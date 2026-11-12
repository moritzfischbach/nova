// Live check: back up on one fresh browser profile, restore on another (both paired via approve-pair.mjs).
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chromium, devices } from '@playwright/test';

const base = process.argv[2] ?? 'https://moritzfischbach.github.io/nova/';
const browser = await chromium.launch({ channel: 'chrome' });
const pass = `Live-${randomBytes(9).toString('base64url')}`; // never printed
const habit = `Live-Backup-Test ${new Date().toISOString().slice(11, 19)}`;
const r = {};
const errors = [];
const mk = async () => {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page };
};
const pair = async (page) => {
  await page.goto(`${base}#/chat`);
  await page.getByTestId('pair-start').waitFor({ timeout: 90000 });
  await page.getByTestId('pair-start').click();
  const code = (await page.getByTestId('pair-code').innerText()).trim();
  execFileSync('node', ['scripts/approve-pair.mjs', code]);
  await page.getByTestId('pair-sheet').waitFor({ state: 'detached', timeout: 30000 });
};
try {
  const a = await mk();
  await pair(a.page);
  await a.page.goto(`${base}#/gewohnheiten`);
  await a.page.getByTestId('habit-new').click();
  await a.page.getByTestId('habit-name').fill(habit);
  await a.page.getByTestId('habit-save').click();
  await a.page.goto(`${base}#/einstellungen`);
  await a.page.getByTestId('backup-setup').click({ timeout: 60000 });
  await a.page.getByTestId('bk-pass').fill(pass);
  await a.page.getByTestId('bk-pass2').fill(pass);
  const t0 = Date.now();
  await a.page.getByTestId('bk-save').click();
  await a.page.getByTestId('backup-status').filter({ hasText: /Zuletzt gesichert|Server|gekoppelt|Fehler/ }).waitFor({ timeout: 90000 });
  r.backupMs = Date.now() - t0;
  r.statusA = (await a.page.getByTestId('backup-status').innerText()).replace(/\s+/g, ' ');
  r.whereA = await a.page.getByTestId('backup-where').innerText().catch(() => null);

  const b = await mk();
  await pair(b.page);
  await b.page.goto(`${base}#/einstellungen`);
  await b.page.getByTestId('backup-found').waitFor({ timeout: 60000 });
  r.found = (await b.page.getByTestId('backup-found').innerText()).replace(/\s+/g, ' ');
  await b.page.getByTestId('backup-found-restore').click();
  await b.page.getByTestId('bk-version').first().waitFor({ timeout: 60000 });
  r.versions = await b.page.getByTestId('bk-version').count();
  await b.page.getByTestId('bk-restore-pass').fill('ganz-falsches-passwort');
  await b.page.getByTestId('bk-restore-go').click();
  await b.page.getByTestId('bk-restore-go').click();
  await b.page.getByTestId('bk-restore-error').filter({ hasText: 'falsch' }).waitFor({ timeout: 60000 });
  r.wrongPassword = await b.page.getByTestId('bk-restore-error').innerText();
  await b.page.getByTestId('bk-restore-pass').fill(pass);
  await b.page.getByTestId('bk-restore-go').click();
  await b.page.getByTestId('bk-restore-go').click();
  await b.page.locator('.toast', { hasText: 'Wiederhergestellt' }).waitFor({ timeout: 60000 });
  r.toast = await b.page.locator('.toast', { hasText: 'Wiederhergestellt' }).innerText();
  await b.page.goto(`${base}#/gewohnheiten`);
  r.habitRestored = await b.page.locator('[data-testid="habit-item"]', { hasText: habit }).isVisible({ timeout: 10000 }).catch(() => false);
  await b.page.goto(`${base}#/einstellungen`);
  r.statusB = (await b.page.getByTestId('backup-status').innerText({ timeout: 60000 })).replace(/\s+/g, ' ');
} catch (e) {
  r.failure = e.message.split('\n')[0];
}
r.errors = errors;
console.log(JSON.stringify(r, null, 1));
await browser.close();
