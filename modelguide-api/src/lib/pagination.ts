/**
 * Pagination utilities for API responses
 */

import { z } from "zod";

/**
 * Default pagination values
 */
export const PAGINATION_DEFAULTS = {
  page: 1,
  pageSize: 20,
  maxPageSize: 100,
} as const;

/**
 * Zod schema for pagination query parameters
 */
export const paginationSchema = z.object({
  page: z.coerce
    .number()
    .int()
    .min(1)
    .default(PAGINATION_DEFAULTS.page)
    .describe("Page number (1-indexed)"),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION_DEFAULTS.maxPageSize)
    .default(PAGINATION_DEFAULTS.pageSize)
    .describe("Number of items per page"),
});

export type PaginationParams = z.infer<typeof paginationSchema>;

/**
 * Pagination metadata for API responses
 */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

/**
 * Calculate SQL offset from page and pageSize
 */
export function getOffset(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

/**
 * Build pagination metadata
 */
export function buildPaginationMeta(
  page: number,
  pageSize: number,
  totalItems: number,
): PaginationMeta {
  const totalPages = Math.ceil(totalItems / pageSize);

  return {
    page,
    pageSize,
    totalItems,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

/**
 * Build a paginated response from items and total count
 */
export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number,
  totalItems: number,
): PaginatedResponse<T> {
  return {
    data: items,
    pagination: buildPaginationMeta(page, pageSize, totalItems),
  };
}

/**
 * Zod schema for paginated response (for OpenAPI docs)
 */
export function paginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    pagination: z.object({
      page: z.number(),
      pageSize: z.number(),
      totalItems: z.number(),
      totalPages: z.number(),
      hasNextPage: z.boolean(),
      hasPreviousPage: z.boolean(),
    }),
  });
}
