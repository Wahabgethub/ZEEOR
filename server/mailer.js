// SMTP configuration + a send helper that can never break the request that triggered it.
// Works with any SMTP provider (Resend, SendGrid, Brevo, Gmail app password, your hosting's mail server…). No Firebase.
//
// Environment variables (put them in the server's .env — see EMAIL-SETUP.md):
//   SMTP_HOST, SMTP_PORT (default 587), SMTP_SECURE ("true" for port 465), SMTP_USER, SMTP_PASS
//   MAIL_FROM     e.g.  ZEEOR <no-reply@zeeor.shop>      (falls back to SMTP_USER)
//   OWNER_EMAILS  e.g.  owner1@zeeor.shop,owner2@zeeor.shop   (comma / semicolon / space separated, or a JSON array)
//   SITE_URL      e.g.  https://zeeor.shop                (used for links inside the emails)
import nodemailer from 'nodemailer';

const EMAIL_RE = /^[^\s@<>()[\],;:"\\]+@[^\s@<>()[\],;:"\\]+\.[^\s@<>()[\],;:"\\]{2,}$/;
export const isValidEmail = (value) => typeof value === 'string' && value.trim().length <= 254 && EMAIL_RE.test(value.trim());

// "a@x.com, b@x.com" | "a@x.com b@x.com" | '["a@x.com","b@x.com"]'  ->  ['a@x.com', 'b@x.com'] (valid, lower-cased, de-duplicated)
export function parseEmailList(raw) {
  if (!raw) return [];
  const text = String(raw).trim();
  let parts = [];
  if (text.startsWith('[')) { try { parts = JSON.parse(text); } catch { parts = []; } } else parts = text.split(/[,;\s]+/);
  if (!Array.isArray(parts)) return [];
  return [...new Set(parts.map((item) => String(item).trim().toLowerCase()).filter(isValidEmail))];
}
export const getOwnerEmails = () => parseEmailList(process.env.OWNER_EMAILS);
export const siteUrl = () => String(process.env.SITE_URL || 'https://zeeor.shop').replace(/\/+$/, '');

export function mailConfig() {
  const host = process.env.SMTP_HOST; const user = process.env.SMTP_USER; const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM || user;
  if (!host || !from) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  return { host, port, secure, auth: user ? { user, pass: pass || '' } : undefined, from };
}

let cached = { key: '', transport: null };
function getTransport(cfg) {
  const key = JSON.stringify([cfg.host, cfg.port, cfg.secure, cfg.auth?.user, cfg.auth?.pass]);
  if (cached.key !== key) {
    cached = { key, transport: nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: cfg.auth, pool: true, maxConnections: 3, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 }) };
  }
  return cached.transport;
}

let warned = false;
// Resolves to { ok, accepted?, rejected?, skipped?, error? } — never throws, so a mail problem can't fail an order or a listing.
export async function sendMail({ to, subject, html, text, replyTo }, { transport, from } = {}) {
  const recipients = [].concat(to || []).filter(isValidEmail);
  if (!recipients.length) return { ok: false, skipped: 'no-recipients' };
  const cfg = mailConfig();
  if (!transport && !cfg) {
    if (!warned) { warned = true; console.warn('[mail] SMTP is not configured (SMTP_HOST / MAIL_FROM missing) — email notifications are switched off.'); }
    return { ok: false, skipped: 'smtp-not-configured' };
  }
  try {
    const info = await (transport || getTransport(cfg)).sendMail({ from: from || cfg.from, to: recipients, subject, html, text, ...(replyTo && isValidEmail(replyTo) ? { replyTo } : {}) });
    const rejected = info.rejected || [];
    if (rejected.length) console.warn(`[mail] "${subject}" — ${rejected.length} recipient(s) rejected by the mail server`);
    return { ok: (info.accepted || []).length > 0, accepted: info.accepted || [], rejected };
  } catch (error) {
    console.error(`[mail] "${subject}" failed:`, error.message);
    return { ok: false, error: error.message };
  }
}
