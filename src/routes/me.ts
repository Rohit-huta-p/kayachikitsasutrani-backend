import { Router } from 'express';
import { Shloka } from '../models/Shloka.js';
import { ShlokaCompletion } from '../models/ShlokaCompletion.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const meRouter = Router();

meRouter.use(requireAuth);

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
    const allCompletionsByShloka = new Map<string, LeanCompletion[]>();
    for (const sid of shlokaIds) {
      const all = await ShlokaCompletion.find({ shlokaId: sid }).lean();
      allCompletionsByShloka.set(sid.toString(), all);
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
