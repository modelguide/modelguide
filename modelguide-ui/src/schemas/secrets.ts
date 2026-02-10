import { z } from 'zod'

export const secretSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  secretType: z.enum(['api_key', 'oauth_token', 'credentials']),
  ownerType: z.string(),
  ownerId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Secret = z.infer<typeof secretSchema>

export const secretCreateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  value: z.string().min(1, 'Value is required'),
  secretType: z.enum(['api_key', 'oauth_token', 'credentials']),
  ownerType: z.string().min(1, 'Owner type is required'),
  ownerId: z.string().uuid('Owner ID is required'),
})

export type SecretCreate = z.infer<typeof secretCreateSchema>

export const secretUpdateSchema = z.object({
  name: z.string().optional(),
  value: z.string().optional(),
})

export type SecretUpdate = z.infer<typeof secretUpdateSchema>
