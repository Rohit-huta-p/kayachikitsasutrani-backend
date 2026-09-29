import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * Engaged time + practice counters for one student, aggregated per local
 * day/hour and per shloka (`shlokaId: null` = time spent outside any shloka
 * page — home, library, profile). The student-side tracker flushes every
 * ~30s and each flush $inc's into these buckets, so an active student
 * produces only a handful of documents per hour.
 *
 * `day` / `hour` are in the student's own local time, as reported by their
 * device, so "when do they study" reads naturally without timezone math.
 */
const activityBucketSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    hour: { type: Number, required: true, min: 0, max: 23 },
    shlokaId: { type: Schema.Types.ObjectId, ref: 'Shloka', default: null },

    // Engaged seconds, split by what the student was doing. Each second is
    // attributed to exactly one activity, so these sum to `totalSeconds`.
    totalSeconds: { type: Number, default: 0 },
    listeningSeconds: { type: Number, default: 0 },
    readingSeconds: { type: Number, default: 0 },
    typingSeconds: { type: Number, default: 0 },
    drawingSeconds: { type: Number, default: 0 },
    arrangingSeconds: { type: Number, default: 0 },
    browsingSeconds: { type: Number, default: 0 },

    // Discrete actions.
    audioPlays: { type: Number, default: 0 },
    audioCompletes: { type: Number, default: 0 },
    meaningPlays: { type: Number, default: 0 },
    typeChecks: { type: Number, default: 0 },
    typeBestPct: { type: Number, default: 0 },
    arrangeChecks: { type: Number, default: 0 },
    arrangeSolves: { type: Number, default: 0 },
  },
  { timestamps: true },
);

activityBucketSchema.index({ userId: 1, day: 1, hour: 1, shlokaId: 1 }, { unique: true });
activityBucketSchema.index({ day: 1, userId: 1 });

export type ActivityBucketDoc = HydratedDocument<InferSchemaType<typeof activityBucketSchema>>;
export const ActivityBucket = model('ActivityBucket', activityBucketSchema);

export const ACTIVITY_KINDS = ['listening', 'reading', 'typing', 'drawing', 'arranging', 'browsing'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_COUNTERS = [
  'audioPlays',
  'audioCompletes',
  'meaningPlays',
  'typeChecks',
  'arrangeChecks',
  'arrangeSolves',
] as const;
export type ActivityCounter = (typeof ACTIVITY_COUNTERS)[number];
