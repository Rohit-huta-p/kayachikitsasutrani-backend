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
    bookmarks: { type: [Schema.Types.ObjectId], ref: 'Shloka', default: [] },
    // Empty array = access ALL published shlokas (default).
    // Non-empty = restrict to only these shloka IDs.
    allowedShlokas: { type: [Schema.Types.ObjectId], ref: 'Shloka', default: [] },
    // 'pending' = access request awaiting admin approval; passwordHash is
    // a throwaway random value and the user cannot log in.
    // 'active'  = approved, real password set by admin, user can log in.
    status: { type: String, enum: ['pending', 'active'], default: 'active', index: true },
  },
  { timestamps: true },
);

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;

export const User = model('User', userSchema);
