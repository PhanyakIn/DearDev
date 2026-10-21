// Bearer token for an order's private pages (success + download).
//
// The order id is a UUID, but UUIDs leak through logs, screenshots, shared
// links and support chats. The token adds a second secret that is required by
// /api/order, /api/download and /api/verify-slip.
//
// Tokens are deterministic (HMAC of the order id) so we do not need a database
// migration. Set ORDER_TOKEN_SECRET in production; if it is absent we fall back
// to the Supabase service-role key (also server-only). Rotating that key
// invalidates old success links.

const crypto = require('crypto');
const { config } = require('./config');

function tokenSecret() {
  const secret = config.orderTokenSecret || config.supabaseServiceKey;
  if (!secret) throw new Error('Missing ORDER_TOKEN_SECRET');
  return secret;
}

function orderToken(orderId) {
  return crypto
    .createHmac('sha256', tokenSecret())
    .update(String(orderId))
    .digest('base64url')
    .slice(0, 32);
}

function tokenMatches(orderId, token) {
  const expected = orderToken(orderId);
  const given = String(token || '');
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

module.exports = { orderToken, tokenMatches };
