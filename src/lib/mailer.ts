import nodemailer from 'nodemailer';
import { setDefaultResultOrder } from 'node:dns';
import { env } from '../env.js';

// Render's outbound network has no IPv6 route, but smtp.gmail.com (and most
// SMTP hosts) resolve to an IPv6 address first — Node then tries IPv6 and
// fails with ENETUNREACH/ETIMEDOUT, hanging the request into a 502. Prefer
// IPv4 process-wide so all outbound connects use a reachable address.
setDefaultResultOrder('ipv4first');

let cachedTransporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (cachedTransporter) return cachedTransporter;
  const e = env();
  if (!e.SMTP_HOST || !e.SMTP_PORT || !e.SMTP_USER || !e.SMTP_PASS) return null;
  const opts = {
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_PORT === 465,
    auth: { user: e.SMTP_USER, pass: e.SMTP_PASS },
    connectionTimeout: 10_000, // fail fast (10s) instead of hanging into a 502
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
  // Force IPv4 at the socket level too (not in nodemailer's TS types, but
  // honored at runtime) — belt-and-suspenders with setDefaultResultOrder.
  (opts as { family?: number }).family = 4;
  cachedTransporter = nodemailer.createTransport(opts);
  return cachedTransporter;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export async function sendMail(msg: MailMessage): Promise<void> {
  const t = getTransporter();
  if (!t) {
    throw new Error('SMTP is not configured on this server.');
  }
  const e = env();
  await t.sendMail({
    from: e.SMTP_FROM ?? e.SMTP_USER,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
    replyTo: msg.replyTo,
  });
}

export function isMailConfigured(): boolean {
  return getTransporter() !== null;
}
