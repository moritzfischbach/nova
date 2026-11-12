// Nova logo: nested, internally tangent circles whose tangent point rotates,
// forming a spiral of crescents that ends in a small circle. White strokes.
// node scripts/logo.mjs → public/logo.svg (+ returns path data for icons)
import { writeFileSync } from 'node:fs';

export function logoCircles({ size = 1024, r0 = 0.39, k = 0.76, step = -52, start = 100, n = 10 } = {}) {
  const out = [];
  let cx = size / 2, cy = size / 2, r = size * r0, phi = (start * Math.PI) / 180;
  for (let i = 0; i < n; i += 1) {
    out.push({ cx, cy, r });
    const nr = r * k;
    cx += (r - nr) * Math.cos(phi);
    cy += (r - nr) * Math.sin(phi);
    r = nr;
    phi += (step * Math.PI) / 180;
  }
  return out;
}

export function logoSvg({ size = 1024, stroke = 7, background = null, pad = 0, n = 10, strokePx = null } = {}) {
  const inner = size - pad * 2;
  const s = inner / 1024;
  const circles = logoCircles({ n })
    .map((c) => `<circle cx="${(pad + c.cx * s).toFixed(2)}" cy="${(pad + c.cy * s).toFixed(2)}" r="${(c.r * s).toFixed(2)}"/>`)
    .join('');
  const bg = background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Nova">${bg}<g fill="none" stroke="#fff" stroke-width="${(strokePx ?? stroke * s).toFixed(2)}">${circles}</g></svg>`;
}

// Icon set: [file, size, padding (px), circles, stroke px]
export const ICONS = [
  ['icons/apple-touch-icon.png', 180, 22, 9, 2.2],
  ['icons/icon-192.png', 192, 14, 9, 2.2],
  ['icons/icon-512.png', 512, 36, 10, 4.2],
  ['icons/icon-192-maskable.png', 192, 40, 8, 2],
  ['icons/icon-512-maskable.png', 512, 104, 10, 4],
  ['icons/favicon-32.png', 32, 1, 5, 1.6],
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const { chromium } = await import('@playwright/test');
  writeFileSync('public/logo.svg', logoSvg() + '\n');
  // in-app mark: stroke uses currentColor, sized by CSS
  writeFileSync('src/assets/logo.svg', logoSvg({ stroke: 16 }).replace('stroke="#fff"', 'stroke="currentColor"').replace(/ width="1024" height="1024"/, '') + '\n');
  writeFileSync('public/icons/logo-black.svg', logoSvg({ background: '#000' }) + '\n');
  writeFileSync('public/icons/favicon.svg', logoSvg({ size: 64, background: '#000', pad: 2, n: 6, strokePx: 2.4 }) + '\n');
  const browser = await chromium.launch({ channel: 'chrome' });
  for (const [file, size, pad, n, strokePx] of ICONS) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<html><body style="margin:0;background:#000">${logoSvg({ size, pad, n, strokePx, background: '#000' })}</body></html>`);
    await page.screenshot({ path: `public/${file}`, omitBackground: false });
    await page.close();
    console.log(`public/${file} ${size}px`);
  }
  await browser.close();
}
