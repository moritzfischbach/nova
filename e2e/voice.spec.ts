import { expect, test, type Page } from '@playwright/test';

/** Installs a fake SpeechRecognition that "hears" window.__say (or errors with window.__voiceError). */
async function mockSpeech(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__voiceLog = [];
    class FakeRecognition {
      lang = '';
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onstart: (() => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        (w.__voiceLog as string[]).push(`start:${this.lang}:${this.interimResults}`);
        const say = String(w.__say ?? '');
        const err = w.__voiceError as string | undefined;
        setTimeout(() => this.onstart?.(), 10);
        if (err) {
          setTimeout(() => { this.onerror?.({ error: err }); this.onend?.(); }, 60);
          return;
        }
        const half = say.split(' ').slice(0, 2).join(' ');
        const mk = (text: string, isFinal: boolean) => ({
          resultIndex: 0,
          results: { length: 1, 0: Object.assign({ isFinal, length: 1 }, { 0: { transcript: text } }) },
        });
        setTimeout(() => this.onresult?.(mk(half, false)), 80);
        setTimeout(() => { (w.__voiceLog as string[]).push(`interim-shown`); }, 120);
        setTimeout(() => this.onresult?.(mk(say, true)), 400);
        setTimeout(() => this.onend?.(), 450);
      }
      stop() { setTimeout(() => this.onend?.(), 0); }
      abort() { setTimeout(() => this.onend?.(), 0); }
    }
    w.webkitSpeechRecognition = FakeRecognition;
    delete w.SpeechRecognition;
  });
}

test.describe('Spracheingabe', () => {
  test('gesprochene Aufgabe landet in der aktuellen Liste', async ({ page }) => {
    await mockSpeech(page);
    await page.goto('/#/aufgaben');
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__say = 'blumen gießen'; });
    const mic = page.getByTestId('todo-mic');
    await expect(mic).toBeVisible();
    await expect(mic).not.toHaveClass(/unsupported/);
    await mic.click();
    await expect(mic).toHaveClass(/recording/);
    await expect(page.getByTestId('todo-input')).toHaveValue('blumen gießen');
    await expect(page.getByTestId('todo-item').filter({ hasText: 'Blumen gießen' })).toBeVisible();
    await expect(page.getByTestId('todo-mic')).not.toHaveClass(/recording/);
    const log = await page.evaluate(() => (window as unknown as Record<string, unknown>).__voiceLog);
    expect(log).toContain('start:de-DE:true');
  });

  test('interimes Transkript erscheint live im Feld', async ({ page }) => {
    await mockSpeech(page);
    await page.goto('/#/finanzen');
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__say = 'zwölf Komma fünf Euro Tanken'; });
    await page.getByTestId('finance-mic').click();
    await expect(page.getByTestId('finance-input')).toHaveValue('zwölf Komma');
    await expect(page.getByTestId('tx-item').filter({ hasText: 'Tanken' })).toContainText('12,50');
  });

  test('gesprochene Ausgabe „fünfzehn Euro Essen“ wird erfasst', async ({ page }) => {
    await mockSpeech(page);
    await page.goto('/#/finanzen');
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__say = 'fünfzehn Euro Essen'; });
    await page.getByTestId('finance-mic').click();
    const row = page.getByTestId('tx-item').filter({ hasText: 'Essen' });
    await expect(row).toContainText('15,00');
    await expect(page.getByTestId('month-chart')).toContainText('Essen');
    await expect(page.getByTestId('finance-input')).toHaveValue('');
  });

  test('Mikrofon verweigert zeigt deutschen Hinweis', async ({ page }) => {
    await mockSpeech(page);
    await page.goto('/#/aufgaben');
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__voiceError = 'not-allowed'; });
    await page.getByTestId('todo-mic').click();
    await expect(page.locator('.toast')).toContainText('Kein Zugriff aufs Mikrofon');
    await expect(page.getByTestId('todo-item')).toHaveCount(0);
    await expect(page.getByTestId('todo-mic')).not.toHaveClass(/recording/);
  });

  test('nichts gehört zeigt Hinweis', async ({ page }) => {
    await mockSpeech(page);
    await page.goto('/#/finanzen');
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__voiceError = 'no-speech'; });
    await page.getByTestId('finance-mic').click();
    await expect(page.locator('.toast')).toContainText('nichts gehört');
    await expect(page.getByTestId('tx-item')).toHaveCount(0);
  });

  test('ohne Web Speech API: Button deaktiviert, Hinweis auf Diktieren', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      delete w.SpeechRecognition;
      delete w.webkitSpeechRecognition;
    });
    await page.goto('/#/aufgaben');
    const mic = page.getByTestId('todo-mic');
    await expect(mic).toHaveClass(/unsupported/);
    await expect(mic).toHaveAttribute('data-unsupported', 'true');
    await mic.click();
    await expect(page.locator('.toast')).toContainText('Diktieren');
    // typing still works
    await page.getByTestId('todo-input').fill('Getippt');
    await page.getByTestId('todo-form').locator('button[type="submit"]').click();
    await expect(page.getByTestId('todo-item')).toContainText('Getippt');
  });
});
