/**
 * Shared Zod schemas for API responses
 */

import { z } from "zod";

export const errorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
});
