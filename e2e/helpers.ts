import type { Page } from '@playwright/test';

export const CONTROL = 'http://127.0.0.1:8798';

export async function control<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${CONTROL}${path}`);
  return (await res.json()) as T;
}

/** Fresh IndexedDB/localStorage per test (all tests share one origin). */
export async function resetApp(page: Page, hash = '#/'): Promise<void> {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    const dbs = (await indexedDB.databases?.()) ?? [{ name: 'nova' }];
    await Promise.all(dbs.map((d) => new Promise((r) => {
      const req = indexedDB.deleteDatabase(d.name!);
      req.onsuccess = req.onerror = req.onblocked = () => r(null);
    })));
  });
  await page.goto(`/${hash}`);
  await page.reload();
}

export function isoInDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
