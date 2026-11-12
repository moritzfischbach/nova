// Screenshots for Backup & Sync. Usage: node e2e/screens-backup.mjs <baseUrl> <outDir>
import { chromium, devices } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:8797/';
const out = process.argv[3] ?? '/workspace/nova-shots';
const browser = await chromium.launch({ channel: 'chrome' });
const mk = async () => {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('nova.backupFast', '1'));
  return page;
};
const t = (p, id) => p.getByTestId(id);
await fetch('http://127.0.0.1:8798/backups/reset');
const a = await mk();
await a.goto(base + '#/einstellungen');
await t(a, 'backup-setup').click();
await t(a, 'bk-pass').fill('Mein-Backup-Passwort-2026');
await t(a, 'bk-pass2').fill('Mein-Backup-Passwort-2026');
await t(a, 'bk-save').click();
await t(a, 'backup-status').filter({ hasText: 'Zuletzt gesichert' }).waitFor({ timeout: 20000 });
await t(a, 'backup-now').click();
await t(a, 'backup-status').filter({ hasText: '2 Versionen' }).waitFor({ timeout: 20000 });
await a.waitForTimeout(2500);
await a.evaluate(() => document.querySelector('[data-testid="backup-settings"]').scrollIntoView({ block: 'start' }));
await a.evaluate(() => window.scrollBy(0, -16));
await a.waitForTimeout(400);
await a.screenshot({ path: `${out}/backup.png` });
const b = await mk();
await b.goto(base + '#/einstellungen');
await t(b, 'backup-found').waitFor();
await t(b, 'backup-found-restore').click();
await t(b, 'bk-version').first().waitFor();
await t(b, 'bk-restore-pass').fill('Mein-Backup-Passwort-2026');
await b.waitForTimeout(600);
await b.screenshot({ path: `${out}/restore.png` });
await browser.close();
