/**
 * End-to-end encryption for the shared family file. The passphrase never
 * leaves the phones; GitHub only ever stores ciphertext.
 *   PBKDF2-SHA-256 (310,000 iterations) → AES-256-GCM, optional gzip first.
 */
export interface Envelope {
  format: 'milestone-sync';
  version: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  compression: 'gzip' | 'none';
  data: string;
  writtenAt: string;
  writtenBy: string;
}

const ITERATIONS = 310_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encrypt(plain: string, passphrase: string, device: string): Promise<Envelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  let bytes: Uint8Array = enc.encode(plain);
  const gzip = typeof CompressionStream !== 'undefined';
  if (gzip) bytes = await pipe(bytes, new CompressionStream('gzip'));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, bytes as BufferSource));
  return {
    format: 'milestone-sync',
    version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    compression: gzip ? 'gzip' : 'none',
    data: toBase64(ct),
    writtenAt: new Date().toISOString(),
    writtenBy: device,
  };
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('The family passphrase does not match the one used on the other phone.');
  }
}

export async function decrypt(env: Envelope, passphrase: string): Promise<string> {
  if (env?.format !== 'milestone-sync' || env.version !== 1) throw new Error('The shared file is not a Milestone sync file.');
  const key = await deriveKey(passphrase, fromBase64(env.kdf.salt), env.kdf.iterations);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(env.cipher.iv) as BufferSource }, key, fromBase64(env.data) as BufferSource));
  } catch {
    throw new WrongPassphraseError();
  }
  if (env.compression === 'gzip') {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read compressed sync files. Update the browser.');
    bytes = await pipe(bytes, new DecompressionStream('gzip'));
  }
  return dec.decode(bytes);
}
