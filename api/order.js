// GET /api/order?orderId=...  → public-safe order status for the success page.

const { rest } = require('../server/supabase');
const { sendJson, sendServerError } = require('../server/http');
const { config } = require('../server/config');
const { tokenMatches } = require('../server/orderToken');

function maskEmail(email) {
  if (!email || !email.includes('@')) return email || '';
  const [user, domain] = email.split('@');
  const head = user.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(user.length - 2, 1))}@${domain}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const orderId = String((req.query && req.query.orderId) || '').trim();
  const token = String((req.query && req.query.token) || '');
  if (!orderId) return sendJson(res, 400, { error: 'Missing orderId' });

  try {
    // The order id alone is not enough: the success link also carries a token.
    if (!tokenMatches(orderId, token)) {
      return sendJson(res, 403, { error: 'Invalid or missing order link.' });
    }

    const orders = await rest(
      `orders?select=id,product_id,email,amount,currency,status,license_key,download_count,created_at,paid_at` +
        `&id=eq.${encodeURIComponent(orderId)}&limit=1`,
    );
    const order = orders && orders[0];
    if (!order) return sendJson(res, 404, { error: 'Order not found' });

    let productName = '';
    if (order.product_id) {
      const products = await rest(
        `products?select=name&id=eq.${encodeURIComponent(order.product_id)}&limit=1`,
      );
      productName = (products && products[0] && products[0].name) || '';
    }

    const paid = order.status === 'paid';
    sendJson(res, 200, {
      orderId: order.id,
      status: order.status,
      productId: order.product_id,
      productName,
      amount: order.amount,
      currency: order.currency,
      email: maskEmail(order.email),
      licenseKey: paid ? order.license_key : null,
      downloadCount: order.download_count,
      downloadLimit: config.downloadLimit,
      remaining: paid ? Math.max(config.downloadLimit - order.download_count, 0) : 0,
      paidAt: order.paid_at,
      createdAt: order.created_at,
    });
  } catch (e) {
    sendServerError(res, e, 'order');
  }
};
