import { AppError, ERROR_CODES } from "../errors";

/**
 * loop/v1: keyset paging for history lists that grow with data.
 * `limit` default 200, max 500; `cursor` = id of the last row of the previous
 * page (newest first: createdAt desc, id desc). No params → first 200, same
 * array shape as before. The current client walks all pages
 * (`src/data/http/repository.ts` pageAll).
 */
export const PAGE_DEFAULT = 200;
export const PAGE_MAX = 500;

export type PageQuery = { limit?: string; cursor?: string };

export function pageTake(raw: string | undefined): number {
  if (raw == null || raw === "") return PAGE_DEFAULT;
  if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new AppError(ERROR_CODES.VALIDATION, "Límite inválido.");
  return Math.min(Number(raw), PAGE_MAX);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where-clause fragment for "rows after the cursor row". `find` loads the
 * cursor row scoped to the same business/list; unknown → 400.
 */
export async function afterCursor(
  cursor: string | undefined,
  find: (id: string) => Promise<{ id: string; createdAt: Date } | null>,
): Promise<{ OR: object[] } | undefined> {
  if (cursor == null || cursor === "") return undefined;
  if (!UUID.test(cursor)) throw new AppError(ERROR_CODES.VALIDATION, "Cursor inválido.");
  const row = await find(cursor);
  if (!row) throw new AppError(ERROR_CODES.VALIDATION, "Cursor inválido.");
  return {
    OR: [{ createdAt: { lt: row.createdAt } }, { createdAt: row.createdAt, id: { lt: row.id } }],
  };
}

export const NEWEST_FIRST = [{ createdAt: "desc" as const }, { id: "desc" as const }];

/** Prisma `take`: one extra row to learn whether another page exists. */
export function pageProbe(raw: string | undefined): number {
  return pageTake(raw) + 1;
}

/** Symbol-keyed: JSON.stringify ignores it, so the array body is unchanged. */
export const PAGE_META = Symbol("pageMeta");
export type PageMeta = { hasMore: boolean; nextCursor: string | null };
export type PagedArray<T> = T[] & { [PAGE_META]?: PageMeta };

/**
 * Trim the probe row, map, and tag the array so PagingHeadersInterceptor
 * sets `X-Has-More` / `X-Next-Cursor` (old clients that send no `limit`
 * learn the list was cut at 200 instead of being silently truncated).
 */
export function paged<R extends { id: string }, T>(rows: R[], rawLimit: string | undefined, map: (r: R) => T): PagedArray<T> {
  const n = pageTake(rawLimit);
  const hasMore = rows.length > n;
  const keep = hasMore ? rows.slice(0, n) : rows;
  const out = keep.map(map) as PagedArray<T>;
  Object.defineProperty(out, PAGE_META, {
    value: { hasMore, nextCursor: hasMore ? keep[keep.length - 1].id : null },
    enumerable: false,
  });
  return out;
}
