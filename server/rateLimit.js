// Per-IP rate limiting for the payment endpoints.
//
// Why this exists: the per-email limit in api/checkout.js can be bypassed by
// simply using a different email, and every slip verification burns a real
// SlipOK credit. Without an IP cap, anyone could create orders with throwaway
// emails and drain the credit balance.
//
// Where the counter lives: in Postgres (function check_rate_limit, see
// supabase/schema.sql). An in-memory counter would reset on every serverless
// cold start, so an attacker would simply retry until a fresh instance picked
// the request up.
//
// The limiter never throws. A missing rate-limit table must not take the shop
// down, so a broken counter fails OPEN (the request is allowed) and logs a
// warning. The per-order attempt cap in api/verify-slip.js still protects the
// SlipOK credit in that case.

const supabase = require('./supabase');

const LOOPBACK = /^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

let warnedUnavailable = false;

function headerValue(req, name) {
  const headers = (req && req.headers) || {};
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

// The public IP of the caller. Vercel sets x-forwarded-for with the client
// address first, then any proxies it appended.
function clientIp(req) {
  const forwarded = String(headerValue(req, 'x-forwarded-for') || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)[0];
  const real = String(headerValue(req, 'x-real-ip') || '').trim();
  const socketIp =
    (req && req.socket && req.socket.remoteAddress) ||
    (req && req.connection && req.connection.remoteAddress) ||
    '';

  const ip = forwarded || real || String(socketIp || '').trim();
  if (!ip) return '';

  // Normalise IPv4-mapped IPv6 (::ffff:1.2.3.4) so one client is one bucket.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return mapped ? mapped[1] : ip;
}

function isLoopback(ip) {
  return LOOPBACK.test(String(ip || ''));
}

// Loopback traffic is the developer's own machine or the local ops scripts
// (npm run test:security, check:storage, ...). Vercel always runs with
// NODE_ENV=production and never sees a loopback client.
function isLocalRequest(ip) {
  return process.env.NODE_ENV !== 'production' && isLoopback(ip);
}

// Count one hit against `bucket` and report whether the caller is still
// inside the limit. Never throws.
async function checkRateLimit({ bucket, ip, limit, windowSeconds }) {
  if (!bucket || !ip) return { allowed: true, skipped: true };
  if (isLocalRequest(ip)) return { allowed: true, skipped: true };

  const max = Number(limit);
  const window = Number(windowSeconds) || 600;
  if (!Number.isFinite(max) || max <= 0) return { allowed: true, skipped: true };

  try {
    const rows = await supabase.rpc('check_rate_limit', {
      p_key: `${bucket}:${ip}`,
      p_limit: max,
      p_window_seconds: window,
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return { allowed: true, degraded: true };

    return {
      allowed: row.allowed !== false,
      hits: Number(row.hits || 0),
      retryAfterSeconds: Number(row.retry_after_seconds || 0),
    };
  } catch (e) {
    // Most likely the function was never created: run supabase/schema.sql
    // (or supabase/hardening.sql) in the Supabase SQL editor.
    if (!warnedUnavailable) {
      warnedUnavailable = true;
      // eslint-disable-next-line no-console
      console.warn(
        'rate limit unavailable — run supabase/hardening.sql to create check_rate_limit()',
        e && e.message ? e.message : e,
      );
    }
    return { allowed: true, degraded: true };
  }
}

module.exports = { checkRateLimit, clientIp, isLoopback, isLocalRequest };
