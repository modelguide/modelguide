import { z } from "zod";

const userRoles = ["admin", "support"] as const;

export const userItemSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(userRoles),
});

export const usersFileSchema = z.object({
  users: z.array(userItemSchema).min(1),
});

export type UserItemInput = z.infer<typeof userItemSchema>;
