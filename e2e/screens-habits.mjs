// Screenshots for Morgenplaner + Gewohnheiten with realistic sample history.
// Usage: node e2e/screens-habits.mjs <baseUrl> <outDir>
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
  const today = day(0);
  const db = await new Promise((r) => { const q = indexedDB.open('nova'); q.onsuccess = () => r(q.result); });
  const put = (store, value) => new Promise((r, j) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value); tx.oncomplete = () => r(null); tx.onerror = () => j(tx.error); });
  const getAll = (store) => new Promise((r) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => r(q.result); });
  const created = new Date(Date.now() - 60 * 86400_000).toISOString();
  const hist = (fn) => Array.from({ length: 60 }, (_, i) => day(-i - 1)).filter(fn).sort();
  const wd = (s) => ((new Date(s + 'T12:00').getDay() + 6) % 7) + 1;
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const habits = [
    { id: 'h1', name: '2 Liter Wasser', emoji: '💧', frequency: { type: 'daily' }, color: '#9fc4e0', reminderTime: '10:00', completions: [...hist((d) => d > day(-12) || rnd() > 0.22), today] },
    { id: 'h2', name: '10 Minuten lesen', emoji: '📖', frequency: { type: 'daily' }, color: '#d8c39a', reminderTime: '21:30', completions: hist((d) => d > day(-6) || rnd() > 0.35) },
    { id: 'h3', name: 'Laufen', emoji: '🏃', frequency: { type: 'perWeek', times: 3 }, color: '#9cc5a8', completions: hist((d) => [1, 3, 6].includes(wd(d)) && rnd() > 0.15) },
    { id: 'h4', name: 'Meditieren', emoji: '🧘', frequency: { type: 'weekdays', days: [1, 2, 3, 4, 5] }, color: '#c2a6d8', reminderTime: '07:10', completions: hist((d) => wd(d) <= 5 && (d > day(-9) || rnd() > 0.3)) },
  ];
  for (const h of habits) await put('habits', { ...h, createdAt: created, updatedAt: created });
  await put('meta', { key: 'morning.config', value: { wakeTime: '06:45', remind: true, budget: 1400, routine: [
    { id: 'r1', title: 'Ein Glas Wasser trinken', time: '06:45' },
    { id: 'r2', title: '5 Minuten dehnen', time: '06:50' },
    { id: 'r3', title: 'Meditieren', time: '07:00' },
    { id: 'r4', title: 'Duschen & anziehen', time: '07:15' },
    { id: 'r5', title: 'Frühstück & Kaffee', time: '07:30' },
  ], checks: { [today]: ['r1', 'r2'] } } });
  const lists = await getAll('todoLists');
  const L = lists[0]?.id;
  const now = new Date().toISOString();
  const todos = [['Angebot für Weber GmbH fertigstellen', today, '16:00'], ['Steuerunterlagen sortieren', day(-2)], ['Geschenk für Lena besorgen', today]];
  for (const [i, [title, dueDate, dueTime]] of todos.entries()) await put('todos', { id: `t${i}`, listId: L, title, done: false, createdAt: now, dueDate, dueTime });
  const ev = (id, title, startTime, endTime, location) => ({ id, uid: `${id}@nova`, title, date: today, startTime, endTime, allDay: false, location, calendarId: 'nova', createdAt: now, updatedAt: now });
  await put('events', ev('e1', 'Team-Call', '09:30', '10:00'));
  await put('events', ev('e2', 'Mittagessen mit Jonas', '12:30', '13:30', 'Café Lotte'));
  await put('events', ev('e3', 'Yoga', '18:30', '19:30', 'Studio Mitte'));
  await put('goals', { id: 'g1', kind: 'spar', title: 'Urlaub Lissabon', targetAmount: 1800, deposits: [{ id: 'd1', amount: 650, date: day(-20) }, { id: 'd2', amount: 300, date: day(-3) }], status: 'offen', color: '#d8c39a', keywords: ['urlaub'], createdAt: now, updatedAt: now });
  await put('goals', { id: 'g2', kind: 'spar', title: 'Notgroschen', targetAmount: 5000, deposits: [{ id: 'd3', amount: 2100, date: day(-30) }], status: 'offen', color: '#9cc5a8', keywords: [], createdAt: now, updatedAt: now });
  const cats = (await getAll('categories')).filter((c) => c.type === 'expense');
  const month = today.slice(0, 8);
  const spend = [[54.2, 'Lebensmittel'], [89.9, 'Tanken'], [32.5, 'Essen'], [220, 'Miete Anteil'], [61.3, 'Drogerie']];
  for (const [i, [amount, note]] of spend.entries()) {
    const dd = `${month}${pad(Math.min(Number(today.slice(8)), 1 + i * 2))}`;
    await put('transactions', { id: `x${i}`, amount, currency: 'EUR', type: 'expense', categoryId: cats[i % cats.length].id, note, date: dd, rawInput: `${amount} ${note}`, createdAt: now });
  }
});

const settle = () => page.waitForTimeout(1000);
await page.goto(base + '#/');
await page.reload();
await settle();
await page.screenshot({ path: `${out}/overview-morning.png` });
await page.goto(base + '#/morgen');
await settle();
await page.screenshot({ path: `${out}/morgen.png` });
await page.screenshot({ path: `${out}/morgen-full.png`, fullPage: true });
await page.goto(base + '#/gewohnheiten');
await page.reload();
await settle();
await page.screenshot({ path: `${out}/habits.png` });
await page.locator('[data-testid="habit-item"]', { hasText: '2 Liter Wasser' }).locator('.habit-copy').click();
await settle();
await page.screenshot({ path: `${out}/habits-detail.png` });
console.log(JSON.stringify({ errors }, null, 1));
await browser.close();
