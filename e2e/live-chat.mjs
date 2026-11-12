// Live chat check against a running Nova (real xAI). Usage: node e2e/live-chat.mjs <appUrl> <screenshot> [pairing-code-file]
import { chromium, devices } from '@playwright/test';
const base = process.argv[2] ?? 'http://127.0.0.1:8787/';
const out = process.argv[3] ?? '/workspace/nova-shots/chat-real.png';
const init = process.argv[4]; // optional file with pairing code (never printed)
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'de-DE', timezoneId: 'Europe/Berlin' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
if (init) {
  const { readFileSync } = await import('node:fs');
  const code = readFileSync(init, 'utf8').trim();
  await page.goto(`${base}#/koppeln?code=${encodeURIComponent(code)}`);
} else {
  await page.goto(`${base}#/chat`);
}
await page.getByTestId('chat').waitFor();
await page.waitForFunction(() => /grok/i.test(document.querySelector('[data-testid="chat-sub"]')?.textContent ?? ''), null, { timeout: 90000 });
await page.getByTestId('chat-input').fill('Hallo Nova! Was steht diese Woche bei mir an? Antworte kurz.');
await page.getByTestId('chat-send').click();
await page.locator('.msg.assistant:not(.streaming)').last().waitFor({ timeout: 120000 });
await page.waitForTimeout(600);
const hasText = await page.locator('.msg.assistant [data-testid="msg-text"]').count();
const hasErr = await page.getByTestId('msg-error').count();
const note = await page.getByTestId('chat-note').count();
await page.screenshot({ path: out });
console.log(JSON.stringify({ reply: hasText > 0, error: hasErr > 0 ? await page.getByTestId('msg-error').first().innerText() : null, note: note ? await page.getByTestId('chat-note').innerText() : null, url_has_code: page.url().includes('code='), errors }));
await browser.close();
