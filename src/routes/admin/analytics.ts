import { Router } from 'express';
import { z } from 'zod';
import type { Types } from 'mongoose';
import { User } from '../../models/User.js';
import { ActivityBucket } from '../../models/ActivityBucket.js';
import { ShlokaCompletion } from '../../models/ShlokaCompletion.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validateObjectId } from '../../middleware/validateObjectId.js';
import { addDays, dayInZone, isValidTimeZone } from '../../lib/analyticsDays.js';
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

export interface StudentActivitySummary {
  userId: string;
  totalSeconds: number;
  last7Seconds: number;
  lastActiveAt: string | null;
  completed: number;
}

/** Headline numbers for every student, for the admin students list. */
adminAnalyticsRouter.get('/students', async (req, res, next) => {
  try {
    const { tz } = z.object({ tz: tzSchema }).parse(req.query);
    const weekStart = addDays(dayInZone(new Date(), tz), -6);
    const [activity, completions] = await Promise.all([
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
      ShlokaCompletion.aggregate<{ _id: Types.ObjectId; completed: number }>([
        { $group: { _id: '$userId', completed: { $sum: 1 } } },
      ]),
    ]);

    const byUser = new Map<string, StudentActivitySummary>();
    const rowFor = (id: string) => {
      let row = byUser.get(id);
      if (!row) {
        row = { userId: id, totalSeconds: 0, last7Seconds: 0, lastActiveAt: null, completed: 0 };
        byUser.set(id, row);
      }
      return row;
    };
    for (const a of activity) {
      const row = rowFor(a._id.toString());
      row.totalSeconds = Math.round(a.totalSeconds);
      row.last7Seconds = Math.round(a.last7Seconds);
      row.lastActiveAt = a.lastActiveAt.toISOString();
    }
    for (const c of completions) rowFor(c._id.toString()).completed = c.completed;

    res.json({ items: [...byUser.values()] });
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
