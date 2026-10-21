// POST /api/verify-slip  { orderId, token, slip: { imageBase64, imageMime } }
// Verifies the payment slip with SlipOK, applies our own checks, and — on
// success — marks the order paid, issues a license key and optionally emails
// the buyer (email is optional; the success page is always the source of truth).
//
// Security rules:
//   - the success/download token must match the order
//   - amount, bank reference and transaction time are checked fail-closed
//   - a slip can be retried until MAX_VERIFY_ATTEMPTS, then the order closes
//   - each attempt is reserved atomically before SlipOK is called, so parallel
//     requests cannot burn more credits than the cap allows
//   - the same bank reference can never pay two orders (unique slip_ref index)

const { rest } = require('../server/supabase');
const { readJsonBody, sendJson, sendServerError } = require('../server/http');
const { config } = require('../server/config');
const { verifySlip, describeCode } = require('../server/payments/slipok');
const { evaluateSlip } = require('../server/payments/rules');
const { generateLicenseKey } = require('../server/license');
const { sendDownloadEmail, isEmailConfigured } = require('../server/email');
const { orderToken, tokenMatches } = require('../server/orderToken');
const { checkRateLimit, clientIp } = require('../server/rateLimit');
const promptpay = require('../server/payments/promptpay');

const ORDER_COLUMNS =
  'id,product_id,email,amount,currency,status,license_key,download_count,created_at,qr_expires_at,slip_payload';

const RESERVE_TRIES = 4;
const PAID_PATCH_TRIES = 3;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOrder(orderId) {
  const rows = await rest(
    `orders?select=${ORDER_COLUMNS}&id=eq.${encodeURIComponent(orderId)}&limit=1`,
  );
  return rows && rows[0];
}

async function fetchProduct(productId) {
  if (!productId) return {};
  const rows = await rest(
    `products?select=name,file_path&id=eq.${encodeURIComponent(productId)}&limit=1`,
  );
  return (rows && rows[0]) || {};
}

function attemptCount(order) {
  const payload = order && order.slip_payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const value = Number(payload.attempts);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

// Compare-and-swap filter on the attempt counter. If two requests read the
// same order at the same time, only one PATCH can match this filter.
function attemptFilter(order) {
  const payload = order && order.slip_payload;
  if (
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    payload.attempts != null &&
    Number.isFinite(Number(payload.attempts))
  ) {
    return `slip_payload->>attempts=eq.${Number(payload.attempts)}`;
  }
  return 'slip_payload->>attempts=is.null';
}

async function reserveAttempt(order) {
  const current = attemptCount(order);
  const payload =
    order.slip_payload && typeof order.slip_payload === 'object' && !Array.isArray(order.slip_payload)
      ? order.slip_payload
      : {};
  const next = { ...payload, attempts: current + 1, lastAttemptAt: new Date().toISOString() };

  const rows = await rest(
    `orders?id=eq.${encodeURIComponent(order.id)}&status=eq.pending&${attemptFilter(order)}`,
    {
      method: 'PATCH',
      prefer: 'return=representation',
      body: { slip_payload: next },
    },
  );
  if (!rows || !rows[0]) return null;
  return { ...order, ...rows[0], slip_payload: next };
}

// Close an order after a terminal outcome. Do NOT rewrite slip_payload here:
// another request may have already advanced the attempt counter, and merging a
// stale copy would undercount it. The counter was advanced atomically before
// SlipOK was called; status is the only thing that needs to change now.
async function finishAttempt(order, { status } = {}) {
  if (!status) return;
  try {
    await rest(`orders?id=eq.${encodeURIComponent(order.id)}&status=eq.pending`, {
      method: 'PATCH',
      body: { status },
    });
  } catch (e) {
    // Bookkeeping must not hide the buyer's real result. The attempt was already
    // reserved; the order stays pending and can be retried or handled manually.
    // eslint-disable-next-line no-console
    console.error('verify-slip: could not close order', order.id, e.message);
  }
}

function sendPaid(res, order) {
  sendJson(res, 200, {
    status: 'paid',
    licenseKey: order.license_key,
    downloadLimit: config.downloadLimit,
    remaining: Math.max(config.downloadLimit - Number(order.download_count || 0), 0),
  });
}

function tooManyAttempts(res) {
  sendJson(res, 422, {
    status: 'rejected',
    code: 1029,
    message: 'Too many verification attempts for this order. Please contact the shop with your slip.',
  });
}

function base64Bytes(base64) {
  return Math.ceil((String(base64 || '').length * 3) / 4);
}

// Public base URL for links in emails. On Vercel x-forwarded-* is reliable;
// this also protects against a forgotten/old SITE_URL pointing at localhost.
function siteBaseUrl(req) {
  const configured = (config.siteUrl || '').replace(/\/$/, '');
  if (configured && !/^http:\/\/localhost(:\d+)?$/i.test(configured)) return configured;

  const headers = (req && req.headers) || {};
  const proto = String(headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim();
  if (host) return `${proto}://${host}`;
  return configured;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid body' });
    return;
  }

  const orderId = String(body.orderId || '').trim();
  if (!orderId) return sendJson(res, 400, { error: 'Missing orderId' });

  // The token is the second secret for an order. Without it, someone who only
  // learns the order id cannot submit slips or read the licence/download link.
  let tokenOk = false;
  try {
    tokenOk = tokenMatches(orderId, body.token);
  } catch (e) {
    sendServerError(res, e, 'verify-slip token');
    return;
  }
  if (!tokenOk) {
    return sendJson(res, 403, { error: 'Invalid or missing order link.' });
  }

  const slip = body.slip && typeof body.slip === 'object' ? body.slip : {};
  const hasImage = typeof slip.imageBase64 === 'string' && slip.imageBase64.length > 0;
  const hasData = typeof slip.data === 'string' && slip.data.length > 0;
  const hasUrl = typeof slip.url === 'string' && slip.url.length > 0;

  if (!hasImage && !hasData && !hasUrl) {
    return sendJson(res, 400, { error: 'Missing slip' });
  }

  // Production only accepts an uploaded image. data/url are a dev convenience
  // and must be explicitly enabled; they bypass the image-size path.
  if (!config.allowSlipData && !hasImage) {
    return sendJson(res, 400, { error: 'Please upload a slip image.' });
  }

  if (hasImage && base64Bytes(slip.imageBase64) > config.maxSlipBytes) {
    return sendJson(res, 413, {
      status: 'pending',
      code: 1020,
      message: 'That slip image is too large. Please upload a smaller photo.',
    });
  }
  if (hasData && base64Bytes(slip.data) > config.maxSlipBytes) {
    return sendJson(res, 413, {
      status: 'pending',
      code: 1020,
      message: 'That slip is too large. Please upload a smaller photo.',
    });
  }
  if (hasUrl && (!/^https:\/\//i.test(slip.url) || slip.url.length > 2048)) {
    return sendJson(res, 400, { error: 'Invalid slip URL.' });
  }

  try {
    let order = await fetchOrder(orderId);
    if (!order) return sendJson(res, 404, { error: 'Order not found' });

    // Idempotent: already fulfilled.
    if (order.status === 'paid') return sendPaid(res, order);
    if (order.status !== 'pending') {
      return sendJson(res, 409, { status: order.status, error: 'Order is not payable' });
    }

    // Payment window: the QR countdown is a UX hint; a buyer who already
    // transferred must still be able to claim their product during grace.
    const expiresAt = order.qr_expires_at ? new Date(order.qr_expires_at).getTime() : 0;
    if (expiresAt && Date.now() > expiresAt + config.qrGraceMinutes * 60 * 1000) {
      await finishAttempt(order, { status: 'expired' });
      return sendJson(res, 410, {
        status: 'expired',
        code: 1015,
        message:
          'This payment window has closed. If you have already paid, please contact the shop with your slip.',
      });
    }

    // Per-IP guard. Every verification that reaches SlipOK costs a credit, so
    // cap how many verifications one network can start inside the window.
    // This runs before the attempt is reserved: a blocked request must not
    // consume an attempt or spend a credit.
    const ip = clientIp(req);
    if (ip) {
      const verdict = await checkRateLimit({
        bucket: 'verify-slip',
        ip,
        limit: config.verifyMaxPerIp,
        windowSeconds: config.rateLimitWindowSeconds,
      });
      if (!verdict.allowed) {
        return sendJson(res, 429, {
          status: 'pending',
          code: 1029,
          message:
            'Too many verification attempts from this network. Please wait a few minutes and try again.',
          retryable: true,
          retryAfterSeconds: verdict.retryAfterSeconds,
        });
      }
    }

    // Reserve the attempt before spending a SlipOK credit. The PATCH is a
    // compare-and-swap on slip_payload.attempts, so parallel requests cannot
    // all pass the cap. Retry a few times if another request won the race.
    let reserved = null;
    for (let i = 0; i < RESERVE_TRIES; i += 1) {
      if (i > 0) {
        order = await fetchOrder(orderId);
        if (!order) return sendJson(res, 404, { error: 'Order not found' });
        if (order.status === 'paid') return sendPaid(res, order);
        if (order.status !== 'pending') {
          return sendJson(res, 409, { status: order.status, error: 'Order is not payable' });
        }
      }

      if (attemptCount(order) >= config.maxVerifyAttempts) {
        await finishAttempt(order, { status: 'rejected' });
        return tooManyAttempts(res);
      }

      reserved = await reserveAttempt(order);
      if (reserved) break;
      await delay(60 + i * 50);
    }

    if (!reserved) {
      return sendJson(res, 429, {
        status: 'pending',
        code: 1029,
        message: 'Another verification is in progress. Please wait a moment and try again.',
      });
    }

    const product = await fetchProduct(reserved.product_id);
    const amountTHB = promptpay.satangToTHB(reserved.amount);

    const result = await verifySlip({
      data: config.allowSlipData ? slip.data : undefined,
      url: config.allowSlipData ? slip.url : undefined,
      imageBase64: slip.imageBase64,
      imageMime: slip.imageMime || 'image/jpeg',
      amountTHB,
      log: config.slipokLog,
    });

    if (!result.ok) {
      const attempts = attemptCount(reserved);
      const capReached = attempts >= config.maxVerifyAttempts;
      await finishAttempt(reserved, { status: capReached ? 'rejected' : undefined });
      if (capReached) return tooManyAttempts(res);
      return sendJson(res, 202, {
        status: 'pending',
        code: result.code,
        message: describeCode(result.code, result.data),
        retryable: true,
      });
    }

    // Defence in depth: SlipOK verified the slip against the branch receiver,
    // but we still prove it belongs to this order (amount, reference, time).
    const verdict = evaluateSlip({
      order: reserved,
      slip: result.data,
      now: Date.now(),
      skewMs: config.slipClockSkewMinutes * 60 * 1000,
    });

    if (!verdict.ok) {
      const attempts = attemptCount(reserved);
      const capReached = attempts >= config.maxVerifyAttempts;
      await finishAttempt(reserved, { status: capReached ? 'rejected' : undefined });
      if (capReached) return tooManyAttempts(res);
      return sendJson(res, 202, {
        status: 'pending',
        code: verdict.code,
        message: verdict.message,
        retryable: true,
      });
    }

    let licenseKey = generateLicenseKey();
    let updated = null;
    let lastError = null;

    for (let i = 0; i < PAID_PATCH_TRIES; i += 1) {
      try {
        updated = await rest(
          `orders?id=eq.${encodeURIComponent(orderId)}&status=eq.pending`,
          {
            method: 'PATCH',
            prefer: 'return=representation',
            body: {
              status: 'paid',
              paid_at: new Date().toISOString(),
              slip_ref: verdict.transRef,
              slip_payload: {
                ...result.data,
                attempts: attemptCount(reserved),
              },
              license_key: licenseKey,
            },
          },
        );
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        const detail = String(e.body || e.message || '');
        if (e.status === 409) {
          if (detail.includes('orders_slip_ref_idx')) {
            const attempts = attemptCount(reserved);
            const capReached = attempts >= config.maxVerifyAttempts;
            await finishAttempt(reserved, { status: capReached ? 'rejected' : undefined });
            if (capReached) return tooManyAttempts(res);
            return sendJson(res, 202, {
              status: 'pending',
              code: 1012,
              message:
                'This slip has already been used. If you paid for this order, please contact the shop with your slip.',
              retryable: true,
            });
          }
          if (detail.includes('license_key')) {
            // Astronomically unlikely, but retrying with a fresh key is free.
            licenseKey = generateLicenseKey();
            continue;
          }
        }
        if (i < PAID_PATCH_TRIES - 1) {
          await delay(150 + i * 100);
          continue;
        }
      }
    }

    if (lastError) throw lastError;

    if (!updated || !updated[0]) {
      // Race: another request fulfilled it first, or the status changed.
      const fresh = await fetchOrder(orderId);
      if (!fresh) return sendJson(res, 404, { error: 'Order not found' });
      if (fresh.status === 'paid') return sendPaid(res, fresh);
      return sendJson(res, 409, { status: fresh.status, error: 'Order is not payable' });
    }

    // Email is optional (Resend requires a verified domain). Fulfilment is
    // already complete; the success page shows the licence and download link.
    let emailSent = false;
    const base = siteBaseUrl(req);
    if (isEmailConfigured() && base) {
      const link =
        `${base}/success?orderId=${encodeURIComponent(orderId)}` +
        `&token=${encodeURIComponent(orderToken(orderId))}`;
      try {
        await sendDownloadEmail({
          to: reserved.email,
          productName: product.name || 'Your product',
          licenseKey,
          downloadUrl: link,
          limit: config.downloadLimit,
        });
        emailSent = true;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('verify-slip: email failed', orderId, e.message);
      }
    } else if (isEmailConfigured() && !base) {
      // eslint-disable-next-line no-console
      console.error('verify-slip: email skipped — no public site URL');
    }

    sendJson(res, 200, {
      status: 'paid',
      licenseKey,
      downloadLimit: config.downloadLimit,
      remaining: config.downloadLimit,
      emailSent,
    });
  } catch (e) {
    // If the slip was verified but the final PATCH failed, leave a server-side
    // breadcrumb so support can find and finish the order manually.
    // eslint-disable-next-line no-console
    console.error('verify-slip failed for order', orderId, e.message);
    sendServerError(res, e, 'verify-slip');
  }
};
