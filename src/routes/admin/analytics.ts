import { Router } from 'express';
import { z } from 'zod';
import type { Types } from 'mongoose';
import { User } from '../../models/User.js';
import { Shloka } from '../../models/Shloka.js';
import { ActivityBucket } from '../../models/ActivityBucket.js';
import { ShlokaCompletion } from '../../models/ShlokaCompletion.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validateObjectId } from '../../middleware/validateObjectId.js';
import { addDays, dayInZone, daysBetween, isValidTimeZone } from '../../lib/analyticsDays.js';
import { buildStudentAnalytics } from '../../lib/studentAnalytics.js';

export const adminAnalyticsRouter = Router();

adminAnalyticsRouter.use(requireAuth, requireRole('admin'));

// Students are in India; the admin UI passes its own zone so "today" and
// "last 7 days" line up with the reader's calendar.
const DEFAULT_TZ = 'Asia/Kolkata';
const tzSchema = z
  .string()
  .max(64)
  .optional()
  .transform((tz) => (tz && isValidTimeZone(tz) ? tz : DEFAULT_TZ));

export interface StudentRosterRow {
  id: string;
  name: string;
  email: string;
  collegeName?: string;
  course?: string;
  status: 'pending' | 'active';
  createdAt: string;
  totalSeconds: number;
  last7Seconds: number;
  /** Engaged seconds for each of `days`, oldest first. */
  last14Days: number[];
  lastActiveAt: string | null;
  /** Completed shlokas that are still in the student's catalog. */
  completed: number;
  available: number;
}

/**
 * Every student with their headline numbers, in one response, so the admin
 * students page can search, sort and filter the whole class client-side.
 */
adminAnalyticsRouter.get('/students', async (req, res, next) => {
  try {
    const { tz } = z.object({ tz: tzSchema }).parse(req.query);
    const today = dayInZone(new Date(), tz);
    const days = daysBetween(addDays(today, -13), today);
    const weekStart = addDays(today, -6);
    const [students, activity, recent, completions, published] = await Promise.all([
      User.find({ role: 'student' }).lean(),
      ActivityBucket.aggregate<{ _id: Types.ObjectId; totalSeconds: number; last7Seconds: number; lastActiveAt: Date }>([
        {
          $group: {
            _id: '$userId',
            totalSeconds: { $sum: '$totalSeconds' },
            last7Seconds: { $sum: { $cond: [{ $gte: ['$day', weekStart] }, '$totalSeconds', 0] } },
            lastActiveAt: { $max: '$updatedAt' },
          },
        },
      ]),
      ActivityBucket.aggregate<{ _id: { userId: Types.ObjectId; day: string }; seconds: number }>([
        { $match: { day: { $gte: days[0] } } },
        { $group: { _id: { userId: '$userId', day: '$day' }, seconds: { $sum: '$totalSeconds' } } },
      ]),
      ShlokaCompletion.aggregate<{ _id: Types.ObjectId; shlokaIds: Types.ObjectId[] }>([
        { $group: { _id: '$userId', shlokaIds: { $addToSet: '$shlokaId' } } },
      ]),
      Shloka.find({ status: 'published' }, { _id: 1 }).lean(),
    ]);

    const publishedIds = new Set(published.map((s) => s._id.toString()));
    const activityByUser = new Map(activity.map((a) => [a._id.toString(), a]));
    const completedByUser = new Map(completions.map((c) => [c._id.toString(), c.shlokaIds.map(String)]));
    const recentByUser = new Map<string, Map<string, number>>();
    for (const r of recent) {
      const id = r._id.userId.toString();
      let perDay = recentByUser.get(id);
      if (!perDay) {
        perDay = new Map();
        recentByUser.set(id, perDay);
      }
      perDay.set(r._id.day, r.seconds);
    }

    const items: StudentRosterRow[] = students.map((u) => {
      const id = u._id.toString();
      const a = activityByUser.get(id);
      // Same catalog rule as the student's own shloka list: an allow-list
      // (when set) narrowed to what's published.
      const allowList = (u.allowedShlokas ?? []).map(String);
      const catalog = allowList.length > 0 ? new Set(allowList.filter((s) => publishedIds.has(s))) : publishedIds;
      return {
        id,
        name: u.name,
        email: u.email,
        collegeName: u.collegeName ?? undefined,
        course: u.course ?? undefined,
        status: (u.status as 'pending' | 'active' | undefined) ?? 'active',
        createdAt: (u.createdAt as Date).toISOString(),
        totalSeconds: Math.round(a?.totalSeconds ?? 0),
        last7Seconds: Math.round(a?.last7Seconds ?? 0),
        last14Days: days.map((d) => Math.round(recentByUser.get(id)?.get(d) ?? 0)),
        lastActiveAt: a ? a.lastActiveAt.toISOString() : null,
        completed: (completedByUser.get(id) ?? []).filter((s) => catalog.has(s)).length,
        available: catalog.size,
      };
    });

    res.json({ today, days, items });
  } catch (err) {
    next(err);
  }
});

const detailQuerySchema = z.object({
  days: z.enum(['7', '30', '90']).default('30').transform(Number),
  tz: tzSchema,
});

/** Full analytics for one student: time, habits, practice and per-shloka progress. */
adminAnalyticsRouter.get('/students/:id', validateObjectId('id', 'Student'), async (req, res, next) => {
  try {
    const q = detailQuerySchema.parse(req.query);
    const user = await User.findOne({ _id: req.params.id, role: 'student' });
    if (!user) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Student not found' } });
      return;
    }
    res.json(await buildStudentAnalytics(user, q.days, q.tz));
  } catch (err) {
    next(err);
  }
});
