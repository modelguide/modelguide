import { http, HttpResponse, delay } from 'msw'
import { getAgentById, mockAgents } from '~/mocks/data/agents'

export const agentHandlers = [
  http.get('/api/agents', async () => {
    await delay(200)
    return HttpResponse.json({
      items: mockAgents,
      total: mockAgents.length,
      page: 1,
      page_size: 20,
    })
  }),

  http.get('/api/agents/:id', async ({ params }) => {
    await delay(150)
    const agent = getAgentById(params.id as string)
    if (!agent) {
      return HttpResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
    return HttpResponse.json(agent)
  }),

  http.post('/api/agents', async ({ request }) => {
    await delay(300)
    const body = (await request.json()) as Record<string, unknown>
    const newAgent = {
      id: crypto.randomUUID(),
      ...body,
      is_active: false,
      key_prefix: `mgk_${Math.random().toString(36).substr(2, 4)}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    const apiKey = `mgk_${Math.random().toString(36).substr(2, 32)}`
    return HttpResponse.json({ ...newAgent, api_key: apiKey }, { status: 201 })
  }),

  http.patch('/api/agents/:id', async ({ params, request }) => {
    await delay(200)
    const agent = getAgentById(params.id as string)
    if (!agent) {
      return HttpResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json({ ...agent, ...body, updated_at: new Date().toISOString() })
  }),

  http.post('/api/agents/:id/activate', async ({ params }) => {
    await delay(200)
    const agent = getAgentById(params.id as string)
    if (!agent) {
      return HttpResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
    return HttpResponse.json({ ...agent, is_active: true })
  }),

  http.post('/api/agents/:id/deactivate', async ({ params }) => {
    await delay(200)
    const agent = getAgentById(params.id as string)
    if (!agent) {
      return HttpResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
    return HttpResponse.json({ ...agent, is_active: false })
  }),

  http.post('/api/agents/:id/regenerate-key', async ({ params }) => {
    await delay(300)
    const agent = getAgentById(params.id as string)
    if (!agent) {
      return HttpResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
    const apiKey = `mgk_${Math.random().toString(36).substr(2, 32)}`
    const keyPrefix = `mgk_${apiKey.substr(4, 4)}`
    return HttpResponse.json({ api_key: apiKey, key_prefix: keyPrefix })
  }),

  http.delete('/api/agents/:id', async ({ params }) => {
    await delay(200)
    const agent = getAgentById(params.id as string)
    if (!agent) {
      return HttpResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
    return new HttpResponse(null, { status: 204 })
  }),
]
