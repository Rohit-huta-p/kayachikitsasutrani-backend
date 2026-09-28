import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Shloka } from '../models/Shloka.js';
import { ActivityBucket, ACTIVITY_KINDS, ACTIVITY_COUNTERS } from '../models/ActivityBucket.js';
import { ActivitySession } from '../models/ActivitySession.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { addDays } from '../lib/analyticsDays.js';

export const activityRouter = Router();

activityRouter.use(requireAuth);

/** Most time a brand-new session may claim in its first flush. */
const FIRST_FLUSH_MAX_SECONDS = 5 * 60;
/** Backlog cap for later flushes (e.g. after the student was briefly offline). */
const FLUSH_MAX_SECONDS = 15 * 60;
/** Leeway for request latency between the client's clock and ours. */
const FLUSH_SLACK_SECONDS = 15;

const seconds = z.number().min(0).max(3600);
const count = z.number().int().min(0).max(1000);

const entrySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hour: z.number().int().min(0).max(23),
  slug: z.string().min(1).max(200).toLowerCase().nullable(),
  seconds: z
    .object({
      listening: seconds.default(0),
      reading: seconds.default(0),
      typing: seconds.default(0),
      drawing: seconds.default(0),
      arranging: seconds.default(0),
      browsing: seconds.default(0),
    })
    .default({}),
  counts: z
    .object({
      audioPlays: count.default(0),
      audioCompletes: count.default(0),
      meaningPlays: count.default(0),
      typeChecks: count.default(0),
      arrangeChecks: count.default(0),
      arrangeSolves: count.default(0),
    })
    .default({}),
  typeBestPct: z.number().min(0).max(100).optional(),
});

const flushSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  device: z.enum(['mobile', 'tablet', 'desktop']),
  entries: z.array(entrySchema).min(1).max(50),
});

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Student-side activity flush (sent every ~30s while a student is engaged).
 * Seconds are clamped to the wall-clock time since the session's previous
 * flush, so a buggy or tampered client can't inflate a student's time.
 */
activityRouter.post('/', async (req, res, next) => {
  try {
    // Only students are measured; admins previewing student pages are ignored.
    if (req.user!.role !== 'student') {
      res.status(204).end();
      return;
    }
    const body = flushSchema.parse(req.body);
    const userId = new Types.ObjectId(req.user!.id);
    const now = new Date();

    // Drop days that can't be "today" anywhere (UTC-12 … UTC+14), with a
    // day of slack so a flush delayed across midnight still lands.
    const utcToday = now.toISOString().slice(0, 10);
    const minDay = addDays(utcToday, -2);
    const maxDay = addDays(utcToday, 1);
    const entries = body.entries.filter((e) => e.day >= minDay && e.day <= maxDay);

    const slugs = [...new Set(entries.map((e) => e.slug).filter((s): s is string => !!s))];
    const shlokas = slugs.length > 0 ? await Shloka.find({ slug: { $in: slugs } }, { _id: 1, slug: 1 }).lean() : [];
    const idBySlug = new Map(shlokas.map((s) => [s.slug, s._id]));

    const requested = entries.reduce((sum, e) => sum + ACTIVITY_KINDS.reduce((s, k) => s + e.seconds[k], 0), 0);
    const session = await ActivitySession.findOne({ userId, sessionId: body.sessionId }, { lastSeenAt: 1 }).lean();
    const budget = session
      ? Math.min(FLUSH_MAX_SECONDS, (now.getTime() - session.lastSeenAt.getTime()) / 1000 + FLUSH_SLACK_SECONDS)
      : FIRST_FLUSH_MAX_SECONDS;
    const scale = requested > budget ? Math.max(0, budget) / requested : 1;

    let granted = 0;
    const ops = [];
    for (const e of entries) {
      const inc: Record<string, number> = {};
      let total = 0;
      for (const k of ACTIVITY_KINDS) {
        const s = round1(e.seconds[k] * scale);
        if (s > 0) {
          inc[`${k}Seconds`] = s;
          total += s;
        }
      }
      if (total > 0) inc.totalSeconds = round1(total);
      for (const c of ACTIVITY_COUNTERS) {
        if (e.counts[c] > 0) inc[c] = e.counts[c];
      }
      const update: Record<string, unknown> = {};
      if (Object.keys(inc).length > 0) update.$inc = inc;
      if (e.typeBestPct) update.$max = { typeBestPct: e.typeBestPct };
      if (Object.keys(update).length === 0) continue;

      granted += total;
      ops.push({
        updateOne: {
          filter: { userId, day: e.day, hour: e.hour, shlokaId: (e.slug && idBySlug.get(e.slug)) || null },
          update,
          upsert: true,
        },
      });
    }
    if (ops.length === 0) {
      res.status(204).end();
      return;
    }
    await ActivityBucket.bulkWrite(ops, { ordered: false });

    await ActivitySession.updateOne(
      { userId, sessionId: body.sessionId },
      {
        $setOnInsert: { device: body.device, startedAt: new Date(now.getTime() - granted * 1000) },
        $set: { lastSeenAt: now },
        $inc: { totalSeconds: round1(granted) },
      },
      { upsert: true },
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
