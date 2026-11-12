/**
 * End-to-end encryption for Nova backups (WebCrypto only).
 *   key  = PBKDF2-SHA-256(secret, salt, 600 000 iterations) → AES-GCM-256 (non-extractable)
 *   data = AES-GCM(key, iv = 12 random bytes, gzip(JSON))
 * The envelope carries only public parameters (salt, iv, iterations); the server never sees the key.
 */

export const KDF_ITERATIONS = 600_000;

export interface BackupEnvelope {
  format: 'nova-backup';
  v: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string; secret: SecretKind };
  cipher: { name: 'AES-GCM'; iv: string };
  compression: 'gzip' | 'none';
  createdAt: string;
  data: string;
}

export type SecretKind = 'password' | 'recovery';

export class WrongSecretError extends Error {
  constructor() {
    super('Passwort oder Wiederherstellungsschlüssel ist falsch.');
    this.name = 'WrongSecretError';
  }
}

export class InvalidBackupError extends Error {
  constructor(message = 'Das ist keine gültige Nova-Backup-Datei.') {
    super(message);
    this.name = 'InvalidBackupError';
  }
}

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

// Crockford-like base32 without ambiguous characters
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

/** 24 characters ≈ 118 bits, shown as XXXX-XXXX-XXXX-XXXX-XXXX-XXXX. */
export function generateRecoveryKey(): string {
  const chars: string[] = [];
  while (chars.length < 24) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < 240 && chars.length < 24) chars.push(RECOVERY_ALPHABET[b % 30]); // 240 = 8 × 30 → unbiased
    }
  }
  return chars.join('').match(/.{4}/g)!.join('-');
}

export function normalizeRecoveryKey(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function looksLikeRecoveryKey(input: string): boolean {
  const n = normalizeRecoveryKey(input);
  return n.length === 24 && [...n].every((c) => RECOVERY_ALPHABET.includes(c));
}

const secretBytes = (secret: string, kind: SecretKind) => new TextEncoder().encode(kind === 'recovery' ? normalizeRecoveryKey(secret) : secret.normalize('NFC'));

export async function deriveKey(secret: string, kind: SecretKind, salt: Uint8Array, iterations = KDF_ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', secretBytes(secret, kind), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export function newSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

async function streamBytes(input: Uint8Array, transform: GenericTransformStream): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(transform as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const canGzip = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

export interface KeyParams {
  key: CryptoKey;
  salt: string;
  iterations: number;
  secret: SecretKind;
}

export async function makeKeyParams(secret: string, kind: SecretKind, iterations = KDF_ITERATIONS): Promise<KeyParams> {
  const salt = newSalt();
  return { key: await deriveKey(secret, kind, salt, iterations), salt: toB64(salt), iterations, secret: kind };
}

/** AAD binds the public parameters to the ciphertext (tampering with them fails decryption). */
const aad = (e: Pick<BackupEnvelope, 'format' | 'v' | 'compression'> & { salt: string; iterations: number }) => new TextEncoder().encode(`${e.format}|${e.v}|${e.compression}|${e.salt}|${e.iterations}`);

export async function encryptJson(value: unknown, params: KeyParams, now = new Date()): Promise<BackupEnvelope> {
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const compression = canGzip() ? 'gzip' : 'none';
  const body = compression === 'gzip' ? await streamBytes(plain, new CompressionStream('gzip')) : plain;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad({ format: 'nova-backup', v: 1, compression, salt: params.salt, iterations: params.iterations }) as BufferSource },
    params.key,
    body as BufferSource,
  );
  return {
    format: 'nova-backup',
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: params.iterations, salt: params.salt, secret: params.secret },
    cipher: { name: 'AES-GCM', iv: toB64(iv) },
    compression,
    createdAt: now.toISOString(),
    data: toB64(new Uint8Array(cipher)),
  };
}

export function parseEnvelope(raw: unknown): BackupEnvelope {
  const e = (typeof raw === 'string' ? safeJson(raw) : raw) as Partial<BackupEnvelope> | undefined;
  if (!e || e.format !== 'nova-backup' || e.v !== 1 || e.kdf?.name !== 'PBKDF2' || e.cipher?.name !== 'AES-GCM' || typeof e.data !== 'string' || typeof e.kdf.salt !== 'string' || typeof e.cipher.iv !== 'string') {
    throw new InvalidBackupError();
  }
  return e as BackupEnvelope;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** Decrypt with a derived key (throws WrongSecretError on mismatch). */
export async function decryptWithKey<T = unknown>(envelope: BackupEnvelope, key: CryptoKey): Promise<T> {
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(envelope.cipher.iv) as BufferSource, additionalData: aad({ format: envelope.format, v: envelope.v, compression: envelope.compression, salt: envelope.kdf.salt, iterations: envelope.kdf.iterations }) as BufferSource },
      key,
      fromB64(envelope.data) as BufferSource,
    );
  } catch {
    throw new WrongSecretError();
  }
  const bytes = envelope.compression === 'gzip' ? await streamBytes(new Uint8Array(plain), new DecompressionStream('gzip')) : new Uint8Array(plain);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/** Derive from the envelope's own parameters, then decrypt. Returns the key params so backups can continue. */
export async function decryptWithSecret<T = unknown>(envelope: BackupEnvelope, secret: string): Promise<{ value: T; params: KeyParams }> {
  // the user may type the recovery key into a password field (and vice versa): try the recorded kind first
  const kinds: SecretKind[] = envelope.kdf.secret === 'recovery' || looksLikeRecoveryKey(secret) ? ['recovery', 'password'] : ['password'];
  for (const kind of kinds) {
    const key = await deriveKey(secret, kind, fromB64(envelope.kdf.salt), envelope.kdf.iterations);
    try {
      const value = await decryptWithKey<T>(envelope, key);
      return { value, params: { key, salt: envelope.kdf.salt, iterations: envelope.kdf.iterations, secret: kind } };
    } catch (e) {
      if (!(e instanceof WrongSecretError)) throw e;
    }
  }
  throw new WrongSecretError();
}
