import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

const shlokaCompletionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    shlokaId: { type: Schema.Types.ObjectId, ref: 'Shloka', required: true },
    completedAt: { type: Date, required: true },
    attempts: { type: Number, required: true, min: 1, max: 1000 },
    elapsedSeconds: { type: Number, required: true, min: 0, max: 86400 },
  },
  { timestamps: true },
);

shlokaCompletionSchema.index({ userId: 1, shlokaId: 1 }, { unique: true });
shlokaCompletionSchema.index({ shlokaId: 1, completedAt: 1 });

export type ShlokaCompletionDoc = HydratedDocument<InferSchemaType<typeof shlokaCompletionSchema>>;
export const ShlokaCompletion = model('ShlokaCompletion', shlokaCompletionSchema);
