import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Shloka } from '../../models/Shloka.js';
import { toPublicShloka } from '../../lib/publicShloka.js';
import { isValidSlug } from '../../lib/slug.js';
import { encodeCursor, decodeCursor } from '../../lib/cursor.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { deleteAsset } from '../../lib/cloudinary.js';

export const adminShlokasRouter = Router();

adminShlokasRouter.use(requireAuth, requireRole('admin'));

const wordTimingSchema = z.object({
  text: z.string().min(1),
  start: z.number().min(0),
  end: z.number().min(0),
});

const assetSchema = z.object({
  url: z.string().url(),
  publicId: z.string().min(1),
});

const lineSchema = z.object({
  sanskrit: z.string().min(1).max(1000),
  words: z.array(wordTimingSchema).optional().default([]),
  fullTimings: z.array(wordTimingSchema),
});

const baseBodySchema = z.object({
  slug: z.string().refine(isValidSlug, { message: 'Invalid slug (use lowercase kebab-case)' }),
  title: z.string().min(1).max(200),
  meaning: z.string().min(1).max(5000),
  fullText: z.string().max(5000).optional(),
  highlightWords: z.array(z.string().min(1).max(200)).optional().default([]),
  caseStudy: z.string().max(5000).optional(),
  status: z.enum(['draft', 'published']).optional(),
  audio: z.object({
    full: assetSchema,
    lines: z.array(assetSchema).optional().default([]),
  }),
  image: assetSchema.optional(),
  lines: z.array(lineSchema),
});

function validateTimings(body: z.infer<typeof baseBodySchema>): string | null {
  if (body.audio.lines.length > 0 && body.audio.lines.length !== body.lines.length) {
    return 'audio.lines.length must equal lines.length';
  }
  for (let i = 0; i < body.lines.length; i++) {
    const line = body.lines[i];
    if (line.words.length > 0 && line.words.length !== line.fullTimings.length) {
      return `lines[${i}].words and fullTimings must have the same length`;
    }
    if (line.words.length > 0) {
      for (let k = 0; k < line.words.length; k++) {
        if (line.words[k].text !== line.fullTimings[k].text) {
          return `lines[${i}].words[${k}].text must equal lines[${i}].fullTimings[${k}].text`;
        }
      }
    }
    for (const arr of [line.words, line.fullTimings]) {
      for (let k = 0; k < arr.length; k++) {
        if (arr[k].start >= arr[k].end) return `lines[${i}] timing ${k}: start must be < end`;
        if (k > 0 && arr[k].start < arr[k - 1].end) return `lines[${i}] timing ${k}: overlaps previous`;
      }
    }
  }
  return null;
}

const listQuerySchema = z.object({
  status: z.enum(['draft', 'published', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

adminShlokasRouter.get('/', async (req, res, next) => {
  try {
    const q = listQuerySchema.parse(req.query);
    const filter: Record<string, unknown> = {};
    if (q.status !== 'all') filter.status = q.status;
    const cursor = decodeCursor(q.cursor);
    if (cursor) {
      filter.$or = [
        { createdAt: { $lt: new Date(cursor.createdAt) } },
        { createdAt: new Date(cursor.createdAt), _id: { $lt: new Types.ObjectId(cursor.id) } },
      ];
    }
    const docs = await Shloka.find(filter).sort({ createdAt: -1, _id: -1 }).limit(q.limit + 1);
    const hasMore = docs.length > q.limit;
    const items = docs.slice(0, q.limit).map((d) => toPublicShloka(d, { includePublicIds: true }));
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

adminShlokasRouter.get('/:id', async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Shloka not found' } });
      return;
    }
    const doc = await Shloka.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Shloka not found' } });
      return;
    }
    res.json(toPublicShloka(doc, { includePublicIds: true }));
  } catch (err) {
    next(err);
  }
});

adminShlokasRouter.post('/', async (req, res, next) => {
  try {
    const body = baseBodySchema.parse(req.body);
    const timingsError = validateTimings(body);
    if (timingsError) {
      res.status(400).json({ error: { code: 'INVALID_TIMINGS', message: timingsError } });
      return;
    }
    const existing = await Shloka.findOne({ slug: body.slug });
    if (existing) {
      res.status(409).json({ error: { code: 'SLUG_TAKEN', message: 'Slug already used' } });
      return;
    }
    const doc = await Shloka.create({
      slug: body.slug,
      title: body.title,
      meaning: body.meaning,
      fullText: body.fullText,
      highlightWords: body.highlightWords,
      caseStudy: body.caseStudy,
      status: body.status ?? 'draft',
      audio: body.audio,
      image: body.image,
      lines: body.lines,
      createdBy: req.user!.id,
    });
    res.json(toPublicShloka(doc, { includePublicIds: true }));
  } catch (err) {
    next(err);
  }
});

const patchBodySchema = baseBodySchema.partial();

adminShlokasRouter.patch('/:id', async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Shloka not found' } });
      return;
    }
    const body = patchBodySchema.parse(req.body);
    const doc = await Shloka.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Shloka not found' } });
      return;
    }

    // If audio or lines are being changed, validate timings against the merged result
    const merged = {
      slug: body.slug ?? doc.slug,
      title: body.title ?? doc.title,
      meaning: body.meaning ?? doc.meaning,
      fullText: body.fullText ?? doc.fullText,
      highlightWords: body.highlightWords ?? doc.highlightWords,
      caseStudy: body.caseStudy ?? doc.caseStudy,
      status: body.status ?? (doc.status as 'draft' | 'published'),
      audio: body.audio ?? doc.audio,
      image: body.image ?? doc.image,
      lines: body.lines ?? doc.lines,
    } as z.infer<typeof baseBodySchema>;

    const timingsError = validateTimings(merged);
    if (timingsError) {
      res.status(400).json({ error: { code: 'INVALID_TIMINGS', message: timingsError } });
      return;
    }

    if (body.slug && body.slug !== doc.slug) {
      const collide = await Shloka.findOne({ slug: body.slug, _id: { $ne: doc._id } });
      if (collide) {
        res.status(409).json({ error: { code: 'SLUG_TAKEN', message: 'Slug already used' } });
        return;
      }
      doc.slug = body.slug;
    }
    if (body.title !== undefined) doc.title = body.title;
    if (body.meaning !== undefined) doc.meaning = body.meaning;
    if (body.fullText !== undefined) doc.fullText = body.fullText;
    if (body.highlightWords !== undefined) doc.highlightWords = body.highlightWords;
    if (body.caseStudy !== undefined) doc.caseStudy = body.caseStudy;
    if (body.status !== undefined) doc.status = body.status;
    // Mongoose accepts plain objects for DocumentArray sub-schemas at runtime,
    // but the static types require DocumentArray. Cast to bypass — runtime is safe.
    if (body.audio !== undefined) doc.audio = body.audio as typeof doc.audio;
    if (body.image !== undefined) doc.image = body.image as typeof doc.image;
    if (body.lines !== undefined) doc.lines = body.lines as typeof doc.lines;
    await doc.save();
    res.json(toPublicShloka(doc, { includePublicIds: true }));
  } catch (err) {
    next(err);
  }
});

adminShlokasRouter.delete('/:id', async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Shloka not found' } });
      return;
    }
    const doc = await Shloka.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Shloka not found' } });
      return;
    }
    const assets: Array<{ publicId: string; resourceType: 'image' | 'video' }> = [
      { publicId: doc.audio.full.publicId, resourceType: 'video' },
      ...doc.audio.lines.map((l) => ({ publicId: l.publicId, resourceType: 'video' as const })),
    ];
    if (doc.image) assets.push({ publicId: doc.image.publicId, resourceType: 'image' });

    await doc.deleteOne();

    await Promise.all(
      assets.map((a) =>
        deleteAsset(a.publicId, a.resourceType).catch((err) => {
          console.error(`[shloka.delete] Cloudinary destroy failed for ${a.publicId}:`, err);
        }),
      ),
    );

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
