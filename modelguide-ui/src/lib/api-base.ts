export function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_URL || '/api'
}
