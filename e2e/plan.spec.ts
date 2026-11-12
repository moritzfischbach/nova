import { expect, test, type Page } from '@playwright/test';
import { control, resetApp } from './helpers';

// Tuesday 2026-11-10, 05:30 Berlin
const at = (hhmm: string, date = '2026-11-10') => new Date(`${date}T${hhmm}:00+01:00`);

async function readMorning(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve) => {
        const req = indexedDB.open('nova');
        req.onsuccess = () => {
          const g = req.result.transaction('meta').objectStore('meta').get('morning.config');
          g.onsuccess = () => resolve((g.result?.value ?? {}) as Record<string, unknown>);
        };
      }),
  );
}

async function answerQuiz(page: Page) {
  await expect(page.getByTestId('pq-count')).toHaveText('1/6');
  await expect(page.getByTestId('pq-question')).toHaveText('Wann musst du bei der Arbeit sein?');
  await page.getByTestId('pq-diff').click();
  await page.getByTestId('pq-arrive-5').fill('07:30');
  await page.getByTestId('pq-arrive-5').blur();
  await page.getByTestId('pq-next').click();

  await expect(page.getByTestId('pq-count')).toHaveText('2/6');
  await page.getByTestId('pq-travel-30').click();
  await expect(page.getByTestId('pq-derived')).toContainText('Losfahren um 07:50');
  await page.getByTestId('pq-mode-abfahrt').click();
  await expect(page.getByTestId('pq-departure')).toHaveValue('07:50');
  await expect(page.getByTestId('pq-derived')).toContainText('30 Min.');
  await page.getByTestId('pq-mode-dauer').click();
  await page.getByTestId('pq-next').click();

  await expect(page.getByTestId('pq-count')).toHaveText('3/6');
  await page.getByTestId('pq-sleep-8').click();
  await page.getByTestId('pq-bedtime').fill('23:00');
  await page.getByTestId('pq-bedtime').blur();
  await page.getByTestId('pq-next').click();

  await expect(page.getByTestId('pq-count')).toHaveText('4/6');
  await page.getByTestId('pq-wake-langsam').click();
  await page.getByTestId('pq-next').click();

  await expect(page.getByTestId('pq-count')).toHaveText('5/6');
  await page.getByTestId('pq-act-sport').click();
  await page.getByTestId('pq-dec-sport').click();
  await expect(page.getByTestId('pq-min-sport')).toHaveText('25');
  await page.getByTestId('pq-custom-title').fill('Pflanzen gießen');
  await page.getByTestId('pq-custom-min').fill('5');
  await page.getByTestId('pq-custom-add').click();
  await expect(page.getByTestId('pq-total')).toContainText('90 Min.');
  await page.getByTestId('pq-next').click();

  await expect(page.getByTestId('pq-count')).toHaveText('6/6');
  await expect(page.getByTestId('pq-nice-sport')).toHaveClass(/active/);
  await page.getByTestId('pq-me-0').click();
  await page.getByTestId('pq-next').click();
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(at('05:30'));
  await resetApp(page, '#/morgen');
});

test('Morgenplan-Quiz: Fragen → perfekter Morgen → übernehmen → wiederholen', async ({ page }) => {
  await expect(page.getByTestId('plan-start')).toContainText('Erstell deinen perfekten Morgen');
  await expect(page.getByTestId('quiz-start')).toHaveCount(0);
  await page.getByTestId('plan-start').click();
  await expect(page).toHaveURL(/#\/morgenplan/);
  await answerQuiz(page);

  const result = page.getByTestId('plan-result');
  await expect(result).toContainText('Dein perfekter Morgen');
  await expect(page.getByTestId('plan-wake')).toHaveText('06:00');
  await expect(page.getByTestId('plan-leave')).toHaveText('07:50');
  await expect(page.getByTestId('plan-arrival')).toHaveText('08:20');
  await expect(page.getByTestId('plan-bedtime')).toHaveText('22:00');
  const steps = page.getByTestId('plan-step');
  await expect(steps).toHaveCount(9);
  await expect(steps.first()).toContainText('Aufwachen');
  await expect(steps.nth(1)).toContainText('Sport');
  await expect(steps.last()).toContainText('Tasche packen');
  await expect(page.getByTestId('plan-perday')).toContainText('Fr auf 05:00 · los 06:50');
  await expect(page.getByTestId('plan-hints')).toContainText('schrittweise');
  await page.getByTestId('plan-compact').click();
  await expect(page.getByTestId('plan-wake')).toHaveText('06:35');
  await expect(steps).toHaveCount(6);
  await page.getByTestId('plan-compact').click();
  await expect(page.getByTestId('plan-wake')).toHaveText('06:00');

  await page.getByTestId('plan-apply').click();
  await expect(page).toHaveURL(/#\/morgen$/);
  await expect(page.getByTestId('plan-card')).toBeVisible();
  await expect(page.getByTestId('plan-start')).toHaveCount(0);
  // gradual: start 07:00, goal 06:00 (natural wake 07:00)
  await expect(page.getByTestId('plan-card-wake')).toHaveText('07:00');
  await expect(page.getByTestId('plan-card-leave')).toHaveText('07:50');
  await expect(page.getByTestId('routine-item')).toHaveCount(9);
  await expect(page.getByTestId('routine-item').first()).toContainText('06:00');
  await expect(page.getByTestId('routine-item').first()).toContainText('Aufwachen');
  await expect(page.getByTestId('wake-now')).toBeVisible();
  await expect(page.getByTestId('quiz-start')).toHaveCount(0);

  const cfg = (await readMorning(page)) as {
    wakeTime: string; remind: boolean; dailyQuiz?: boolean; wakeByDay?: Record<string, string>;
    wakeGoal: { goal: string; gradual: boolean; start: string };
    work: { days: Record<string, { start: string; travel: number; buffer?: number }>; leaveRemind: boolean };
  };
  expect(cfg.wakeTime).toBe('07:00');
  expect(cfg.remind).toBe(true);
  expect(cfg.dailyQuiz).toBeFalsy();
  expect(cfg.wakeGoal).toMatchObject({ goal: '06:00', gradual: true, start: '07:00' });
  expect(cfg.work.days['2']).toEqual({ start: '08:30', travel: 30, buffer: 10 });
  expect(cfg.work.days['5']).toEqual({ start: '07:30', travel: 30, buffer: 10 });
  expect(cfg.work.leaveRemind).toBe(true);
  expect(cfg.wakeByDay?.['5']).toBe('05:00');

  // one-tap wake log (daily quiz off)
  await page.clock.setFixedTime(at('06:55'));
  await page.getByTestId('wake-now').click();
  await expect(page.getByTestId('wake-done')).toContainText('Pünktlich aufgestanden');

  // redo: prefilled with the last answers
  await page.getByTestId('plan-redo').click();
  await expect(page.getByTestId('pq-count')).toHaveText('1/6');
  await expect(page.getByTestId('pq-diff')).toHaveClass(/active/);
  await expect(page.getByTestId('pq-arrive-5')).toHaveValue('07:30');
  await page.getByTestId('pq-back').click();
  await expect(page).toHaveURL(/#\/morgen$/);

  // daily brain quiz is an opt-in toggle
  await page.getByTestId('wake-setup').click();
  await page.getByTestId('wake-daily-quiz').check();
  await page.getByTestId('wake-save').click();
  await expect(page.getByTestId('quiz-card').or(page.getByTestId('quiz-start'))).toBeVisible();
});

test('Mit Nova verfeinern schickt Antworten und Plan an den Chat', async ({ page }) => {
  await page.goto('/#/morgenplan');
  await answerQuiz(page);
  const before = (await control<unknown[]>('/xai')).length;
  await page.getByTestId('plan-refine').click();
  await expect(page).toHaveURL(/#\/chat/);
  await expect.poll(async () => (await control<unknown[]>('/xai')).length, { timeout: 15000 }).toBeGreaterThan(before);
  const last = (await control<{ messages: { role: string; content: string }[] }[]>('/xai')).at(-1)!;
  const user = last.messages.filter((m) => m.role === 'user').at(-1)!.content;
  expect(user).toContain('perfekten Morgen');
  expect(user).toContain('Aufstehen 06:00');
  expect(user).toContain('losfahren 07:50');
  // draft survives: back to the quiz shows the result again
  await page.goto('/#/morgenplan');
  await expect(page.getByTestId('plan-wake')).toHaveText('06:00');
});
