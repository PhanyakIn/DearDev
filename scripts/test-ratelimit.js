#!/usr/bin/env node
// Rate-limit test — no database, no SlipOK, no credits.
//
// It proves:
//   - the limiter allows exactly `limit` hits inside the window, then blocks
//   - /api/checkout answers 429 once the per-IP limit is reached
//   - /api/verify-slip answers 429 BEFORE the attempt counter advances and
//     BEFORE SlipOK is called (a blocked request must not burn a credit)
//
// The database and SlipOK are stubbed, so running this never touches the real
// shop and never costs a verification credit.
//
//   node scripts/test-ratelimit.js

// The limits are read when server/config.js is first required, so they must be
// set before anything else is loaded.
process.env.CHECKOUT_MAX_PER_IP = process.env.CHECKOUT_MAX_PER_IP || '2';
process.env.VERIFY_MAX_PER_IP = process.env.VERIFY_MAX_PER_IP || '1';
process.env.RATE_LIMIT_WINDOW_SECONDS = process.env.RATE_LIMIT_WINDOW_SECONDS || '600';

const { loadEnv } = require('./lib/env');

loadEnv();

const supabase = require('../server/supabase');

// --- stubs -----------------------------------------------------------------
// The rate-limit counter (mirrors the SQL in supabase/hardening.sql).
const counters = new Map();

let slipokCalled = false;
let orderAttempts = 0;

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT = {
  id: 'prod1',
  name: 'Test product',
  price: 59,
  currency: 'THB',
  file_path: 'test.zip',
  is_active: true,
};

function orderRow() {
  return {
    id: ORDER_ID,
    product_id: 'prod1',
    email: 'buyer@example.com',
    amount: 5900,
    currency: 'THB',
    status: 'pending',
    license_key: null,
    download_count: 0,
    created_at: new Date().toISOString(),
    qr_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    slip_payload: { attempts: orderAttempts },
  };
}

supabase.rpc = async (fn, args) => {
  if (fn !== 'check_rate_limit') throw new Error(`unexpected rpc: ${fn}`);
  const now = Date.now();
  const windowMs = Number(args.p_window_seconds) * 1000;
  const entry = counters.get(args.p_key);
  const expired = !entry || now - entry.started >= windowMs;
  const hits = expired ? 1 : entry.hits + 1;
  const started = expired ? now : entry.started;
  counters.set(args.p_key, { hits, started });
  return [
    {
      allowed: hits <= Number(args.p_limit),
      hits,
      retry_after_seconds: Math.max(0, Math.ceil((started + windowMs - now) / 1000)),
    },
  ];
};

supabase.rest = async (path, opts = {}) => {
  if (path.startsWith('products')) return [{ ...PRODUCT }];
  if (path.startsWith('orders')) {
    if (opts.method === 'POST') return [orderRow()];
    if (opts.method === 'PATCH') {
      // The compare-and-swap on the attempt counter.
      if (opts.body && opts.body.slip_payload) orderAttempts += 1;
      return [{ ...orderRow(), slip_payload: { attempts: orderAttempts } }];
    }
    if (path.includes('select=id&email')) return [];
    return [orderRow()];
  }
  throw new Error(`unexpected rest call: ${path}`);
};

// SlipOK must never be reached by a rate-limited request.
const slipok = require('../server/payments/slipok');
slipok.verifySlip = async () => {
  slipokCalled = true;
  throw new Error('SlipOK must not be called in this test');
};

const { checkRateLimit } = require('../server/rateLimit');
const { orderToken } = require('../server/orderToken');
const checkout = require('../api/checkout');
const verify = require('../api/verify-slip');

const PASS = '\u2713';
const FAIL = '\u2717';
let failures = 0;

function ok(label, detail = '') {
  console.log(`  ${PASS} ${label}${detail ? ` — ${detail}` : ''}`);
}

function bad(label, detail = '') {
  failures += 1;
  console.log(`  ${FAIL} ${label}${detail ? ` — ${detail}` : ''}`);
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(key, value) {
      res.headers[String(key).toLowerCase()] = value;
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) res.body += chunk;
    },
  };
  return res;
}

function json(res) {
  try {
    return JSON.parse(res.body || '{}');
  } catch {
    return {};
  }
}

async function call(handler, req) {
  const res = mockRes();
  await handler(req, res);
  return { res, data: json(res) };
}

function req(method, body, ip) {
  return {
    method,
    body,
    headers: ip ? { 'x-forwarded-for': ip } : {},
    socket: { remoteAddress: ip || '127.0.0.1' },
  };
}

async function main() {
  console.log('\nDearDev rate-limit test\n');

  // --- 1. the limiter itself ------------------------------------------------
  const ipA = '203.0.113.10';
  const first = await checkRateLimit({ bucket: 'unit', ip: ipA, limit: 2, windowSeconds: 600 });
  const second = await checkRateLimit({ bucket: 'unit', ip: ipA, limit: 2, windowSeconds: 600 });
  const third = await checkRateLimit({ bucket: 'unit', ip: ipA, limit: 2, windowSeconds: 600 });
  if (first.allowed && second.allowed && !third.allowed) {
    ok('limiter allows 2 hits then blocks the 3rd');
  } else {
    bad('limiter window', JSON.stringify({ first, second, third }));
  }

  // A different IP has its own bucket.
  const other = await checkRateLimit({ bucket: 'unit', ip: '203.0.113.99', limit: 2, windowSeconds: 600 });
  if (other.allowed) ok('a different IP gets its own budget');
  else bad('different IP was blocked');

  // --- 2. /api/checkout ----------------------------------------------------
  const ipB = '203.0.113.11';
  const c1 = await call(checkout, req('POST', { productId: 'prod1', email: 'a@example.com' }, ipB));
  const c2 = await call(checkout, req('POST', { productId: 'prod1', email: 'b@example.com' }, ipB));
  const c3 = await call(checkout, req('POST', { productId: 'prod1', email: 'c@example.com' }, ipB));
  if (c1.res.statusCode === 200 && c2.res.statusCode === 200) {
    ok('checkout succeeds inside the per-IP limit');
  } else {
    bad('checkout inside the limit', `${c1.res.statusCode}/${c2.res.statusCode}`);
  }
  if (c3.res.statusCode === 429) {
    ok('checkout answers 429 once the per-IP limit is reached');
  } else {
    bad('checkout was not limited', `${c3.res.statusCode} ${JSON.stringify(c3.data)}`);
  }
  if (c3.data && c3.data.error) ok('the 429 carries a readable message');
  else bad('the 429 has no message');

  // --- 3. /api/verify-slip (must not spend a credit) ------------------------
  const ipC = '203.0.113.12';
  // Spend the single allowed verification for this IP.
  await checkRateLimit({ bucket: 'verify-slip', ip: ipC, limit: 1, windowSeconds: 600 });

  orderAttempts = 0;
  slipokCalled = false;
  const v = await call(
    verify,
    req('POST', { orderId: ORDER_ID, token: orderToken(ORDER_ID), slip: { imageBase64: 'AAAA' } }, ipC),
  );
  if (v.res.statusCode === 429) {
    ok('verify-slip answers 429 when the per-IP limit is reached');
  } else {
    bad('verify-slip was not limited', `${v.res.statusCode} ${JSON.stringify(v.data)}`);
  }
  if (!slipokCalled) ok('a blocked verification never calls SlipOK (no credit spent)');
  else bad('SlipOK was called for a blocked request');
  if (orderAttempts === 0) ok('a blocked verification does not consume an attempt');
  else bad('the attempt counter advanced', String(orderAttempts));

  console.log('');
  if (failures) {
    console.log(`  ${failures} check(s) failed\n`);
    process.exitCode = 1;
  } else {
    console.log('  all checks passed\n');
  }
}

main().catch((e) => {
  console.error('ERR', e && e.message ? e.message : e);
  process.exit(1);
});
