import { Router } from 'express';
import { mongoStateLabel } from '../db.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), mongoState: mongoStateLabel() });
});
