// Backup storage. The server only ever stores encrypted envelopes (see src/shared/backup/crypto.ts).
//   memoryBackupStore – tests
//   dirBackupStore    – local mode (server/data/backups)
//   gitBackupStore    – durable: a private GitHub repo written with a repo-scoped deploy key.
//                       Each write is a single orphan commit (force-push), so the repo only ever
//                       holds the last N versions and never grows.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{ id: string, createdAt: string, device?: string, size: number }} BackupMeta */
/** @typedef {{ kind: string, list: () => Promise<BackupMeta[]>, get: (id: string) => Promise<{ meta: BackupMeta, envelope: any } | undefined>, put: (meta: BackupMeta, envelope: any) => Promise<BackupMeta[]> }} BackupStore */

const ID_RE = /^[0-9]{8}T[0-9]{6}Z-[a-z0-9]{6}$/;
export const validBackupId = (id) => typeof id === 'string' && ID_RE.test(id);

export function newBackupId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
  return `${stamp}-${rand}`;
}

const sortNewest = (list) => [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));

/** @returns {BackupStore} */
export function memoryBackupStore(keep = 10) {
  /** @type {Map<string, { meta: BackupMeta, envelope: any }>} */
  const data = new Map();
  return {
    kind: 'memory',
    async list() {
      return sortNewest([...data.values()].map((v) => v.meta));
    },
    async get(id) {
      const v = data.get(id);
      return v && structuredClone(v);
    },
    async put(meta, envelope) {
      data.set(meta.id, structuredClone({ meta, envelope }));
      const list = sortNewest([...data.values()].map((v) => v.meta));
      for (const old of list.slice(keep)) data.delete(old.id);
      return list.slice(0, keep);
    },
  };
}

function filesApi(dir, keep) {
  const indexFile = () => join(dir, 'index.json');
  const readIndex = () => (existsSync(indexFile()) ? JSON.parse(readFileSync(indexFile(), 'utf8')) : []);
  return {
    readIndex,
    get(id) {
      if (!validBackupId(id)) return undefined;
      const f = join(dir, 'versions', `${id}.json`);
      return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : undefined;
    },
    write(meta, envelope) {
      mkdirSync(join(dir, 'versions'), { recursive: true });
      writeFileSync(join(dir, 'versions', `${meta.id}.json`), JSON.stringify({ meta, envelope }));
      const index = sortNewest([meta, ...readIndex().filter((m) => m.id !== meta.id)]).slice(0, keep);
      const keepIds = new Set(index.map((m) => m.id));
      for (const f of readdirSync(join(dir, 'versions'))) if (!keepIds.has(f.replace(/\.json$/, ''))) rmSync(join(dir, 'versions', f));
      writeFileSync(indexFile(), JSON.stringify(index, null, 2));
      writeFileSync(
        join(dir, 'README.md'),
        `# Nova Backups\n\nEnde-zu-Ende-verschlüsselte Backups der Nova-App (AES-GCM, Schlüssel nur auf dem Gerät).\nDer Nova-Server schreibt hier automatisch; es werden nur die letzten ${keep} Versionen behalten.\n`,
      );
      return index;
    },
  };
}

/** @returns {BackupStore} */
export function dirBackupStore(dir, keep = 10) {
  const files = filesApi(dir, keep);
  let chain = Promise.resolve();
  const queue = (fn) => (chain = chain.then(fn, fn));
  return {
    kind: 'local',
    async list() {
      return files.readIndex();
    },
    async get(id) {
      return files.get(id);
    },
    put(meta, envelope) {
      return queue(() => files.write(meta, envelope));
    },
  };
}

/**
 * @param {{ repo: string, keyB64: string, keep?: number, workDir?: string, log?: (m: string) => void, branch?: string }} opts
 * @returns {BackupStore}
 */
export function gitBackupStore({ repo, keyB64, keep = 10, workDir = join(tmpdir(), 'nova-backups-work'), log = () => {}, branch = 'main' }) {
  const helper = join(dirname(fileURLToPath(import.meta.url)), 'git-ssh.mjs');
  const keyFile = join(tmpdir(), `nova-backup-key-${process.pid}`);
  const files = filesApi(workDir, keep);
  let chain = Promise.resolve();
  const queue = (fn) => (chain = chain.then(fn, fn));
  let syncedAt = 0;
  let ready = false;

  const env = () => ({
    ...process.env,
    GIT_SSH: helper,
    GIT_SSH_VARIANT: 'simple',
    NOVA_GIT_SSH_KEY_FILE: keyFile,
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Nova Server',
    GIT_AUTHOR_EMAIL: 'nova-server@users.noreply.github.com',
    GIT_COMMITTER_NAME: 'Nova Server',
    GIT_COMMITTER_EMAIL: 'nova-server@users.noreply.github.com',
  });
  const git = (args) =>
    new Promise((resolve, reject) => {
      execFile('git', args, { cwd: workDir, env: env(), timeout: 60_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(Object.assign(new Error(`git ${args[0]} fehlgeschlagen: ${String(stderr || err.message).split('\n').filter(Boolean).slice(-1)[0] ?? ''}`), { stderr }));
        else resolve(String(stdout).trim());
      });
    });

  async function init() {
    if (ready) return;
    if (!existsSync(keyFile)) {
      const pem = Buffer.from(keyB64, 'base64').toString('utf8');
      writeFileSync(keyFile, pem.endsWith('\n') ? pem : `${pem}\n`, { mode: 0o600 });
    }
    mkdirSync(workDir, { recursive: true });
    if (!existsSync(join(workDir, '.git'))) {
      await git(['init', '-q']);
      await git(['remote', 'add', 'origin', repo]);
    }
    ready = true;
  }

  async function sync(force = false) {
    await init();
    if (!force && Date.now() - syncedAt < 60_000) return;
    try {
      await git(['fetch', '-q', '--depth', '1', 'origin', branch]);
      await git(['reset', '-q', '--hard', 'FETCH_HEAD']);
      await git(['clean', '-qfdx']);
    } catch (e) {
      // empty repository: no branch yet
      if (!/couldn't find remote ref|no matching remote head|not found/i.test(String(e.stderr ?? e.message))) throw e;
    }
    syncedAt = Date.now();
  }

  return {
    kind: 'github',
    list() {
      return queue(async () => {
        await sync();
        return files.readIndex();
      });
    },
    get(id) {
      return queue(async () => {
        await sync();
        return files.get(id);
      });
    },
    put(meta, envelope) {
      return queue(async () => {
        await sync(true);
        const index = files.write(meta, envelope);
        await git(['add', '-A']);
        const tree = await git(['write-tree']);
        const commit = await git(['commit-tree', tree, '-m', `Backup ${meta.createdAt} (${index.length} Versionen)`]);
        await git(['push', '-q', '-f', 'origin', `${commit}:refs/heads/${branch}`]);
        await git(['update-ref', `refs/heads/${branch}`, commit]);
        await git(['symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
        syncedAt = Date.now();
        log(`backup stored (${index.length} versions, ${meta.size} bytes)`);
        return index;
      });
    },
  };
}
