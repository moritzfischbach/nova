// Screenshots for the Morgenplan-Quiz. Usage: node e2e/screens-plan.mjs <baseUrl> <outDir>
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:8797/';
const out = process.argv[3] ?? '/workspace/nova-shots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'de-DE', timezoneId: 'Europe/Berlin' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await page.evaluate(async () => {
  localStorage.clear();
  sessionStorage.clear();
  await new Promise((r) => { const q = indexedDB.deleteDatabase('nova'); q.onsuccess = q.onerror = q.onblocked = () => r(null); });
});
await page.reload();
await page.getByTestId('open-morning').waitFor();
const settle = () => page.waitForTimeout(700);
const t = (id) => page.getByTestId(id);
await page.goto(base + '#/morgen');
await settle();
await page.screenshot({ path: `${out}/plan-cta.png` });
await t('plan-start').click();
await settle();
await t('pq-arrive').fill('08:15');
await t('pq-arrive').blur();
await t('pq-next').click();
await t('pq-travel-30').click();
await t('pq-buffer-10').click();
await t('pq-next').click();
await t('pq-sleep-75').click();
await t('pq-bedtime').fill('23:15');
await t('pq-bedtime').blur();
await t('pq-next').click();
await t('pq-wake-normal').click();
await t('pq-next').click();
await t('pq-act-dehnen').click();
await t('pq-act-sport').click();
await t('pq-dec-sport').click();
await t('pq-dec-sport').click();
await t('pq-act-planen').click();
await page.evaluate(() => window.scrollTo(0, 0));
await settle();
await page.screenshot({ path: `${out}/plan-quiz.png` });
await t('pq-next').click();
await t('pq-me-10').click();
await t('pq-next').click();
await t('plan-result').waitFor();
await settle();
await page.setViewportSize({ width: 390, height: 1900 });
await settle();
await page.screenshot({ path: `${out}/plan-result.png` });
await t('plan-apply').click();
await t('plan-card').waitFor();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/plan-applied.png` });
const info = {
  wake: await t('plan-card-wake').textContent(),
  routine: await t('routine-item').count(),
};
console.log(JSON.stringify({ info, errors }));
await browser.close();
