import { chromium, devices } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome' });
for (const w of [320]) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: w, height: 800 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:8797/#/morgenplan');
  await page.getByTestId('pq-next').waitFor();
  await page.getByTestId('pq-diff').click();
  for (let i = 0; i < 6; i++) await page.getByTestId('pq-next').click();
  await page.getByTestId('plan-apply').click();
  await page.getByTestId('plan-card').waitFor();
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const vw = innerWidth;
    const wide = [...document.querySelectorAll('body *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width && b.right > vw + 0.5; })
      .filter((e) => !e.closest('.tabbar,.toast,.toasts')).slice(0, 15).map((e) => `${e.tagName}.${String(e.className).slice(0,40)}[${e.dataset.testid ?? ''}] w=${Math.round(e.getBoundingClientRect().width)} r=${Math.round(e.getBoundingClientRect().right)}`);
    const inputs = [...document.querySelectorAll('input,select,textarea')].map((e) => parseFloat(getComputedStyle(e).fontSize)).filter((f) => f < 16);
    const mc = (root) => [...root.querySelectorAll('*')].map((e) => { const old = e.style.width; e.style.width = 'min-content'; const wv = e.getBoundingClientRect().width; e.style.width = old; return [wv, e]; });
    const page = document.querySelector('.morning-page');
    const top = [...page.children].map((c) => { const o = c.style.width; c.style.width = 'min-content'; const wv = Math.round(c.getBoundingClientRect().width); c.style.width = o; return `${c.tagName}.${c.className}[${c.dataset.testid ?? ''}] ${wv}`; });
    const leaf = mc(page).filter(([wv]) => wv > 280).map(([wv, e]) => `${e.tagName}.${String(e.className).slice(0,30)}[${e.dataset.testid ?? ''}] ${Math.round(wv)} :: ${e.textContent.trim().slice(0,40)}`).slice(-25);
    return { top, leaf, sw: document.scrollingElement.scrollWidth, vsw: document.querySelector('.view').scrollWidth, wide, smallInputs: inputs.length };
  });
  console.log(w, JSON.stringify(r, null, 1));
  await ctx.close();
}
await browser.close();
