// Generates VAPID keys once and stores them in .env (gitignored). Prints only the public key.
import webpush from 'web-push';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const envFile = process.env.NOVA_ENV_FILE ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
let text = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
const has = (k) => new RegExp(`^${k}=.+`, 'm').test(text);
if (has('VAPID_PUBLIC_KEY') && has('VAPID_PRIVATE_KEY') && !process.argv.includes('--force')) {
  console.log('VAPID-Schlüssel sind bereits in .env vorhanden (mit --force neu erzeugen).');
  process.exit(0);
}
const keys = webpush.generateVAPIDKeys();
const set = (k, v) => {
  const re = new RegExp(`^${k}=.*$`, 'm');
  text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text.replace(/\n?$/, '\n')}${k}=${v}\n`;
};
set('VAPID_PUBLIC_KEY', keys.publicKey);
set('VAPID_PRIVATE_KEY', keys.privateKey);
if (!has('VAPID_SUBJECT')) set('VAPID_SUBJECT', 'mailto:nova@example.invalid');
writeFileSync(envFile, text, { mode: 0o600 });
console.log(`VAPID-Schlüssel erzeugt und in ${envFile} gespeichert.`);
console.log(`Öffentlicher Schlüssel: ${keys.publicKey}`);
