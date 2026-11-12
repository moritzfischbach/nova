import { defineConfig } from 'vitest/config';
import { browserslistToTargets } from 'lightningcss';
import browserslist from 'browserslist';

// iOS 15+ / aktuelle Browser; lightningcss löst CSS-Nesting der Kalender-Bibliothek auf.
const cssTargets = browserslistToTargets(browserslist(['safari >= 15', 'ios_saf >= 15', 'chrome >= 100', 'firefox >= 100']));

export default defineConfig({
  // GitHub Pages: NOVA_BASE=/<repo>/ (absolute subpath); default relative for the combined server
  base: process.env.NOVA_BASE || './',
  css: { transformer: 'lightningcss', lightningcss: { targets: cssTargets } },
  build: { cssMinify: 'lightningcss', target: ['es2020', 'safari15'] },
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  preview: {
    host: true,
    port: 4173,
  },
  test: {
    include: ['tests/**/*.test.ts', 'server/**/*.test.js'],
    environment: 'node',
  },
});
