import { http, HttpResponse, delay } from 'msw'
import { getSecretById, mockSecrets } from '~/mocks/data/secrets'

export const secretHandlers = [
  http.get('*/api/secrets', async () => {
    await delay(200)
    return HttpResponse.json({
      items: mockSecrets,
      total: mockSecrets.length,
      page: 1,
      page_size: 20,
    })
  }),

  http.get('*/api/secrets/:id', async ({ params }) => {
    await delay(150)
    const secret = getSecretById(params.id as string)
    if (!secret) {
      return HttpResponse.json({ error: 'Secret not found' }, { status: 404 })
    }
    return HttpResponse.json(secret)
  }),

  http.post('*/api/secrets', async ({ request }) => {
    await delay(300)
    const body = (await request.json()) as { name: string }
    const newSecret = {
      id: crypto.randomUUID(),
      name: body.name,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    return HttpResponse.json(newSecret, { status: 201 })
  }),

  http.patch('*/api/secrets/:id', async ({ params, request }) => {
    await delay(200)
    const secret = getSecretById(params.id as string)
    if (!secret) {
      return HttpResponse.json({ error: 'Secret not found' }, { status: 404 })
    }
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json({ ...secret, ...body, updated_at: new Date().toISOString() })
  }),

  http.delete('*/api/secrets/:id', async ({ params }) => {
    await delay(200)
    const secret = getSecretById(params.id as string)
    if (!secret) {
      return HttpResponse.json({ error: 'Secret not found' }, { status: 404 })
    }
    return new HttpResponse(null, { status: 204 })
  }),
]
