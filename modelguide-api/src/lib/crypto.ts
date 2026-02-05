/**
 * Cryptographic utilities for API keys, hashing, and encryption
 */

import { getEncryptionKey } from "@/env";

const API_KEY_PREFIX = "mgk_";
const API_KEY_LENGTH = 32;

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
 * Computes SHA-256 hash of an API key
 */
export function hashApiKey(key: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const sha256 = new Bun.CryptoHasher("sha256");
  sha256.update(data);
  return sha256.digest("hex");
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
 * Encryption result containing the encrypted value and IV
 */
interface EncryptedData {
  /** Base64-encoded encrypted data */
  encrypted: string;
  /** Base64-encoded initialization vector */
  iv: string;
  /** Authentication tag for GCM */
  tag: string;
}

/**
 * Encrypts a secret value using AES-256-GCM
 */
export async function encryptSecret(value: string): Promise<string> {
  const encryptionKey = getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96 bits for GCM

  const encoder = new TextEncoder();
  const data = encoder.encode(value);

  const key = await crypto.subtle.importKey(
    "raw",
    encryptionKey.slice().buffer,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.slice().buffer },
    key,
    data,
  );

  // GCM appends the auth tag to the ciphertext
  const encrypted = Buffer.from(encryptedBuffer).toString("base64");
  const ivBase64 = Buffer.from(iv).toString("base64");

  // Store as JSON string with iv and encrypted data
  const result: EncryptedData = {
    encrypted,
    iv: ivBase64,
    tag: "", // Tag is included in the encrypted data for Web Crypto API
  };

  return JSON.stringify(result);
}

/**
 * Decrypts a secret value using AES-256-GCM
 */
export async function decryptSecret(encryptedValue: string): Promise<string> {
  const encryptionKey = getEncryptionKey();

  let parsed: EncryptedData;
  try {
    parsed = JSON.parse(encryptedValue);
  } catch {
    throw new Error("Invalid encrypted value format");
  }

  const ivBuffer = Buffer.from(parsed.iv, "base64");
  const encryptedDataBuffer = Buffer.from(parsed.encrypted, "base64");

  const key = await crypto.subtle.importKey(
    "raw",
    encryptionKey.slice().buffer,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

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
}

/**
 * Generates a magic link token (32 bytes, base64url encoded)
 */
export function generateMagicToken(): string {
  return generateRandomString(43); // ~32 bytes in base64url
}

/**
 * Hashes a magic token for storage
 */
export function hashMagicToken(token: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const sha256 = new Bun.CryptoHasher("sha256");
  sha256.update(data);
  return sha256.digest("hex");
}
