// Screenshot of the Morgenplaner at 390px with plan + punctuality data. Usage: node e2e/screens-morgen-fixed.mjs <baseUrl> <out.png>
import { chromium, devices } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:8797/';
const out = process.argv[3] ?? '/workspace/nova-shots/morgen-fixed.png';
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
const page = await ctx.newPage();
const t = (id) => page.getByTestId(id);
await page.goto(base);
await page.evaluate(async () => {
  localStorage.clear(); sessionStorage.clear();
  await new Promise((r) => { const q = indexedDB.deleteDatabase('nova'); q.onsuccess = q.onerror = q.onblocked = () => r(null); });
});
await page.goto(base + '#/morgenplan?neu=1');
await page.reload();
await t('pq-arrive').fill('08:15'); await t('pq-arrive').blur();
for (let i = 0; i < 4; i += 1) await t('pq-next').click();
await t('pq-act-dehnen').click();
await t('pq-next').click(); await t('pq-next').click();
await t('plan-apply').click();
await t('plan-card').waitFor();
await t('wake-now').click();
if (await t('checkin-card').count()) await t('checkin-ja').click();
await page.waitForTimeout(3500);
await page.evaluate(() => document.querySelector('[data-testid="wake-section"]').scrollIntoView({ block: 'center' }));
await page.waitForTimeout(500);
const m = await page.evaluate(() => ({ doc: document.scrollingElement.scrollWidth, vw: innerWidth, view: document.querySelector('.view').scrollWidth }));
await page.screenshot({ path: out });
console.log(JSON.stringify(m));
await browser.close();
