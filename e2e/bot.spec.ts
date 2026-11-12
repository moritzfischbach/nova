import { expect, test } from '@playwright/test';
import { control, resetApp } from './helpers';

type Hook = { headers: Record<string, string>; body: Record<string, string> };

test('Grok Bot: senden über den Server an den (Mock-)Webhook', async ({ page }) => {
  await resetApp(page, '#/grok');
  await expect(page.getByTestId('bot-status')).toContainText('Verbunden');
  const before = (await control<Hook[]>('/hooks')).length;
  await page.getByRole('radio', { name: 'Kalender' }).click();
  await page.getByTestId('bot-input').fill('Plane meine Woche');
  await page.getByTestId('bot-context').fill('Viel Arbeit am Dienstag');
  await page.getByTestId('bot-send').click();
  await expect(page.getByTestId('bot-item').first()).toHaveAttribute('data-status', 'gesendet');
  await expect(page.getByTestId('bot-item').first()).toContainText('Antwort im Grok-Bot-Chat');
  const hooks = await control<Hook[]>('/hooks');
  expect(hooks.length).toBe(before + 1);
  const last = hooks.at(-1)!;
  expect(last.body).toMatchObject({ task: 'Plane meine Woche', module: 'kalender', context: 'Viel Arbeit am Dienstag' });
  expect(last.body.request_id).toMatch(/^nova-/);
  expect(last.headers.authorization).toBe('Bearer e2e-SECRET-webhook-key-123456');
  expect(last.headers['x-automation-key']).toBe('e2e-SECRET-webhook-key-123456');
  // the key never reaches the browser
  const html = await page.content();
  expect(html).not.toContain('e2e-SECRET');
});

test('Grok Bot: Fehler vom Webhook wird angezeigt, Erneut-Senden klappt', async ({ page }) => {
  await resetApp(page, '#/grok');
  await control('/hook-mode?mode=fail');
  await page.getByTestId('bot-input').fill('ping');
  await page.getByTestId('bot-send').click();
  await expect(page.getByTestId('bot-item').first()).toHaveAttribute('data-status', 'fehler');
  await control('/hook-mode?mode=ok');
  await page.getByRole('button', { name: 'Erneut' }).click();
  await expect(page.getByTestId('bot-item').first()).toHaveAttribute('data-status', 'gesendet');
});

test('Grok Bot: offline wird gespeichert und später gesendet', async ({ page, context }) => {
  await resetApp(page, '#/grok');
  await context.setOffline(true);
  await page.getByTestId('bot-input').fill('Offline-Nachricht');
  await page.getByTestId('bot-send').click();
  await expect(page.getByTestId('bot-item').first()).toHaveAttribute('data-status', 'wartend');
  await context.setOffline(false);
  await expect(page.getByTestId('bot-item').first()).toHaveAttribute('data-status', 'gesendet', { timeout: 10_000 });
  const hooks = await control<Hook[]>('/hooks');
  expect(hooks.at(-1)!.body.task).toBe('Offline-Nachricht');
});

test('Schnellaktion: Aufgabe an Grok Bot', async ({ page }) => {
  await resetApp(page, '#/aufgaben');
  await page.getByTestId('todo-input').fill('Präsentation vorbereiten');
  await page.getByTestId('todo-input').press('Enter');
  await page.getByLabel('An Grok Bot schicken').click();
  await expect(page).toHaveURL(/#\/grok\?/);
  await expect(page.getByTestId('bot-input')).toHaveValue('Hilf mir bei dieser Aufgabe: Präsentation vorbereiten');
  await expect(page.getByRole('radio', { name: 'Aufgaben' })).toHaveAttribute('aria-checked', 'true');
});

test('Client-Bundle enthält keinen Webhook-Schlüssel', async ({ request }) => {
  const html = await (await request.get('/')).text();
  const scripts = [...html.matchAll(/src="\.\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  expect(scripts.length).toBeGreaterThan(0);
  for (const s of scripts) {
    const js = await (await request.get(`/${s}`)).text();
    expect(js).not.toContain('e2e-SECRET');
    expect(js).not.toContain('GROKBOT_WEBHOOK_KEY');
  }
});
