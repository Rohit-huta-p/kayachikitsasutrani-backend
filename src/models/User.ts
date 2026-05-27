import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['student', 'admin'], required: true, default: 'student' },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    age: { type: Number, min: 1, max: 150 },
    gender: { type: String, enum: ['male', 'female', 'other'] },
    collegeName: { type: String, trim: true, maxlength: 200 },
    course: { type: String, trim: true, maxlength: 200 },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;

export const User = model('User', userSchema);
