import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * One study session = one browser tab's visit, rotated by the client after
 * 30 minutes without engagement. Used for session counts / average length,
 * device mix, and to cap how many seconds a single flush may claim.
 */
const activitySessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sessionId: { type: String, required: true },
    device: { type: String, enum: ['mobile', 'tablet', 'desktop'], required: true },
    startedAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    totalSeconds: { type: Number, default: 0 },
  },
  { timestamps: true },
);

activitySessionSchema.index({ userId: 1, sessionId: 1 }, { unique: true });
activitySessionSchema.index({ userId: 1, lastSeenAt: -1 });

export type ActivitySessionDoc = HydratedDocument<InferSchemaType<typeof activitySessionSchema>>;
export const ActivitySession = model('ActivitySession', activitySessionSchema);
