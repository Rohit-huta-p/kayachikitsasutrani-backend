import { Router } from 'express';
import { z } from 'zod';
import { User } from '../models/User.js';
import { hashPassword, comparePassword, generateRandomPassword } from '../lib/password.js';
import { signSession } from '../lib/jwt.js';
import { setSessionCookie, clearSessionCookie } from '../lib/cookies.js';
import { toPublicUser } from '../lib/publicUser.js';
import { sendMail, isMailConfigured } from '../lib/mailer.js';
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

// Public access-request schema — note it has NO password field. The
// password is generated server-side and emailed to the admin reviewer.
const requestSignupSchema = z.object({
  email: z.string().email().toLowerCase(),
  name: z.string().min(1).max(100),
  age: z.number().int().min(1).max(150).optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  collegeName: z.string().max(200).optional(),
  course: z.string().max(200).optional(),
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

/**
 * Public access-request endpoint. The caller submits their profile (no
 * password) and the server:
 *   1. Generates a strong random password.
 *   2. Creates a student account hashed with that password.
 *   3. Emails the admin reviewer (SIGNUP_NOTIFY_EMAIL) the user's profile
 *      plus the generated password in plaintext, so the reviewer can vet
 *      the request and forward the credentials to the requester out of
 *      band if they decide to approve.
 *
 * The plaintext password is never written to the response, never logged,
 * and never returned to the requester — only the admin sees it.
 *
 * Admin role is never granted from this endpoint; the role is forced to
 * 'student' regardless of input.
 */
authRouter.post('/request-signup', async (req, res, next) => {
  try {
    const body = requestSignupSchema.parse(req.body);
    const existing = await User.findOne({ email: body.email });
    if (existing) {
      const code = existing.status === 'pending' ? 'REQUEST_PENDING' : 'EMAIL_TAKEN';
      const message =
        existing.status === 'pending'
          ? 'A request for this email is already awaiting review.'
          : 'Email already registered.';
      res.status(409).json({ error: { code, message } });
      return;
    }

    // Pending users get a throwaway random hash — long enough that nobody
    // can guess it, never returned anywhere, replaced when the admin
    // approves the request.
    const throwawayHash = await hashPassword(generateRandomPassword(48));
    const user = await User.create({
      email: body.email,
      passwordHash: throwawayHash,
      role: 'student',
      status: 'pending',
      name: body.name,
      age: body.age,
      gender: body.gender,
      collegeName: body.collegeName,
      course: body.course,
    });

    const e = env();
    const notifyTo = e.SIGNUP_NOTIFY_EMAIL;
    if (isMailConfigured() && notifyTo) {
      const adminUrl = `${e.FRONTEND_ORIGINS[0] ?? ''}/admin/access-requests`;
      const subject = `Chikitsa Sutra · access request from ${body.name}`;
      const lines = [
        `A new user has requested access to Chikitsa Sutra.`,
        ``,
        `Name:     ${body.name}`,
        `Email:    ${body.email}`,
        body.age ? `Age:      ${body.age}` : null,
        body.gender ? `Gender:   ${body.gender}` : null,
        body.collegeName ? `College:  ${body.collegeName}` : null,
        body.course ? `Course:   ${body.course}` : null,
        ``,
        `Review and approve in the admin panel:`,
        adminUrl,
        ``,
        `Submitted at: ${new Date().toISOString()}`,
      ].filter((l): l is string => l !== null);

      const html = `
        <div style="font-family:Georgia,serif;color:#1B1208;max-width:560px;">
          <h2 style="color:#A67C52;margin:0 0 12px;">Chikitsa Sutra · new access request</h2>
          <p>A new user has requested access. Review their details and approve in the admin panel.</p>
          <table style="border-collapse:collapse;margin:12px 0;">
            <tr><td style="padding:4px 12px 4px 0;color:#6B5436;">Name</td><td>${escapeHtml(body.name)}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#6B5436;">Email</td><td>${escapeHtml(body.email)}</td></tr>
            ${body.age ? `<tr><td style="padding:4px 12px 4px 0;color:#6B5436;">Age</td><td>${body.age}</td></tr>` : ''}
            ${body.gender ? `<tr><td style="padding:4px 12px 4px 0;color:#6B5436;">Gender</td><td>${escapeHtml(body.gender)}</td></tr>` : ''}
            ${body.collegeName ? `<tr><td style="padding:4px 12px 4px 0;color:#6B5436;">College</td><td>${escapeHtml(body.collegeName)}</td></tr>` : ''}
            ${body.course ? `<tr><td style="padding:4px 12px 4px 0;color:#6B5436;">Course</td><td>${escapeHtml(body.course)}</td></tr>` : ''}
          </table>
          <p style="margin-top:16px;">
            <a href="${escapeHtml(adminUrl)}" style="display:inline-block;background:#A67C52;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:bold;">
              Review in admin panel
            </a>
          </p>
          <p style="margin-top:16px;color:#6B5436;font-size:12px;">
            Submitted: ${new Date().toISOString()}
          </p>
        </div>`;

      try {
        await sendMail({
          to: notifyTo,
          subject,
          text: lines.join('\n'),
          html,
          replyTo: body.email,
        });
      } catch (mailErr) {
        // Mail failure should not block the request — the admin can still
        // see the entry in /admin/access-requests. Just log it.
        // eslint-disable-next-line no-console
        console.error('request-signup notification mail failed', mailErr);
      }
    }

    res.json({
      ok: true,
      message:
        'Request received. The administrator will review it and email you your login credentials.',
      requestId: user._id.toString(),
    });
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
    if (user.status === 'pending') {
      res.status(403).json({
        error: {
          code: 'REQUEST_PENDING',
          message:
            'Your access request is still awaiting administrator approval.',
        },
      });
      return;
    }
    // Use updateOne instead of user.save() to bypass full-doc validation.
    // Old user docs may have capitalized gender ("Male") from a prior signup
    // form, which the current lowercase-enum schema would reject on save.
    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
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
