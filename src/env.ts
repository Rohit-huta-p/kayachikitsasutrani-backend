import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().regex(/^\d+$/).transform(Number),
  MONGO_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  FRONTEND_ORIGIN: z.string().min(1),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(8),
  ADMIN_NAME: z.string().min(1),
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
});

export type Env = z.infer<typeof schema> & { FRONTEND_ORIGINS: string[] };

export function parseEnv(source: NodeJS.ProcessEnv | Record<string, string | undefined>): Env {
  const parsed = schema.parse(source);
  return {
    ...parsed,
    FRONTEND_ORIGINS: parsed.FRONTEND_ORIGIN.split(',').map(s => s.trim()).filter(Boolean),
  };
}

let cached: Env | null = null;
export function env(): Env {
  if (cached) return cached;
  cached = parseEnv(process.env);
  return cached;
}
