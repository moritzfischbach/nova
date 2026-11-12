import { expect, test, type Page } from '@playwright/test';
import { resetApp } from './helpers';

// Regression: on the real iPhone the Morgenplaner was wider than the screen (sideways swiping).
const WIDTHS = [320, 375, 390, 430];
const ROUTES = ['#/', '#/aufgaben', '#/kalender', '#/finanzen', '#/ziele', '#/grok', '#/einstellungen', '#/chat', '#/gewohnheiten', '#/morgenplan', '#/morgen'];
const at = (hhmm: string, date = '2026-11-12') => new Date(`${date}T${hhmm}:00+01:00`);

async function overflow(page: Page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const view = document.querySelector<HTMLElement>('.view');
    const offenders = [...document.querySelectorAll<HTMLElement>('.view *, .sheet *')]
      .filter((e) => {
        const b = e.getBoundingClientRect();
        if (!b.width || !b.height) return false;
        const cs = getComputedStyle(e);
        if (cs.visibility === 'hidden' || cs.position === 'fixed') return false;
        // horizontally scrollable chip rows are intentional
        if (e.closest('.chips:not(.wrap), .subnav')) return false;
        return b.right > vw + 1 || b.left < -1;
      })
      .slice(0, 6)
      .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}[${e.dataset.testid ?? ''}] ${Math.round(e.getBoundingClientRect().right)}px: ${(e.textContent ?? '').trim().slice(0, 30)}`);
    const smallInputs = [...document.querySelectorAll<HTMLElement>('input:not([type=checkbox]):not([type=radio]), select, textarea')]
      .filter((e) => e.getBoundingClientRect().width && parseFloat(getComputedStyle(e).fontSize) < 16)
      .map((e) => e.dataset.testid ?? e.getAttribute('name') ?? e.tagName);
    return {
      doc: document.scrollingElement!.scrollWidth - vw,
      view: view ? view.scrollWidth - view.clientWidth : 0,
      offenders,
      smallInputs,
    };
  });
}

async function expectFits(page: Page, label: string) {
  await page.waitForTimeout(150);
  const o = await overflow(page);
  expect(o, label).toEqual({ doc: 0, view: 0, offenders: [], smallInputs: [] });
}

async function seed(page: Page) {
  // plan with per-day start times, applied
  await page.goto('/#/morgenplan?neu=1');
  await page.getByTestId('pq-diff').click();
  await page.getByTestId('pq-arrive-5').fill('07:30');
  await page.getByTestId('pq-arrive-5').blur();
  for (let i = 0; i < 4; i += 1) await page.getByTestId('pq-next').click();
  await page.getByTestId('pq-act-sport').click();
  await page.getByTestId('pq-custom-title').fill('Pflanzengießenundbalkonaufräumen');
  await page.getByTestId('pq-custom-add').click();
  await page.getByTestId('pq-next').click();
  await page.getByTestId('pq-next').click();
  await page.getByTestId('plan-apply').click();
  await expect(page.getByTestId('plan-card')).toBeVisible();
  // punctuality + wake data
  await page.getByTestId('wake-now').click();
  await expect(page.getByTestId('checkin-card')).toBeVisible();
  await page.getByTestId('checkin-knapp').click();
  await expect(page.getByTestId('checkin-card')).toHaveCount(0);
}

for (const width of WIDTHS) {
  test(`kein seitliches Scrollen bei ${width}px – Morgenplaner, Sheets und alle Seiten`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.clock.setFixedTime(at('18:45'));
    await resetApp(page, '#/');
    await seed(page);

    await page.goto('/#/morgen');
    await expect(page.getByTestId('wake-section')).toBeVisible();
    await expectFits(page, `#/morgen @${width}`);

    for (const [open, label] of [['morning-settings', 'Einstellungen'], ['wake-setup', 'Aufstehen & Arbeit'], ['wake-tile', 'Statistik'], ['routine-edit', 'Routine']] as const) {
      await page.getByTestId(open).first().click();
      await expect(page.locator('.sheet')).toBeVisible();
      await page.waitForTimeout(400);
      await expectFits(page, `#/morgen Sheet ${label} @${width}`);
      await page.keyboard.press('Escape');
      await expect(page.locator('.sheet')).toHaveCount(0);
    }

    for (const hash of ROUTES) {
      await page.goto(`/${hash}`);
      await page.waitForTimeout(300);
      await expectFits(page, `${hash} @${width}`);
    }
    // quiz steps and the result
    await page.goto('/#/morgenplan?neu=1');
    for (let i = 0; i < 6; i += 1) {
      await expectFits(page, `#/morgenplan Schritt ${i + 1} @${width}`);
      if (i === 0) await page.getByTestId('pq-diff').click(), await expectFits(page, `#/morgenplan Tage @${width}`);
      await page.getByTestId('pq-next').click();
    }
    await expect(page.getByTestId('plan-result')).toBeVisible();
    await expectFits(page, `#/morgenplan Ergebnis @${width}`);
  });
}
