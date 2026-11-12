import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

const LOCKED = 'http://127.0.0.1:8799';
const ADMIN = 'e2e-admin-token-0123456789abcdef';

test('device-code pairing: button → code → admin approves via script → chat works', async ({ page }) => {
  await page.goto(`${LOCKED}/#/chat`);
  const note = page.getByTestId('chat-note');
  await expect(note).toContainText('noch nicht mit dem Nova-Server gekoppelt');
  await expect(page.getByTestId('chat-input')).toBeVisible();
  await page.getByTestId('pair-start').click();
  const code = (await page.getByTestId('pair-code').innerText()).trim();
  expect(code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
  await expect(page.getByTestId('pair-sheet')).toContainText(`Kopple Nova mit Code ${code}`);

  // wrong admin token fails, real one succeeds – the script prints only success/failure
  const run = (token: string) => {
    try {
      return execFileSync('node', ['scripts/approve-pair.mjs', code, LOCKED], { env: { ...process.env, NOVA_APP_TOKEN: token, NOVA_SECRETS_DIR: '/nonexistent' } }).toString();
    } catch (e) {
      return String((e as { stdout?: Buffer }).stdout ?? '');
    }
  };
  expect(run('wrong-token-123456')).toContain('Fehlgeschlagen');
  const out = run(ADMIN);
  expect(out.trim()).toBe('Erfolg: Kopplung bestätigt.');

  await expect(page.getByTestId('pair-sheet')).toHaveCount(0, { timeout: 15000 });
  await expect(note).toHaveCount(0);
  const token = await page.evaluate(() => localStorage.getItem('nova.appToken'));
  expect(token).toMatch(/^nd1\./);

  await page.getByTestId('chat-input').fill('Hallo Nova');
  await page.getByTestId('chat-send').click();
  await expect(page.locator('.msg.assistant:not(.streaming) [data-testid="msg-text"]')).toBeVisible();

  await page.getByTestId('tab-overview').click();
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('pair-state')).toHaveText('Mit dem Nova-Server gekoppelt.');
  await expect(page.getByTestId('settings-pair-start')).toBeHidden();
});

test('settings offer pairing on an unpaired device; expired/invalid token asks to re-pair', async ({ page }) => {
  await page.goto(`${LOCKED}/#/einstellungen`);
  await expect(page.getByTestId('pair-state')).toHaveText('Noch nicht mit dem Nova-Server gekoppelt.');
  await expect(page.getByTestId('settings-pair-start')).toHaveText('Gerät koppeln');
  await page.evaluate(() => localStorage.setItem('nova.appToken', 'nd1.revoked0000.1700000000.invalidsig'));
  await page.goto(`${LOCKED}/#/chat`);
  await page.reload();
  await expect(page.getByTestId('chat-note')).toContainText('nicht mehr mit dem Nova-Server gekoppelt');
  await expect(page.getByTestId('pair-start')).toBeVisible();
});

test('pairing survives an app reload (iOS may reload the home-screen app while the user is in the Grok app)', async ({ page }) => {
  await page.goto(`${LOCKED}/#/chat`);
  await page.getByTestId('pair-start').click();
  const code = (await page.getByTestId('pair-code').innerText()).trim();
  await expect(page.getByTestId('pair-sheet')).toContainText('Home-Bildschirm-App und Safari speichern getrennt');
  await page.reload();
  await expect(page.getByTestId('pair-code')).toHaveText(code);
  const out = execFileSync('node', ['scripts/approve-pair.mjs', code, LOCKED], { env: { ...process.env, NOVA_APP_TOKEN: ADMIN, NOVA_SECRETS_DIR: '/nonexistent' } }).toString();
  expect(out.trim()).toBe('Erfolg: Kopplung bestätigt.');
  await expect(page.getByTestId('pair-sheet')).toHaveCount(0, { timeout: 15000 });
  await expect(page.getByTestId('chat-note')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('nova.pairPending'))).toBeNull();
});

test('sending while unpaired explains why instead of failing silently', async ({ page }) => {
  await page.goto(`${LOCKED}/#/chat`);
  await expect(page.getByTestId('pair-start')).toBeVisible();
  await page.getByTestId('chat-input').fill('Hallo?');
  await page.getByTestId('chat-send').click();
  await expect(page.locator('.toast').last()).toContainText('noch nicht mit dem Nova-Server gekoppelt');
});
