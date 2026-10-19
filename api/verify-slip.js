// POST /api/verify-slip  { orderId, slip: { data?, url?, imageBase64?, imageMime? } }
// Verifies the payment slip with SlipOK, applies our own checks, and — on
// success — marks the order paid, issues a license key and emails the buyer.
// Idempotent: re-submitting an already-paid order just returns the result.

const { rest } = require('../server/supabase');
const { readJsonBody, sendJson } = require('../server/http');
const { config } = require('../server/config');
const { verifySlip, describeCode } = require('../server/payments/slipok');
const { generateLicenseKey } = require('../server/license');
const { sendDownloadEmail } = require('../server/email');
const promptpay = require('../server/payments/promptpay');

// Only these codes mean "this slip can never be valid for this order".
// Everything else (blurry photo, e-wallet slip, bank delay, outage) leaves the
// order pending, so one bad upload never destroys a paid customer's order.
const REJECT_CODES = new Set([1011, 1012, 1013, 1014]);

const ORDER_COLUMNS =
  'id,product_id,email,amount,currency,status,license_key,download_count,qr_expires_at,slip_payload';

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

// Attempts are tracked inside slip_payload so no extra column is needed.
function attemptCount(order) {
  const payload = order && order.slip_payload;
  if (payload && typeof payload === 'object' && Number.isFinite(Number(payload.attempts))) {
    return Number(payload.attempts);
  }
  return 0;
}

// Writes the attempt counter (and optionally a new status) in one round-trip.
// Filtered on status=pending so a concurrently-fulfilled order is never touched.
async function recordAttempt(orderId, order, { status, error } = {}) {
  const attempts = attemptCount(order) + 1;
  const body = {
    slip_payload: {
      attempts,
      lastAttemptAt: new Date().toISOString(),
      ...(error ? { error } : {}),
    },
  };
  if (status) body.status = status;
  try {
    await rest(`orders?id=eq.${encodeURIComponent(orderId)}&status=eq.pending`, {
      method: 'PATCH',
      body,
    });
  } catch {
    /* best effort — never block the buyer on a bookkeeping write */
  }
  return attempts;
}

function base64Bytes(base64) {
  return Math.ceil((String(base64 || '').length * 3) / 4);
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
  const slip = body.slip || {};
  if (!orderId) return sendJson(res, 400, { error: 'Missing orderId' });
  if (!slip.data && !slip.url && !slip.imageBase64) {
    return sendJson(res, 400, { error: 'Missing slip' });
  }

  try {
    const order = await fetchOrder(orderId);
    if (!order) return sendJson(res, 404, { error: 'Order not found' });

    // Idempotent: already fulfilled.
    if (order.status === 'paid') {
      return sendJson(res, 200, {
        status: 'paid',
        licenseKey: order.license_key,
        downloadLimit: config.downloadLimit,
        remaining: Math.max(config.downloadLimit - order.download_count, 0),
      });
    }
    if (order.status !== 'pending') {
      return sendJson(res, 409, { status: order.status, error: 'Order is not payable' });
    }

    // Payment window: the QR countdown is a UX hint, but a buyer who already
    // transferred must still be able to claim their product. We only close the
    // order once the grace period after expiry has also passed.
    const expiresAt = order.qr_expires_at ? new Date(order.qr_expires_at).getTime() : 0;
    if (expiresAt && Date.now() > expiresAt + config.qrGraceMinutes * 60 * 1000) {
      await recordAttempt(orderId, order, { status: 'expired', error: 'payment window closed' });
      return sendJson(res, 410, {
        status: 'expired',
        code: 1015,
        message:
          'This payment window has closed. If you have already paid, please contact the shop with your slip.',
      });
    }

    // Cap retries: each SlipOK call costs a credit.
    if (attemptCount(order) >= config.maxVerifyAttempts) {
      return sendJson(res, 429, {
        status: 'pending',
        code: 1029,
        message: 'Too many attempts for this order. Please contact the shop for help.',
      });
    }

    if (slip.imageBase64 && base64Bytes(slip.imageBase64) > config.maxSlipBytes) {
      return sendJson(res, 413, {
        status: 'pending',
        code: 1020,
        message: 'That slip image is too large. Please upload a smaller photo.',
      });
    }

    const product = await fetchProduct(order.product_id);
    const amountTHB = promptpay.satangToTHB(order.amount);

    const result = await verifySlip({
      data: slip.data,
      url: slip.url,
      imageBase64: slip.imageBase64,
      imageMime: slip.imageMime,
      amountTHB,
      log: true,
    });

    if (!result.ok) {
      const terminal = REJECT_CODES.has(Number(result.code));
      // Terminal → mark rejected so it leaves the pending queue.
      // Otherwise stay pending so the buyer can upload the right slip.
      await recordAttempt(orderId, order, {
        status: terminal ? 'rejected' : undefined,
        error: result,
      });
      return sendJson(res, terminal ? 422 : 202, {
        status: terminal ? 'rejected' : 'pending',
        code: result.code,
        message: describeCode(result.code, result.data),
        retryable: !terminal,
      });
    }

    // Cross-check the amount ourselves as well (defence in depth).
    const slipData = result.data;
    const slipAmountSatang = Math.round(Number(slipData.amount) * 100);
    if (Number.isFinite(slipAmountSatang) && slipAmountSatang !== order.amount) {
      await recordAttempt(orderId, order, {
        status: 'rejected',
        error: 'amount mismatch',
      });
      return sendJson(res, 422, {
        status: 'rejected',
        code: 1013,
        message: 'The amount on the slip does not match this order.',
      });
    }

    const transRef = String(slipData.transRef || '');
    const licenseKey = generateLicenseKey();

    let updated;
    try {
      updated = await rest(`orders?id=eq.${encodeURIComponent(orderId)}&status=eq.pending`, {
        method: 'PATCH',
        prefer: 'return=representation',
        body: {
          status: 'paid',
          paid_at: new Date().toISOString(),
          slip_ref: transRef || null,
          slip_payload: { ...slipData, attempts: attemptCount(order) + 1 },
          license_key: licenseKey,
        },
      });
    } catch (e) {
      if (e.status === 409) {
        // Slip reference already used by another order → duplicate slip.
        await recordAttempt(orderId, order, { status: 'rejected', error: 'duplicate slip' });
        return sendJson(res, 422, {
          status: 'rejected',
          code: 1012,
          message: 'This slip has already been used.',
        });
      }
      throw e;
    }

    if (!updated || !updated[0]) {
      // Race: another request fulfilled it first — return current state.
      const fresh = await fetchOrder(orderId);
      return sendJson(res, 200, {
        status: fresh.status,
        licenseKey: fresh.license_key,
        downloadLimit: config.downloadLimit,
        remaining: Math.max(config.downloadLimit - fresh.download_count, 0),
      });
    }

    const downloadUrl = config.siteUrl
      ? `${config.siteUrl}/success?orderId=${encodeURIComponent(orderId)}`
      : `/success?orderId=${encodeURIComponent(orderId)}`;

    // Email is best-effort; fulfilment already succeeded.
    let emailSent = true;
    try {
      await sendDownloadEmail({
        to: order.email,
        productName: product.name || 'Your product',
        licenseKey,
        downloadUrl,
        limit: config.downloadLimit,
      });
    } catch (e) {
      emailSent = false;
      // eslint-disable-next-line no-console
      console.error('send email failed:', e.message);
    }

    sendJson(res, 200, {
      status: 'paid',
      licenseKey,
      downloadLimit: config.downloadLimit,
      remaining: config.downloadLimit,
      emailSent,
    });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
};
