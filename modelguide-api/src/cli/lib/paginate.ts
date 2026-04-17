/**
 * Iterate a paginated endpoint/service until every page is drained.
 *
 * Accepts any function that returns `{ data, pagination: { hasNextPage } }`
 * (the shape used by both the HTTP API and the in-process service layer).
 * The caller owns the fetcher — this helper just loops page numbers and
 * flattens the results.
 *
 * A safety cap (maxPages) prevents an infinite loop if a misbehaving API
 * keeps reporting hasNextPage=true; hitting the cap throws instead of
 * silently truncating, which is the behaviour we specifically want to avoid.
 */

export interface PageResponse<T> {
  data: T[];
  pagination: { hasNextPage: boolean };
}

export async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<PageResponse<T>>,
  options?: { pageSize?: number; maxPages?: number; label?: string },
): Promise<T[]> {
  const maxPages = options?.maxPages ?? 100;
  const label = options?.label ?? "results";

  const all: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const resp = await fetchPage(page);
    all.push(...resp.data);
    if (!resp.pagination.hasNextPage) return all;
  }

  throw new Error(
    `Refusing to fetch more than ${maxPages} pages of ${label} — endpoint may be looping`,
  );
}
