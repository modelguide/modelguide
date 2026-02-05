import { z } from 'zod'

export const loginRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

export type LoginRequest = z.infer<typeof loginRequestSchema>

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: z.enum(['admin', 'support']),
  organization_id: z.string().uuid(),
})

export type User = z.infer<typeof userSchema>

export const loginResponseSchema = z.object({
  user: userSchema,
  token: z.string(),
})

export type LoginResponse = z.infer<typeof loginResponseSchema>
