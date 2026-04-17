export function getElevenLabsExternalId(
  elMeta: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!elMeta) return undefined;

  const externalId = elMeta.externalId;
  if (typeof externalId === "string" && externalId.length > 0) {
    return externalId;
  }

  const legacyAgentId = elMeta.agentId;
  if (typeof legacyAgentId === "string" && legacyAgentId.length > 0) {
    return legacyAgentId;
  }

  return undefined;
}

export function setElevenLabsExternalId(
  elMeta: Record<string, unknown>,
  externalId: string,
): Record<string, unknown> {
  return {
    ...elMeta,
    externalId,
    // Legacy alias kept for the existing UI/routes while the new key rolls out.
    agentId: externalId,
  };
}
