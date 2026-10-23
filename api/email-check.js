// GET /api/email-check?token=<admin secret>[&sendto=<email>]
//
// Debug helper for "no email arrived". Reports which mail transport is
// configured in THIS runtime and whether the SMTP connect+auth handshake
// succeeds, so the dashboard logs are not the only way to see it.
//
//   - nothing is sent unless `sendto` is given (then one tiny test email)
//   - `token` must match the order-link secret (orderTokenSecret, or the
//     service_role key when the secret is unset) — server-only knowledge,
//     so this endpoint is inert to the public
//
// Remove this route once delivery is proven, or keep it; it does nothing
// without the admin token.

const { config } = require('../server/config');
const { sendJson } = require('../server/http');
const {
  sendEmail,
  isEmailConfigured,
  smtpConfigured,
  resendConfigured,
  verifySmtp,
} = require('../server/email');

function tokenMatches(token) {
  const secret = config.orderTokenSecret || config.supabaseServiceKey;
  if (!secret) return false;
  const a = Buffer.from(String(token || ''));
  const b = Buffer.from(secret);
  return a.length === b.length && a.equals(b);
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const token = String((req.query && req.query.token) || '');
  if (!tokenMatches(token)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  const report = {
    runtimeEnv: {
      emailConfiguredOverall: isEmailConfigured(),
      smtpConfigured: smtpConfigured(),
      resendConfigured: resendConfigured(),
      emailFromSet: Boolean(config.emailFrom),
      siteUrlSet: Boolean(config.siteUrl),
    },
  };

  try {
    if (smtpConfigured()) {
      report.smtp = await verifySmtp();
    }

    const sendto = String((req.query && req.query.sendto) || '').toLowerCase().trim();
    if (sendto && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sendto) && isEmailConfigured()) {
      try {
        const result = await sendEmail({
          to: sendto,
          subject: 'DearDev email-check ✅',
          html: '<p>This is a test email triggered from /api/email-check. If you can read this, the transport works.</p>',
        });
        report.testSend = { ok: true, result };
      } catch (e) {
        report.testSend = { ok: false, error: e.message };
      }
    }

    sendJson(res, 200, report);
  } catch (e) {
    sendJson(res, 500, { error: e.message, ...report });
  }
};
