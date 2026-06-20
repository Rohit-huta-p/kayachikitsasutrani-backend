import { Router } from 'express';
import { Shloka, type ShlokaDoc } from '../models/Shloka.js';
import { toPublicShloka } from '../lib/publicShloka.js';
import { paginationQuerySchema, paginate } from '../lib/pagination.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const shlokasRouter = Router();

shlokasRouter.use(requireAuth);

shlokasRouter.get('/', async (req, res, next) => {
  try {
    const q = paginationQuerySchema.parse(req.query);
    const filter: Record<string, unknown> = { status: 'published' };
    const allowed = req.user!.allowedShlokas;
    if (allowed.length > 0 && req.user!.role !== 'admin') {
      filter._id = { $in: allowed };
    }
    const result = await paginate(
      Shloka, filter, q.limit, q.cursor,
      (d: ShlokaDoc) => toPublicShloka(d, { includePublicIds: false }),
    );
    res.json(result);
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
    const allowed = req.user!.allowedShlokas;
    if (allowed.length > 0 && req.user!.role !== 'admin') {
      if (!allowed.includes(doc._id.toString())) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this shloka' } });
        return;
      }
    }
    res.json(toPublicShloka(doc, { includePublicIds: false }));
  } catch (err) {
    next(err);
  }
});
