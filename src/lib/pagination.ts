import { z } from 'zod';
import { Types } from 'mongoose';
import { encodeCursor, decodeCursor } from './cursor.js';

/** Pagination constants shared across all list endpoints. */
export const PAGINATION = {
  MIN_LIMIT: 1,
  MAX_LIMIT: 50,
  DEFAULT_LIMIT: 20,
} as const;

/**
 * Zod schema for cursor-based pagination query parameters.
 *
 * `limit` — how many items to return (clamped to PAGINATION bounds).
 * `cursor` — opaque token returned by a previous response's `nextCursor`.
 */
export const paginationQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(PAGINATION.MIN_LIMIT)
    .max(PAGINATION.MAX_LIMIT)
    .default(PAGINATION.DEFAULT_LIMIT),
  cursor: z.string().optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Result of applying cursor-based pagination to a Mongoose query.
 */
export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | undefined;
}

/**
 * Apply cursor-based keyset pagination (createdAt + _id descending).
 *
 * The caller provides a base `filter` and the parsed `limit` / `cursor`
 * values. The helper returns the paginated items plus the next cursor.
 *
 * @param Model     A Mongoose model (must expose `.find().sort().limit()`).
 * @param filter    Base filter object — cursor conditions are merged in.
 * @param limit     Max items to return.
 * @param cursor    Opaque cursor string from the previous page, or `undefined`.
 * @param mapItem   Transform each document before returning.
 */
export async function paginate<TDoc, TOut>(
  // Mongoose Model.find() has many overloads that don't reduce to a simple
  // structural type.  We accept `any` here and constrain `TDoc` via mapItem.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Model: { find: (...args: any[]) => any },
  filter: Record<string, unknown>,
  limit: number,
  cursor: string | undefined,
  mapItem: (doc: TDoc) => TOut,
): Promise<PaginatedResult<TOut>> {
  const fullFilter = { ...filter };
  const decoded = decodeCursor(cursor);
  if (decoded) {
    fullFilter.$or = [
      { createdAt: { $lt: new Date(decoded.createdAt) } },
      { createdAt: new Date(decoded.createdAt), _id: { $lt: new Types.ObjectId(decoded.id) } },
    ];
  }

  const docs: TDoc[] = await Model.find(fullFilter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1);
  const hasMore = docs.length > limit;
  const items = docs.slice(0, limit).map(mapItem);
  const last = docs[limit - 1] as TDoc & { _id: Types.ObjectId; createdAt: unknown } | undefined;
  const nextCursor =
    hasMore && last
      ? encodeCursor({ createdAt: (last.createdAt as Date).toISOString(), id: last._id.toString() })
      : undefined;

  return { items, nextCursor };
}
