import type { UserDoc } from '../models/User.js';

export interface PublicUser {
  id: string;
  email: string;
  role: 'student' | 'admin';
  name: string;
  age?: number;
  gender?: 'male' | 'female' | 'other';
  collegeName?: string;
  course?: string;
  createdAt: string;
}

export function toPublicUser(doc: UserDoc): PublicUser {
  return {
    id: doc._id.toString(),
    email: doc.email,
    role: doc.role as 'student' | 'admin',
    name: doc.name,
    age: doc.age ?? undefined,
    gender: (doc.gender as 'male' | 'female' | 'other' | undefined) ?? undefined,
    collegeName: doc.collegeName ?? undefined,
    course: doc.course ?? undefined,
    createdAt: (doc.createdAt as Date).toISOString(),
  };
}
