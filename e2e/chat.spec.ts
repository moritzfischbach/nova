import { expect, test } from '@playwright/test';
import { control, resetApp } from './helpers';

const send = async (page: import('@playwright/test').Page, text: string, wait = false) => {
  const before = await page.locator('.msg.assistant').count();
  await page.getByTestId('chat-input').fill(text);
  await page.getByTestId('chat-send').click();
  if (wait) {
    await expect(page.locator('.msg.assistant:not(.streaming)')).toHaveCount(before + 1);
  }
};

test.beforeEach(async ({ page }) => {
  await resetApp(page, '#/chat');
  await expect(page.getByTestId('chat')).toBeVisible();
  await expect(page.getByTestId('chat-sub')).toContainText('grok-test');
});

test('center tab and empty state with suggestions', async ({ page }) => {
  await page.goto('/#/');
  await page.getByTestId('open-chat').click();
  await expect(page.getByTestId('tab-chat')).toHaveClass(/active/);
  await expect(page.getByTestId('chat-suggestions')).toBeVisible();
  await expect(page.getByTestId('chat-note')).toHaveCount(0);
});

test('streams a reply and renders markdown safely', async ({ page }) => {
  await send(page, 'Hallo Nova, wie geht es dir?', true);
  await expect(page.getByTestId('msg-user')).toContainText('Hallo Nova');
  const reply = page.getByTestId('msg-text').last();
  await expect(reply.locator('strong').first()).toBeVisible();
  await expect(page.locator('.chat-log script')).toHaveCount(0);
  await expect(reply.locator('a[href^="javascript"]')).toHaveCount(0);
  await expect(page.locator('.msg.streaming')).toHaveCount(0);
  const reqs = await control<{ messages: { role: string }[]; model: string }[]>('/xai');
  const last = reqs.at(-1)!;
  expect(last.model).toBe('grok-test');
  expect(JSON.stringify(last.messages[0])).toContain('nova_daten');
});

test('context sharing can be switched off', async ({ page }) => {
  await page.getByTestId('chat-context').click();
  await expect(page.getByTestId('chat-context')).toHaveAttribute('aria-pressed', 'false');
  await send(page, 'Ohne Kontext bitte', true);
  await expect(page.getByTestId('msg-text').last()).toBeVisible();
  const last = (await control<{ messages: { content: string }[] }[]>('/xai')).at(-1)!;
  expect(JSON.stringify(last.messages[0])).not.toContain('Offene Aufgaben');
});

test('todo tool: confirm creates the todo and Nova follows up', async ({ page }) => {
  await send(page, 'Leg eine Aufgabe an: Milch kaufen');
  const chip = page.getByTestId('tool-chip');
  await expect(chip).toContainText('Milch kaufen');
  await expect(chip).toHaveAttribute('data-status', 'offen');
  await chip.getByTestId('tool-confirm').click();
  await expect(chip).toHaveAttribute('data-status', 'ausgefuehrt');
  await expect(page.getByTestId('msg-text').last()).toContainText('Erledigt');
  await page.getByTestId('tab-todos').click();
  await expect(page.getByText('Milch kaufen').first()).toBeVisible();
});

test('decline path tells the model and creates nothing', async ({ page }) => {
  await send(page, 'Bitte einen Termin beim Zahnarzt');
  const chip = page.getByTestId('tool-chip');
  await chip.getByTestId('tool-decline').click();
  await expect(chip).toHaveAttribute('data-status', 'abgelehnt');
  await expect(page.getByTestId('msg-text').last()).toContainText('lasse ich das');
  const last = (await control<{ messages: { role: string; content: string }[] }[]>('/xai')).at(-1)!;
  expect(last.messages.at(-1)!.role).toBe('tool');
  expect(last.messages.at(-1)!.content).toContain('abgelehnt');
});

test('Grok tool hands the task to Grok Bot via the webhook', async ({ page }) => {
  const before = (await control<unknown[]>('/hooks')).length;
  await send(page, 'Frag Grok nach Flügen nach Lissabon');
  const chip = page.getByTestId('tool-chip');
  await expect(chip).toContainText('Lissabon');
  await chip.getByTestId('tool-confirm').click();
  await expect(chip).toHaveAttribute('data-status', 'ausgefuehrt');
  await expect(chip).toContainText('Grok');
  const hooks = await control<{ body: Record<string, unknown> }[]>('/hooks');
  expect(hooks.length).toBe(before + 1);
  expect(JSON.stringify(hooks.at(-1)!.body)).toContain('Lissabon');
});

test('upstream error shows retry', async ({ page }) => {
  await send(page, 'fehler401');
  await expect(page.getByTestId('msg-error')).toContainText('xAI-Schlüssel');
  await expect(page.getByTestId('chat-retry')).toBeVisible();
});

test('conversations persist, switch and clear', async ({ page }) => {
  await send(page, 'Erster Chat über Pläne', true);
  await page.getByTestId('chat-new').click();
  await expect(page.getByTestId('chat-suggestions')).toBeVisible();
  await send(page, 'Zweiter Chat', true);
  await page.reload();
  await expect(page.getByTestId('msg-user')).toContainText('Zweiter Chat');
  await page.getByTestId('chat-history').click();
  await expect(page.getByTestId('chat-conversation')).toHaveCount(2);
  await page.getByTestId('chat-conversation').filter({ hasText: 'Erster Chat' }).locator('[data-open]').click();
  await expect(page.getByTestId('msg-user')).toContainText('Erster Chat');
  await page.getByTestId('chat-history').click();
  await page.getByTestId('chat-clear').click();
  await expect(page.getByTestId('chat-suggestions')).toBeVisible();
  await expect(page.getByTestId('msg-user')).toHaveCount(0);
});

test('pairing link stores the app token and leaves the URL', async ({ page }) => {
  await page.goto('/#/koppeln?code=pairing-code-1234567890');
  await expect(page.getByTestId('chat')).toBeVisible();
  expect(page.url()).not.toContain('pairing-code');
  expect(await page.evaluate(() => localStorage.getItem('nova.appToken'))).toBe('pairing-code-1234567890');
  await page.evaluate(() => localStorage.removeItem('nova.appToken'));
});
