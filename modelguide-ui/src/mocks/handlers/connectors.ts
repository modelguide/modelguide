import { http, HttpResponse, delay } from 'msw'
import { getConnectorById, mockConnectors } from '~/mocks/data/connectors'

export const connectorHandlers = [
  http.get('/api/connectors', async () => {
    await delay(200)
    return HttpResponse.json({
      items: mockConnectors,
      total: mockConnectors.length,
      page: 1,
      page_size: 20,
    })
  }),

  http.get('/api/connectors/:id', async ({ params }) => {
    await delay(150)
    const connector = getConnectorById(params.id as string)
    if (!connector) {
      return HttpResponse.json({ error: 'Connector not found' }, { status: 404 })
    }
    return HttpResponse.json(connector)
  }),

  http.patch('/api/connectors/:id', async ({ params, request }) => {
    await delay(200)
    const connector = getConnectorById(params.id as string)
    if (!connector) {
      return HttpResponse.json({ error: 'Connector not found' }, { status: 404 })
    }
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json({ ...connector, ...body, is_configured: true })
  }),

  http.post('/api/connectors/:id/health-check', async ({ params }) => {
    await delay(500)
    const connector = getConnectorById(params.id as string)
    if (!connector) {
      return HttpResponse.json({ error: 'Connector not found' }, { status: 404 })
    }
    const isHealthy = connector.is_configured
    return HttpResponse.json({
      status: isHealthy ? 'healthy' : 'unhealthy',
      message: isHealthy ? 'Connection successful' : 'Not configured',
      checked_at: new Date().toISOString(),
    })
  }),
]
