import type { Types } from 'mongoose';
import {
  ActivityBucket,
  ACTIVITY_KINDS,
  ACTIVITY_COUNTERS,
  type ActivityKind,
  type ActivityCounter,
} from '../models/ActivityBucket.js';
import { ActivitySession } from '../models/ActivitySession.js';
import { Shloka } from '../models/Shloka.js';
import { ShlokaCompletion } from '../models/ShlokaCompletion.js';
import type { UserDoc } from '../models/User.js';
import { toPublicUser, type PublicUser } from './publicUser.js';
import { leaderboardPosition } from './leaderboardPosition.js';
import { addDays, dayInZone, daysBetween, streaks, weekdayIndex } from './analyticsDays.js';

/** A day counts toward active days and streaks only with at least this much engaged time. */
export const ACTIVE_DAY_MIN_SECONDS = 60;

const DAY_MS = 86_400_000;

type Devices = Record<'mobile' | 'tablet' | 'desktop', number>;
type KindSeconds = Record<ActivityKind, number>;
type Counts = Record<ActivityCounter, number>;
type BucketSums = { totalSeconds: number } & Record<`${ActivityKind}Seconds`, number> & Counts;

export interface ShlokaAnalyticsRow {
  shlokaId: string;
  slug: string;
  title: string;
  status: 'completed' | 'in-progress' | 'not-started';
  /** False once the shloka left the student's catalog (unpublished or access restricted). */
  available: boolean;
  totalSeconds: number;
  listeningSeconds: number;
  readingSeconds: number;
  practiceSeconds: number;
  audioPlays: number;
  audioCompletes: number;
  meaningPlays: number;
  typeChecks: number;
  typeBestPct: number;
  arrangeChecks: number;
  arrangeSolves: number;
  firstActiveDay: string | null;
  lastActiveAt: string | null;
  completion: {
    completedAt: string;
    attempts: number;
    elapsedSeconds: number;
    rank: number;
    totalCompletions: number;
  } | null;
}

export interface StudentAnalytics {
  generatedAt: string;
  tz: string;
  today: string;
  /** First day any student activity was recorded — time before this was never measured. */
  trackingSince: string | null;
  /** `prevFrom` starts the equally long period before `from`, used for comparisons. */
  range: { days: number; from: string; to: string; prevFrom: string };
  user: PublicUser & { lastLoginAt: string | null };
  summary: {
    totalSeconds: number;
    rangeSeconds: number;
    prevRangeSeconds: number;
    activeDays: number;
    currentStreak: number;
    longestStreak: number;
    sessions: number;
    rangeSessions: number;
    avgSessionSeconds: number;
    firstActiveAt: string | null;
    lastActiveAt: string | null;
    completed: number;
    inProgress: number;
    available: number;
    /** Engaged seconds in range per device type. */
    devices: Devices;
  };
  daily: { day: string; seconds: number }[];
  /** Engaged seconds in range by the student's local hour, 0–23. */
  hourly: number[];
  /** Engaged seconds in range by weekday, Monday first. */
  weekday: number[];
  activity: KindSeconds;
  actions: Counts;
  shlokas: ShlokaAnalyticsRow[];
}

const sumFields = Object.fromEntries(
  ['totalSeconds', ...ACTIVITY_KINDS.map((k) => `${k}Seconds`), ...ACTIVITY_COUNTERS].map((f) => [f, { $sum: `$${f}` }]),
);

const zeroKinds = (): KindSeconds => Object.fromEntries(ACTIVITY_KINDS.map((k) => [k, 0])) as KindSeconds;
const zeroCounts = (): Counts => Object.fromEntries(ACTIVITY_COUNTERS.map((c) => [c, 0])) as Counts;

const STATUS_ORDER: Record<ShlokaAnalyticsRow['status'], number> = { 'in-progress': 0, completed: 1, 'not-started': 2 };

export async function buildStudentAnalytics(user: UserDoc, rangeDays: number, tz: string): Promise<StudentAnalytics> {
  const userId = user._id as Types.ObjectId;
  const userIdStr = userId.toString();
  const now = new Date();
  const today = dayInZone(now, tz);
  const from = addDays(today, -(rangeDays - 1));
  const prevFrom = addDays(from, -rangeDays);
  const rangeStart = new Date(now.getTime() - rangeDays * DAY_MS);

  const availableFilter: Record<string, unknown> = { status: 'published' };
  if (user.allowedShlokas && user.allowedShlokas.length > 0) availableFilter._id = { $in: user.allowedShlokas };

  const [byDayHour, byShloka, sessionsByDevice, completions, available, firstBucket] = await Promise.all([
    ActivityBucket.aggregate<BucketSums & { _id: { day: string; hour: number } }>([
      { $match: { userId } },
      { $group: { _id: { day: '$day', hour: '$hour' }, ...sumFields } },
    ]),
    ActivityBucket.aggregate<
      BucketSums & { _id: Types.ObjectId; typeBestPct: number; firstActiveDay: string; lastActiveAt: Date }
    >([
      { $match: { userId, shlokaId: { $ne: null } } },
      {
        $group: {
          _id: '$shlokaId',
          ...sumFields,
          typeBestPct: { $max: '$typeBestPct' },
          firstActiveDay: { $min: '$day' },
          lastActiveAt: { $max: '$updatedAt' },
        },
      },
    ]),
    ActivitySession.aggregate<{
      _id: keyof Devices;
      sessions: number;
      rangeSessions: number;
      rangeSeconds: number;
      firstAt: Date;
      lastAt: Date;
    }>([
      { $match: { userId } },
      {
        $group: {
          _id: '$device',
          sessions: { $sum: 1 },
          rangeSessions: { $sum: { $cond: [{ $gte: ['$lastSeenAt', rangeStart] }, 1, 0] } },
          rangeSeconds: { $sum: { $cond: [{ $gte: ['$lastSeenAt', rangeStart] }, '$totalSeconds', 0] } },
          firstAt: { $min: '$startedAt' },
          lastAt: { $max: '$lastSeenAt' },
        },
      },
    ]),
    ShlokaCompletion.find({ userId }).lean(),
    Shloka.find(availableFilter, { slug: 1, title: 1 }).sort({ createdAt: 1 }).lean(),
    ActivityBucket.findOne({}, { day: 1 }).sort({ day: 1 }).lean(),
  ]);

  // ── Time series, study pattern, activity mix ──────────────────────────
  let totalSeconds = 0;
  let rangeSeconds = 0;
  let prevRangeSeconds = 0;
  const secondsByDay = new Map<string, number>();
  const hourly = new Array<number>(24).fill(0);
  const weekday = new Array<number>(7).fill(0);
  const activity = zeroKinds();
  const actions = zeroCounts();
  for (const g of byDayHour) {
    const { day, hour } = g._id;
    totalSeconds += g.totalSeconds;
    secondsByDay.set(day, (secondsByDay.get(day) ?? 0) + g.totalSeconds);
    if (day >= from) {
      rangeSeconds += g.totalSeconds;
      hourly[hour] += g.totalSeconds;
      weekday[weekdayIndex(day)] += g.totalSeconds;
      for (const k of ACTIVITY_KINDS) activity[k] += g[`${k}Seconds`];
      for (const c of ACTIVITY_COUNTERS) actions[c] += g[c];
    } else if (day >= prevFrom) {
      prevRangeSeconds += g.totalSeconds;
    }
  }
  const activeDayList = [...secondsByDay].filter(([, s]) => s >= ACTIVE_DAY_MIN_SECONDS).map(([d]) => d);
  const { current: currentStreak, longest: longestStreak } = streaks(activeDayList, today);

  // ── Sessions + devices ────────────────────────────────────────────────
  const devices: Devices = { mobile: 0, tablet: 0, desktop: 0 };
  let sessions = 0;
  let rangeSessions = 0;
  let rangeSessionSeconds = 0;
  let firstActiveAt: Date | null = null;
  let lastActiveAt: Date | null = null;
  for (const d of sessionsByDevice) {
    devices[d._id] = Math.round(d.rangeSeconds);
    sessions += d.sessions;
    rangeSessions += d.rangeSessions;
    rangeSessionSeconds += d.rangeSeconds;
    if (!firstActiveAt || d.firstAt < firstActiveAt) firstActiveAt = d.firstAt;
    if (!lastActiveAt || d.lastAt > lastActiveAt) lastActiveAt = d.lastAt;
  }

  // ── Per-shloka rows ───────────────────────────────────────────────────
  const availableIds = new Set(available.map((s) => s._id.toString()));
  const activityById = new Map(byShloka.map((g) => [g._id.toString(), g]));
  const completionById = new Map(completions.map((c) => [c.shlokaId.toString(), c]));
  const extraIds = [...new Set([...activityById.keys(), ...completionById.keys()])].filter((id) => !availableIds.has(id));
  const extra = extraIds.length > 0 ? await Shloka.find({ _id: { $in: extraIds } }, { slug: 1, title: 1 }).lean() : [];

  const allCompletions =
    completionById.size > 0
      ? await ShlokaCompletion.find({ shlokaId: { $in: [...completionById.keys()] } }).lean()
      : [];
  const completionsByShloka = new Map<string, typeof allCompletions>();
  for (const c of allCompletions) {
    const key = c.shlokaId.toString();
    const arr = completionsByShloka.get(key);
    if (arr) arr.push(c);
    else completionsByShloka.set(key, [c]);
  }

  const shlokas: ShlokaAnalyticsRow[] = [...available, ...extra].map((s) => {
    const id = s._id.toString();
    const a = activityById.get(id);
    const c = completionById.get(id);
    const all = completionsByShloka.get(id) ?? [];
    const spent = a?.totalSeconds ?? 0;
    return {
      shlokaId: id,
      slug: s.slug,
      title: s.title,
      status: c ? 'completed' : spent > 0 ? 'in-progress' : 'not-started',
      available: availableIds.has(id),
      totalSeconds: Math.round(spent),
      listeningSeconds: Math.round(a?.listeningSeconds ?? 0),
      readingSeconds: Math.round(a?.readingSeconds ?? 0),
      practiceSeconds: Math.round((a?.typingSeconds ?? 0) + (a?.drawingSeconds ?? 0) + (a?.arrangingSeconds ?? 0)),
      audioPlays: a?.audioPlays ?? 0,
      audioCompletes: a?.audioCompletes ?? 0,
      meaningPlays: a?.meaningPlays ?? 0,
      typeChecks: a?.typeChecks ?? 0,
      typeBestPct: Math.round(a?.typeBestPct ?? 0),
      arrangeChecks: a?.arrangeChecks ?? 0,
      arrangeSolves: a?.arrangeSolves ?? 0,
      firstActiveDay: a?.firstActiveDay ?? null,
      lastActiveAt: a ? a.lastActiveAt.toISOString() : null,
      completion: c
        ? {
            completedAt: (c.completedAt as Date).toISOString(),
            attempts: c.attempts,
            elapsedSeconds: c.elapsedSeconds,
            rank: leaderboardPosition(all, userIdStr),
            totalCompletions: all.length,
          }
        : null,
    };
  });
  // Stable sort keeps catalog order among not-started rows.
  shlokas.sort((x, y) => {
    if (x.status !== y.status) return STATUS_ORDER[x.status] - STATUS_ORDER[y.status];
    if (x.status === 'in-progress') return y.totalSeconds - x.totalSeconds;
    if (x.status === 'completed') return y.completion!.completedAt.localeCompare(x.completion!.completedAt);
    return 0;
  });

  const inCatalog = shlokas.filter((r) => r.available);

  return {
    generatedAt: now.toISOString(),
    tz,
    today,
    trackingSince: firstBucket?.day ?? null,
    range: { days: rangeDays, from, to: today, prevFrom },
    user: {
      ...toPublicUser(user),
      lastLoginAt: user.lastLoginAt ? (user.lastLoginAt as Date).toISOString() : null,
    },
    summary: {
      totalSeconds: Math.round(totalSeconds),
      rangeSeconds: Math.round(rangeSeconds),
      prevRangeSeconds: Math.round(prevRangeSeconds),
      activeDays: activeDayList.filter((d) => d >= from).length,
      currentStreak,
      longestStreak,
      sessions,
      rangeSessions,
      avgSessionSeconds: rangeSessions > 0 ? Math.round(rangeSessionSeconds / rangeSessions) : 0,
      firstActiveAt: firstActiveAt ? firstActiveAt.toISOString() : null,
      lastActiveAt: lastActiveAt ? lastActiveAt.toISOString() : null,
      completed: inCatalog.filter((r) => r.status === 'completed').length,
      inProgress: inCatalog.filter((r) => r.status === 'in-progress').length,
      available: available.length,
      devices,
    },
    daily: daysBetween(from, today).map((day) => ({ day, seconds: Math.round(secondsByDay.get(day) ?? 0) })),
    hourly: hourly.map(Math.round),
    weekday: weekday.map(Math.round),
    activity: Object.fromEntries(ACTIVITY_KINDS.map((k) => [k, Math.round(activity[k])])) as KindSeconds,
    actions,
    shlokas,
  };
}
