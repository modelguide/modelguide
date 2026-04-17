export interface RunEvalsAgentSummary {
  id: string;
  slug: string;
}

export interface RunEvalsSuiteSummary {
  id: string;
  name: string;
  agentId: string;
  sopId: string | null;
}

export interface RunEvalsSopSummary {
  id: string;
  slug: string;
  name: string;
}

interface SelectRunEvalsSuitesInput {
  suites: RunEvalsSuiteSummary[];
  agents: RunEvalsAgentSummary[];
  sops: RunEvalsSopSummary[];
  agentSlug?: string;
  suiteSlugs?: string[];
}

export function selectRunEvalsSuites(
  input: SelectRunEvalsSuitesInput,
): RunEvalsSuiteSummary[] {
  const requestedSuiteSlugs = [
    ...new Set((input.suiteSlugs ?? []).filter((slug) => slug.length > 0)),
  ];

  let suites = input.suites;
  if (input.agentSlug) {
    const agent = input.agents.find(
      (candidate) => candidate.slug === input.agentSlug,
    );
    if (!agent) {
      throw new Error(`Agent "${input.agentSlug}" not found in org`);
    }
    suites = suites.filter((suite) => suite.agentId === agent.id);
  }

  if (requestedSuiteSlugs.length === 0) {
    return suites;
  }

  const sopIdsBySlug = new Map(input.sops.map((sop) => [sop.slug, sop.id]));
  const missingSuiteSlugs = requestedSuiteSlugs.filter(
    (slug) => !sopIdsBySlug.has(slug),
  );
  if (missingSuiteSlugs.length > 0) {
    throw new Error(
      `SOP slug(s) not found in org: ${missingSuiteSlugs.join(", ")}`,
    );
  }

  const requestedSopIds = new Set(
    requestedSuiteSlugs.map((slug) => sopIdsBySlug.get(slug)!),
  );
  const filteredSuites = suites.filter(
    (suite) => suite.sopId !== null && requestedSopIds.has(suite.sopId),
  );

  const unmatchedSuiteSlugs = requestedSuiteSlugs.filter((slug) => {
    const sopId = sopIdsBySlug.get(slug);
    return !filteredSuites.some((suite) => suite.sopId === sopId);
  });
  if (unmatchedSuiteSlugs.length > 0) {
    const agentContext = input.agentSlug
      ? ` for agent "${input.agentSlug}"`
      : "";
    throw new Error(
      `No eval suite found${agentContext} for SOP slug(s): ${unmatchedSuiteSlugs.join(", ")}`,
    );
  }

  return filteredSuites;
}
