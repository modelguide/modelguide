/**
 * Validates a user-provided base URL to prevent SSRF attacks.
 * Blocks private/internal IP ranges and non-HTTP(S) protocols.
 */

const PRIVATE_IP_PATTERN =
  /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.|0\.)/;

const PRIVATE_HOSTNAMES = new Set(["localhost", "[::1]"]);

export function validateBaseUrl(raw: string, connectorName: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${connectorName} baseUrl is not a valid URL: ${raw}`);
  }

  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error(
      `${connectorName} baseUrl must use http or https (got ${parsed.protocol})`,
    );
  }

  if (
    PRIVATE_IP_PATTERN.test(parsed.hostname) ||
    PRIVATE_HOSTNAMES.has(parsed.hostname)
  ) {
    throw new Error(
      `${connectorName} baseUrl must not point to a private or internal address`,
    );
  }

  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}
