// Local HTTPS "push service" for tests: accepts Web Push POSTs and can decrypt them.
import { execFileSync } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { Agent, createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ece from 'http_ece';

export function selfSignedCert() {
  const dir = mkdtempSync(join(tmpdir(), 'nova-push-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
  return { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) };
}

export async function startTestPushService() {
  const received = [];
  const server = createServer(selfSignedCert(), (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.statusCode = req.url.includes('gone') ? 410 : 201;
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `https://127.0.0.1:${server.address().port}`;
  /** Creates a browser-like subscription (client key pair + auth secret). */
  const subscription = (name = 'device') => {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const auth = randomBytes(16).toString('base64url');
    return {
      sub: { endpoint: `${base}/push/${name}`, keys: { p256dh: ecdh.getPublicKey('base64url'), auth } },
      decrypt: (body) => JSON.parse(ece.decrypt(body, { version: 'aes128gcm', privateKey: ecdh, authSecret: auth }).toString()),
    };
  };
  return {
    base,
    received,
    subscription,
    agent: new Agent({ rejectUnauthorized: false }), // self-signed, test only
    close: () => new Promise((r) => server.close(r)),
  };
}
