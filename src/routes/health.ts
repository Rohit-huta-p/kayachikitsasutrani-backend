import { Router } from 'express';
import { mongoStateLabel } from '../db';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), mongoState: mongoStateLabel() });
});
