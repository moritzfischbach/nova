import { expect, test, type Page } from '@playwright/test';
import { control, isoInDays, resetApp } from './helpers';

async function createHabit(page: Page, name: string, opts: { perWeek?: number; emoji?: string } = {}) {
  await page.goto('/#/gewohnheiten');
  await page.getByTestId('habit-new').click();
  await page.getByTestId('habit-name').fill(name);
  if (opts.emoji) await page.getByTestId('habit-emojis').getByRole('button', { name: opts.emoji }).click();
  if (opts.perWeek) {
    await page.getByTestId('habit-freq-perweek').click();
    await page.getByTestId(`habit-times-${opts.perWeek}`).click();
  }
  await page.getByTestId('habit-save').click();
  await expect(page.locator('[data-testid="habit-item"]', { hasText: name })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await resetApp(page, '#/');
});

test('Gewohnheit anlegen, abhaken, Serie, Heatmap und Quoten', async ({ page }) => {
  await createHabit(page, 'Wasser trinken', { emoji: '💧' });
  await createHabit(page, 'Sport', { perWeek: 3, emoji: '🏃' });
  const water = page.locator('[data-testid="habit-item"]', { hasText: 'Wasser trinken' });
  await expect(page.locator('[data-testid="habit-item"]', { hasText: 'Sport' })).toContainText('3× pro Woche · 0/3 diese Woche');
  await expect(page.getByTestId('habits-summary')).toHaveText('Heute 0 von 2 erledigt');
  await water.getByTestId('habit-check').click();
  await expect(page.getByTestId('habits-summary')).toHaveText('Heute 1 von 2 erledigt');
  await expect(water.getByTestId('habit-streak')).toHaveText('🔥 1 Tag in Folge');

  // detail: tick yesterday in the month heatmap → streak 2
  await water.locator('.habit-copy').click();
  const detail = page.getByTestId('habit-detail');
  await expect(detail.getByTestId('habit-current')).toHaveText('1');
  const yesterday = isoInDays(-1);
  if (yesterday.slice(0, 7) !== isoInDays(0).slice(0, 7)) await detail.locator('[data-month="-1"]').click();
  await detail.locator(`[data-day="${yesterday}"]`).click();
  await expect(detail.getByTestId('habit-current')).toHaveText('2');
  await expect(detail.getByTestId('habit-longest')).toHaveText('2');
  await expect(detail.getByTestId('habit-rate7')).toHaveText('100 %');
  await expect(detail.locator(`[data-day="${yesterday}"]`)).toHaveClass(/on/);
  await page.keyboard.press('Escape');

  // persisted in IndexedDB
  await page.reload();
  await expect(page.locator('[data-testid="habit-item"]', { hasText: 'Wasser trinken' }).getByTestId('habit-streak')).toHaveText('🔥 2 Tage in Folge');

  // edit → delete
  await page.locator('[data-testid="habit-item"]', { hasText: 'Sport' }).locator('.habit-copy').click();
  await page.getByTestId('habit-edit').click();
  await page.getByTestId('habit-delete').click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.locator('[data-testid="habit-item"]', { hasText: 'Sport' })).toHaveCount(0);
});

test('Übersicht: Guten-Morgen-Karte und Gewohnheiten zum Abhaken', async ({ page }) => {
  await createHabit(page, 'Lesen', { emoji: '📖' });
  await page.goto('/#/');
  await expect(page.getByTestId('open-morning')).toContainText('Routine 0/5');
  const section = page.getByTestId('overview-habits');
  await section.getByTestId('habit-check').click();
  await expect(section.locator('h2')).toContainText('1/1');
  await expect(page.getByText('Morgenplaner', { exact: true }).locator('xpath=ancestor::section[contains(@class,"overview")]')).toHaveCount(1);
  await page.getByTestId('open-morning').click();
  await expect(page).toHaveURL(/#\/morgen$/);
  await expect(page.getByTestId('tab-overview')).toHaveClass(/active/);
  await expect(page.getByTestId('morning-habits')).toContainText('Lesen');
  await page.getByTestId('morning-habits-link').click();
  await expect(page).toHaveURL(/#\/gewohnheiten$/);
});

test('Morgenplaner: Routine, Einstellungen, Budget, fällige Aufgaben', async ({ page }) => {
  // overdue todo with due date
  await page.goto('/#/aufgaben');
  await page.getByTestId('todo-input').fill('Steuer abgeben');
  await page.getByTestId('todo-input').press('Enter');
  await page.getByText('Steuer abgeben').click();
  await page.getByTestId('todo-due-date').fill(isoInDays(-2));
  await page.getByRole('button', { name: 'Speichern' }).click();

  await page.goto('/#/morgen');
  await expect(page.getByTestId('morning-summary')).toContainText('1 fällige Aufgabe');
  await expect(page.getByTestId('morning-todos')).toContainText('überfällig seit');
  await page.getByTestId('routine-item').first().click();
  await expect(page.getByTestId('routine-progress')).toHaveText('1/5');
  await expect(page.getByTestId('routine-item').first()).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('routine-edit').click();
  await page.getByTestId('routine-new-time').fill('06:50');
  await page.getByTestId('routine-new-title').fill('Meditieren');
  await page.getByTestId('routine-add').click();
  await page.getByTestId('routine-save').click();
  await expect(page.getByTestId('routine-progress')).toHaveText('1/6');
  await expect(page.getByTestId('routine-item').first()).toContainText('06:50');

  await page.getByTestId('morning-settings').click();
  await page.getByTestId('morning-wake').fill('06:30');
  await page.getByTestId('morning-remind').check();
  await page.getByTestId('morning-budget-input').fill('1.200');
  await page.getByTestId('morning-save').click();
  await expect(page.getByTestId('morning-settings')).toContainText('06:30 Uhr');
  await expect(page.getByTestId('morning-budget')).toContainText('übrig');
  await expect(page.getByTestId('morning-budget')).toContainText('von 1.200,00');

  await page.getByTestId('morning-todo').first().click();
  await expect(page.getByTestId('morning-todos')).toContainText('Nichts fällig');
  await page.reload();
  await expect(page.getByTestId('routine-progress')).toHaveText('1/6');
});

test('„Tag planen mit Nova“ sendet den Tag an den Chat und schlägt Zeitblöcke vor', async ({ page }) => {
  await createHabit(page, 'Lesen', { emoji: '📖' });
  await page.goto('/#/morgen');
  await page.getByTestId('morning-plan').click();
  await expect(page).toHaveURL(/#\/chat$/);
  await expect(page.getByTestId('msg-user')).toContainText('Plane bitte meinen Tag');
  await expect(page.getByTestId('msg-user')).toContainText('Lesen');
  const chips = page.getByTestId('tool-chip');
  await expect(chips).toHaveCount(2);
  await expect(chips.first()).toContainText('Fokus: Angebot schreiben');
  await chips.first().getByTestId('tool-confirm').click();
  await chips.last().getByTestId('tool-decline').click();
  await expect(chips.first()).toHaveAttribute('data-status', 'ausgefuehrt');
  const last = (await control<{ messages: { role: string; content: string }[] }[]>('/xai')).at(-1)!;
  expect(JSON.stringify(last.messages[0])).toContain('Gewohnheiten (1)');
  await page.goto('/#/morgen');
  await expect(page.getByTestId('morning-events')).toContainText('Fokus: Angebot schreiben');
});

test('Chat-Werkzeuge: Gewohnheit anlegen und abhaken (mit Bestätigung)', async ({ page }) => {
  await createHabit(page, 'Wasser trinken');
  await page.goto('/#/chat');
  await expect(page.getByTestId('chat-sub')).toContainText('grok-test');
  await page.getByTestId('chat-input').fill('Leg eine Gewohnheit an: Meditieren Mo, Mi, Fr');
  await page.getByTestId('chat-send').click();
  const chip = page.getByTestId('tool-chip').last();
  await expect(chip).toContainText('🧘 „Meditieren“ · Mo, Mi, Fr · Erinnerung 07:15');
  await chip.getByTestId('tool-confirm').click();
  await expect(chip).toHaveAttribute('data-status', 'ausgefuehrt');
  await expect(page.getByTestId('msg-text').last()).toContainText('Ich habe es in Nova eingetragen');
  await expect(page.locator('.msg.streaming')).toHaveCount(0);

  await page.getByTestId('chat-input').fill('Bitte Wasser abhaken');
  await page.getByTestId('chat-send').click();
  const chip2 = page.getByTestId('tool-chip').last();
  await expect(chip2).toHaveAttribute('data-tool', 'gewohnheit_abhaken');
  await expect(chip2).toHaveAttribute('data-status', 'offen');
  await chip2.getByTestId('tool-confirm').click();
  await expect(chip2).toContainText('„Wasser trinken“ abgehakt – Serie: 1 Tag');

  await page.goto('/#/gewohnheiten');
  await expect(page.locator('[data-testid="habit-item"]', { hasText: 'Meditieren' })).toContainText('Mo, Mi, Fr');
  await expect(page.locator('[data-testid="habit-item"]', { hasText: 'Wasser trinken' }).getByTestId('habit-check')).toHaveClass(/checked/);
});

test('Weckzeit-Mitteilung und Gewohnheits-Erinnerung landen beim Server', async ({ page, context }) => {
  await context.grantPermissions(['notifications']);
  const device = await control<{ endpoint: string }>('/device');
  await page.addInitScript((sub) => {
    const fake = { endpoint: sub.endpoint, toJSON: () => sub, unsubscribe: async () => true, options: {} };
    PushManager.prototype.subscribe = async () => fake as unknown as PushSubscription;
    PushManager.prototype.getSubscription = async () => (localStorage.getItem('nova.pushEnabled') ? (fake as unknown as PushSubscription) : null);
  }, device);
  await resetApp(page, '#/einstellungen');
  await page.getByTestId('push-enable').click();
  await expect(page.getByTestId('push-status')).toContainText('Aktiv auf diesem Gerät');
  await page.goto('/#/morgen');
  await page.getByTestId('morning-settings').click();
  await page.getByTestId('morning-wake').fill('06:15');
  await page.getByTestId('morning-remind').check();
  await page.getByTestId('morning-save').click();
  const tomorrow = isoInDays(1);
  await expect.poll(async () => ((await control<{ id: string }[] | null>('/store?key=push.reminders')) ?? []).map((r) => r.id)).toContain(`morning:${tomorrow}`);
  const reminders = (await control<{ id: string; at: string; url: string; title: string }[]>('/store?key=push.reminders'))!;
  const m = reminders.find((r) => r.id === `morning:${tomorrow}`)!;
  expect(new Date(m.at).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })).toBe('06:15');
  expect(m.url).toBe('#/morgen?quiz=1');
  const tick = await control<{ sent: number }>(`/tick?now=${encodeURIComponent(new Date(Date.parse(m.at) + 1000).toISOString())}`);
  expect(tick.sent).toBeGreaterThanOrEqual(1);
  const got = await control<{ payload: { title: string; url: string } }[]>('/push-received');
  expect(got.find((x) => x.payload.url === '#/morgen?quiz=1')?.payload.title).toBe('Guten Morgen ☀️');

  await page.goto('/#/gewohnheiten');
  await page.getByTestId('habit-new').click();
  await page.getByTestId('habit-name').fill('Vitamine');
  await page.getByTestId('habit-reminder').fill('08:00');
  await page.getByTestId('habit-save').click();
  await expect.poll(async () => ((await control<{ title: string }[] | null>('/store?key=push.reminders')) ?? []).some((r) => r.title.endsWith('Vitamine'))).toBe(true);
});
