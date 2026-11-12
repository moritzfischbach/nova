import { expect, test, type Page } from '@playwright/test';
import { control, resetApp } from './helpers';

async function clickSlot(page: Page, label: string) {
  const lab = page.locator('.ec-sidebar .ec-slot', { hasText: new RegExp(`^${label}$`) }).first();
  await lab.scrollIntoViewIfNeeded();
  const lb = (await lab.boundingBox())!;
  const body = (await page.locator('.ec-body .ec-day').last().boundingBox())!;
  await page.mouse.click(body.x + body.width / 2, lb.y + lb.height + 6);
}

test('Ansichten wechseln: Monat, Woche, Tag, Liste', async ({ page }) => {
  await resetApp(page, '#/kalender');
  await expect(page.locator('.ec-week-view')).toBeVisible();
  await page.getByTestId('view-dayGridMonth').click();
  await expect(page.locator('.ec-month-view')).toBeVisible();
  await page.getByTestId('view-timeGridDay').click();
  await expect(page.locator('.ec-day-view')).toBeVisible();
  await expect(page.locator('.ec-now-indicator')).toBeVisible();
  const title = await page.getByTestId('cal-title').textContent();
  await page.getByTestId('cal-next').click();
  await expect(page.getByTestId('cal-title')).not.toHaveText(title!);
  await page.getByTestId('cal-today').click();
  await expect(page.getByTestId('cal-title')).toHaveText(title!);
  await page.getByTestId('view-listMonth').click();
  await expect(page.locator('.ec-list')).toBeVisible();
  await page.reload();
  await expect(page.locator('.ec-list')).toBeVisible(); // view is remembered
});

test('Tippen auf freien Slot erstellt Termin; bearbeiten und löschen', async ({ page }) => {
  await resetApp(page, '#/kalender');
  await page.getByTestId('view-timeGridDay').click();
  await clickSlot(page, '14:00');
  await expect(page.getByTestId('event-start')).toHaveValue(/^14:/);
  await page.getByTestId('event-title').fill('Zahnarzt');
  await page.getByTestId('event-save').click();
  const ev = page.locator('.ec-event', { hasText: 'Zahnarzt' });
  await expect(ev).toBeVisible();

  await ev.click();
  await page.getByTestId('event-title').fill('Zahnarzt Dr. Weber');
  await page.getByTestId('event-save').click();
  await expect(page.locator('.ec-event', { hasText: 'Zahnarzt Dr. Weber' })).toBeVisible();

  await page.getByTestId('view-timeGridWeek').click();
  await expect(page.locator('.ec-event', { hasText: 'Zahnarzt Dr. Weber' })).toBeVisible();
  await page.locator('.ec-event', { hasText: 'Zahnarzt Dr. Weber' }).click();
  await page.getByTestId('event-delete').click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.locator('.ec-event', { hasText: 'Zahnarzt' })).toHaveCount(0);
});

test('Überlappende Termine nebeneinander, Ganztägig-Zeile, Wiederholung', async ({ page }) => {
  await resetApp(page, '#/kalender');
  await page.getByTestId('view-timeGridDay').click();
  for (const t of ['A-Termin', 'B-Termin']) {
    await page.getByTestId('cal-add').click();
    await page.getByTestId('event-title').fill(t);
    await page.getByTestId('event-start').fill('10:00');
    await page.getByTestId('event-end').fill('11:00');
    await page.getByTestId('event-save').click();
    await expect(page.locator('.ec-event', { hasText: t })).toBeVisible();
  }
  await expect(page.locator('.ec-event', { hasText: 'B-Termin' })).toBeVisible();
  const a = (await page.locator('.ec-event', { hasText: 'A-Termin' }).boundingBox())!;
  const b = (await page.locator('.ec-event', { hasText: 'B-Termin' }).boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  // overlapping events are laid out side by side, not stacked on top of each other
  const col = (await page.locator('.ec-body .ec-day').last().boundingBox())!;
  expect(Math.abs(a.x - b.x)).toBeGreaterThan(20);
  expect(a.width).toBeLessThan(col.width * 0.6);
  expect(b.width).toBeLessThan(col.width * 0.6);

  await page.getByTestId('cal-add').click();
  await page.getByTestId('event-title').fill('Urlaubstag');
  await page.getByTestId('event-allday').check();
  await page.getByTestId('event-save').click();
  await expect(page.locator('.ec-all-day .ec-event', { hasText: 'Urlaubstag' })).toBeVisible();

  await page.getByTestId('cal-add').click();
  await page.getByTestId('event-title').fill('Yoga');
  await page.getByTestId('event-start').fill('07:00');
  await page.getByTestId('event-end').fill('08:00');
  await page.getByTestId('event-repeat').selectOption('DAILY');
  await page.getByTestId('event-save').click();
  await page.getByTestId('view-timeGridWeek').click();
  await page.getByTestId('cal-next').click();
  await expect(page.locator('.ec-event', { hasText: 'Yoga' })).toHaveCount(7);
  // delete just one occurrence of the series
  await page.locator('.ec-event', { hasText: 'Yoga' }).nth(2).click();
  await page.getByTestId('event-delete').click();
  await page.getByTestId('delete-one').click();
  await expect(page.locator('.ec-event', { hasText: 'Yoga' })).toHaveCount(6);
});

test('Google-Sync gegen Mock: verbinden, hochladen, abrufen', async ({ page }) => {
  await resetApp(page, '#/kalender');
  await page.getByTestId('cal-add').click();
  await page.getByTestId('event-title').fill('Lokal nach Google');
  await page.getByTestId('event-save').click();
  await page.getByRole('button', { name: 'Sync' }).click();
  await expect(page.getByTestId('google-status')).toContainText('Bereit zum Verbinden');
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/calendar/google/callback')),
    page.getByRole('link', { name: 'Mit Google verbinden' }).click(),
  ]);
  await page.waitForLoadState('load');
  await expect(page).toHaveURL(/#\/kalender/);
  await expect(page.getByTestId('calendar')).toBeVisible();
  await page.getByRole('button', { name: 'Sync' }).click();
  await expect(page.getByTestId('google-status')).toContainText('Verbunden');
  await page.getByTestId('google-sync').click();
  await expect(page.getByText(/Google: 1 gesendet, 1 empfangen/)).toBeVisible();
  const remote = await control<{ summary: string }[]>('/google');
  expect(remote.map((e) => e.summary)).toContain('Lokal nach Google');
  await page.getByTestId('view-listMonth').click();
  await page.getByTestId('cal-today').click();
  await page.getByTestId('cal-next').click(); // remote event lives on 20 Nov 2026 (mock); list shows month
  await page.getByTestId('cal-prev').click();
  await expect(page.locator('.ec-event', { hasText: 'Aus Google' })).toBeVisible();
});
