// Transactional email via Resend HTTP API.

const { config } = require('./config');
const { fetchWithTimeout } = require('./fetch');

function isEmailConfigured() {
  return Boolean(config.resendApiKey && config.emailFrom);
}

async function sendEmail({ to, subject, html }) {
  if (!isEmailConfigured()) throw new Error('Email is not configured');
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

async function sendDownloadEmail({ to, productName, licenseKey, downloadUrl, limit }) {
  const name = escapeHtml(productName);
  const key = escapeHtml(licenseKey);
  const url = escapeHtml(downloadUrl);
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
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
    <p style="color:#888;font-size:12px;margin:0">DearDev — thanks for supporting my work 😊</p>
  </div>`;
  return sendEmail({
    to,
    subject: `Your product is ready — ${productName}`,
    html,
  });
}

module.exports = { sendEmail, sendDownloadEmail, escapeHtml, isEmailConfigured };
