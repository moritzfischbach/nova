import { expect, test } from '@playwright/test';
import { isoInDays, resetApp } from './helpers';

test('Sparziel anlegen, per Finanzplaner „50 Euro Sparen Urlaub“ füllen', async ({ page }) => {
  await resetApp(page, '#/ziele');
  await page.getByTestId('goal-new').click();
  await page.getByTestId('goal-title').fill('Urlaub Portugal');
  await page.getByTestId('goal-amount').fill('1.000');
  await page.getByTestId('goal-date').fill(isoInDays(40));
  await page.getByTestId('goal-save').click();
  await expect(page.getByTestId('goal-item')).toContainText('0,00 € von 1.000,00 €');

  await page.getByTestId('tab-finance').click();
  await page.getByTestId('finance-input').fill('50 Euro Sparen Urlaub');
  await page.getByTestId('finance-submit').click();
  await expect(page.getByText(/Sparziel „Urlaub Portugal“/)).toBeVisible();

  await page.getByTestId('tab-goals').click();
  await expect(page.getByTestId('goal-item')).toContainText('50,00 € von 1.000,00 €');
  await page.getByTestId('goal-item').click();
  await page.getByTestId('deposit-amount').fill('25,50');
  await page.getByRole('button', { name: 'Einzahlen' }).click();
  await expect(page.getByTestId('goal-saved').last()).toHaveText('75,50 €');
});

test('Allgemeines Ziel erscheint im Kalender, Tippen öffnet das Ziel', async ({ page }) => {
  await resetApp(page, '#/ziele');
  await page.getByTestId('goal-new').click();
  await page.getByRole('button', { name: 'Allgemeines Ziel' }).click();
  await page.getByTestId('goal-title').fill('Halbmarathon');
  await page.getByTestId('goal-date').fill(isoInDays(0));
  await page.getByTestId('goal-save').click();
  await page.goto('/#/kalender');
  await page.getByTestId('view-timeGridDay').click();
  const marker = page.locator('.ec-goal-marker', { hasText: 'Halbmarathon' });
  await expect(marker).toBeVisible();
  await marker.click();
  await expect(page).toHaveURL(/#\/ziele\?id=/);
  await expect(page.getByTestId('goal-detail')).toBeVisible();
  await expect(page.locator('.sheet-header h2')).toHaveText('Halbmarathon');
});
