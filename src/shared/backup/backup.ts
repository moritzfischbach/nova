/**
 * Backup & Sync: automatic, end-to-end-encrypted backups on the Nova server.
 * The derived AES key is kept on the device as a non-extractable CryptoKey (IndexedDB),
 * so automatic backups need no password; restoring on another device needs it.
 */
import { getMeta, onDbChange, setMeta } from '../../data/db';
import { apiHeaders, apiUrl, fetchWithTimeout, STATIC_ONLY } from '../api';
import { isIOS, isStandalone } from '../reminders';
import { decryptWithKey, decryptWithSecret, encryptJson, makeKeyParams, parseEnvelope, type BackupEnvelope, type KeyParams, type SecretKind } from './crypto';
import { applySnapshot, countsOf, isPrivateMetaKey, takeSnapshot, validSnapshot, type Snapshot } from './snapshot';

export interface BackupState {
  enabled: boolean;
  auto: boolean;
  params?: KeyParams;
  setupAt?: string;
  lastBackupAt?: string;
  lastVersionId?: string;
  versions?: number;
  lastError?: string;
  lastErrorAt?: string;
}

export interface BackupVersion {
  id: string;
  createdAt: string;
  device?: string;
  size: number;
}

export interface ServerBackupStatus {
  reachable: boolean;
  configured: boolean;
  storage?: 'github' | 'local' | 'memory';
  keep?: number;
}

const STATE_KEY = 'backup.state';
const DIRTY_KEY = 'nova.backupDirty';
export const AUTO = { debounceMs: 20_000, minIntervalMs: 3 * 60_000, dailyMs: 24 * 3600_000, startDelayMs: 4000 };
// e2e only: shorter timings (set by the browser tests, harmless otherwise)
if (typeof localStorage !== 'undefined' && localStorage.getItem('nova.backupFast') === '1') Object.assign(AUTO, { debounceMs: 400, minIntervalMs: 1500, startDelayMs: 300 });

export async function getBackupState(): Promise<BackupState> {
  return (await getMeta<BackupState>(STATE_KEY)) ?? { enabled: false, auto: true };
}

async function patchState(p: Partial<BackupState>): Promise<BackupState> {
  const next = { ...(await getBackupState()), ...p };
  await setMeta(STATE_KEY, next);
  emitStatus();
  return next;
}

const statusListeners = new Set<() => void>();
export function onBackupStatus(fn: () => void): () => void {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}
const emitStatus = () => statusListeners.forEach((fn) => fn());

export function dirtySince(): string | undefined {
  return localStorage.getItem(DIRTY_KEY) ?? undefined;
}

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const platform = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (isIOS() && /Macintosh/.test(ua)) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Linux';
  const browser = isStandalone() ? 'Home-Bildschirm' : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) && !/CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${platform} · ${browser}`;
}

async function api<T>(path: string, init: RequestInit = {}, ms = 30000): Promise<T> {
  const res = await fetchWithTimeout(apiUrl(path), { ...init, headers: { ...apiHeaders(init.method === 'POST'), ...(init.headers ?? {}) } }, ms);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      res.status === 401
        ? 'Dieses Gerät ist noch nicht mit dem Nova-Server gekoppelt.'
        : res.status === 503
          ? 'Backups sind auf dem Server nicht eingerichtet.'
          : (data.message as string) || `Server-Fehler (${res.status}).`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return data as T;
}

export async function getServerBackupStatus(): Promise<ServerBackupStatus> {
  if (STATIC_ONLY) return { reachable: false, configured: false };
  try {
    const d = await api<{ configured: boolean; storage?: ServerBackupStatus['storage']; keep?: number }>('api/backup/status', {}, 20000);
    return { reachable: true, configured: d.configured, storage: d.storage, keep: d.keep };
  } catch {
    return { reachable: false, configured: false };
  }
}

export async function listVersions(): Promise<BackupVersion[]> {
  const d = await api<{ versions: BackupVersion[] }>('api/backup');
  return d.versions;
}

export async function fetchVersion(id: string): Promise<BackupEnvelope> {
  const d = await api<{ envelope: unknown }>(`api/backup/${encodeURIComponent(id)}`);
  return parseEnvelope(d.envelope);
}

/** Set (or change) the backup secret, then back up right away. */
export async function setupBackup(secret: string, kind: SecretKind): Promise<BackupState> {
  const params = await makeKeyParams(secret, kind);
  await patchState({ enabled: true, auto: true, params, setupAt: new Date().toISOString(), lastError: undefined, lastErrorAt: undefined });
  localStorage.setItem(DIRTY_KEY, new Date().toISOString());
  await backupNow();
  return getBackupState();
}

export async function disableBackup(): Promise<void> {
  await setMeta(STATE_KEY, { enabled: false, auto: true } satisfies BackupState);
  emitStatus();
}

export async function setAutoBackup(on: boolean): Promise<void> {
  await patchState({ auto: on });
}

export async function encryptCurrentData(params: KeyParams): Promise<{ envelope: BackupEnvelope; snapshot: Snapshot }> {
  const snapshot = await takeSnapshot(deviceLabel());
  return { envelope: await encryptJson(snapshot, params), snapshot };
}

let running: Promise<BackupState> | undefined;
let changeSeq = 0;

/** Encrypt everything and upload one new version. */
export function backupNow(): Promise<BackupState> {
  if (running) return running;
  running = (async () => {
    const state = await getBackupState();
    if (!state.enabled || !state.params) throw new Error('Backup ist noch nicht eingerichtet.');
    const seq = changeSeq;
    try {
      const { envelope } = await encryptCurrentData(state.params);
      const d = await api<{ version: BackupVersion; versions: BackupVersion[] }>('api/backup', { method: 'POST', body: JSON.stringify({ envelope, device: deviceLabel() }) }, 60000);
      if (changeSeq === seq) localStorage.removeItem(DIRTY_KEY);
      else void scheduleAuto();
      return await patchState({ lastBackupAt: d.version.createdAt, lastVersionId: d.version.id, versions: d.versions.length, lastError: undefined, lastErrorAt: undefined });
    } catch (e) {
      await patchState({ lastError: e instanceof Error ? e.message : String(e), lastErrorAt: new Date().toISOString() });
      throw e;
    }
  })().finally(() => {
    running = undefined;
  });
  return running;
}

export interface RestoreResult {
  counts: ReturnType<typeof countsOf>;
  written: Awaited<ReturnType<typeof applySnapshot>>;
  createdAt: string;
  device?: string;
}

/** Decrypt an envelope with the user's secret and write it into this device. Backups continue with that secret. */
export async function restoreEnvelope(envelope: BackupEnvelope, secret: string, mode: 'replace' | 'merge'): Promise<RestoreResult> {
  const { value, params } = await decryptWithSecret<Snapshot>(envelope, secret);
  if (!validSnapshot(value)) throw new Error('Backup-Inhalt ist ungültig.');
  const written = await applySnapshot(value, mode);
  const prev = await getBackupState();
  await setMeta(STATE_KEY, {
    ...prev,
    enabled: true,
    auto: prev.enabled ? prev.auto : true,
    params,
    setupAt: prev.setupAt ?? new Date().toISOString(),
    lastBackupAt: mode === 'replace' ? envelope.createdAt : prev.lastBackupAt,
    lastError: undefined,
    lastErrorAt: undefined,
  } satisfies BackupState);
  if (mode === 'replace') localStorage.removeItem(DIRTY_KEY);
  else localStorage.setItem(DIRTY_KEY, new Date().toISOString());
  emitStatus();
  return { counts: countsOf(value), written, createdAt: value.createdAt, device: value.device };
}

/** Quick check whether the stored key opens an envelope (used for a sanity test after setup). */
export async function canOpenWithStoredKey(envelope: BackupEnvelope): Promise<boolean> {
  const s = await getBackupState();
  if (!s.params) return false;
  try {
    await decryptWithKey(envelope, s.params.key);
    return true;
  } catch {
    return false;
  }
}

export function backupFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `Nova-Backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.nova`;
}

/** Encrypted .nova file – via the share sheet (iOS: „In Dateien sichern“) or as a download. */
export async function exportBackupFile(): Promise<'shared' | 'downloaded'> {
  const state = await getBackupState();
  if (!state.params) throw new Error('Bitte zuerst ein Backup-Passwort festlegen.');
  const { envelope } = await encryptCurrentData(state.params);
  const name = backupFileName();
  const file = new File([JSON.stringify(envelope)], name, { type: 'application/octet-stream' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (isIOS() && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') throw new Error('Export abgebrochen.');
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

export async function readBackupFile(file: File): Promise<BackupEnvelope> {
  if (file.size > 20 * 1024 * 1024) throw new Error('Die Datei ist zu groß.');
  return parseEnvelope(await file.text());
}

// ---------- automatic backups ----------
let timer: number | undefined;
let started = false;

async function scheduleAuto(delay?: number): Promise<void> {
  const s = await getBackupState();
  if (!s.enabled || !s.auto || !s.params || STATIC_ONLY) return;
  const last = s.lastBackupAt ? Date.parse(s.lastBackupAt) : 0;
  const errorPause = s.lastErrorAt && Date.now() - Date.parse(s.lastErrorAt) < AUTO.minIntervalMs ? AUTO.minIntervalMs : 0;
  const wait = Math.max(delay ?? AUTO.debounceMs, last + AUTO.minIntervalMs - Date.now(), errorPause);
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = undefined;
    if (!dirtySince() && Date.now() - last < AUTO.dailyMs) return;
    backupNow().catch(() => undefined);
  }, wait);
}

/** Call once on app start. */
export function startAutoBackup(): void {
  if (started) return;
  started = true;
  onDbChange((store, key) => {
    if (store === 'meta' && isPrivateMetaKey(key)) return;
    changeSeq += 1;
    if (!dirtySince()) localStorage.setItem(DIRTY_KEY, new Date().toISOString());
    void scheduleAuto();
  });
  // daily at least: on app open, if dirty or the last backup is older than a day
  void (async () => {
    const s = await getBackupState();
    const last = s.lastBackupAt ? Date.parse(s.lastBackupAt) : 0;
    if (dirtySince() || Date.now() - last >= AUTO.dailyMs) void scheduleAuto(AUTO.startDelayMs);
  })();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && dirtySince()) {
      void getBackupState().then((s) => {
        const last = s.lastBackupAt ? Date.parse(s.lastBackupAt) : 0;
        if (s.enabled && s.auto && s.params && Date.now() - last > 60_000) backupNow().catch(() => undefined);
      });
    }
  });
}
