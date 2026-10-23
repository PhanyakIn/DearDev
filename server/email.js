// Transactional email. Two transports, chosen automatically:
//   - SMTP (nodemailer) when SMTP_HOST/USER/PASS are set — works with a plain
//     Gmail account, no custom domain required.
//   - Resend HTTP API otherwise — kept for the day a real domain is verified
//     (a .vercel.app URL cannot be verified, so it cannot send to buyers).

const { config } = require('./config');
const { fetchWithTimeout } = require('./fetch');

// SMTP is slower than an HTTP API (DNS, TLS handshake, server greeting), so a
// first send can take a few seconds. The caps below keep a hung connection
// from holding a serverless request until the platform kills it.
const SMTP_CONNECT_TIMEOUT_MS = 10000;
const SMTP_SEND_TIMEOUT_MS = 15000;

let transporter = null;
let transporterTried = false;

function smtpConfigured() {
  return Boolean(config.smtpHost && config.smtpUser && config.smtpPass && config.emailFrom);
}

function resendConfigured() {
  return Boolean(config.resendApiKey && config.emailFrom);
}

function isEmailConfigured() {
  return smtpConfigured() || resendConfigured();
}

function getTransporter() {
  if (transporter || transporterTried) return transporter;
  transporterTried = true;
  try {
    // Lazy require: nodemailer is only touched when SMTP is actually enabled.
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort || 465,
      // 465 is implicit-TLS; 587 needs STARTTLS, which nodemailer negotiates.
      secure: Number(config.smtpPort || 465) === 465,
      auth: { user: config.smtpUser, pass: config.smtpPass },
      connectionTimeout: SMTP_CONNECT_TIMEOUT_MS,
      greetingTimeout: SMTP_CONNECT_TIMEOUT_MS,
      socketTimeout: SMTP_SEND_TIMEOUT_MS,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('email: nodemailer unavailable', e.message);
    transporter = null;
  }
  return transporter;
}

async function sendViaSmtp({ to, subject, html }) {
  const mailer = getTransporter();
  if (!mailer) throw new Error('SMTP transport unavailable');
  const send = new Promise((resolve, reject) => {
    mailer.sendMail({ from: config.emailFrom, to, subject, html }, (err, info) =>
      err ? reject(err) : resolve(info),
    );
  });
  const guard = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`smtp timeout after ${SMTP_SEND_TIMEOUT_MS}ms`)), SMTP_SEND_TIMEOUT_MS),
  );
  const info = await Promise.race([send, guard]);
  return { id: info && info.messageId };
}

// Diagnostic only: runs the SMTP connect+auth handshake without sending mail.
// Used by the (token-protected) /api/email-check debug route.
async function verifySmtp() {
  const mailer = getTransporter();
  if (!mailer) return { ok: false, error: 'transport unavailable (nodemailer missing)' };
  try {
    await mailer.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.code || e.message };
  }
}

async function sendEmail({ to, subject, html }) {
  if (!isEmailConfigured()) throw new Error('Email is not configured');
  if (smtpConfigured()) return sendViaSmtp({ to, subject, html });
  const res = await fetchWithTimeout(
    'https://api.resend.com/emails',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: config.emailFrom, to, subject, html }),
    },
    8000,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`resend ${res.status}: ${text}`);
  }
  return res.json();
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// downloadUrl  → the primary CTA. Points at the /download confirm page, not at
//                /api/download directly: link scanners prefetch GET URLs, and
//                that endpoint consumes quota on every request. Requiring a
//                second click inside the browser keeps the quota honest.
// orderUrl     → the order/success page, as a fallback and way to re-download.
async function sendDownloadEmail({ to, productName, licenseKey, downloadUrl, orderUrl, limit }) {
  const name = escapeHtml(productName);
  const key = escapeHtml(licenseKey);
  const url = escapeHtml(downloadUrl);
  const manage = escapeHtml(orderUrl || downloadUrl);
  const html = `
  <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;color:#111">
    <h2 style="margin:0 0 8px">Thank you for your purchase 🎉</h2>
    <p style="margin:0 0 16px;color:#444">You have successfully bought <strong>${name}</strong></p>
    <p style="margin:0 0 8px">Your license key:</p>
    <p style="font-size:20px;font-weight:700;letter-spacing:2px;background:#f3f4f6;border-radius:8px;padding:12px 16px;text-align:center">${key}</p>
    <p style="margin:24px 0 8px">
      <a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Download product</a>
    </p>
    <p style="margin:8px 0 0;color:#666;font-size:13px">The download link can be used up to ${limit} times — you can revisit the page after payment.</p>
    <p style="margin:8px 0 0;color:#666;font-size:13px">Lost the email? Check your Junk folder, or <a href="${manage}">open your order page</a> to download again.</p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
    <p style="color:#888;font-size:12px;margin:0">DearDev — thanks for supporting my work 😊</p>
  </div>`;
  return sendEmail({
    to,
    subject: `Your product is ready — ${productName}`,
    html,
  });
}

module.exports = {
  sendEmail,
  sendDownloadEmail,
  escapeHtml,
  isEmailConfigured,
  smtpConfigured,
  resendConfigured,
  verifySmtp,
};
