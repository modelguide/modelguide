/**
 * Cryptographic utilities for API keys, hashing, and encryption
 */

import { env } from "@/env";

const API_KEY_PREFIX = "mgk_";
const API_KEY_LENGTH = 32;

/**
 * Masks a sensitive string, showing only the last N characters.
 * Returns "****" for strings shorter than or equal to `visible`.
 */
export function mask(value: string, visible = 4): string {
  if (value.length <= visible) return "****";
  return "*".repeat(value.length - visible) + value.slice(-visible);
}

/**
 * Masks PII (e.g. email), preserving the first and last N characters.
 * "user@example.com" → "use**********com"
 */
export function maskPII(value: string, edgeChars = 3): string {
  if (value.length <= edgeChars * 2) return "****";
  return (
    value.slice(0, edgeChars) +
    "*".repeat(value.length - edgeChars * 2) +
    value.slice(-edgeChars)
  );
}

/**
 * Derives a 32-byte AES-256 key from the ENCRYPTION_KEY env var via SHA-256.
 * Result is cached after first call.
 */
let _derivedKey: Uint8Array | null = null;

function deriveKey(): Uint8Array {
  if (_derivedKey) return _derivedKey;
  const hash = new Bun.CryptoHasher("sha256");
  hash.update(env.ENCRYPTION_KEY);
  _derivedKey = new Uint8Array(hash.digest());
  return _derivedKey;
}

/**
 * Cached CryptoKey instances for encrypt/decrypt to avoid repeated importKey calls.
 */
let _encryptKey: CryptoKey | null = null;
let _decryptKey: CryptoKey | null = null;

async function getEncryptKey(): Promise<CryptoKey> {
  if (_encryptKey) return _encryptKey;
  _encryptKey = await crypto.subtle.importKey(
    "raw",
    deriveKey().slice().buffer,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  return _encryptKey;
}

async function getDecryptKey(): Promise<CryptoKey> {
  if (_decryptKey) return _decryptKey;
  _decryptKey = await crypto.subtle.importKey(
    "raw",
    deriveKey().slice().buffer,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  return _decryptKey;
}

/**
 * Result of API key generation
 */
export interface GeneratedApiKey {
  /** Full API key (only returned once) */
  key: string;
  /** SHA-256 hash for storage */
  hash: string;
  /** Prefix for display (e.g., "mgk_xxxx") */
  prefix: string;
}

/**
 * Generates a random string of specified length using crypto-safe random bytes
 */
function generateRandomString(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  // Use base64url encoding and trim to exact length
  return Buffer.from(bytes).toString("base64url").slice(0, length);
}

/**
 * Generates a new API key with hash and prefix
 * Key format: mgk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (32 chars after prefix)
 */
export function generateApiKey(): GeneratedApiKey {
  const randomPart = generateRandomString(API_KEY_LENGTH);
  const key = `${API_KEY_PREFIX}${randomPart}`;

  return {
    key,
    hash: hashApiKey(key),
    prefix: `${API_KEY_PREFIX}${randomPart.slice(0, 4)}`,
  };
}

/**
 * Computes SHA-256 hex digest of input string
 */
function sha256Hex(input: string): string {
  const data = new TextEncoder().encode(input);
  const sha256 = new Bun.CryptoHasher("sha256");
  sha256.update(data);
  return sha256.digest("hex");
}

/**
 * Computes HMAC-SHA256 hex digest of input string with a secret key
 */
function hmacSha256Hex(key: string, data: string): string {
  const hmac = new Bun.CryptoHasher("sha256", key);
  hmac.update(data);
  return hmac.digest("hex");
}

/**
 * Computes SHA-256 hash of an API key
 */
export function hashApiKey(key: string): string {
  return sha256Hex(key);
}

/**
 * Validates API key format (must start with mgk_ and have correct length)
 */
export function isValidApiKeyFormat(key: string): boolean {
  if (!key.startsWith(API_KEY_PREFIX)) {
    return false;
  }
  const randomPart = key.slice(API_KEY_PREFIX.length);
  // Allow some flexibility in length since base64url can vary slightly
  return (
    randomPart.length >= API_KEY_LENGTH - 2 &&
    randomPart.length <= API_KEY_LENGTH + 2
  );
}

/**
 * Encryption result containing the encrypted value and IV.
 * The GCM authentication tag is appended to the ciphertext by Web Crypto API.
 */
interface EncryptedData {
  /** Base64-encoded encrypted data (includes GCM auth tag) */
  encrypted: string;
  /** Base64-encoded initialization vector */
  iv: string;
}

/**
 * Encrypts a secret value using AES-256-GCM
 */
export async function encryptSecret(value: string): Promise<string> {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96 bits for GCM

    const encoder = new TextEncoder();
    const data = encoder.encode(value);

    const key = await getEncryptKey();

    const encryptedBuffer = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv.slice().buffer },
      key,
      data,
    );

    // GCM appends the auth tag to the ciphertext
    const encrypted = Buffer.from(encryptedBuffer).toString("base64");
    const ivBase64 = Buffer.from(iv).toString("base64");

    const result: EncryptedData = {
      encrypted,
      iv: ivBase64,
    };

    return JSON.stringify(result);
  } catch (err) {
    const hint =
      err instanceof DOMException && err.name === "OperationError"
        ? "AES-GCM encryption failed — likely invalid ENCRYPTION_KEY"
        : "unexpected encryption error";
    throw new Error(`encrypt failed: ${hint}`);
  }
}

/**
 * Decrypts a secret value using AES-256-GCM.
 * Wraps low-level crypto errors with diagnostic context so callers can
 * distinguish "corrupt ciphertext" from "wrong ENCRYPTION_KEY" in logs.
 */
export async function decryptSecret(encryptedValue: string): Promise<string> {
  let parsed: EncryptedData;
  try {
    parsed = JSON.parse(encryptedValue);
  } catch {
    throw new Error(
      "decrypt failed: invalid JSON envelope (corrupt or not encrypted)",
    );
  }

  if (!parsed.iv || !parsed.encrypted) {
    throw new Error(
      "decrypt failed: missing iv or encrypted field in envelope",
    );
  }

  const ivBuffer = Buffer.from(parsed.iv, "base64");
  const encryptedDataBuffer = Buffer.from(parsed.encrypted, "base64");

  const key = await getDecryptKey();

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: ivBuffer.buffer.slice(
          ivBuffer.byteOffset,
          ivBuffer.byteOffset + ivBuffer.byteLength,
        ),
      },
      key,
      encryptedDataBuffer.buffer.slice(
        encryptedDataBuffer.byteOffset,
        encryptedDataBuffer.byteOffset + encryptedDataBuffer.byteLength,
      ),
    );

    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  } catch (err) {
    // AES-GCM decrypt fails with DOMException OperationError when:
    // - ENCRYPTION_KEY doesn't match the key used to encrypt
    // - ciphertext or IV is corrupt / truncated
    // - auth tag verification fails
    const hint =
      err instanceof DOMException && err.name === "OperationError"
        ? "AES-GCM decryption failed — likely ENCRYPTION_KEY mismatch or corrupt ciphertext"
        : "unexpected decryption error";

    throw new Error(`decrypt failed: ${hint}`);
  }
}

/**
 * Generates a magic link token (32 bytes, base64url encoded)
 */
export function generateMagicToken(): string {
  return generateRandomString(43); // ~32 bytes in base64url
}

/**
 * Hashes a magic token for storage using HMAC-SHA256
 */
export function hashMagicToken(token: string): string {
  return hmacSha256Hex(env.MAGIC_LINK_SECRET, token);
}
