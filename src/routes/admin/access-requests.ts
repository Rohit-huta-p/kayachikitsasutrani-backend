import { Router } from 'express';
import { Types } from 'mongoose';
import { User } from '../../models/User.js';
import { hashPassword, generateRandomPassword } from '../../lib/password.js';
import { env } from '../../env.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';

export const adminAccessRequestsRouter = Router();

adminAccessRequestsRouter.use(requireAuth, requireRole('admin'));

// Build the email a reviewer can send to the requester once accepted. The
// mailto link is server-side so the templating lives in one place; the
// admin UI just needs to use `window.location.href = mailto`.
function buildAcceptanceEmail(args: {
  name: string;
  email: string;
  password: string;
  loginUrl: string;
}) {
  const subject = 'Chikitsa Sutra · Your login credentials';
  const body = [
    `Hello ${args.name},`,
    ``,
    `Your request to join Chikitsa Sutra has been approved.`,
    ``,
    `You can sign in here: ${args.loginUrl}`,
    ``,
    `  Email:    ${args.email}`,
    `  Password: ${args.password}`,
    ``,
    `After your first sign-in, please update your password from your profile.`,
    ``,
    `Welcome aboard.`,
    `— Chikitsa Sutra`,
  ].join('\n');
  const mailto =
    `mailto:${encodeURIComponent(args.email)}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;
  return { subject, body, mailto };
}

// List pending access requests, newest first.
adminAccessRequestsRouter.get('/', async (req, res, next) => {
  try {
    const docs = await User.find({ status: 'pending', role: 'student' })
      .sort({ createdAt: -1, _id: -1 })
      .lean();
    const items = docs.map((d) => ({
      id: d._id.toString(),
      name: d.name,
      email: d.email,
      age: d.age ?? undefined,
      gender: d.gender ?? undefined,
      collegeName: d.collegeName ?? undefined,
      course: d.course ?? undefined,
      createdAt: ((d.createdAt as Date) ?? new Date()).toISOString(),
    }));
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// Approve a pending request:
//   - Generate a fresh random password.
//   - Replace the user's throwaway hash with the real one.
//   - Flip the user from 'pending' to 'active'.
//   - Return the plaintext password ONCE, plus a pre-built mailto link
//     and subject/body so the admin UI can render a "copy" + "send email"
//     pair without re-templating client-side.
adminAccessRequestsRouter.post('/:id/accept', async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Request not found' } });
      return;
    }
    const user = await User.findOne({ _id: req.params.id, status: 'pending' });
    if (!user) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Request not found' } });
      return;
    }
    const password = generateRandomPassword(14);
    const passwordHash = await hashPassword(password);
    await User.updateOne(
      { _id: user._id },
      { $set: { passwordHash, status: 'active' } },
    );

    const e = env();
    const origin = e.FRONTEND_ORIGINS[0] ?? '';
    const loginUrl = origin ? `${origin}/login` : '/login';
    const email = buildAcceptanceEmail({
      name: user.name,
      email: user.email,
      password,
      loginUrl,
    });

    res.json({
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      password,
      mailtoSubject: email.subject,
      mailtoBody: email.body,
      mailto: email.mailto,
      loginUrl,
    });
  } catch (err) {
    next(err);
  }
});

// Reject a pending request — deletes the user record entirely so the
// email can be used to submit a fresh request later if needed.
adminAccessRequestsRouter.post('/:id/reject', async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Request not found' } });
      return;
    }
    const result = await User.deleteOne({ _id: req.params.id, status: 'pending' });
    if (result.deletedCount === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Request not found' } });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
