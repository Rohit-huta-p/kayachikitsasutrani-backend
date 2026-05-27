import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Shloka } from '../models/Shloka.js';
import { ShlokaCompletion, type ShlokaCompletionDoc } from '../models/ShlokaCompletion.js';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { deriveAvatar } from '../lib/avatar.js';

export const completionsRouter = Router();

completionsRouter.use(requireAuth);

const completeBodySchema = z.object({
  attempts: z.number().int().min(1).max(1000),
  elapsedSeconds: z.number().min(0).max(86400),
});

/** Resolve a slug to a shloka the user is allowed to see (drafts admin-only). */
async function findVisibleShloka(slug: string, userRole: 'student' | 'admin') {
  const doc = await Shloka.findOne({ slug });
  if (!doc) return null;
  if (doc.status === 'draft' && userRole !== 'admin') return null;
  return doc;
}

completionsRouter.post('/:slug/complete', async (req, res, next) => {
  try {
    const body = completeBodySchema.parse(req.body);
    const shloka = await findVisibleShloka(req.params.slug, req.user!.role);
    if (!shloka) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Shloka not found' } });
      return;
    }
    const userId = new Types.ObjectId(req.user!.id);
    const existing = await ShlokaCompletion.findOne({ userId, shlokaId: shloka._id });
    if (existing) {
      res.json({
        completion: {
          id: existing._id.toString(),
          userId: existing.userId.toString(),
          shlokaId: existing.shlokaId.toString(),
          completedAt: (existing.completedAt as Date).toISOString(),
          attempts: existing.attempts,
          elapsedSeconds: existing.elapsedSeconds,
        },
        alreadyCompleted: true,
      });
      return;
    }
    const doc = await ShlokaCompletion.create({
      userId,
      shlokaId: shloka._id,
      completedAt: new Date(),
      attempts: body.attempts,
      elapsedSeconds: body.elapsedSeconds,
    });
    res.json({
      completion: {
        id: doc._id.toString(),
        userId: doc.userId.toString(),
        shlokaId: doc.shlokaId.toString(),
        completedAt: (doc.completedAt as Date).toISOString(),
        attempts: doc.attempts,
        elapsedSeconds: doc.elapsedSeconds,
      },
      alreadyCompleted: false,
    });
  } catch (err) {
    next(err);
  }
});

function denseRank<T>(items: T[], compare: (a: T, b: T) => number): Map<T, number> {
  const sorted = [...items].sort(compare);
  const ranks = new Map<T, number>();
  let lastKey: T | null = null;
  let lastRank = 0;
  sorted.forEach((item, idx) => {
    if (lastKey !== null && compare(lastKey, item) === 0) {
      ranks.set(item, lastRank);
    } else {
      lastRank = idx + 1;
      ranks.set(item, lastRank);
      lastKey = item;
    }
  });
  return ranks;
}

completionsRouter.get('/:slug/leaderboard', async (req, res, next) => {
  try {
    const shloka = await findVisibleShloka(req.params.slug, req.user!.role);
    if (!shloka) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Shloka not found' } });
      return;
    }
    const completions = await ShlokaCompletion.find({ shlokaId: shloka._id }).lean();
    const total = completions.length;
    if (total === 0) {
      res.json({ total: 0, items: [] });
      return;
    }
    // Compute three rank maps using dense ranking
    const chronoRanks = denseRank(completions, (a, b) =>
      (a.completedAt as Date).getTime() - (b.completedAt as Date).getTime(),
    );
    const timeRanks = denseRank(completions, (a, b) => a.elapsedSeconds - b.elapsedSeconds);
    const attemptsRanks = denseRank(completions, (a, b) => a.attempts - b.attempts);

    // Fetch user info for all completions in one query
    const userIds = completions.map((c) => c.userId);
    const users = await User.find({ _id: { $in: userIds } }).lean();
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const items = completions.map((c) => {
      const user = userMap.get(c.userId.toString());
      const name = user?.name ?? 'Unknown';
      const email = user?.email ?? '';
      const { initials, color } = deriveAvatar(name, email);
      const chronoRank = chronoRanks.get(c)!;
      const timeRank = timeRanks.get(c)!;
      const attemptsRank = attemptsRanks.get(c)!;
      return {
        userId: c.userId.toString(),
        name,
        email,
        avatarColor: color,
        initials,
        completedAt: (c.completedAt as Date).toISOString(),
        attempts: c.attempts,
        elapsedSeconds: c.elapsedSeconds,
        chronoRank,
        timeRank,
        attemptsRank,
        averageRank: (chronoRank + timeRank + attemptsRank) / 3,
      };
    });

    items.sort((a, b) => {
      if (a.averageRank !== b.averageRank) return a.averageRank - b.averageRank;
      return new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime();
    });

    res.json({ total, items });
  } catch (err) {
    next(err);
  }
});
