import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { control, resetApp } from './helpers';

const PASS = 'Mein-Backup-Passwort-2026';
const LOCKED = 'http://127.0.0.1:8799';
const ADMIN = 'e2e-admin-token-0123456789abcdef';

async function addHabit(page: Page, name: string, base = '') {
  await page.goto(`${base}/#/gewohnheiten`);
  await page.getByTestId('habit-new').click();
  await page.getByTestId('habit-name').fill(name);
  await page.getByTestId('habit-save').click();
  await expect(page.locator('[data-testid="habit-item"]', { hasText: name })).toBeVisible();
}

async function freshPage(browser: Browser, base = '') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE', timezoneId: 'Europe/Berlin', acceptDownloads: true, baseURL: base || 'http://127.0.0.1:8797' });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('nova.backupFast', '1'));
  return { ctx, page };
}

async function setupPassword(page: Page, base = '') {
  await page.goto(`${base}/#/einstellungen`);
  await page.getByTestId('backup-setup').click();
  await page.getByTestId('bk-pass').fill('zu-kurz');
  await page.getByTestId('bk-pass2').fill('zu-kurz');
  await page.getByTestId('bk-save').click();
  await expect(page.getByTestId('bk-error')).toContainText('mindestens 10 Zeichen');
  await page.getByTestId('bk-pass').fill(PASS);
  await page.getByTestId('bk-pass2').fill(PASS);
  await page.getByTestId('bk-save').click();
  await expect(page.getByTestId('backup-status')).toContainText('Zuletzt gesichert: heute', { timeout: 20000 });
}

test.beforeEach(async () => {
  await control('/backups/reset');
});

test('Backup einrichten → automatisch sichern → auf frischem Gerät mit Passwort wiederherstellen', async ({ page, browser }) => {
  await page.addInitScript(() => localStorage.setItem('nova.backupFast', '1'));
  await resetApp(page, '#/');
  await addHabit(page, 'Backup-Testgewohnheit');
  await setupPassword(page);
  await expect(page.getByTestId('backup-status')).toContainText('1 Version');
  await expect(page.getByTestId('backup-where')).toContainText('die letzten 10 Versionen');

  // server only holds ciphertext
  const raw = await control<string[]>('/backups/raw');
  expect(raw.length).toBe(1);
  expect(raw[0]).not.toContain('Backup-Testgewohnheit');
  expect(raw[0]).not.toContain(PASS);
  expect(JSON.parse(raw[0]).envelope.cipher.name).toBe('AES-GCM');

  // a change triggers an automatic (debounced) backup
  await addHabit(page, 'Zweite Gewohnheit');
  await page.goto('/#/einstellungen');
  await expect(page.getByTestId('backup-status')).toContainText('2 Versionen', { timeout: 20000 });

  // manual backup
  await page.getByTestId('backup-now').click();
  await expect(page.getByTestId('backup-status')).toContainText('3 Versionen', { timeout: 20000 });

  // fresh device (e.g. home-screen app after Safari)
  const { ctx, page: other } = await freshPage(browser);
  await other.goto('/#/einstellungen');
  await expect(other.getByTestId('backup-found')).toContainText('Backup gefunden');
  await other.getByTestId('backup-found-restore').click();
  await expect(other.getByTestId('bk-version')).toHaveCount(3);
  await expect(other.getByTestId('bk-version').first()).toContainText('neueste');
  await other.getByTestId('bk-restore-pass').fill('falsches-passwort-123');
  await other.getByTestId('bk-restore-go').click();
  await expect(other.getByTestId('bk-confirm-replace')).toBeVisible();
  await other.getByTestId('bk-restore-go').click();
  await expect(other.getByTestId('bk-restore-error')).toHaveText('Passwort oder Wiederherstellungsschlüssel ist falsch.');
  await other.getByTestId('bk-restore-pass').fill(PASS);
  await other.getByTestId('bk-restore-go').click();
  await other.getByTestId('bk-restore-go').click();
  await expect(other.locator('.toast')).toContainText('Wiederhergestellt', { timeout: 15000 });
  await other.goto('/#/gewohnheiten');
  await expect(other.locator('[data-testid="habit-item"]', { hasText: 'Backup-Testgewohnheit' })).toBeVisible();
  await expect(other.locator('[data-testid="habit-item"]', { hasText: 'Zweite Gewohnheit' })).toBeVisible();
  // the restored device keeps backing up with the same password
  await other.goto('/#/einstellungen');
  await expect(other.getByTestId('backup-status')).toContainText('Zuletzt gesichert');
  await expect(other.getByTestId('backup-now')).toBeVisible();
  await ctx.close();
});

test('Backup-Datei mit Wiederherstellungsschlüssel exportieren und auf anderem Gerät zusammenführen', async ({ page, browser }) => {
  await resetApp(page, '#/');
  await addHabit(page, 'Aus der Datei');
  await page.goto('/#/einstellungen');
  await page.getByTestId('backup-export').click();
  await expect(page.getByTestId('backup-setup-sheet')).toBeVisible();
  await page.getByTestId('bk-mode-recovery').click();
  const key = (await page.getByTestId('bk-recovery-key').innerText()).trim();
  expect(key).toMatch(/^([A-Z2-9]{4}-){5}[A-Z2-9]{4}$/);
  await page.getByTestId('bk-save').click();
  await expect(page.getByTestId('bk-error')).toContainText('bestätige');
  await page.getByTestId('bk-confirm').check();
  await page.getByTestId('bk-save').click();
  await expect(page.getByTestId('backup-status')).toContainText('Zuletzt gesichert', { timeout: 20000 });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('backup-export').click()]);
  expect(download.suggestedFilename()).toMatch(/^Nova-Backup-\d{4}-\d{2}-\d{2}-\d{4}\.nova$/);
  const file = await download.path();
  const text = readFileSync(file!, 'utf8');
  expect(text).not.toContain('Aus der Datei');
  expect(JSON.parse(text).kdf.secret).toBe('recovery');

  const { ctx, page: other } = await freshPage(browser);
  await addHabit(other, 'Nur auf Gerät B');
  await other.goto('/#/einstellungen');
  await other.getByTestId('backup-file').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/octet-stream', buffer: Buffer.from(text) });
  await expect(other.getByTestId('bk-file-name')).toContainText('.nova');
  await other.getByTestId('bk-merge').click();
  await other.getByTestId('bk-restore-pass').fill(key.toLowerCase().replace(/-/g, ' '));
  await other.getByTestId('bk-restore-go').click();
  await expect(other.locator('.toast')).toContainText('Wiederhergestellt', { timeout: 15000 });
  await other.goto('/#/gewohnheiten');
  await expect(other.locator('[data-testid="habit-item"]', { hasText: 'Aus der Datei' })).toBeVisible();
  await expect(other.locator('[data-testid="habit-item"]', { hasText: 'Nur auf Gerät B' })).toBeVisible();
  await ctx.close();
});

test('Neues, ungekoppeltes Gerät: erst koppeln, dann Backup finden und wiederherstellen', async ({ browser }) => {
  const approve = (code: string) => execFileSync('node', ['scripts/approve-pair.mjs', code, LOCKED], { env: { ...process.env, NOVA_APP_TOKEN: ADMIN, NOVA_SECRETS_DIR: '/nonexistent' } }).toString();
  const pair = async (p: Page) => {
    await p.goto(`${LOCKED}/#/einstellungen`);
    await p.getByTestId('settings-pair-start').click();
    approve((await p.getByTestId('pair-code').innerText()).trim());
    await expect(p.getByTestId('pair-sheet')).toHaveCount(0, { timeout: 15000 });
  };
  const a = await freshPage(browser, LOCKED);
  await addHabit(a.page, 'Vom alten iPhone', LOCKED);
  await pair(a.page);
  await setupPassword(a.page, LOCKED);

  const b = await freshPage(browser, LOCKED);
  await b.page.goto(`${LOCKED}/#/einstellungen`);
  await expect(b.page.getByTestId('backup-pair-hint')).toBeVisible();
  await expect(b.page.getByTestId('backup-found')).toHaveCount(0);
  await pair(b.page);
  await b.page.reload();
  await expect(b.page.getByTestId('backup-found')).toBeVisible();
  await b.page.getByTestId('backup-found-restore').click();
  await b.page.getByTestId('bk-restore-pass').fill(PASS);
  await b.page.getByTestId('bk-restore-go').click();
  await b.page.getByTestId('bk-restore-go').click();
  await expect(b.page.locator('.toast')).toContainText('Wiederhergestellt', { timeout: 15000 });
  await b.page.goto(`${LOCKED}/#/gewohnheiten`);
  await expect(b.page.locator('[data-testid="habit-item"]', { hasText: 'Vom alten iPhone' })).toBeVisible();
  await a.ctx.close();
  await b.ctx.close();
});
