// POST /api/checkout  { productId, email }
// Creates a pending order and returns a per-order PromptPay QR (not pinned).

const { rest } = require('../server/supabase');
const { readJsonBody, sendJson, sendServerError } = require('../server/http');
const { config } = require('../server/config');
const { orderToken } = require('../server/orderToken');
const { checkRateLimit, clientIp } = require('../server/rateLimit');
const promptpay = require('../server/payments/promptpay');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { error: 'Invalid body' });
    return;
  }

  const productId = String(body.productId || '').trim();
  const email = String(body.email || '').trim().toLowerCase();

  if (!productId) return sendJson(res, 400, { error: 'Missing productId' });
  if (!EMAIL_RE.test(email)) return sendJson(res, 400, { error: 'Invalid email' });

  try {
    promptpay.assertProxy();

    // Guard against spamming order creation (and burning QR/DB writes).
    const since = new Date(
      Date.now() - config.checkoutWindowMinutes * 60 * 1000,
    ).toISOString();
    const recent = await rest(
      `orders?select=id&email=eq.${encodeURIComponent(email)}` +
        `&created_at=gte.${encodeURIComponent(since)}`,
    );
    if (recent && recent.length >= config.checkoutMaxPerWindow) {
      return sendJson(res, 429, {
        error: 'Too many checkout attempts. Please wait a few minutes and try again.',
      });
    }

    const products = await rest(
      `products?select=id,name,price,currency,file_path,is_active` +
        `&id=eq.${encodeURIComponent(productId)}&is_active=eq.true&limit=1`,
    );
    const product = products && products[0];
    if (!product) return sendJson(res, 404, { error: 'Product not found' });
    if (!product.file_path) return sendJson(res, 409, { error: 'Product file not configured' });
    if (product.currency && String(product.currency).toUpperCase() !== 'THB') {
      return sendJson(res, 409, { error: 'This product is not priced in THB' });
    }

    const amountSatang = Math.round(Number(product.price) * 100);
    if (!Number.isFinite(amountSatang) || amountSatang <= 0) {
      return sendJson(res, 500, { error: 'Invalid product price' });
    }

    // Per-IP guard. The per-email window above is trivial to bypass with a
    // fresh email, so cap how many orders one network can start. This runs
    // only for well-formed checkouts, so a burst of junk requests does not
    // burn a real customer's budget.
    const ip = clientIp(req);
    if (ip) {
      const verdict = await checkRateLimit({
        bucket: 'checkout',
        ip,
        limit: config.checkoutMaxPerIp,
        windowSeconds: config.rateLimitWindowSeconds,
      });
      if (!verdict.allowed) {
        return sendJson(res, 429, {
          error:
            'Too many checkout attempts from this network. Please wait a few minutes and try again.',
          retryAfterSeconds: verdict.retryAfterSeconds,
        });
      }
    }

    const expiresAt = new Date(Date.now() + config.qrTtlMinutes * 60 * 1000).toISOString();
    // How long the buyer can come back and still upload a slip for this order.
    // The client stores this so the floating checkout button knows when the
    // order is too old to resume.
    const resumeUntil = new Date(
      new Date(expiresAt).getTime() + config.qrGraceMinutes * 60 * 1000,
    ).toISOString();

    const rows = await rest('orders', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        product_id: product.id,
        email,
        amount: amountSatang,
        currency: product.currency || 'THB',
        status: 'pending',
        qr_expires_at: expiresAt,
        // Start the attempt counter at zero. The counter is advanced with a
        // compare-and-swap in verify-slip, so parallel uploads cannot exceed it.
        slip_payload: { attempts: 0 },
      },
    });
    const order = rows && rows[0];
    if (!order) return sendJson(res, 500, { error: 'Could not create order' });

    const payload = promptpay.buildPayload({ amountSatang });
    const qr = await promptpay.renderQrDataUrl(payload);

    sendJson(res, 200, {
      orderId: order.id,
      accessToken: orderToken(order.id),
      qr, // data URL image — raw proxy is never sent to the client
      amount: amountSatang, // satang
      amountTHB: promptpay.satangToTHB(amountSatang),
      currency: product.currency || 'THB',
      productName: product.name,
      expiresAt,
      resumeUntil,
      downloadLimit: config.downloadLimit,
    });
  } catch (e) {
    sendServerError(res, e, 'checkout');
  }
};
