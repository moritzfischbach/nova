// Cloudflare Workers entry. Secrets via `wrangler secret put GROKBOT_WEBHOOK_KEY` etc.
// Static assets (dist/) can be served by Workers Static Assets or Cloudflare Pages.
import { createApp } from './app.js';

const app = createApp({ getConfig: (c) => c.env ?? {} });
export default app;
