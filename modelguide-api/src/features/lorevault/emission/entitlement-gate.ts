/**
 * Entitlement fail-fast gate (Phase 0 Integration Contract §1.7 + spec §11).
 *
 * Before Mode B starts emitting, call `GET /external/v1/entitlements`
 * once. If the response shows a Starter-tier vault or `osi_enabled: false`,
 * the connector refuses to enable Mode B with a clear error. Mode A and
 * Mode C remain unaffected.
 *
 * The gate caches the verdict for the lifetime of the queue so we don't
 * re-check on every signal.
 */

import { getLogger } from "@lib/logger";
import type {
  EntitlementResponse,
  LoreVaultIntegrationClient,
} from "../client";

export type EntitlementVerdict =
  | { allowed: true; entitlements: EntitlementResponse }
  | { allowed: false; reason: string };

export async function checkEntitlement(
  client: LoreVaultIntegrationClient,
): Promise<EntitlementVerdict> {
  let entitlements: EntitlementResponse;
  try {
    entitlements = await client.getEntitlements();
  } catch (err) {
    return {
      allowed: false,
      reason: `Mode B disabled: entitlement lookup failed (${(err as Error).message}).`,
    };
  }

  if (entitlements.tier === "starter") {
    return {
      allowed: false,
      reason:
        "Mode B disabled: vault tier does not include OSI (Starter tier excluded per Phase 0 §1.7).",
    };
  }
  if (!entitlements.features.osi_enabled) {
    return {
      allowed: false,
      reason:
        "Mode B disabled: vault tier does not include OSI (features.osi_enabled is false).",
    };
  }
  return { allowed: true, entitlements };
}

export function logVerdict(
  verdict: EntitlementVerdict,
  ctx: Record<string, unknown> = {},
): void {
  const log = getLogger();
  if (verdict.allowed) {
    log.info(
      { ...ctx, tier: verdict.entitlements.tier },
      "Mode B enabled: entitlement check passed",
    );
  } else {
    log.warn({ ...ctx, reason: verdict.reason }, verdict.reason);
  }
}
