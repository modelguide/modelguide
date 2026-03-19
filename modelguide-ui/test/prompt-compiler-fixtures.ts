import type { Agent, CompiledFrom } from '~/schemas/agents'
import type { CompileResponse } from '~/schemas/prompt-compiler'

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export function makeCompiledFrom(
  overrides: Partial<CompiledFrom & object> = {},
): NonNullable<CompiledFrom> {
  return {
    sopId: '00000000-0000-0000-0000-000000000050',
    sopName: 'WISMO Email Flow',
    guardrailIds: ['00000000-0000-0000-0000-000000000060'],
    toolCount: 3,
    stepCount: 6,
    ...overrides,
  }
}

export function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Support Bot',
    slug: 'support-bot',
    description: 'A helpful support agent',
    modality: 'text',
    agentPlatform: 'custom',
    isActive: true,
    hasElevenLabsKey: false,
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-02-01T12:00:00Z',
    ...overrides,
  }
}

export function makeCompileResponse(overrides: Partial<CompileResponse> = {}): CompileResponse {
  return {
    agentId: '00000000-0000-0000-0000-000000000001',
    compiledAt: '2026-03-19T16:00:00Z',
    compiledFrom: makeCompiledFrom(),
    compiledPrompt: SAMPLE_PROMPT,
    promptLength: SAMPLE_PROMPT.length,
    toolCount: 3,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Sample compiled prompt (realistic multi-section markdown)
// ---------------------------------------------------------------------------

export const SAMPLE_PROMPT = `You are a customer support agent for GlowBox Beauty.
You handle order status inquiries via email.

## Workflow: WISMO
1. Greet the customer
2. Ask for their order number
3. Look up the order using the tool
4. Provide status update

## Available Tools
- glowbox_store_lookup_order
- glowbox_store_track_shipment
- helpdesk_create_ticket — Create a support ticket

## Guardrails
### Critical
**Never share PII**: Do not reveal other customers' data
### High
**Verify identity**: Always confirm email before sharing order details
### Medium
**Tone**: Keep responses professional and empathetic

## Escalation Triggers
- Customer requests a supervisor
- Three failed verification attempts
- Profanity or abusive language`

export const MINIMAL_PROMPT = 'You are a helpful assistant.'

export const MULTILINE_PROMPT = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`).join('\n')
