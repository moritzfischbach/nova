// Live check for Morgenplaner + Gewohnheiten incl. real Grok tool calls.
// Usage: node e2e/live-habits.mjs <appUrl> <shotDir>
import { execFileSync } from 'node:child_process';
import { chromium, devices } from '@playwright/test';

const base = process.argv[2] ?? 'https://moritzfischbach.github.io/nova/';
const out = process.argv[3] ?? '/tmp';
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'de-DE', timezoneId: 'Europe/Berlin' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const r = {};
const chips = () => page.getByTestId('tool-chip');
const waitReply = async () => {
  await page.waitForTimeout(800);
  await page.locator('.msg.streaming').waitFor({ state: 'detached', timeout: 120000 });
};
try {
  await page.goto(base);
  await page.getByTestId('open-morning').waitFor({ timeout: 30000 });
  r.morningCard = (await page.getByTestId('open-morning').innerText()).replace(/\s+/g, ' ');
  await page.goto(`${base}#/gewohnheiten`);
  await page.getByTestId('habit-new').click();
  await page.getByTestId('habit-name').fill('Wasser trinken');
  await page.getByTestId('habit-save').click();
  await page.getByTestId('habit-check').first().click();
  await page.waitForTimeout(400);
  r.habitStreak = await page.getByTestId('habit-streak').first().innerText();
  await page.goto(`${base}#/morgen`);
  await page.getByTestId('morning-habits').waitFor();
  r.morningSummary = await page.getByTestId('morning-summary').innerText();

  // pair this browser with the live server
  await page.goto(`${base}#/chat`);
  await page.getByTestId('pair-start').waitFor({ timeout: 90000 });
  await page.getByTestId('pair-start').click();
  const code = (await page.getByTestId('pair-code').innerText()).trim();
  r.approve = execFileSync('node', ['scripts/approve-pair.mjs', code]).toString().trim();
  await page.getByTestId('pair-sheet').waitFor({ state: 'detached', timeout: 30000 });

  await page.getByTestId('chat-input').fill('Leg bitte eine neue Gewohnheit an: 10 Minuten lesen, täglich, Erinnerung um 21:00.');
  await page.getByTestId('chat-send').click();
  await waitReply();
  const c1 = chips().last();
  r.createTool = await c1.getAttribute('data-tool').catch(() => null);
  r.createDesc = await c1.locator('.tool-desc').innerText().catch(() => null);
  await c1.getByTestId('tool-confirm').click();
  await waitReply();
  r.createStatus = await c1.getAttribute('data-status');

  await page.getByTestId('chat-input').fill('Ich habe heute schon 10 Minuten gelesen – hak das bitte ab.');
  await page.getByTestId('chat-send').click();
  await waitReply();
  const c2 = chips().last();
  r.checkTool = await c2.getAttribute('data-tool').catch(() => null);
  await c2.getByTestId('tool-confirm').click();
  await waitReply();
  r.checkSummary = await c2.locator('.tool-desc').innerText().catch(() => null);
  await page.screenshot({ path: `${out}/live-habit-chat.png` });

  await page.goto(`${base}#/morgen`);
  await page.getByTestId('morning-plan').click();
  await page.waitForURL(/#\/chat/);
  await page.getByTestId('msg-user').last().waitFor();
  await waitReply();
  r.planTools = await chips().evaluateAll((els) => els.filter((e) => e.getAttribute('data-status') === 'offen').map((e) => `${e.dataset.tool}: ${e.querySelector('.tool-desc')?.textContent}`));
  r.planText = ((await page.getByTestId('msg-text').last().innerText().catch(() => '')) || '').slice(0, 300);
  await page.screenshot({ path: `${out}/live-plan.png` });
  r.msgErrors = await page.getByTestId('msg-error').allInnerTexts();
} catch (e) {
  r.failure = e.message.split('\n')[0];
  await page.screenshot({ path: `${out}/live-habits-failure.png` }).catch(() => undefined);
}
r.errors = errors;
console.log(JSON.stringify(r, null, 1));
await browser.close();
