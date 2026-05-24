import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { User } from '../../models/User.js';
import { toPublicUser } from '../../lib/publicUser.js';
import { encodeCursor, decodeCursor } from '../../lib/cursor.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';

export const adminStudentsRouter = Router();

adminStudentsRouter.use(requireAuth, requireRole('admin'));

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

adminStudentsRouter.get('/', async (req, res, next) => {
  try {
    const q = listQuerySchema.parse(req.query);
    const filter: Record<string, unknown> = { role: 'student' };
    const cursor = decodeCursor(q.cursor);
    if (cursor) {
      filter.$or = [
        { createdAt: { $lt: new Date(cursor.createdAt) } },
        { createdAt: new Date(cursor.createdAt), _id: { $lt: new Types.ObjectId(cursor.id) } },
      ];
    }
    const docs = await User.find(filter).sort({ createdAt: -1, _id: -1 }).limit(q.limit + 1);
    const hasMore = docs.length > q.limit;
    const items = docs.slice(0, q.limit).map(toPublicUser);
    const last = docs[q.limit - 1];
    const nextCursor = hasMore && last
      ? encodeCursor({ createdAt: (last.createdAt as Date).toISOString(), id: last._id.toString() })
      : undefined;
    res.json({ items, nextCursor });
  } catch (err) {
    next(err);
  }
});

adminStudentsRouter.get('/:id', async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Student not found' } });
      return;
    }
    const doc = await User.findOne({ _id: req.params.id, role: 'student' });
    if (!doc) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Student not found' } });
      return;
    }
    res.json({ user: toPublicUser(doc) });
  } catch (err) {
    next(err);
  }
});
