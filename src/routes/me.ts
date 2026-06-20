import { Router } from 'express';
import { z } from 'zod';
import { Shloka } from '../models/Shloka.js';
import { ShlokaCompletion } from '../models/ShlokaCompletion.js';
import { User } from '../models/User.js';
import { toPublicShloka } from '../lib/publicShloka.js';
import { toPublicUser } from '../lib/publicUser.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { denseRank } from '../lib/denseRank.js';
import { hashPassword, comparePassword } from '../lib/password.js';

export const meRouter = Router();

meRouter.use(requireAuth);

const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  age: z.number().int().min(1).max(150).optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  collegeName: z.string().max(200).optional(),
  course: z.string().max(200).optional(),
});

meRouter.patch('/profile', async (req, res, next) => {
  try {
    const body = updateProfileSchema.parse(req.body);
    const update: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined) update[k] = v;
    }
    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'No fields to update' } });
      return;
    }
    const doc = await User.findByIdAndUpdate(req.user!.id, { $set: update }, { new: true });
    if (!doc) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
      return;
    }
    res.json({ user: toPublicUser(doc) });
  } catch (err) {
    next(err);
  }
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

meRouter.post('/change-password', async (req, res, next) => {
  try {
    const body = changePasswordSchema.parse(req.body);
    const user = await User.findById(req.user!.id);
    if (!user) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
      return;
    }
    const ok = await comparePassword(body.currentPassword, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect' } });
      return;
    }
    const newHash = await hashPassword(body.newPassword);
    await User.updateOne({ _id: user._id }, { $set: { passwordHash: newHash } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

meRouter.get('/completions', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const myCompletions = await ShlokaCompletion.find({ userId }).lean();
    if (myCompletions.length === 0) {
      res.json({ total: 0, items: [] });
      return;
    }
    const shlokaIds = myCompletions.map((c) => c.shlokaId);
    const shlokas = await Shloka.find({ _id: { $in: shlokaIds } }).lean();
    const shlokaMap = new Map(shlokas.map((s) => [s._id.toString(), s]));

    type LeanCompletion = typeof myCompletions[number];
    const allCompletions = await ShlokaCompletion.find({ shlokaId: { $in: shlokaIds } }).lean();
    const allCompletionsByShloka = new Map<string, LeanCompletion[]>();
    for (const c of allCompletions) {
      const key = c.shlokaId.toString();
      const arr = allCompletionsByShloka.get(key);
      if (arr) arr.push(c);
      else allCompletionsByShloka.set(key, [c]);
    }

    const items = myCompletions.map((c) => {
      const sid = c.shlokaId.toString();
      const shloka = shlokaMap.get(sid);
      const all = allCompletionsByShloka.get(sid) || [];
      const chronoRanks = denseRank(all, (a, b) => (a.completedAt as Date).getTime() - (b.completedAt as Date).getTime());
      const timeRanks = denseRank(all, (a, b) => a.elapsedSeconds - b.elapsedSeconds);
      const attemptsRanks = denseRank(all, (a, b) => a.attempts - b.attempts);
      const sortedByAvg = [...all].sort((a, b) => {
        const aAvg = ((chronoRanks.get(a) || 0) + (timeRanks.get(a) || 0) + (attemptsRanks.get(a) || 0)) / 3;
        const bAvg = ((chronoRanks.get(b) || 0) + (timeRanks.get(b) || 0) + (attemptsRanks.get(b) || 0)) / 3;
        if (aAvg !== bAvg) return aAvg - bAvg;
        return (a.completedAt as Date).getTime() - (b.completedAt as Date).getTime();
      });
      const myIdx = sortedByAvg.findIndex((x) => x.userId.toString() === userId);
      return {
        shlokaId: sid,
        slug: shloka?.slug ?? '',
        title: shloka?.title ?? '',
        completedAt: (c.completedAt as Date).toISOString(),
        attempts: c.attempts,
        elapsedSeconds: c.elapsedSeconds,
        rank: myIdx >= 0 ? myIdx + 1 : 0,
        totalCompletions: all.length,
      };
    });

    items.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
    res.json({ total: items.length, items });
  } catch (err) {
    next(err);
  }
});

// List the current user's bookmarked shlokas.
meRouter.get('/bookmarks', async (req, res, next) => {
  try {
    const user = await User.findById(req.user!.id).lean();
    const ids = (user?.bookmarks ?? []) as unknown[];
    if (ids.length === 0) {
      res.json({ total: 0, items: [] });
      return;
    }
    const shlokas = await Shloka.find({ _id: { $in: ids }, status: 'published' });
    const items = shlokas.map((s) => {
      const pub = toPublicShloka(s);
      return {
        id: pub.id,
        slug: pub.slug,
        title: pub.title,
        fullText: pub.fullText,
        images: pub.images,
      };
    });
    res.json({ total: items.length, items });
  } catch (err) {
    next(err);
  }
});
