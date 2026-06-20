import { Router } from 'express';
import mongoose from 'mongoose';
import { User } from '../../models/User.js';
import { toPublicUser } from '../../lib/publicUser.js';
import { paginationQuerySchema, paginate } from '../../lib/pagination.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validateObjectId } from '../../middleware/validateObjectId.js';

export const adminStudentsRouter = Router();

adminStudentsRouter.use(requireAuth, requireRole('admin'));

adminStudentsRouter.get('/', async (req, res, next) => {
  try {
    const q = paginationQuerySchema.parse(req.query);
    const filter: Record<string, unknown> = { role: 'student' };
    const result = await paginate(User, filter, q.limit, q.cursor, toPublicUser);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

adminStudentsRouter.get('/:id', validateObjectId('id', 'Student'), async (req, res, next) => {
  try {
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

adminStudentsRouter.delete('/:id', validateObjectId('id', 'Student'), async (req, res, next) => {
  try {
    const doc = await User.findOneAndDelete({ _id: req.params.id, role: 'student' });
    if (!doc) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Student not found' } });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminStudentsRouter.put('/:id/allowed-shlokas', validateObjectId('id', 'Student'), async (req, res, next) => {
  try {
    const { shlokaIds } = req.body;
    if (!Array.isArray(shlokaIds) || !shlokaIds.every((id: string) => mongoose.Types.ObjectId.isValid(id))) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'shlokaIds must be an array of valid ObjectIds' } });
      return;
    }
    const doc = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'student' },
      { $set: { allowedShlokas: shlokaIds } },
      { new: true },
    );
    if (!doc) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Student not found' } });
      return;
    }
    res.json({ user: toPublicUser(doc) });
  } catch (err) {
    next(err);
  }
});
