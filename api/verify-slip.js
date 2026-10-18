// POST /api/verify-slip  { orderId, slip: { data?, url?, imageBase64?, imageMime? } }
// Verifies the payment slip with SlipOK, applies our own checks, and — on
// success — marks the order paid, issues a license key and emails the buyer.
// Idempotent: re-submitting an already-paid order just returns the result.

const { rest } = require('../server/supabase');
const { readJsonBody, sendJson } = require('../server/http');
const { config } = require('../server/config');
const { verifySlip } = require('../server/payments/slipok');
const { generateLicenseKey } = require('../server/license');
const { sendDownloadEmail } = require('../server/email');
const promptpay = require('../server/payments/promptpay');

// SlipOK error codes → how we treat them.
// retryable: keep the order pending so the buyer can try again later.
const RETRYABLE_CODES = new Set([1010]); // 1010 = bank delay (BBL/SCB)

async function fetchOrder(orderId) {
  const rows = await rest(
    `orders?select=id,product_id,email,amount,currency,status,license_key,download_count` +
      `&id=eq.${encodeURIComponent(orderId)}&limit=1`,
  );
  return rows && rows[0];
}

async function fetchProductName(productId) {
  if (!productId) return '';
  const rows = await rest(
    `products?select=name,file_path&id=eq.${encodeURIComponent(productId)}&limit=1`,
  );
  return (rows && rows[0]) || {};
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

    const product = await fetchProductName(order.product_id);
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
      const retryable = RETRYABLE_CODES.has(Number(result.code));
      if (!retryable) {
        // Clearly invalid (fake / wrong amount / wrong receiver / duplicate):
        // mark rejected so it leaves the pending queue.
        await rest(`orders?id=eq.${encodeURIComponent(orderId)}&status=eq.pending`, {
          method: 'PATCH',
          body: { status: 'rejected', slip_payload: { error: result } },
        });
      }
      return sendJson(res, retryable ? 202 : 422, {
        status: retryable ? 'pending' : 'rejected',
        code: result.code,
        message: result.message,
        retryable,
      });
    }

    // Cross-check the amount ourselves as well (defence in depth).
    const slipData = result.data;
    const slipAmountSatang = Math.round(Number(slipData.amount) * 100);
    if (Number.isFinite(slipAmountSatang) && slipAmountSatang !== order.amount) {
      return sendJson(res, 422, {
        status: 'pending',
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
          slip_payload: slipData,
          license_key: licenseKey,
        },
      });
    } catch (e) {
      if (e.status === 409) {
        // Slip reference already used by another order → duplicate slip.
        await rest(`orders?id=eq.${encodeURIComponent(orderId)}&status=eq.pending`, {
          method: 'PATCH',
          body: { status: 'rejected', slip_payload: { error: 'duplicate slip', transRef } },
        });
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
