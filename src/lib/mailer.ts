import nodemailer from 'nodemailer';
import { env } from '../env.js';

let cachedTransporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (cachedTransporter) return cachedTransporter;
  const e = env();
  if (!e.SMTP_HOST || !e.SMTP_PORT || !e.SMTP_USER || !e.SMTP_PASS) return null;
  cachedTransporter = nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_PORT === 465,
    auth: { user: e.SMTP_USER, pass: e.SMTP_PASS },
  });
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
