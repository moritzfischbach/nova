// Live check: Wach-Quiz + Pünktlichkeit on the deployed app, plus a real chat answer using the stats.
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
  await page.goto(`${base}#/morgen`);
  await t('wake-setup').click();
  await t('wake-goal').fill('06:30');
  await t('wake-start').fill('07:10');
  await t('wake-gradual').check();
  for (let i = 1; i <= 7; i += 1) await t(`work-day-${i}`).check();
  await t('wake-save').click();
  await page.locator('[data-testid="wake-plan"]', { hasText: 'Ziel 06:30' }).waitFor();
  r.target = await t('wake-target').innerText();
  r.plan = await t('wake-plan').innerText();
  r.leave = await t('leave-time').innerText();
  await t('quiz-start').click();
  await t('quiz-time').fill('07:05');
  await t('quiz-next').click();
  for (let i = 0; i < 6 && !(await t('quiz-result').count()); i += 1) {
    await page.waitForTimeout(300);
    if (await t('quiz-result').count()) break;
    if (await t('quiz-memo-ok').count()) await t('quiz-memo-ok').click();
    else if (await t('quiz-option').count()) { r.q = (r.q ?? []).concat(await t('quiz-prompt').innerText()); await t('quiz-option').nth(1).click(); await page.waitForTimeout(1500); }
    else if (await t('quiz-text').count()) { await t('quiz-text').fill('Angebot fertig'); await t('quiz-next').click(); }
    else if (await t('quiz-time').count()) { await t('quiz-time').fill('07:55'); await t('quiz-next').click(); }
  }
  r.result = (await t('quiz-result').innerText()).replace(/\s+/g, ' ');
  await t('result-close').click();
  if (await t('checkin-card').count()) { await t('checkin-ja').click(); r.checkin = 'ja'; }
  await page.goto(`${base}#/chat`);
  await t('pair-start').waitFor({ timeout: 90000 });
  await t('pair-start').click();
  const code = (await t('pair-code').innerText()).trim();
  r.approve = execFileSync('node', ['scripts/approve-pair.mjs', code]).toString().trim();
  await t('pair-sheet').waitFor({ state: 'detached', timeout: 30000 });
  await t('chat-input').fill('Wie lief heute mein Aufstehen und wann muss ich los?');
  await t('chat-send').click();
  await page.locator('.msg.assistant:not(.streaming) [data-testid="msg-text"], [data-testid="msg-error"]').first().waitFor({ timeout: 120000 });
  r.reply = (await page.locator('.msg.assistant [data-testid="msg-text"]').last().innerText().catch(() => '')).slice(0, 500);
  r.replyError = (await t('msg-error').count()) ? await t('msg-error').innerText() : null;
} catch (e) {
  r.failure = e.message.split('\n')[0];
  await page.screenshot({ path: '/tmp/live-wake-failure.png' }).catch(() => undefined);
}
r.errors = errors;
console.log(JSON.stringify(r, null, 1));
await browser.close();
