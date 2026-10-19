#!/usr/bin/env node
// Checkout smoke test — verifies the payment pipeline end to end WITHOUT
// spending a SlipOK credit or any real money.
//
//   node scripts/smoke-checkout.js            # verify the pipeline
//   node scripts/smoke-checkout.js --qr       # also save a scannable QR PNG
//
// It creates one throwaway order against the real database, renders the
// PromptPay QR, prints the decoded EMVCo payload (so you can see exactly which
// proxy and amount the QR embeds), then deletes the order again.

const { loadEnv } = require('./lib/env');

loadEnv();

// server/config.js reads process.env at import time, and promptpay.js pulls it
// in on import — so the fallback must be set before ANY server require.
const usingPlaceholder = !process.env.PROMPTPAY_PROXY;
if (usingPlaceholder) {
  process.env.PROMPTPAY_PROXY = '0000000000';
  process.stdout.write(
    '  note: PROMPTPAY_PROXY is not set — using a placeholder number for this test\n',
  );
}

const fs = require('fs');
const os = require('os');
const path = require('path');

const { rest } = require('../server/supabase');
const { config } = require('../server/config');
const promptpay = require('../server/payments/promptpay');

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

// Minimal EMVCo TLV reader, just to show what the QR actually contains.
function decodeTlv(text) {
  const out = [];
  let i = 0;
  while (i + 4 <= text.length) {
    const tag = text.slice(i, i + 2);
    const len = parseInt(text.slice(i + 2, i + 4), 10);
    if (!Number.isFinite(len)) break;
    out.push([tag, text.slice(i + 4, i + 4 + len)]);
    i += 4 + len;
  }
  return out;
}

async function main() {
  console.log('\nDearDev checkout smoke test\n');

  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
  }
  const digits = String(config.promptpayProxy).replace(/\D/g, '');
  const kind = digits.length >= 15 ? 'e-Wallet id' : digits.length >= 13 ? 'citizen id' : 'phone number';
  console.log(`  proxy: ${'*'.repeat(Math.max(digits.length - 4, 0))}${digits.slice(-4)} (${kind})`);
  console.log(`  note : the QR embeds this proxy — the buyer's app shows the real name on it.\n`);

  const products = await rest(
    'products?select=id,name,price,currency,file_path&is_active=eq.true&limit=1',
  );
  const product = products && products[0];
  if (!product) {
    bad('no active product configured');
    console.log('');
    process.exitCode = 1;
    return;
  }
  ok(`product "${product.id}"`, `${product.name} — ${product.price} ${product.currency}`);
  if (!product.file_path) {
    bad('product has no file_path', '/api/checkout would answer 409');
  } else {
    ok('product file_path is set', product.file_path);
  }

  const amountSatang = Math.round(Number(product.price) * 100);
  const payload = promptpay.buildPayload({ amountSatang });
  const decoded = decodeTlv(payload);
  const field = (tag) => {
    const hit = decoded.find(([t]) => t === tag);
    return hit ? hit[1] : null;
  };

  console.log('');
  ok('EMVCo payload built');
  console.log(`      ${payload}`);
  if (field('54') === promptpay.satangToTHB(amountSatang).toFixed(2)) {
    ok('embedded amount matches the product price', `tag 54 = ${field('54')}`);
  } else {
    bad('embedded amount mismatch', `tag 54 = ${field('54')}`);
  }
  if (field('53') === '764') {
    ok('currency is THB', 'tag 53 = 764');
  } else {
    bad('unexpected currency', `tag 53 = ${field('53')}`);
  }
  if (field('29')) {
    ok('merchant account present', 'tag 29 = PromptPay AID + proxy');
  } else {
    bad('missing PromptPay merchant account (tag 29)');
  }

  const qr = await promptpay.renderQrDataUrl(payload);
  if (qr.startsWith('data:image/png;base64,') && qr.length > 500) {
    ok('QR image rendered', `${qr.length} chars`);
  } else {
    bad('QR image did not render');
  }

  // --qr writes a scannable PNG you can actually pay with (real proxy only).
  if (process.argv.includes('--qr')) {
    const file = path.join(os.tmpdir(), 'deardev-qr-test.png');
    fs.writeFileSync(file, Buffer.from(qr.split(',')[1], 'base64'));
    ok('QR image saved', file);
    if (usingPlaceholder) {
      console.log('      (placeholder proxy — the QR will NOT reach your account)');
    } else {
      console.log(`      scan it to transfer ${promptpay.satangToTHB(amountSatang)} THB for real`);
    }
  }

  // Order lifecycle + the exact query API routes use.
  const expiresAt = new Date(Date.now() + config.qrTtlMinutes * 60 * 1000).toISOString();
  const inserted = await rest('orders', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      product_id: product.id,
      email: 'smoke-test@example.com',
      amount: amountSatang,
      currency: product.currency || 'THB',
      status: 'pending',
      qr_expires_at: expiresAt,
    },
  });
  const order = inserted && inserted[0];
  if (!order || !order.id) {
    bad('could not create an order');
    console.log('');
    process.exitCode = 1;
    return;
  }
  ok('order created', `${order.id} (${order.amount} satang)`);

  const since = new Date(Date.now() - config.checkoutWindowMinutes * 60 * 1000).toISOString();
  const recent = await rest(
    `orders?select=id&email=eq.smoke-test%40example.com&created_at=gte.${encodeURIComponent(since)}`,
  );
  ok('rate-limit query works', `${recent.length} of max ${config.checkoutMaxPerWindow} in window`);

  await rest(`orders?id=eq.${encodeURIComponent(order.id)}`, { method: 'DELETE' });
  const still = await rest(`orders?select=id&id=eq.${encodeURIComponent(order.id)}`);
  if (still.length === 0) ok('cleanup', 'throwaway order deleted');
  else bad('could not delete the throwaway order');

  console.log('');
  if (failures) {
    console.log(`${FAIL} ${failures} problem(s) found.\n`);
    process.exitCode = 1;
  } else {
    console.log(`${PASS} checkout pipeline is ready.\n`);
  }
}

main().catch((e) => {
  console.error(`\n${FAIL} ${e.message}\n`);
  process.exit(1);
});
