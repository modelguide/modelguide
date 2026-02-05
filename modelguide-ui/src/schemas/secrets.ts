import { z } from 'zod'

export const secretSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type Secret = z.infer<typeof secretSchema>

export const secretCreateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  value: z.string().min(1, 'Value is required'),
})

export type SecretCreate = z.infer<typeof secretCreateSchema>

export const secretListResponseSchema = z.object({
  items: z.array(secretSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
})

export type SecretListResponse = z.infer<typeof secretListResponseSchema>
