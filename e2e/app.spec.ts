import { expect, test } from '@playwright/test';
import { resetApp } from './helpers';

test('Übersicht, Aufgaben und Finanzen – Kernabläufe', async ({ page }) => {
  await resetApp(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Guten /);
  await expect(page.getByTestId('open-grok')).toBeVisible();

  await page.getByTestId('tab-todos').click();
  await expect(page.getByRole('heading', { name: 'Persönlich' })).toBeVisible();
  await page.getByTestId('todo-input').fill('Milch kaufen');
  await page.getByTestId('todo-form').locator('button[type="submit"]').click();
  await expect(page.getByTestId('todo-item')).toContainText('Milch kaufen');
  await page.getByLabel('Abhaken').click();
  await expect(page.getByTestId('todo-item')).toHaveClass(/done/);
  await page.getByTestId('todo-item').getByLabel('Löschen').click();
  await expect(page.getByTestId('todo-item')).toHaveCount(0);

  await page.getByTestId('tab-finance').click();
  await page.getByTestId('finance-input').fill('15 Euro Essen');
  await page.getByTestId('finance-submit').click();
  await expect(page.getByTestId('tx-item')).toContainText('Essen');
  await expect(page.getByTestId('month-chart')).toContainText('Essen');
});

test('Aufgabe mit Fälligkeit bearbeiten', async ({ page }) => {
  await resetApp(page, '#/aufgaben');
  await page.getByTestId('todo-input').fill('Steuer abgeben');
  await page.getByTestId('todo-input').press('Enter');
  await page.getByText('Steuer abgeben').click();
  await page.getByTestId('todo-due-date').fill('2026-11-20');
  await page.getByTestId('todo-due-time').fill('17:30');
  await page.getByTestId('todo-remind').check();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByTestId('todo-due')).toContainText('20. Nov.');
  await expect(page.getByTestId('todo-due')).toContainText('17:30');
});
