import { Router } from 'express';
import { z } from 'zod';
import { User } from '../models/User.js';
import { hashPassword, comparePassword } from '../lib/password.js';
import { signSession } from '../lib/jwt.js';
import { setSessionCookie, clearSessionCookie } from '../lib/cookies.js';
import { toPublicUser } from '../lib/publicUser.js';
import { env } from '../env.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const authRouter = Router();

const signupSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(100),
  age: z.number().int().min(1).max(150).optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  collegeName: z.string().max(200).optional(),
  course: z.string().max(200).optional(),
});

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1).max(200),
});

authRouter.post('/signup', async (req, res, next) => {
  try {
    const body = signupSchema.parse(req.body);
    const existing = await User.findOne({ email: body.email });
    if (existing) {
      res.status(409).json({ error: { code: 'EMAIL_TAKEN', message: 'Email already registered' } });
      return;
    }
    const passwordHash = await hashPassword(body.password);
    const user = await User.create({
      email: body.email,
      passwordHash,
      role: 'student',
      name: body.name,
      age: body.age,
      gender: body.gender,
      collegeName: body.collegeName,
      course: body.course,
    });
    const e = env();
    const token = signSession(user._id.toString(), e.JWT_SECRET);
    setSessionCookie(res, token, e.NODE_ENV === 'production');
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const user = await User.findOne({ email: body.email });
    const invalid = () => res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } });
    if (!user) {
      // Still hash to mitigate timing side channels
      await hashPassword(body.password);
      invalid();
      return;
    }
    const ok = await comparePassword(body.password, user.passwordHash);
    if (!ok) {
      invalid();
      return;
    }
    user.lastLoginAt = new Date();
    await user.save();
    const e = env();
    const token = signSession(user._id.toString(), e.JWT_SECRET);
    setSessionCookie(res, token, e.NODE_ENV === 'production');
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', requireAuth, (req, res) => {
  clearSessionCookie(res, env().NODE_ENV === 'production');
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
