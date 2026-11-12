// Design screenshots at iPhone size with sample data. Usage: node e2e/screens.mjs <baseUrl> <outDir>
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
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(base);
await page.evaluate(async () => {
  localStorage.clear();
  await new Promise((r) => { const q = indexedDB.deleteDatabase('nova'); q.onsuccess = q.onerror = q.onblocked = () => r(null); });
});
await page.reload();
const settle = () => page.waitForTimeout(900);

// sample data via the UI
await page.goto(base + '#/aufgaben');
for (const t of ['Präsentation für Montag vorbereiten', 'Geschenk für Lena besorgen', 'Steuerunterlagen sortieren', 'Laufschuhe zurückschicken']) {
  await page.getByTestId('todo-input').fill(t);
  await page.getByTestId('todo-input').press('Enter');
}
await page.getByLabel('Abhaken').first().click();
await page.waitForTimeout(500);
await page.getByTestId('tab-goals').click();
await page.getByTestId('goal-new').waitFor();
for (const [title, amount] of [['Urlaub Lissabon', '1.800'], ['Notgroschen', '5.000']]) {
  await page.getByTestId('goal-new').click();
  await page.getByTestId('goal-title').fill(title);
  await page.getByTestId('goal-amount').fill(amount);
  await page.getByTestId('goal-save').click();
  await page.waitForTimeout(800);
  if (await page.locator('.sheet-overlay').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
  await page.getByTestId('tab-goals').click();
  await page.waitForTimeout(500);
}
await page.getByTestId('tab-finance').click();
for (const t of ['+3200 Euro Gehalt', '64,90 Euro Essen Restaurant', '45 Euro Tanken', '19,99 Euro Netflix Abo', '420 Euro Sparen Urlaub', '250 Euro Sparen Notgroschen', '86 Euro Supermarkt Einkauf']) {
  await page.getByTestId('finance-input').fill(t);
  await page.getByTestId('finance-submit').click();
  await page.waitForTimeout(150);
}
await page.getByTestId('tab-calendar').click();
await page.getByTestId('view-timeGridWeek').click();
const today = new Date();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
const events = [
  ['Team-Meeting', day(0), '09:00', '10:00', 1],
  ['Zahnarzt', day(1), '11:00', '12:00', 6],
  ['Lunch mit Lena', day(0), '12:30', '13:30', 3],
  ['Yoga', day(-1), '07:30', '08:30', 3],
  ['Review', day(0), '09:30', '11:00', 2],
  ['Flug nach Lissabon', day(2), '15:00', '18:00', 4],
];
for (const [title, date, s, e, color] of events) {
  await page.getByTestId('cal-add').click();
  await page.getByTestId('event-title').fill(title);
  await page.locator('[data-testid="event-date"]').fill(date);
  await page.locator('[data-testid="event-date"]').dispatchEvent('change');
  await page.getByTestId('event-start').fill(s);
  await page.getByTestId('event-end').fill(e);
  await page.locator('.swatch').nth(color).click();
  await page.getByTestId('event-save').click();
  await page.waitForTimeout(250);
}

const shots = [['overview', '#/'], ['todos', '#/aufgaben'], ['calendar-week', '#/kalender'], ['finance', '#/finanzen'], ['ziele', '#/ziele']];
for (const [name, hash] of shots) {
  await page.goto(base + hash);
  if (name === 'calendar-week') {
    await page.getByTestId('view-timeGridWeek').click();
    await page.evaluate(() => document.querySelector('.ec-body')?.scrollTo?.(0, 8 * 48));
  }
  await page.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 8000 }).catch(() => undefined);
  await settle();
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`${out}/${name}.png`);
}
// extras: event sheet + toast
await page.goto(base + '#/kalender');
await page.getByTestId('cal-add').click();
await settle();
await page.screenshot({ path: `${out}/calendar-sheet.png` });
console.log(`${out}/calendar-sheet.png`);
console.log(errors.length ? `ERRORS: ${errors.join(' | ')}` : 'no console errors');
await browser.close();
