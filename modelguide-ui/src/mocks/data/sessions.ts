import type { ChannelType, Session, SessionStatus } from '~/schemas/sessions'

const agents = [
  { id: 'agent-001', name: 'Pizza Palace Assistant' },
  { id: 'agent-002', name: 'Support Bot' },
  { id: 'agent-003', name: 'Booking Agent' },
]

const channels: ChannelType[] = ['voice', 'web', 'widget', 'whatsapp', 'sms', 'api', 'slack']
const statuses: SessionStatus[] = [
  'completed',
  'completed',
  'completed',
  'escalated',
  'abandoned',
  'active',
]

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function generateSession(index: number): Session {
  const startTime = new Date()
  startTime.setMinutes(startTime.getMinutes() - Math.floor(Math.random() * 1440)) // Random time in last 24h

  const status = randomFrom(statuses)
  const durationSeconds = status === 'active' ? null : Math.floor(Math.random() * 600) + 60
  const endTime =
    status === 'active' ? null : new Date(startTime.getTime() + (durationSeconds || 0) * 1000)

  const agent = randomFrom(agents)

  return {
    id: `sess_${String(index).padStart(6, '0')}`,
    external_id: `ext_${String(index).padStart(8, '0')}`,
    agent,
    channel_type: randomFrom(channels),
    status,
    user_identifier: `user_${Math.random().toString(36).substr(2, 6)}`,
    escalation_ref: status === 'escalated' ? `ZD-${1000 + index}` : null,
    started_at: startTime.toISOString(),
    ended_at: endTime?.toISOString() ?? null,
    duration_seconds: durationSeconds,
    feedback:
      Math.random() > 0.6
        ? [
            {
              id: `fb_${index}`,
              rating: Math.random() > 0.2 ? 2 : 1,
              comment: Math.random() > 0.5 ? 'Great service!' : null,
              feedback_source: 'customer',
              feedback_tags: null,
              created_at: endTime?.toISOString() ?? startTime.toISOString(),
            },
          ]
        : [],
  }
}

// Generate 30 mock sessions
export const mockSessions: Session[] = Array.from({ length: 30 }, (_, i) =>
  generateSession(i + 1),
).sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())

export function getSessionById(id: string): Session | undefined {
  const session = mockSessions.find((s) => s.id === id)
  if (!session) return undefined

  // Add detailed messages for individual session view
  return {
    ...session,
    messages: [
      {
        id: 'msg-1',
        role: 'assistant',
        content: 'Hi, welcome to Pizza Palace! How can I help you today?',
        created_at: session.started_at,
      },
      {
        id: 'msg-2',
        role: 'user',
        content: "I'd like to order a large pepperoni pizza",
        created_at: new Date(new Date(session.started_at).getTime() + 3000).toISOString(),
      },
      {
        id: 'msg-3',
        role: 'tool',
        tool_call_id: 'tc-1',
        tool_name: 'pizzapalace_add_to_cart',
        tool_input: { item: 'pizza', size: 'large', toppings: ['pepperoni'], quantity: 1 },
        tool_output: { cart_id: 'cart_123', item_id: 'item_456', subtotal: 18.99 },
        status: 'success',
        latency_ms: 150,
        created_at: new Date(new Date(session.started_at).getTime() + 4000).toISOString(),
      },
      {
        id: 'msg-4',
        role: 'assistant',
        content:
          "I've added a large pepperoni pizza to your cart. Your subtotal is $18.99. Would you like anything else?",
        created_at: new Date(new Date(session.started_at).getTime() + 5000).toISOString(),
      },
      {
        id: 'msg-5',
        role: 'user',
        content: "No, that's all. Please proceed to checkout.",
        created_at: new Date(new Date(session.started_at).getTime() + 8000).toISOString(),
      },
      {
        id: 'msg-6',
        role: 'tool',
        tool_call_id: 'tc-2',
        tool_name: 'pizzapalace_create_order',
        tool_input: { cart_id: 'cart_123', payment_method: 'card' },
        tool_output: { order_id: 'order_789', total: 20.99, estimated_time: '30-40 min' },
        status: 'success',
        latency_ms: 320,
        created_at: new Date(new Date(session.started_at).getTime() + 9000).toISOString(),
      },
      {
        id: 'msg-7',
        role: 'assistant',
        content:
          'Your order has been placed! Order #789, total $20.99. Estimated delivery time is 30-40 minutes. Thank you for ordering from Pizza Palace!',
        created_at: new Date(new Date(session.started_at).getTime() + 10000).toISOString(),
      },
    ],
  }
}
