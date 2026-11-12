import { expect, test, type Page } from '@playwright/test';
import { control, resetApp } from './helpers';

const at = (hhmm: string, date = '2026-11-12') => new Date(`${date}T${hhmm}:00+01:00`);

async function setup(page: Page) {
  await page.goto('/#/morgen');
  await page.getByTestId('wake-setup').click();
  await page.getByTestId('wake-goal').fill('06:30');
  await page.getByTestId('wake-start').fill('07:10');
  await page.getByTestId('wake-gradual').check();
  await page.getByTestId('work-start-1').fill('08:30');
  await page.getByTestId('work-travel-1').fill('30');
  await page.getByTestId('work-day-1').check();
  await page.getByTestId('work-copy').click();
  await page.getByTestId('work-lead').fill('10');
  await page.getByTestId('work-checkin').fill('18:30');
  await page.getByTestId('wake-daily-quiz').check();
  await page.getByTestId('wake-save').click();
  await expect(page.getByTestId('wake-target')).toHaveText('07:10 Uhr');
}

async function runQuiz(page: Page, woke: string) {
  await page.getByTestId('quiz-time').fill(woke);
  await page.getByTestId('quiz-next').click();
  for (let i = 0; i < 6 && !(await page.getByTestId('quiz-result').count()); i += 1) {
    await page.waitForTimeout(250);
    if (await page.getByTestId('quiz-result').count()) break;
    if (await page.getByTestId('quiz-memo-ok').count()) await page.getByTestId('quiz-memo-ok').click();
    else if (await page.getByTestId('quiz-option').count()) {
      await page.getByTestId('quiz-option').first().click();
      await expect(page.getByTestId('quiz-feedback')).toBeVisible();
      await page.waitForTimeout(1400);
    } else if (await page.getByTestId('quiz-text').count()) {
      await page.getByTestId('quiz-text').fill('Angebot fertig schreiben');
      await page.getByTestId('quiz-next').click();
    } else if (await page.getByTestId('quiz-time').count()) {
      await page.getByTestId('quiz-time').fill('07:55');
      await page.getByTestId('quiz-next').click();
    }
  }
  await expect(page.getByTestId('quiz-result')).toBeVisible();
}

test('Einrichten: Stufenplan, Arbeitszeiten, Losgehen-Zeit und verknüpfte Gewohnheiten', async ({ page }) => {
  await page.clock.setFixedTime(at('06:40'));
  await resetApp(page, '#/morgen');
  await setup(page);
  await expect(page.getByTestId('wake-plan')).toContainText('ab Do., 19. Nov. 07:00 · Ziel 06:30 (noch 4 Schritte)');
  await expect(page.getByTestId('leave-time')).toHaveText('Losgehen um 08:00');
  await expect(page.getByTestId('work-tile')).toContainText('Arbeit 08:30 · 30 Min. Weg · Push 10 Min. vorher');
  await expect(page.getByTestId('quiz-start')).toContainText('Ziel heute: 07:10 Uhr');
  await page.goto('/#/gewohnheiten');
  await expect(page.locator('[data-testid="habit-item"]', { hasText: 'Früh aufstehen' })).toContainText('Täglich');
  await expect(page.locator('[data-testid="habit-item"]', { hasText: 'Pünktlich bei der Arbeit' })).toContainText('Werktags');
});

test('Wach-Quiz: 3 Fragen, pünktlich aufgestanden, Serie, Gewohnheit abgehakt', async ({ page }) => {
  await page.clock.setFixedTime(at('07:12'));
  await resetApp(page, '#/morgen');
  await setup(page);
  await page.getByTestId('quiz-start').click();
  await expect(page.getByTestId('quiz-step')).toContainText('Frage 1 von 3');
  await expect(page.getByTestId('quiz-time')).toHaveValue('07:12');
  await runQuiz(page, '07:05');
  await expect(page.getByTestId('result-title')).toHaveText('Pünktlich aufgestanden');
  await expect(page.getByTestId('result-delta')).toHaveText('Aufgestanden 07:05 · Ziel 07:10 · 5 Min. vor deinem Ziel');
  await expect(page.getByTestId('result-streak')).toHaveText('1');
  await expect(page.getByTestId('result-motivation')).not.toBeEmpty();
  await expect(page.getByTestId('result-score')).toHaveText(/^[0-2]\/[12]$/);
  await page.getByTestId('result-close').click();
  await expect(page.getByTestId('quiz-card')).toContainText('Pünktlich aufgestanden');
  await expect(page.getByTestId('quiz-card')).toContainText('Quiz erledigt · 07:12 Uhr');
  await expect(page.getByTestId('wake-week').locator('.wk.today')).toHaveClass(/on/);
  await page.goto('/#/gewohnheiten');
  await expect(page.locator('[data-testid="habit-item"]', { hasText: 'Früh aufstehen' }).getByTestId('habit-check')).toHaveClass(/checked/);
});

test('Wach-Quiz: zu spät aufgestanden wird ehrlich gezählt', async ({ page }) => {
  await page.clock.setFixedTime(at('07:40'));
  await resetApp(page, '#/morgen');
  await setup(page);
  await page.getByTestId('quiz-start').click();
  await runQuiz(page, '07:25');
  await expect(page.getByTestId('result-title')).toHaveText('Heute etwas später');
  await expect(page.getByTestId('result-delta')).toContainText('15 Min. nach deinem Ziel');
  await expect(page.getByTestId('result-streak')).toHaveText('0');
  await page.getByTestId('result-close').click();
  await expect(page.getByTestId('wake-week').locator('.wk.today')).toHaveClass(/miss/);
});

test('Push-Link öffnet das Quiz direkt; Check-in „Warst du pünktlich?“', async ({ page }) => {
  await page.clock.setFixedTime(at('07:00'));
  await resetApp(page, '#/morgen');
  await setup(page);
  await page.goto('/#/');
  await page.goto('/#/morgen?quiz=1');
  await expect(page.getByTestId('quiz')).toBeVisible();
  await page.keyboard.press('Escape');

  // yesterday's check-in via deep link from the evening push
  await page.goto('/#/');
  await page.goto('/#/morgen?checkin=2026-11-11');
  await expect(page.getByTestId('checkin-card')).toContainText('Warst du gestern pünktlich bei der Arbeit?');
  await page.getByTestId('checkin-knapp').click();
  await expect(page.getByTestId('checkin-card')).toHaveCount(0);
  await expect(page.getByTestId('work-week').locator('.wk').nth(2)).toHaveClass(/on/);

  // later that day: today's check-in shows after work start
  await page.clock.setFixedTime(at('18:40'));
  await page.goto('/#/');
  await page.goto('/#/morgen');
  await expect(page.getByTestId('checkin-card')).toContainText('Warst du heute pünktlich');
  await page.getByTestId('checkin-ja').click();
  await expect(page.getByTestId('checkin-card')).toHaveCount(0);
  await page.getByTestId('work-tile').click();
  await expect(page.getByTestId('stats-work-streak')).toHaveText('2');
  await expect(page.getByTestId('stats-work-grid').locator('.heat-cell.on')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.goto('/#/gewohnheiten');
  await expect(page.locator('[data-testid="habit-item"]', { hasText: 'Pünktlich bei der Arbeit' }).getByTestId('habit-check')).toHaveClass(/checked/);
});

test('Erinnerungen „Zeit loszugehen“ und Weckzeit landen beim Server; Chat kennt die Statistik', async ({ page, context }) => {
  await context.grantPermissions(['notifications']);
  const device = await control<{ endpoint: string }>('/device');
  await page.addInitScript((sub) => {
    const fake = { endpoint: sub.endpoint, toJSON: () => sub, unsubscribe: async () => true, options: {} };
    PushManager.prototype.subscribe = async () => fake as unknown as PushSubscription;
    PushManager.prototype.getSubscription = async () => (localStorage.getItem('nova.pushEnabled') ? (fake as unknown as PushSubscription) : null);
  }, device);
  await page.clock.setFixedTime(at('06:00'));
  await resetApp(page, '#/einstellungen');
  await page.getByTestId('push-enable').click();
  await expect(page.getByTestId('push-status')).toContainText('Aktiv auf diesem Gerät');
  await page.goto('/#/morgen');
  await page.getByTestId('morning-settings').click();
  await page.getByTestId('morning-remind').check();
  await page.getByTestId('morning-save').click();
  await setup(page);
  type R = { id: string; at: string; url: string; title: string; body: string };
  await expect.poll(async () => ((await control<R[] | null>('/store?key=push.reminders')) ?? []).map((r) => r.id)).toContain('leave:2026-11-12');
  const list = (await control<R[]>('/store?key=push.reminders'))!;
  const leave = list.find((r) => r.id === 'leave:2026-11-12')!;
  expect(leave.at).toBe(at('07:50').toISOString());
  expect(leave.body).toContain('In 10 Min. losgehen (08:00 Uhr)');
  expect(list.find((r) => r.id === 'morning:2026-11-12')).toMatchObject({ at: at('07:10').toISOString(), url: '#/morgen?quiz=1' });
  expect(list.find((r) => r.id === 'checkin:2026-11-12')?.url).toBe('#/morgen?checkin=2026-11-12');

  await page.goto('/#/chat');
  await expect(page.getByTestId('chat-sub')).toContainText('grok-test');
  const before = (await control<unknown[]>('/xai')).length;
  await page.getByTestId('chat-input').fill('Wie läuft es mit dem Aufstehen?');
  await page.getByTestId('chat-send').click();
  await expect.poll(async () => (await control<unknown[]>('/xai')).length, { timeout: 15000 }).toBeGreaterThan(before);
  const last = (await control<{ messages: { content: string }[] }[]>('/xai')).at(-1)!;
  expect(last.messages[0].content).toContain('Aufstehen: Ziel heute 07:10 (Endziel 06:30');
  expect(last.messages[0].content).toContain('Arbeit: heute Beginn 08:30, 30 Min. Weg, losgehen 08:00');
});
