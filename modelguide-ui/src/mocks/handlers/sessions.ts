import { http, HttpResponse, delay } from 'msw'
import { getSessionById, mockSessions } from '~/mocks/data/sessions'

export const sessionHandlers = [
  http.get('/api/sessions', async ({ request }) => {
    await delay(200)

    const url = new URL(request.url)
    const page = Number(url.searchParams.get('page')) || 1
    const pageSize = Number(url.searchParams.get('page_size')) || 20
    const status = url.searchParams.get('status')
    const channelType = url.searchParams.get('channel_type')
    const agentId = url.searchParams.get('agent_id')

    let filtered = [...mockSessions]

    if (status) {
      filtered = filtered.filter((s) => s.status === status)
    }
    if (channelType) {
      filtered = filtered.filter((s) => s.channel_type === channelType)
    }
    if (agentId) {
      filtered = filtered.filter((s) => s.agent.id === agentId)
    }

    const total = filtered.length
    const start = (page - 1) * pageSize
    const items = filtered.slice(start, start + pageSize)

    return HttpResponse.json({
      items,
      total,
      page,
      page_size: pageSize,
    })
  }),

  http.get('/api/sessions/:id', async ({ params }) => {
    await delay(150)

    const session = getSessionById(params.id as string)
    if (!session) {
      return HttpResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    return HttpResponse.json(session)
  }),

  http.post('/api/sessions/:id/feedback', async ({ params, request }) => {
    await delay(200)

    const session = mockSessions.find((s) => s.id === params.id)
    if (!session) {
      return HttpResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const body = (await request.json()) as Record<string, unknown>
    const feedback = {
      id: `fb_${Date.now()}`,
      ...body,
      created_at: new Date().toISOString(),
    }

    return HttpResponse.json(feedback, { status: 201 })
  }),
]
