# ADR-008: Knowledge Base as Polymorphic Agent Context Container

**Status:** Accepted

## Context

ModelGuide agents need various kinds of contextual information — behavioral guardrails today, but potentially FAQs, product catalogs, brand guidelines, and policy documents in the future. These content types share structural similarities (name, slug, content body, org-scoped, assignable to agents) but differ in how they are consumed at runtime.

An early design question was whether to build separate tables and APIs per content type, or to use a single polymorphic container with a type discriminator. Separate tables would mean duplicated CRUD, duplicated agent-assignment junction tables, and duplicated UI patterns for each new type. A shared container consolidates storage and management while preserving the ability to differentiate behavior via the `type` column.

## Decision

### Single `knowledge_base` table with a `type` discriminator

All agent context content is stored in the `knowledge_base` table. The `type` column (DB enum: `guardrail`, extensible to `faq`, `policy`, etc.) determines the semantic meaning of each entry. Type-specific metadata lives in the `config` JSONB column (e.g., `{ "category": "safety" }` for guardrails).

This is a **storage and management** decision, not a consumption decision. The knowledge base layer is concerned with CRUD, organization scoping (RLS), and agent assignment. How content is delivered to agents at runtime is a downstream concern.

### Consumption is handled at the MCP integration layer

Different content types will be consumed differently:

- **Guardrails:** Injected into the agent's system prompt as behavioral constraints. Retrieved in bulk at session start.
- **FAQs (future):** Retrieved via search or RAG at query time. May benefit from embeddings and vector similarity.
- **Policy documents (future):** May be chunked and indexed for retrieval-augmented generation.

The MCP server (the agent-facing interface) is responsible for resolving which KB items to surface and how. The storage layer provides the content; the integration layer decides the delivery mechanism. This separation keeps the core CRUD simple and avoids premature optimization of retrieval strategies.

### Type-specific config via JSONB

Rather than adding nullable columns for each type's metadata, the `config` JSONB column holds type-specific fields. For guardrails, this includes `category` (safety, compliance, brand, operational). New types can introduce their own config shape without schema migrations. The API validates config shape per type at the route/service layer.

### Agent assignment is type-agnostic

The `agent_knowledge_base` junction table connects agents to KB items regardless of type. An agent can have guardrails, FAQs, and policies assigned simultaneously. The MCP layer filters by type when constructing prompts or handling retrieval requests.

## Consequences

### Benefits

- **Single CRUD surface** for all context types — one API, one UI, one set of tests.
- **New types are additive:** add an enum value, define a config schema, and wire up consumption in MCP. No new tables or junction tables needed.
- **Consistent agent assignment** model across all content types, matching the existing pattern for connector tools (`agent_connector_tools`) and SOPs (`agent_sops`).

### Tradeoffs

- **JSONB config is not statically typed at the DB level.** Validation happens in application code. Incorrect config shapes won't be caught by DB constraints.
- **JSONB filtering** (e.g., `config->>'category'`) is less efficient than a dedicated column with a B-tree index. Acceptable at current scale; add a GIN index on `config` if query patterns expand.
- **No vector storage.** If a future type (e.g., FAQs) requires embedding-based retrieval, the knowledge base table itself won't store vectors. Options at that point: (a) a companion `kb_embeddings` table with FK to `knowledge_base`, or (b) an external vector store synced from the KB. This ADR does not prescribe the approach — revisit when the need materializes.

### Naming alternatives considered

We evaluated several alternative names for this entity:

- **`agent_context`** — technically accurate (it's context injected into agent prompts), but too generic and easily confused with runtime session context or LLM context windows.
- **`agent_resources`** — broad enough for all types, but conflicts with MCP's own "resources" primitive, which would create ambiguity in the integration layer.
- **`knowledge_resources`** — a compromise between specificity and breadth, but doesn't add enough clarity over `knowledge_base` to justify diverging from a well-understood term.

We chose **`knowledge_base`** because it maps to a familiar mental model for both technical and non-technical users. The `type` discriminator makes the actual nature of each entry explicit. If future types stretch the metaphor too far (e.g., executable actions or dynamic configurations), revisit this naming decision.

### When to revisit

- A new content type requires a fundamentally different authorship model (e.g., auto-generated from external sources rather than manually authored).
- Embedding-based retrieval becomes a requirement — decide between in-DB vectors (`pgvector`) and external vector store.
- Config JSONB queries become a performance bottleneck — consider promoting frequently filtered fields to dedicated columns.
