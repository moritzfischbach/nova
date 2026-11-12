import { expect, test } from '@playwright/test';
import { control, resetApp } from './helpers';

type Sub = { endpoint: string; keys: { p256dh: string; auth: string } };

test('Push aktivieren → Server sendet echte Web-Push-Nachricht (Test + Erinnerung)', async ({ page, context }) => {
  await context.grantPermissions(['notifications']);
  const device = await control<Sub>('/device');
  // Headless Chrome has no FCM connection, so the browser-side subscribe() is replaced by a
  // subscription pointing at the local test push service. Everything after that is real:
  // VAPID signing, aes128gcm encryption, delivery and decryption.
  await page.addInitScript((sub) => {
    const fake = { endpoint: sub.endpoint, toJSON: () => sub, unsubscribe: async () => true, options: {} };
    PushManager.prototype.subscribe = async () => fake as unknown as PushSubscription;
    PushManager.prototype.getSubscription = async () => (localStorage.getItem('nova.pushEnabled') ? (fake as unknown as PushSubscription) : null);
  }, device);
  await resetApp(page, '#/einstellungen');
  await expect(page.getByTestId('push-status')).toContainText('Erinnerungen an Termine');
  await page.getByTestId('push-enable').click();
  await expect(page.getByTestId('push-status')).toContainText('Aktiv auf diesem Gerät');
  await page.getByTestId('push-test').click();
  await expect.poll(async () => (await control<{ payload: { title: string } }[]>('/push-received')).length).toBeGreaterThan(0);
  const received = await control<{ payload: { title: string; url: string } }[]>('/push-received');
  expect(received.at(-1)!.payload.title).toBe('Nova');

  // a todo with due time + reminder → planned reminder on the server → scheduler sends it
  await page.goto('/#/aufgaben');
  await page.getByTestId('todo-input').fill('Blumen gießen');
  await page.getByTestId('todo-input').press('Enter');
  await page.getByText('Blumen gießen').click();
  const d = new Date(Date.now() + 2 * 86400_000);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await page.getByTestId('todo-due-date').fill(iso);
  await page.getByTestId('todo-due-time').fill('18:00');
  await page.getByTestId('todo-remind').check();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect.poll(async () => ((await control<{ title: string }[] | null>('/store?key=push.reminders')) ?? []).map((r) => r.title)).toContain('Aufgabe fällig: Blumen gießen');
  const reminders = (await control<{ title: string; at: string }[]>('/store?key=push.reminders'))!;
  const at = reminders.find((r) => r.title === 'Aufgabe fällig: Blumen gießen')!.at;
  const tick = await control<{ sent: number }>(`/tick?now=${encodeURIComponent(new Date(Date.parse(at) + 1000).toISOString())}`);
  expect(tick.sent).toBeGreaterThanOrEqual(1);
  const all = await control<{ payload: { title: string; url: string } }[]>('/push-received');
  expect(all.map((m) => m.payload.title)).toContain('Aufgabe fällig: Blumen gießen');
  expect(all.find((m) => m.payload.title.includes('Blumen'))!.payload.url).toBe('#/aufgaben');
});

test('Service Worker zeigt eine Push-Nachricht als Benachrichtigung', async ({ page, context }) => {
  await context.grantPermissions(['notifications']);
  await resetApp(page, '#/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cdp = await context.newCDPSession(page);
  const regs: { registrationId: string; scopeURL: string }[] = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => regs.push(...e.registrations));
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => regs.length).toBeGreaterThan(0);
  await cdp.send('ServiceWorker.deliverPushMessage', {
    origin: new URL(page.url()).origin,
    registrationId: regs[0].registrationId,
    data: JSON.stringify({ title: 'Termin in 10 Minuten', body: 'Zahnarzt', url: '#/kalender', tag: 't1' }),
  });
  await expect
    .poll(() => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => `${n.title}|${n.body}|${(n.data as { url: string }).url}`)))
    .toContain('Termin in 10 Minuten|Zahnarzt|#/kalender');
});

test('iPhone ohne Home-Bildschirm: Erklärung statt Aktivieren', async ({ browser }) => {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
  });
  const page = await ctx.newPage();
  await page.goto('/#/einstellungen');
  await expect(page.getByTestId('push-ios-hint')).toContainText('Zum Home-Bildschirm');
  await expect(page.getByTestId('push-enable')).toHaveCount(0);
  await ctx.close();
});
