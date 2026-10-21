#!/usr/bin/env node
// End-to-end verification flow test with a stubbed SlipOK adapter.
//
// This drives the REAL /api/checkout and /api/verify-slip handlers against the
// real database, but replaces server/payments/slipok.js with an in-process mock.
// Result: it exercises the paid path, retry/attempt cap, our date/amount rules,
// and the unique slip_ref guard without spending a single SlipOK credit.
//
//   node scripts/test-verify-flow.js
//
// Everything it creates is deleted at the end.

const { loadEnv } = require('./lib/env');

loadEnv();

const { rest } = require('../server/supabase');
const { config } = require('../server/config');

// Replace the network adapter BEFORE verify-slip destructures it. describeCode
// stays real so the buyer-facing messages are still exercised.
const slipok = require('../server/payments/slipok');
let mockVerify = async () => ({ ok: false, code: 1013, message: 'mock failure' });
slipok.verifySlip = (args) => mockVerify(args);

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

async function createOrder(email) {
  const { res, data } = await call(checkout, {
    method: 'POST',
    body: { productId: 'prod1', email },
  });
  if (res.statusCode !== 200 || !data.orderId || !data.accessToken) {
    throw new Error(`checkout ${res.statusCode}: ${data.error || 'missing order/token'}`);
  }
  return data;
}

async function submit(order, slip = { imageBase64: 'eA==', imageMime: 'image/jpeg' }) {
  return call(verify, {
    method: 'POST',
    body: { orderId: order.orderId, token: order.accessToken, slip },
  });
}

async function readOrder(orderId) {
  const rows = await rest(
    `orders?select=status,license_key,slip_ref,download_count,slip_payload->>attempts` +
      `&id=eq.${encodeURIComponent(orderId)}&limit=1`,
  );
  return (rows && rows[0]) || null;
}

function validSlip({ amountTHB, transRef, when = new Date() }) {
  return {
    ok: true,
    data: {
      amount: amountTHB,
      transRef,
      transTimestamp: when.toISOString(),
      receiver: 'mock-receiver',
    },
  };
}

async function main() {
  console.log('\nDearDev verify-flow test (SlipOK stubbed)\n');
  console.log(`  max verify attempts: ${config.maxVerifyAttempts}`);
  console.log('  SlipOK credits used: 0\n');

  const created = [];
  const stamp = Date.now();

  try {
    // ---- 1. a valid slip is fulfilled ------------------------------------
    const good = await createOrder(`flow-good+${stamp}@example.com`);
    created.push(good.orderId);
    const goodRef = `FLOWGOOD${stamp}`;
    mockVerify = async ({ amountTHB }) => validSlip({ amountTHB, transRef: goodRef });

    let r = await submit(good);
    if (r.res.statusCode === 200 && r.data.status === 'paid' && r.data.licenseKey) {
      ok('valid slip marks the order paid', r.data.licenseKey);
    } else {
      bad('valid slip failed', `${r.res.statusCode} ${r.data.error || r.data.message || ''}`);
    }
    if (r.data && r.data.emailSent === false) ok('email is optional', 'emailSent=false');

    let row = await readOrder(good.orderId);
    if (row && row.status === 'paid' && row.slip_ref === goodRef) {
      ok('slip_ref and status persisted', `attempts=${row.attempts}`);
    } else {
      bad('paid order state is wrong', JSON.stringify(row));
    }

    // ---- 2. a failing slip stays pending until the cap -------------------
    const retry = await createOrder(`flow-retry+${stamp}@example.com`);
    created.push(retry.orderId);
    mockVerify = async () => ({ ok: false, code: 1013, message: 'mock wrong amount' });

    for (let i = 1; i <= config.maxVerifyAttempts; i += 1) {
      r = await submit(retry);
      if (i < config.maxVerifyAttempts) {
        if (r.res.statusCode !== 202 || r.data.status !== 'pending') {
          bad(`attempt ${i} should stay pending`, `${r.res.statusCode} ${r.data.status}`);
        }
      } else if (r.res.statusCode === 422 && r.data.status === 'rejected') {
        ok('last allowed attempt closes the order', 'rejected');
      } else {
        bad('cap was not enforced', `${r.res.statusCode} ${r.data.status}`);
      }
    }

    row = await readOrder(retry.orderId);
    if (row && row.status === 'rejected' && Number(row.attempts) === config.maxVerifyAttempts) {
      ok('attempt counter stops at the cap', `attempts=${row.attempts}`);
    } else {
      bad('retry order state is wrong', JSON.stringify(row));
    }

    // ---- 3. a slip paid before the order is rejected, not accepted -------
    const old = await createOrder(`flow-old+${stamp}@example.com`);
    created.push(old.orderId);
    mockVerify = async ({ amountTHB }) =>
      validSlip({
        amountTHB,
        transRef: `FLOWOLD${stamp}`,
        when: new Date(Date.now() - 10 * 60 * 1000),
      });

    r = await submit(old);
    if (r.res.statusCode === 202 && Number(r.data.code) === 1016) {
      ok('slip from before the order is rejected', 'code 1016');
    } else {
      bad('old slip was not rejected', `${r.res.statusCode} code=${r.data.code}`);
    }
    row = await readOrder(old.orderId);
    if (row && row.status === 'pending' && Number(row.attempts) === 1) {
      ok('old slip stays retryable', 'attempts=1');
    } else {
      bad('old-slip order state is wrong', JSON.stringify(row));
    }

    // ---- 4. the same bank reference cannot pay two orders ----------------
    const first = await createOrder(`flow-dup-a+${stamp}@example.com`);
    created.push(first.orderId);
    const dupRef = `FLOWDUP${stamp}`;
    mockVerify = async ({ amountTHB }) => validSlip({ amountTHB, transRef: dupRef });
    r = await submit(first);
    if (r.res.statusCode === 200 && r.data.status === 'paid') ok('first use of slip_ref is paid');
    else bad('first duplicate test order failed', `${r.res.statusCode}`);

    const second = await createOrder(`flow-dup-b+${stamp}@example.com`);
    created.push(second.orderId);
    mockVerify = async ({ amountTHB }) => validSlip({ amountTHB, transRef: dupRef });
    r = await submit(second);
    if (r.res.statusCode === 202 && Number(r.data.code) === 1012) {
      ok('reused slip_ref is refused', 'code 1012');
    } else {
      bad('reused slip_ref was accepted', `${r.res.statusCode} code=${r.data.code}`);
    }
    row = await readOrder(second.orderId);
    if (row && row.status === 'pending' && Number(row.attempts) === 1) {
      ok('reused-slip order stays retryable', 'attempts=1');
    } else {
      bad('duplicate order state is wrong', JSON.stringify(row));
    }
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
    console.log(`${PASS} verify flow is ready.\n`);
  }
}

main().catch((e) => {
  console.error(`\n${FAIL} ${e.message}\n`);
  process.exit(1);
});
