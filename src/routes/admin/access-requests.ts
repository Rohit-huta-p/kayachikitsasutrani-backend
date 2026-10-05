import { Router } from 'express';
import { User } from '../../models/User.js';
import { CredentialDelivery } from '../../models/CredentialDelivery.js';
import { hashPassword, generateRandomPassword } from '../../lib/password.js';
import { encryptSecret, decryptSecret, credentialCryptoReady } from '../../lib/credentialCrypto.js';
import { sendMail, isMailConfigured } from '../../lib/mailer.js';
import { env } from '../../env.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validateObjectId } from '../../middleware/validateObjectId.js';

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
  // ASCII-only subject so the mailto URI parses cleanly in every mail
  // client (some choke on multi-byte chars like "·" once they're
  // percent-encoded into the URL).
  const subject = 'Chikitsa Sutra - Your login credentials';
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
    `Chikitsa Sutra`,
  ].join('\n');
  // RFC 6068: the address part of a mailto URI is NOT percent-encoded the
  // same way query params are — leave the local-part and domain raw, only
  // encode the query string.
  const mailto =
    `mailto:${args.email}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;
  // Gmail web compose fallback — works in any browser without a registered
  // mailto: protocol handler. Opens Gmail in a new tab with the to /
  // subject / body fields pre-filled, ready to send.
  const gmailUrl =
    `https://mail.google.com/mail/?view=cm&fs=1` +
    `&to=${encodeURIComponent(args.email)}` +
    `&su=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;
  return { subject, body, mailto, gmailUrl };
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
adminAccessRequestsRouter.post('/:id/accept', validateObjectId('id', 'Request'), async (req, res, next) => {
  try {
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

    // Persist the credential so it stays on the Approved list from any device
    // (spec 2026-10-05). Best-effort — never fail an approval over this.
    try {
      if (credentialCryptoReady()) {
        const sealed = encryptSecret(password);
        await CredentialDelivery.findOneAndUpdate(
          { userId: user._id },
          {
            $set: {
              email: user.email,
              name: user.name,
              passwordCiphertext: sealed.ciphertext,
              passwordIv: sealed.iv,
              passwordTag: sealed.tag,
              approvedByAdminId: req.user?.id,
              approvedAt: new Date(),
              deliveredAt: null,
              revealedCount: 0,
              lastRevealedAt: null,
            },
          },
          { upsert: true },
        );
      } else {
        console.warn(`[access-requests] CREDENTIAL_ENC_KEY unset — credential for ${user._id} not stored`);
      }
    } catch (err) {
      console.error('[access-requests] failed to persist approved credential', err);
    }

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
      gmailUrl: email.gmailUrl,
      loginUrl,
    });
  } catch (err) {
    next(err);
  }
});

// Reject a pending request — deletes the user record entirely so the
// email can be used to submit a fresh request later if needed.
adminAccessRequestsRouter.post('/:id/reject', validateObjectId('id', 'Request'), async (req, res, next) => {
  try {
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

// List approved accounts that still have a stored credential, newest first.
// Decrypts the password for the authenticated admin and rebuilds fresh email
// links. `password` is null when purged, undecryptable, or the key is absent.
adminAccessRequestsRouter.get('/approved', async (_req, res, next) => {
  try {
    const deliveries = await CredentialDelivery.find().sort({ approvedAt: -1, _id: -1 });
    const users = await User.find({ _id: { $in: deliveries.map((d) => d.userId) } }).lean();
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const e = env();
    const origin = e.FRONTEND_ORIGINS[0] ?? '';
    const loginUrl = origin ? `${origin}/login` : '/login';

    const revealed: string[] = [];
    const items = deliveries.map((d) => {
      const u = userMap.get(d.userId.toString());
      let password: string | null = null;
      if (d.passwordCiphertext && d.passwordIv && d.passwordTag && credentialCryptoReady()) {
        try {
          password = decryptSecret({ ciphertext: d.passwordCiphertext, iv: d.passwordIv, tag: d.passwordTag });
          revealed.push(d._id.toString());
        } catch {
          password = null; // e.g. key rotated — treat as unavailable
        }
      }
      const links = password ? buildAcceptanceEmail({ name: d.name, email: d.email, password, loginUrl }) : null;
      return {
        id: d.userId.toString(),
        name: u?.name ?? d.name,
        email: u?.email ?? d.email,
        age: u?.age ?? undefined,
        gender: u?.gender ?? undefined,
        collegeName: u?.collegeName ?? undefined,
        course: u?.course ?? undefined,
        approvedAt: ((d.approvedAt as Date) ?? new Date()).toISOString(),
        deliveredAt: d.deliveredAt ? (d.deliveredAt as Date).toISOString() : null,
        password,
        loginUrl,
        mailtoSubject: links?.subject,
        mailtoBody: links?.body,
        mailto: links?.mailto,
        gmailUrl: links?.gmailUrl,
      };
    });

    if (revealed.length > 0) {
      await CredentialDelivery.updateMany(
        { _id: { $in: revealed } },
        { $inc: { revealedCount: 1 }, $set: { lastRevealedAt: new Date() } },
      );
    }

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// Purge the stored credential (does NOT deactivate the student). Idempotent.
adminAccessRequestsRouter.delete('/approved/:id', validateObjectId('id', 'Credential'), async (req, res, next) => {
  try {
    await CredentialDelivery.deleteOne({ userId: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Mint a fresh password for an active student; re-hash, re-store (encrypted),
// and return it once with email links — same shape as accept.
adminAccessRequestsRouter.post('/:id/regenerate', validateObjectId('id', 'Request'), async (req, res, next) => {
  try {
    const user = await User.findOne({ _id: req.params.id, status: 'active', role: 'student' });
    if (!user) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Active student not found' } });
      return;
    }
    const password = generateRandomPassword(14);
    const passwordHash = await hashPassword(password);
    await User.updateOne({ _id: user._id }, { $set: { passwordHash } });

    const e = env();
    const origin = e.FRONTEND_ORIGINS[0] ?? '';
    const loginUrl = origin ? `${origin}/login` : '/login';
    const emailMsg = buildAcceptanceEmail({ name: user.name, email: user.email, password, loginUrl });

    try {
      if (credentialCryptoReady()) {
        const sealed = encryptSecret(password);
        await CredentialDelivery.findOneAndUpdate(
          { userId: user._id },
          {
            $set: {
              email: user.email,
              name: user.name,
              passwordCiphertext: sealed.ciphertext,
              passwordIv: sealed.iv,
              passwordTag: sealed.tag,
              approvedByAdminId: req.user?.id,
              approvedAt: new Date(),
              deliveredAt: null,
              revealedCount: 0,
              lastRevealedAt: null,
            },
          },
          { upsert: true },
        );
      }
    } catch (err) {
      console.error('[access-requests] failed to persist regenerated credential', err);
    }

    res.json({
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      password,
      mailtoSubject: emailMsg.subject,
      mailtoBody: emailMsg.body,
      mailto: emailMsg.mailto,
      gmailUrl: emailMsg.gmailUrl,
      loginUrl,
    });
  } catch (err) {
    next(err);
  }
});

// Email the credential directly via nodemailer (lib/mailer.ts).
adminAccessRequestsRouter.post('/approved/:id/send-email', validateObjectId('id', 'Credential'), async (req, res, next) => {
  try {
    if (!isMailConfigured()) {
      res.status(503).json({ error: { code: 'SMTP_NOT_CONFIGURED', message: 'Email is not configured on the server' } });
      return;
    }
    const d = await CredentialDelivery.findOne({ userId: req.params.id });
    if (!d || !d.passwordCiphertext || !d.passwordIv || !d.passwordTag || !credentialCryptoReady()) {
      res.status(409).json({ error: { code: 'CREDENTIAL_UNAVAILABLE', message: 'No stored password — regenerate first' } });
      return;
    }
    let password: string;
    try {
      password = decryptSecret({ ciphertext: d.passwordCiphertext, iv: d.passwordIv, tag: d.passwordTag });
    } catch {
      res.status(409).json({ error: { code: 'CREDENTIAL_UNAVAILABLE', message: 'Stored password could not be read' } });
      return;
    }
    const e = env();
    const origin = e.FRONTEND_ORIGINS[0] ?? '';
    const loginUrl = origin ? `${origin}/login` : '/login';
    const msg = buildAcceptanceEmail({ name: d.name, email: d.email, password, loginUrl });
    await sendMail({ to: d.email, subject: msg.subject, text: msg.body });
    const deliveredAt = new Date();
    await CredentialDelivery.updateOne({ _id: d._id }, { $set: { deliveredAt } });
    res.json({ ok: true, deliveredAt: deliveredAt.toISOString() });
  } catch (err) {
    next(err);
  }
});
