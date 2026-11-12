// Smoke test for the static-only build (GitHub Pages). Usage: node e2e/static-smoke.mjs <url>
import { chromium, devices } from '@playwright/test';

const url = process.argv[2] ?? 'http://127.0.0.1:8805/nova/';
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'de-DE', timezoneId: 'Europe/Berlin', userAgent: undefined });
const page = await ctx.newPage();
const problems = [];
const apiCalls = [];
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => r.failure()?.errorText !== 'net::ERR_ABORTED' && problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => r.status() >= 400 && problems.push(`http ${r.status()}: ${r.url()}`));
page.on('request', (r) => r.url().includes('/api/') && apiCalls.push(r.url()));
const ok = [];
const step = async (name, fn) => {
  try { await fn(); ok.push(`✓ ${name}`); } catch (e) { problems.push(`✗ ${name}: ${e.message.split('\n')[0]}`); }
};
const ex = (await import('@playwright/test')).expect;

await page.goto(url);
await step('Übersicht lädt', () => ex(page.getByRole('heading', { level: 1 })).toContainText(/Guten /));
await step('Aufgabe anlegen', async () => {
  await page.getByTestId('tab-todos').click();
  await page.getByTestId('todo-input').fill('Live-Test Aufgabe');
  await page.getByTestId('todo-input').press('Enter');
  await ex(page.getByTestId('todo-item').filter({ hasText: 'Live-Test Aufgabe' })).toBeVisible();
});
await step('Ziel anlegen', async () => {
  await page.getByTestId('tab-finance').click();
  await page.getByTestId('tab-goals').click();
  await page.getByTestId('goal-new').click();
  await page.getByTestId('goal-title').fill('Urlaub');
  await page.getByTestId('goal-amount').fill('500');
  await page.getByTestId('goal-save').click();
  await ex(page.getByTestId('goal-item')).toContainText('Urlaub');
});
await step('Finanzen + Sparziel-Verknüpfung', async () => {
  await page.getByTestId('tab-finance').click();
  await page.getByTestId('finance-input').fill('50 Euro Sparen Urlaub');
  await page.getByTestId('finance-submit').click();
  await ex(page.getByTestId('tx-item').first()).toContainText('50');
  await page.getByTestId('tab-goals').click();
  await ex(page.getByTestId('goal-item')).toContainText('50,00 €');
});
await step('Kalender: Termin anlegen', async () => {
  await page.getByTestId('tab-calendar').click();
  await page.getByTestId('cal-add').click();
  await page.getByTestId('event-title').fill('Live-Termin');
  await page.getByTestId('event-save').click();
  await ex(page.locator('.ec-event', { hasText: 'Live-Termin' })).toBeVisible();
});
await step('Kalender-Sync: ICS da, Google/Apple mit Server-Hinweis', async () => {
  await page.getByRole('button', { name: 'Synchronisieren' }).click();
  await ex(page.getByTestId('ics-export')).toBeVisible();
  await ex(page.getByTestId('google-status')).toContainText('Braucht den Nova-Server');
  await page.keyboard.press('Escape');
});
await step('Grok Bot: Hinweis statt Fehler, Formular deaktiviert', async () => {
  await page.goto(url + '#/grok');
  await ex(page.getByTestId('bot-status')).toContainText('Braucht den Nova-Server, kommt nach der Server-Einrichtung');
  await ex(page.getByTestId('bot-send')).toBeDisabled();
});
await step('Nova Chat: UI mit Server-Hinweis, Eingabe deaktiviert', async () => {
  await page.getByTestId('tab-chat').click();
  await ex(page.getByTestId('chat-note')).toContainText('Nova Chat braucht den Nova-Server und einen xAI-Schlüssel');
  await ex(page.getByTestId('chat-input')).toBeDisabled();
  await ex(page.getByTestId('chat-suggestions')).toBeVisible();
});
await step('Einstellungen: Grok + Mitteilungen mit Hinweis', async () => {
  await page.goto(url + '#/einstellungen');
  await ex(page.getByTestId('settings-bot-status')).toContainText('Braucht den Nova-Server');
  await ex(page.getByTestId('push-status')).toContainText('Braucht den Nova-Server');
});
await step('Daten bleiben nach Neuladen', async () => {
  await page.goto(url + '#/aufgaben');
  await page.reload();
  await ex(page.getByTestId('todo-item').filter({ hasText: 'Live-Test Aufgabe' })).toBeVisible();
});
await step('Service Worker aktiv im Unterpfad', async () => {
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  if (!scope.endsWith(new URL(url).pathname)) throw new Error(`scope ${scope}`);
  ok.push(`  SW-Scope ${scope}`);
});
await step('Manifest-Felder', async () => {
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const m = await (await page.request.get(new URL(href, url).toString())).json();
  const start = new URL(m.start_url, new URL(href, url)).toString();
  const scope = new URL(m.scope, new URL(href, url)).toString();
  if (start !== url || scope !== url) throw new Error(`start ${start} scope ${scope}`);
  for (const i of m.icons) {
    const r = await page.request.get(new URL(i.src, new URL(href, url)).toString());
    if (r.status() !== 200) throw new Error(`icon ${i.src} ${r.status()}`);
  }
});
await page.screenshot({ path: '/tmp/nova-static.png' });
console.log(ok.join('\n'));
console.log(apiCalls.length ? `API-Aufrufe: ${apiCalls.join(', ')}` : 'API-Aufrufe: keine');
console.log(problems.length ? `PROBLEME:\n${problems.join('\n')}` : 'Keine Konsolenfehler, keine fehlgeschlagenen Requests.');
await browser.close();
process.exit(problems.length || apiCalls.length ? 1 : 0);
