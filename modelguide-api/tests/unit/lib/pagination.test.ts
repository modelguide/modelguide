/**
 * Tests for pagination utilities
 */

import { describe, expect, test } from "bun:test";
import {
  PAGINATION_DEFAULTS,
  buildPaginationMeta,
  getOffset,
  paginate,
  paginationSchema,
} from "@lib/pagination";

describe("paginationSchema", () => {
  test("parses valid pagination params", () => {
    const result = paginationSchema.safeParse({ page: 2, pageSize: 10 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.pageSize).toBe(10);
    }
  });

  test("uses defaults when not provided", () => {
    const result = paginationSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(PAGINATION_DEFAULTS.page);
      expect(result.data.pageSize).toBe(PAGINATION_DEFAULTS.pageSize);
    }
  });

  test("coerces string values to numbers", () => {
    const result = paginationSchema.safeParse({ page: "3", pageSize: "25" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.pageSize).toBe(25);
    }
  });

  test("rejects page less than 1", () => {
    const result = paginationSchema.safeParse({ page: 0 });
    expect(result.success).toBe(false);
  });

  test("rejects negative page", () => {
    const result = paginationSchema.safeParse({ page: -1 });
    expect(result.success).toBe(false);
  });

  test("rejects pageSize greater than max", () => {
    const result = paginationSchema.safeParse({
      pageSize: PAGINATION_DEFAULTS.maxPageSize + 1,
    });
    expect(result.success).toBe(false);
  });

  test("accepts pageSize at max", () => {
    const result = paginationSchema.safeParse({
      pageSize: PAGINATION_DEFAULTS.maxPageSize,
    });
    expect(result.success).toBe(true);
  });
});

describe("getOffset", () => {
  test("calculates offset for first page", () => {
    expect(getOffset(1, 20)).toBe(0);
  });

  test("calculates offset for second page", () => {
    expect(getOffset(2, 20)).toBe(20);
  });

  test("calculates offset with different page sizes", () => {
    expect(getOffset(3, 10)).toBe(20);
    expect(getOffset(3, 25)).toBe(50);
    expect(getOffset(5, 15)).toBe(60);
  });
});

describe("buildPaginationMeta", () => {
  test("builds correct meta for first page", () => {
    const meta = buildPaginationMeta(1, 10, 50);
    expect(meta).toEqual({
      page: 1,
      pageSize: 10,
      totalItems: 50,
      totalPages: 5,
      hasNextPage: true,
      hasPreviousPage: false,
    });
  });

  test("builds correct meta for last page", () => {
    const meta = buildPaginationMeta(5, 10, 50);
    expect(meta).toEqual({
      page: 5,
      pageSize: 10,
      totalItems: 50,
      totalPages: 5,
      hasNextPage: false,
      hasPreviousPage: true,
    });
  });

  test("builds correct meta for middle page", () => {
    const meta = buildPaginationMeta(3, 10, 50);
    expect(meta.hasNextPage).toBe(true);
    expect(meta.hasPreviousPage).toBe(true);
  });

  test("handles single page", () => {
    const meta = buildPaginationMeta(1, 20, 15);
    expect(meta.totalPages).toBe(1);
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPreviousPage).toBe(false);
  });

  test("handles empty results", () => {
    const meta = buildPaginationMeta(1, 20, 0);
    expect(meta.totalPages).toBe(0);
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPreviousPage).toBe(false);
  });

  test("rounds up total pages for partial last page", () => {
    const meta = buildPaginationMeta(1, 10, 25);
    expect(meta.totalPages).toBe(3);
  });
});

describe("paginate", () => {
  test("creates paginated response with items", () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const result = paginate(items, 1, 10, 30);

    expect(result.data).toEqual(items);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.pageSize).toBe(10);
    expect(result.pagination.totalItems).toBe(30);
    expect(result.pagination.totalPages).toBe(3);
  });

  test("creates paginated response with empty items", () => {
    const result = paginate([], 1, 20, 0);

    expect(result.data).toEqual([]);
    expect(result.pagination.totalItems).toBe(0);
    expect(result.pagination.totalPages).toBe(0);
  });
});
