import { http, HttpResponse, delay } from 'msw'
import { mockAnalyticsSummary } from '~/mocks/data/analytics'

export const analyticsHandlers = [
  http.get('/api/analytics/summary', async () => {
    await delay(200)
    return HttpResponse.json(mockAnalyticsSummary)
  }),
]
