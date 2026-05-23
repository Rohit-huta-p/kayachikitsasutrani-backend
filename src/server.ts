import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './env.js';
import { connectDb } from './db.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { errorHandler } from './middleware/errorHandler.js';

export function buildApp(): express.Express {
  const app = express();
  const e = env();

  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true); // server-to-server / curl
        if (e.FRONTEND_ORIGINS.includes(origin)) return cb(null, true);
        cb(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type'],
    }),
  );

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
  app.use(errorHandler);

  return app;
}

async function main(): Promise<void> {
  const e = env();
  await connectDb(e.MONGO_URI);
  const app = buildApp();
  app.listen(e.PORT, () => {
    console.log(`shloka-backend listening on :${e.PORT}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
