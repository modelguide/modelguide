import type { Connector } from '~/schemas/connectors'

export const mockConnectors: Connector[] = [
  {
    id: '550e8400-e29b-41d4-a716-446655440020',
    name: 'Medusa',
    title: 'Pizza Palace Store',
    slug: 'pizzapalace',
    description: 'E-commerce platform for online ordering',
    connector_type: 'api',
    icon_url: null,
    config: {
      base_url: 'https://api.pizzapalace.com',
      api_token: '550e8400-e29b-41d4-a716-446655440030',
    },
    is_configured: true,
    tools: [
      {
        id: 't1',
        name: 'Add to Cart',
        slug: 'add_to_cart',
        description: 'Add item to cart',
        default_requires_confirmation: false,
      },
      {
        id: 't2',
        name: 'Get Cart',
        slug: 'get_cart',
        description: 'Get cart contents',
        default_requires_confirmation: false,
      },
      {
        id: 't3',
        name: 'Create Order',
        slug: 'create_order',
        description: 'Create draft order',
        default_requires_confirmation: false,
      },
      {
        id: 't4',
        name: 'Confirm Order',
        slug: 'confirm_order',
        description: 'Confirm and place order',
        default_requires_confirmation: true,
      },
      {
        id: 't5',
        name: 'Cancel Order',
        slug: 'cancel_order',
        description: 'Cancel an order',
        default_requires_confirmation: true,
      },
    ],
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440021',
    name: 'Zendesk',
    title: 'Support Tickets',
    slug: 'zendesk',
    description: 'Customer support and ticketing system',
    connector_type: 'api',
    icon_url: null,
    config: {},
    is_configured: false,
    tools: [
      {
        id: 't6',
        name: 'Create Ticket',
        slug: 'create_ticket',
        description: 'Create support ticket',
        default_requires_confirmation: false,
      },
      {
        id: 't7',
        name: 'Get Ticket',
        slug: 'get_ticket',
        description: 'Get ticket details',
        default_requires_confirmation: false,
      },
      {
        id: 't8',
        name: 'Update Ticket',
        slug: 'update_ticket',
        description: 'Update ticket status',
        default_requires_confirmation: false,
      },
      {
        id: 't9',
        name: 'Close Ticket',
        slug: 'close_ticket',
        description: 'Close a ticket',
        default_requires_confirmation: true,
      },
    ],
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440022',
    name: 'Calendly',
    title: 'Scheduling',
    slug: 'calendly',
    description: 'Appointment scheduling and calendar management',
    connector_type: 'api',
    icon_url: null,
    config: {},
    is_configured: false,
    tools: [
      {
        id: 't10',
        name: 'List Available Slots',
        slug: 'list_slots',
        description: 'Get available time slots',
        default_requires_confirmation: false,
      },
      {
        id: 't11',
        name: 'Book Appointment',
        slug: 'book_appointment',
        description: 'Book an appointment',
        default_requires_confirmation: true,
      },
      {
        id: 't12',
        name: 'Cancel Appointment',
        slug: 'cancel_appointment',
        description: 'Cancel appointment',
        default_requires_confirmation: true,
      },
    ],
    created_at: '2024-01-01T00:00:00Z',
  },
]

export function getConnectorById(id: string): Connector | undefined {
  return mockConnectors.find((c) => c.id === id)
}
