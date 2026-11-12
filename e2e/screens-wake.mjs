// Screenshots for Wach-Quiz + Pünktlichkeit. Usage: node e2e/screens-wake.mjs <baseUrl> <outDir>
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
  await new Promise((r) => { const q = indexedDB.deleteDatabase('nova'); q.onsuccess = q.onerror = q.onblocked = () => r(null); });
});
await page.reload();
await page.getByTestId('open-morning').waitFor();
await page.evaluate(async () => {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
  const wd = (s) => ((new Date(s + 'T12:00').getDay() + 6) % 7) + 1;
  const db = await new Promise((r) => { const q = indexedDB.open('nova'); q.onsuccess = () => r(q.result); });
  const put = (store, value) => new Promise((r, j) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value); tx.oncomplete = () => r(null); tx.onerror = () => j(tx.error); });
  const work = { days: { 1: { start: '08:30', travel: 30 }, 2: { start: '08:30', travel: 30 }, 3: { start: '08:30', travel: 30 }, 4: { start: '08:30', travel: 30 }, 5: { start: '08:00', travel: 30 } }, leaveRemind: true, leaveLead: 10, checkinTime: '18:30' };
  await put('meta', { key: 'morning.config', value: { wakeTime: '07:00', remind: true, routine: [
    { id: 'r1', title: 'Ein Glas Wasser trinken', time: '06:50' }, { id: 'r2', title: '5 Minuten dehnen', time: '06:55' }, { id: 'r3', title: 'Duschen & anziehen', time: '07:05' }, { id: 'r4', title: 'Frühstück', time: '07:20' },
  ], checks: {}, wakeGoal: { goal: '06:30', gradual: true, start: '07:10', startDate: day(-15), stepMinutes: 10, everyDays: 7 }, work, linkHabits: true } });
  const logs = {};
  const woke = ['06:47', '06:52', '06:58', '07:16', '06:55', '06:49', '06:51', '07:04', '07:08', '06:52', '07:15', '06:59', '07:12', '07:05'];
  for (let i = 1; i <= 14; i += 1) {
    const d = day(-i);
    const target = i > 14 ? '07:10' : i > 7 ? '07:00' : '06:50';
    const w = woke[i - 1];
    const toM = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const early = toM(w) <= toM(target) + 10;
    logs[d] = { date: d, quizAt: w.replace(/:(\d)\d$/, (m, a) => `:${a}9`), wokeAt: w, target, early, score: 2, total: 2 };
    if (wd(d) <= 5) logs[d].punctual = i === 5 ? 'spaet' : i % 4 === 0 ? 'knapp' : 'ja';
  }
  await put('meta', { key: 'wake.log', value: logs });
});
const settle = () => page.waitForTimeout(900);
await page.goto(base + '#/morgen');
await page.reload();
await settle();
await page.screenshot({ path: `${out}/morgen-wake.png` });
// quiz: answer wake time, then go to the first choice question for the screenshot
await page.getByTestId('quiz-start').click();
await settle();
await page.getByTestId('quiz-time').fill('06:48');
await page.screenshot({ path: `${out}/quiz-q1.png` });
await page.getByTestId('quiz-next').click();
await page.waitForTimeout(400);
if (await page.getByTestId('quiz-memo').count()) {
  await page.screenshot({ path: `${out}/quiz.png` });
  await page.getByTestId('quiz-memo-ok').click();
} else await page.screenshot({ path: `${out}/quiz.png` });
for (let i = 0; i < 3; i += 1) {
  await page.waitForTimeout(300);
  if (await page.getByTestId('quiz-result').count()) break;
  if (await page.getByTestId('quiz-memo-ok').count()) { await page.getByTestId('quiz-memo-ok').click(); continue; }
  if (await page.getByTestId('quiz-option').count()) { await page.getByTestId('quiz-option').first().click(); await page.waitForTimeout(1500); continue; }
  if (await page.getByTestId('quiz-text').count()) await page.getByTestId('quiz-text').fill('Angebot für Weber fertig schreiben');
  if (await page.getByTestId('quiz-time').count()) await page.getByTestId('quiz-time').fill('07:55');
  await page.getByTestId('quiz-next').click();
}
await page.getByTestId('quiz-result').waitFor();
await settle();
await page.screenshot({ path: `${out}/quiz-result.png` });
await page.getByTestId('result-close').click();
await settle();
await page.getByTestId('wake-section').scrollIntoViewIfNeeded();
await page.evaluate(() => document.querySelector('[data-testid="wake-section"]').scrollIntoView({ block: 'start' }));
await settle();
await page.screenshot({ path: `${out}/puenktlich.png` });
await page.getByTestId('work-tile').click();
await settle();
await page.screenshot({ path: `${out}/puenktlich-stats.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.getByTestId('wake-setup').click();
await settle();
await page.screenshot({ path: `${out}/puenktlich-settings.png` });
console.log(JSON.stringify({ errors }, null, 1));
await browser.close();
