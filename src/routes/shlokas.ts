import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Shloka } from '../models/Shloka.js';
import { toPublicShloka } from '../lib/publicShloka.js';
import { encodeCursor, decodeCursor } from '../lib/cursor.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const shlokasRouter = Router();

shlokasRouter.use(requireAuth);

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

shlokasRouter.get('/', async (req, res, next) => {
  try {
    const q = listQuerySchema.parse(req.query);
    const filter: Record<string, unknown> = { status: 'published' };
    const cursor = decodeCursor(q.cursor);
    if (cursor) {
      filter.$or = [
        { createdAt: { $lt: new Date(cursor.createdAt) } },
        { createdAt: new Date(cursor.createdAt), _id: { $lt: new Types.ObjectId(cursor.id) } },
      ];
    }
    const docs = await Shloka.find(filter).sort({ createdAt: -1, _id: -1 }).limit(q.limit + 1);
    const hasMore = docs.length > q.limit;
    const items = docs.slice(0, q.limit).map((d) => toPublicShloka(d, { includePublicIds: false }));
    const last = docs[q.limit - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ createdAt: (last.createdAt as Date).toISOString(), id: last._id.toString() })
        : undefined;
    res.json({ items, nextCursor });
  } catch (err) {
    next(err);
  }
});

shlokasRouter.get('/:slug', async (req, res, next) => {
  try {
    const doc = await Shloka.findOne({ slug: req.params.slug.toLowerCase(), status: 'published' });
    if (!doc) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Shloka not found' } });
      return;
    }
    res.json(toPublicShloka(doc, { includePublicIds: false }));
  } catch (err) {
    next(err);
  }
});
