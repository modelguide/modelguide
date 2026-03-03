import type {
  AssignedAgent,
  SopDetail,
  SopMetadata,
  SopStep,
  SopSummary,
  SopTemplate,
  SopTrigger,
  StepWarning,
} from '~/schemas/sops'

export function makeSopSummary(overrides: Partial<SopSummary> = {}): SopSummary {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Order Lookup',
    slug: 'order-lookup',
    status: 'active',
    version: '1',
    assignedAgents: [],
    sopTemplateId: null,
    templateName: null,
    stepCount: 3,
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-02-01T12:00:00Z',
    ...overrides,
  }
}

export function makeAssignedAgent(overrides: Partial<AssignedAgent> = {}): AssignedAgent {
  return {
    id: '00000000-0000-0000-0000-000000000010',
    name: 'Support Bot',
    modality: 'text',
    ...overrides,
  }
}

export function makeSopStep(overrides: Partial<SopStep> = {}): SopStep {
  return {
    id: 'step-1',
    order: 1,
    instruction: 'Ask the customer for their order number',
    required: true,
    ...overrides,
  }
}

export function makeSopTrigger(type: SopTrigger['type'] = 'manual'): SopTrigger {
  switch (type) {
    case 'channel':
      return { type: 'channel', config: { channelTypes: ['voice', 'chat'] } }
    case 'intent_detected':
      return {
        type: 'intent_detected',
        config: { patterns: ['where is my order', 'track my package'] },
      }
    case 'tool_present':
      return { type: 'tool_present', config: { toolSlugs: ['get_order', 'track_shipment'] } }
    default:
      return { type: 'manual', config: {} }
  }
}

export function makeSopMetadata(overrides: Partial<SopMetadata> = {}): SopMetadata {
  return {
    tags: ['order', 'tracking'],
    reasonCode: 'WISMO-001',
    estimatedDuration: '2-5 minutes',
    ...overrides,
  }
}

export function makeSopDetail(overrides: Partial<SopDetail> = {}): SopDetail {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Order Lookup',
    slug: 'order-lookup',
    description: 'Look up order status for customers',
    status: 'active',
    version: '1',
    assignedAgents: [],
    sopTemplateId: null,
    template: null,
    definition: {
      schemaVersion: 1,
      trigger: makeSopTrigger('manual'),
      steps: [
        makeSopStep({
          id: 'step-1',
          order: 1,
          instruction: 'Ask for order number',
          required: true,
        }),
        makeSopStep({ id: 'step-2', order: 2, instruction: 'Look up the order', required: true }),
        makeSopStep({
          id: 'step-3',
          order: 3,
          instruction: 'Provide status update',
          required: false,
        }),
      ],
      metadata: makeSopMetadata(),
    },
    createdBy: null,
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-02-01T12:00:00Z',
    ...overrides,
  }
}

export function makeSopTemplate(overrides: Partial<SopTemplate> = {}): SopTemplate {
  return {
    id: '00000000-0000-0000-0000-000000000100',
    name: 'WISMO Template',
    slug: 'wismo',
    description: 'Where Is My Order template',
    catalogSlugs: ['medusa'],
    definition: {
      schemaVersion: 1,
      trigger: makeSopTrigger('intent_detected'),
      steps: [
        makeSopStep({ id: 'step-1', order: 1, instruction: 'Greet the customer' }),
        makeSopStep({ id: 'step-2', order: 2, instruction: 'Look up their order' }),
      ],
      metadata: makeSopMetadata(),
    },
    version: '1',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: null,
    ...overrides,
  }
}

export function makeStepWarning(overrides: Partial<StepWarning> = {}): StepWarning {
  return {
    stepId: 'step-1',
    message: 'Tool reference not found in any connected connector',
    ...overrides,
  }
}
