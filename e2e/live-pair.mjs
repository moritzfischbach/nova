// Live device-code pairing check. Usage: node e2e/live-pair.mjs <appUrl> <shotDir>
// Starts a pairing in a fresh browser, approves it with scripts/approve-pair.mjs, then chats.
import { execFileSync } from 'node:child_process';
import { chromium, devices } from '@playwright/test';

const base = process.argv[2] ?? 'https://moritzfischbach.github.io/nova/';
const out = process.argv[3] ?? '/workspace/nova-shots';
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'de-DE', timezoneId: 'Europe/Berlin' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const result = {};
try {
  await page.goto(`${base}#/chat`);
  await page.getByTestId('pair-start').waitFor({ timeout: 90000 });
  result.note = await page.getByTestId('chat-note').innerText();
  result.button = await page.getByTestId('pair-start').innerText();
  await page.getByTestId('pair-start').click();
  await page.getByTestId('pair-code').waitFor({ timeout: 60000 });
  const code = (await page.getByTestId('pair-code').innerText()).trim();
  await page.waitForTimeout(900);
  result.sheet = await page.getByTestId('pair-sheet').innerText();
  await page.screenshot({ path: `${out}/pair.png` });
  result.approve = execFileSync('node', ['scripts/approve-pair.mjs', code]).toString().trim();
  await page.getByTestId('pair-sheet').waitFor({ state: 'detached', timeout: 30000 });
  result.paired = /^nd1\./.test((await page.evaluate(() => localStorage.getItem('nova.appToken'))) ?? '');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/pair-done.png` });
  await page.getByTestId('chat-input').fill('Hallo Nova! Sag mir kurz, dass die Kopplung geklappt hat.');
  await page.getByTestId('chat-send').click();
  await page.locator('.msg.assistant:not(.streaming)').last().waitFor({ timeout: 120000 });
  result.reply = (await page.locator('.msg.assistant [data-testid="msg-text"]').count()) > 0;
  result.replyError = (await page.getByTestId('msg-error').count()) ? await page.getByTestId('msg-error').innerText() : null;
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/pair-chat.png` });
} catch (e) {
  result.failure = e.message.split('\n')[0];
  await page.screenshot({ path: `${out}/pair-failure.png` }).catch(() => undefined);
}
result.errors = errors;
console.log(JSON.stringify(result, null, 1));
await browser.close();
