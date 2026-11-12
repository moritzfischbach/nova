#!/usr/bin/env node
// Minimal SSH transport for git (GIT_SSH + GIT_SSH_VARIANT=simple), pure JS via ssh2.
// Render's native runtime ships git but no ssh client. Only GitHub host keys are accepted.
//   usage (by git): git-ssh.mjs [-p port] git@github.com "git-receive-pack 'owner/repo.git'"
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ssh2 from 'ssh2';

// https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
const GITHUB_FINGERPRINTS = new Set([
  '+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU', // ED25519
  'p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM', // ECDSA
  'uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s', // RSA
]);

const args = process.argv.slice(2);
let port = 22;
while (args[0]?.startsWith('-')) {
  const flag = args.shift();
  if (flag === '-p') port = Number(args.shift());
  else if (flag === '-o') args.shift();
}
const [target, ...rest] = args;
const [username, host] = target.includes('@') ? target.split('@') : ['git', target];
const keyFile = process.env.NOVA_GIT_SSH_KEY_FILE;
if (!keyFile) {
  console.error('git-ssh: NOVA_GIT_SSH_KEY_FILE fehlt');
  process.exit(255);
}

const conn = new ssh2.Client();
conn.on('ready', () => {
  conn.exec(rest.join(' '), (err, stream) => {
    if (err) {
      console.error(`git-ssh: ${err.message}`);
      process.exit(255);
    }
    process.stdin.pipe(stream);
    stream.pipe(process.stdout);
    stream.stderr.pipe(process.stderr);
    stream.on('exit', (code) => {
      process.exitCode = typeof code === 'number' ? code : 0;
    });
    stream.on('close', () => conn.end());
  });
});
conn.on('error', (e) => {
  console.error(`git-ssh: ${e.message}`);
  process.exit(255);
});
conn.connect({
  host,
  port,
  username,
  privateKey: readFileSync(keyFile),
  readyTimeout: 20000,
  hostVerifier: (key) => GITHUB_FINGERPRINTS.has(createHash('sha256').update(key).digest('base64').replace(/=+$/, '')),
});
