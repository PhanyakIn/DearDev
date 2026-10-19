#!/usr/bin/env node
// Fulfilment test — proves a paid order really produces a downloadable file,
// that unpaid orders are refused, and that the download cap is enforced.
//
//   node scripts/test-fulfilment.js
//
// It drives the REAL api handlers (api/checkout.js, api/download.js) against
// the real database, then deletes everything it created. No money, no SlipOK
// credit, no browser.

const { loadEnv } = require('./lib/env');

loadEnv();

const { rest } = require('../server/supabase');
const { config } = require('../server/config');
const { generateLicenseKey } = require('../server/license');

const checkout = require('../api/checkout');
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

// Minimal stand-in for Vercel's (req, res) pair.
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

async function createOrder(email) {
  const res = mockRes();
  await checkout({ method: 'POST', body: { productId: 'prod1', email } }, res);
  const data = json(res);
  if (res.statusCode !== 200 || !data.orderId) {
    throw new Error(`checkout ${res.statusCode}: ${data.error || 'no orderId'}`);
  }
  return data;
}

async function main() {
  console.log('\nDearDev fulfilment test\n');
  console.log(`  download limit: ${config.downloadLimit}`);
  console.log(`  bucket        : ${config.bucket}\n`);

  const created = [];
  const stamp = Date.now();

  try {
    // ---- 1. unpaid order must NOT download --------------------------------
    const unpaid = await createOrder(`fulfil-unpaid+${stamp}@example.com`);
    created.push(unpaid.orderId);
    const rUnpaid = mockRes();
    await download({ method: 'GET', query: { orderId: unpaid.orderId } }, rUnpaid);
    if (rUnpaid.statusCode === 403) ok('unpaid order is refused', '403');
    else bad('unpaid order could download!', `expected 403, got ${rUnpaid.statusCode}`);

    // ---- 2. paid order downloads up to the cap ---------------------------
    const paid = await createOrder(`fulfil-paid+${stamp}@example.com`);
    created.push(paid.orderId);
    ok('order created', `${paid.orderId} — ${paid.amountTHB} ${paid.currency}`);

    const licenseKey = generateLicenseKey();
    await rest(`orders?id=eq.${encodeURIComponent(paid.orderId)}`, {
      method: 'PATCH',
      prefer: 'return=representation',
      body: { status: 'paid', paid_at: new Date().toISOString(), license_key: licenseKey },
    });
    ok('marked paid', `license ${licenseKey}`);

    for (let i = 1; i <= config.downloadLimit; i += 1) {
      const res = mockRes();
      await download({ method: 'GET', query: { orderId: paid.orderId } }, res);
      if (res.statusCode !== 302 || !res.headers.location) {
        bad(`download #${i} failed`, `${res.statusCode} ${json(res).error || ''}`);
        break;
      }
      const file = await fetch(res.headers.location);
      const bytes = Number(file.headers.get('content-length') || 0);
      if (file.status !== 200) {
        bad(`download #${i} — signed URL failed`, `HTTP ${file.status}`);
        break;
      }
      ok(`download #${i}/${config.downloadLimit}`, `${bytes} bytes from the private bucket`);
    }

    // ---- 3. the cap must hold --------------------------------------------
    const rOver = mockRes();
    await download({ method: 'GET', query: { orderId: paid.orderId } }, rOver);
    if (rOver.statusCode === 403) ok('over-limit download refused', 'cap enforced');
    else bad('cap NOT enforced', `expected 403, got ${rOver.statusCode}`);

    // ---- 4. the counter must match ---------------------------------------
    const rows = await rest(
      `orders?select=download_count,status,license_key&id=eq.${encodeURIComponent(paid.orderId)}`,
    );
    const row = rows && rows[0];
    if (!row) {
      bad('could not re-read the order');
    } else {
      if (Number(row.download_count) === config.downloadLimit) {
        ok('download_count matches', String(row.download_count));
      } else {
        bad('download_count is wrong', `${row.download_count} (expected ${config.downloadLimit})`);
      }
      if (row.status === 'paid' && row.license_key === licenseKey) ok('order stayed paid');
      else bad('order state changed unexpectedly', `${row.status}`);
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
    console.log(`${PASS} fulfilment chain is ready.\n`);
  }
}

main().catch((e) => {
  console.error(`\n${FAIL} ${e.message}\n`);
  process.exit(1);
});
