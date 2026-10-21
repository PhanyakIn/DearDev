#!/usr/bin/env node
// Security-focused integration test.
//
// Drives the REAL /api/order, /api/verify-slip and /api/download handlers
// against the real database, but never calls SlipOK (so it costs 0 credits).
// It proves:
//   - an order id without the order token is rejected
//   - a wrong token is rejected by status/verify/download
//   - rejected/oversized attempts do not advance the attempt counter
//   - an order at the attempt cap is closed as `rejected` without a SlipOK call
//
//   node scripts/test-security.js
//
// Everything it creates is deleted at the end.

const { loadEnv } = require('./lib/env');

loadEnv();

const { rest } = require('../server/supabase');
const { config } = require('../server/config');

const checkout = require('../api/checkout');
const order = require('../api/order');
const verify = require('../api/verify-slip');
const download = require('../api/download');

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

async function createOrder(email) {
  const { res, data } = await call(checkout, {
    method: 'POST',
    body: { productId: 'prod1', email },
  });
  if (res.statusCode !== 200 || !data.orderId || !data.accessToken) {
    throw new Error(`checkout ${res.statusCode}: ${data.error || 'missing orderId/token'}`);
  }
  return data;
}

async function readOrder(orderId) {
  const rows = await rest(
    `orders?select=status,slip_payload->>attempts&id=eq.${encodeURIComponent(orderId)}&limit=1`,
  );
  return (rows && rows[0]) || null;
}

async function main() {
  console.log('\nDearDev security test\n');
  console.log(`  max verify attempts: ${config.maxVerifyAttempts}`);
  console.log(`  max slip bytes     : ${config.maxSlipBytes}\n`);

  const created = [];
  const stamp = Date.now();

  try {
    const createdOrder = await createOrder(`security+${stamp}@example.com`);
    created.push(createdOrder.orderId);
    const { orderId, accessToken } = createdOrder;
    ok('order created', orderId);

    // ---- token enforcement on the status endpoint -------------------------
    let r = await call(order, { method: 'GET', query: { orderId } });
    if (r.res.statusCode === 403) ok('status without token is refused', '403');
    else bad('status without token was accepted', String(r.res.statusCode));

    r = await call(order, { method: 'GET', query: { orderId, token: 'wrong' } });
    if (r.res.statusCode === 403) ok('status with wrong token is refused', '403');
    else bad('status with wrong token was accepted', String(r.res.statusCode));

    r = await call(order, { method: 'GET', query: { orderId, token: accessToken } });
    if (r.res.statusCode === 200 && r.data.status === 'pending') {
      ok('status with the correct token works', 'pending');
    } else {
      bad('status with correct token failed', `${r.res.statusCode} ${r.data.error || ''}`);
    }

    // ---- token / input checks on verify-slip (no SlipOK call) ------------
    r = await call(verify, { method: 'POST', body: { orderId, token: accessToken } });
    if (r.res.statusCode === 400) ok('verify without a slip is refused', '400');
    else bad('verify without a slip was accepted', String(r.res.statusCode));

    r = await call(verify, {
      method: 'POST',
      body: { orderId, token: 'wrong', slip: { imageBase64: 'eA==' } },
    });
    if (r.res.statusCode === 403) ok('verify with wrong token is refused', '403');
    else bad('verify with wrong token was accepted', String(r.res.statusCode));

    const oversized = 'A'.repeat(Math.ceil((config.maxSlipBytes * 4) / 3) + 16);
    r = await call(verify, {
      method: 'POST',
      body: { orderId, token: accessToken, slip: { imageBase64: oversized } },
    });
    if (r.res.statusCode === 413) ok('oversized slip is refused', '413');
    else bad('oversized slip was accepted', String(r.res.statusCode));

    let row = await readOrder(orderId);
    if (row && Number(row.attempts) === 0) {
      ok('rejected requests did not use an attempt', 'attempts=0');
    } else {
      bad('attempt counter changed without SlipOK', `attempts=${row && row.attempts}`);
    }

    // ---- attempt cap closes the order without calling SlipOK -------------
    await rest(`orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      body: { slip_payload: { attempts: config.maxVerifyAttempts } },
    });

    r = await call(verify, {
      method: 'POST',
      body: { orderId, token: accessToken, slip: { imageBase64: 'eA==' } },
    });
    if (r.res.statusCode === 422 && r.data.status === 'rejected') {
      ok('attempt cap closes the order', 'rejected');
    } else {
      bad('attempt cap was not enforced', `${r.res.statusCode} ${r.data.status || ''}`);
    }

    row = await readOrder(orderId);
    if (row && row.status === 'rejected' && Number(row.attempts) === config.maxVerifyAttempts) {
      ok('order stayed at the cap', `attempts=${row.attempts}`);
    } else {
      bad('order state after cap is wrong', `${row && row.status} attempts=${row && row.attempts}`);
    }

    // ---- download token check -------------------------------------------
    r = await call(download, { method: 'GET', query: { orderId, token: 'wrong' } });
    if (r.res.statusCode === 403) ok('download with wrong token is refused', '403');
    else bad('download with wrong token was accepted', String(r.res.statusCode));
  } catch (e) {
    bad('test aborted', e.message);
  } finally {
    for (const orderId of created) {
      try {
        await rest(`orders?id=eq.${encodeURIComponent(orderId)}`, { method: 'DELETE' });
        ok('cleanup', `${orderId} deleted`);
      } catch (e) {
        bad('cleanup failed', e.message);
      }
    }
  }

  console.log('');
  if (failures) {
    console.log(`${FAIL} ${failures} problem(s) found.\n`);
    process.exitCode = 1;
  } else {
    console.log(`${PASS} order access + attempt cap are enforced.\n`);
  }
}

main().catch((e) => {
  console.error(`\n${FAIL} ${e.message}\n`);
  process.exit(1);
});
