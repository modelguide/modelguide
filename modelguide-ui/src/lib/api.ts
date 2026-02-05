import ky from 'ky'
import { useAuthStore } from '~/stores/auth'

export const api = ky.create({
  prefixUrl: '/api',
  hooks: {
    beforeRequest: [
      (request) => {
        const { token } = useAuthStore.getState()
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`)
        }
      },
    ],
    afterResponse: [
      async (_request, _options, response) => {
        if (response.status === 401) {
          useAuthStore.getState().logout()
        }
        return response
      },
    ],
  },
})
