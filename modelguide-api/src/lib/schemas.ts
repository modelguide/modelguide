/**
 * Shared Zod schemas for API responses
 */

import { z } from "zod";

export const errorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
});

/**
 * OpenAPI error response helper for route definitions
 */
export function errorResponse(description: string) {
  return {
    description,
    content: { "application/json": { schema: errorResponseSchema } },
  };
}
