import { z } from 'zod'

export const magicLinkRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
})

export type MagicLinkRequest = z.infer<typeof magicLinkRequestSchema>

export const magicLinkResponseSchema = z.object({
  message: z.string(),
})

export type MagicLinkResponse = z.infer<typeof magicLinkResponseSchema>

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: z.enum(['admin', 'support', 'viewer']),
  organizationId: z.string().uuid(),
})

export type User = z.infer<typeof userSchema>

// Extended user returned by the admin users list endpoint
export const userListItemSchema = userSchema.extend({
  isActive: z.boolean(),
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
})

export type UserListItem = z.infer<typeof userListItemSchema>

export const authResponseSchema = z.object({
  user: userSchema,
  token: z.string(),
})

export type AuthResponse = z.infer<typeof authResponseSchema>
