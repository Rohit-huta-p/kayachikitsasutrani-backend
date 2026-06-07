import { Schema, model, type InferSchemaType, type HydratedDocument, Types } from 'mongoose';

const wordTimingSchema = new Schema(
  {
    text: { type: String, required: true },
    start: { type: Number, required: true, min: 0 },
    end: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const lineSchema = new Schema(
  {
    sanskrit: { type: String, required: true, trim: true, minlength: 1, maxlength: 1000 },
    words: { type: [wordTimingSchema], default: [] },
    fullTimings: { type: [wordTimingSchema], default: [] },
  },
  { _id: false },
);

const assetSchema = new Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
  },
  { _id: false },
);

const audioSchema = new Schema(
  {
    full: { type: assetSchema, required: true },
    lines: { type: [assetSchema], default: [] },
  },
  { _id: false },
);

const shlokaSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
    meaning: { type: String, required: true, trim: true, minlength: 1, maxlength: 5000 },
    fullText: { type: String, trim: true, maxlength: 5000 },
    highlightWords: { type: [String], default: [] },
    caseStudy: { type: String, trim: true, maxlength: 5000 },
    reference: { type: String, trim: true, maxlength: 500 },
    status: { type: String, enum: ['draft', 'published'], required: true, default: 'draft', index: true },
    audio: { type: audioSchema, required: true },
    image: { type: assetSchema },
    lines: { type: [lineSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

shlokaSchema.index({ status: 1, createdAt: -1 });

export type ShlokaDoc = HydratedDocument<InferSchemaType<typeof shlokaSchema>>;

export const Shloka = model('Shloka', shlokaSchema);

export const ObjectId = Types.ObjectId;
