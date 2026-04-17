import { describe, expect, test } from "bun:test";
import { fetchAllPages } from "../../../src/cli/lib/paginate";

describe("fetchAllPages", () => {
  test("returns a single page when hasNextPage is false", async () => {
    const result = await fetchAllPages(async (page) => {
      expect(page).toBe(1);
      return { data: ["a", "b"], pagination: { hasNextPage: false } };
    });
    expect(result).toEqual(["a", "b"]);
  });

  test("drains every page until hasNextPage is false", async () => {
    const pages = [
      { data: ["a", "b"], pagination: { hasNextPage: true } },
      { data: ["c", "d"], pagination: { hasNextPage: true } },
      { data: ["e"], pagination: { hasNextPage: false } },
    ];
    const seenPages: number[] = [];
    const result = await fetchAllPages(async (page) => {
      seenPages.push(page);
      return pages[page - 1];
    });
    expect(seenPages).toEqual([1, 2, 3]);
    expect(result).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("throws if the endpoint exceeds maxPages (misbehaving paginator)", async () => {
    await expect(
      fetchAllPages(
        async () => ({
          data: ["x"],
          pagination: { hasNextPage: true },
        }),
        { maxPages: 3, label: "widgets" },
      ),
    ).rejects.toThrow("Refusing to fetch more than 3 pages of widgets");
  });

  test("returns empty array when first page has no data and no next", async () => {
    const result = await fetchAllPages(async () => ({
      data: [] as string[],
      pagination: { hasNextPage: false },
    }));
    expect(result).toEqual([]);
  });
});
