// Live check: Morgenplan-Quiz on the deployed app, „Mit Nova verfeinern“ with a real Grok answer, then „Plan übernehmen“.
import { execFileSync } from 'node:child_process';
import { chromium, devices } from '@playwright/test';

const base = process.argv[2] ?? 'https://moritzfischbach.github.io/nova/';
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'de-DE', timezoneId: 'Europe/Berlin' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const r = {};
const t = (id) => page.getByTestId(id);
try {
  await page.goto(`${base}#/chat`);
  await t('pair-start').waitFor({ timeout: 90000 });
  await t('pair-start').click();
  const code = (await t('pair-code').innerText()).trim();
  execFileSync('node', ['scripts/approve-pair.mjs', code]);
  r.paired = true;
  await t('pair-sheet').waitFor({ state: 'detached', timeout: 30000 });

  await page.goto(`${base}#/morgen`);
  r.cta = (await t('plan-start').innerText()).replace(/\s+/g, ' ');
  await t('plan-start').click();
  await t('pq-arrive').fill('08:00');
  await t('pq-arrive').blur();
  await t('pq-next').click();
  await t('pq-travel-20').click();
  await t('pq-buffer-10').click();
  r.derived = await t('pq-derived').innerText();
  await t('pq-next').click();
  await t('pq-sleep-75').click();
  await t('pq-next').click();
  await t('pq-wake-langsam').click();
  await t('pq-next').click();
  await t('pq-act-dehnen').click();
  await t('pq-next').click();
  await t('pq-next').click();
  await t('plan-result').waitFor();
  r.wake = await t('plan-wake').innerText();
  r.leave = await t('plan-leave').innerText();
  r.arrival = await t('plan-arrival').innerText();
  r.bedtime = await t('plan-bedtime').innerText();
  r.steps = await t('plan-step').count();

  await t('plan-refine').click();
  await page.locator('.msg.assistant:not(.streaming) [data-testid="msg-text"], [data-testid="msg-error"]').first().waitFor({ timeout: 120000 });
  r.reply = (await page.locator('.msg.assistant [data-testid="msg-text"]').last().innerText().catch(() => '')).slice(0, 400);
  r.replyError = (await t('msg-error').count()) ? await t('msg-error').innerText() : null;

  await page.goto(`${base}#/morgenplan`);
  await t('plan-apply').click();
  await t('plan-card').waitFor();
  r.card = (await t('plan-card').innerText()).replace(/\s+/g, ' ');
  r.routine = await t('routine-item').count();
  r.wakeNow = await t('wake-now').count();
} catch (e) {
  r.failure = e.message.split('\n')[0];
  await page.screenshot({ path: '/tmp/live-plan-failure.png' }).catch(() => undefined);
}
r.errors = errors;
console.log(JSON.stringify(r, null, 1));
await browser.close();
