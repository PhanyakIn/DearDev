#!/usr/bin/env node
// Order admin CLI — the manual override for when automation cannot help.
//
// Credentials are read from .env.local / .env (same file the server uses) and
// are never printed. Run from the repo root:
//
//   node scripts/orders.js list [status] [limit]   # e.g. list pending 20
//   node scripts/orders.js show <orderId>
//   node scripts/orders.js paid <orderId>          # manually fulfil an order
//   node scripts/orders.js expire                  # close stale pending orders
//   node scripts/orders.js prune [--apply]         # delete abandoned orders, scrub old PII
//   node scripts/orders.js stats
//
// `paid` is the safety net for the bad case: the buyer really transferred the
// money but SlipOK could not confirm it (outage, wrong receiver, expired QR).

const { loadEnv } = require('./lib/env');

// .env.local wins over .env, mirroring CRA/Vercel precedence.
loadEnv();

// Require AFTER env is loaded: server/config reads process.env at import time.
const { rest } = require('../server/supabase');
const { config } = require('../server/config');
const { generateLicenseKey } = require('../server/license');
const { sendDownloadEmail } = require('../server/email');

const COLUMNS =
  'id,product_id,email,amount,currency,status,license_key,slip_ref,download_count,paid_at,created_at';

function thb(satang) {
  return (Number(satang || 0) / 100).toFixed(2);
}

function shortDate(value) {
  if (!value) return '-';
  return new Date(value).toISOString().replace('T', ' ').slice(0, 16);
}

function pad(text, width) {
  const value = String(text == null ? '' : text);
  return value.length > width ? `${value.slice(0, width - 1)}…` : value.padEnd(width);
}

function printTable(rows) {
  if (!rows.length) {
    console.log('(no orders)');
    return;
  }
  console.log(
    [
      pad('created', 16),
      pad('status', 9),
      pad('amount', 9),
      pad('email', 26),
      pad('product', 10),
      'order id',
    ].join(' '),
  );
  console.log('-'.repeat(100));
  for (const o of rows) {
    console.log(
      [
        pad(shortDate(o.created_at), 16),
        pad(o.status, 9),
        pad(thb(o.amount), 9),
        pad(o.email, 26),
        pad(o.product_id, 10),
        o.id,
      ].join(' '),
    );
  }
}

async function list(args) {
  const status = args[0];
  const limit = Number(args[1] || 25);
  let query = `orders?select=${COLUMNS}&order=created_at.desc&limit=${limit}`;
  if (status) query += `&status=eq.${encodeURIComponent(status)}`;
  const rows = await rest(query);
  console.log(`\n${rows ? rows.length : 0} order(s)${status ? ` with status=${status}` : ''}\n`);
  printTable(rows || []);
  console.log('');
}

async function show(orderId) {
  const rows = await rest(
    `orders?select=${COLUMNS},slip_payload&id=eq.${encodeURIComponent(orderId)}&limit=1`,
  );
  const order = rows && rows[0];
  if (!order) {
    console.error(`Order not found: ${orderId}`);
    process.exitCode = 1;
    return;
  }
  const { slip_payload: slipPayload, ...rest2 } = order;
  console.log('\n' + JSON.stringify(rest2, null, 2));
  if (slipPayload) console.log('\nslip_payload:\n' + JSON.stringify(slipPayload, null, 2));
  console.log('');
}

async function markPaid(orderId) {
  const rows = await rest(
    `orders?select=${COLUMNS}&id=eq.${encodeURIComponent(orderId)}&limit=1`,
  );
  const order = rows && rows[0];
  if (!order) {
    console.error(`Order not found: ${orderId}`);
    process.exitCode = 1;
    return;
  }
  if (order.status === 'paid') {
    console.log(`Order is already paid. License key: ${order.license_key}`);
    return;
  }

  const licenseKey = order.license_key || generateLicenseKey();
  const updated = await rest(`orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: {
      status: 'paid',
      paid_at: new Date().toISOString(),
      license_key: licenseKey,
    },
  });
  if (!updated || !updated[0]) {
    console.error('Could not update the order.');
    process.exitCode = 1;
    return;
  }

  const link = config.siteUrl
    ? `${config.siteUrl}/success?orderId=${encodeURIComponent(orderId)}`
    : `/success?orderId=${encodeURIComponent(orderId)}`;

  console.log(`\nMarked ${orderId} as paid.`);
  console.log(`  buyer     : ${order.email}`);
  console.log(`  license   : ${licenseKey}`);
  console.log(`  download  : ${link}`);

  if (!config.resendApiKey) {
    console.log('  email     : skipped (RESEND_API_KEY not set — send the link manually)');
    return;
  }
  try {
    const product = await rest(
      `products?select=name&id=eq.${encodeURIComponent(order.product_id)}&limit=1`,
    );
    await sendDownloadEmail({
      to: order.email,
      productName: (product && product[0] && product[0].name) || 'Your product',
      licenseKey,
      downloadUrl: link,
      limit: config.downloadLimit,
    });
    console.log('  email     : sent');
  } catch (e) {
    console.log(`  email     : FAILED (${e.message}) — send the link manually`);
  }
  console.log('');
}

async function expireStale() {
  const cutoff = new Date(Date.now() - config.qrGraceMinutes * 60 * 1000).toISOString();
  const updated = await rest(
    `orders?status=eq.pending&qr_expires_at=lt.${encodeURIComponent(cutoff)}`,
    { method: 'PATCH', prefer: 'return=representation', body: { status: 'expired' } },
  );
  console.log(`\nClosed ${updated ? updated.length : 0} stale pending order(s).\n`);
}

async function stats() {
  const rows = await rest(`orders?select=status,amount,download_count&limit=10000`);
  const byStatus = {};
  let paidRevenue = 0;
  for (const o of rows || []) {
    byStatus[o.status] = (byStatus[o.status] || 0) + 1;
    if (o.status === 'paid') paidRevenue += Number(o.amount || 0);
  }
  console.log(`\nTotal orders: ${(rows || []).length}`);
  for (const [status, count] of Object.entries(byStatus).sort()) {
    console.log(`  ${pad(status, 10)} ${count}`);
  }
  console.log(`\nPaid revenue: ฿${thb(paidRevenue)}\n`);
}

// Housekeeping. Paid orders are NEVER deleted — their slip_ref is the unique
// index that stops a slip being re-used on a second order, and they are the
// only evidence you have in a dispute. Only the PII and the bulky jsonb are
// cleared once the order is old.
async function prune(args) {
  const apply = args.includes('--apply');
  const daysIndex = args.indexOf('--days');
  const paidDays = daysIndex === -1 ? 180 : Number(args[daysIndex + 1]);
  if (!Number.isFinite(paidDays) || paidDays < 30) {
    throw new Error('--days must be a number >= 30');
  }

  const ago = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const abandoned = {
    label: 'delete  expired / rejected older than 30 days',
    filter: `status=in.(expired,rejected)&created_at=lt.${encodeURIComponent(ago(30))}`,
  };
  const stalePending = {
    label: 'delete  pending older than 90 days',
    filter: `status=eq.pending&created_at=lt.${encodeURIComponent(ago(90))}`,
  };
  const oldPaid = {
    label: `scrub   paid older than ${paidDays} days (email + slip data)`,
    filter: `status=eq.paid&created_at=lt.${encodeURIComponent(ago(paidDays))}`,
  };

  const countMatching = async (filter) => {
    const rows = await rest(`orders?select=id&limit=100000&${filter}`);
    return rows ? rows.length : 0;
  };

  console.log('\nDearDev order prune\n');
  console.log(`  mode: ${apply ? 'APPLY' : 'DRY RUN (add --apply to execute)'}\n`);

  for (const job of [abandoned, stalePending, oldPaid]) {
    job.count = await countMatching(job.filter);
    console.log(`  ${pad(job.label, 48)} ${job.count} order(s)`);
  }

  console.log('\n  paid orders are never deleted:');
  console.log('    - slip_ref feeds a UNIQUE index that blocks re-using a slip');
  console.log('    - they are the evidence you need if a buyer disputes a charge');
  console.log('    - download links keep working after the scrub\n');

  if (!apply) {
    console.log('  nothing was changed.\n');
    return;
  }

  for (const job of [abandoned, stalePending]) {
    if (!job.count) continue;
    const removed = await rest(`orders?select=id&${job.filter}`, {
      method: 'DELETE',
      prefer: 'return=representation',
    });
    console.log(`  removed ${removed ? removed.length : 0} — ${job.label}`);
  }

  if (oldPaid.count) {
    const scrubbed = await rest(`orders?select=id&${oldPaid.filter}`, {
      method: 'PATCH',
      prefer: 'return=representation',
      body: { email: null, slip_payload: null },
    });
    console.log(`  scrubbed ${scrubbed ? scrubbed.length : 0} — ${oldPaid.label}`);
  }

  console.log('\n  Note: Postgres reuses the freed space for new rows. The database');
  console.log('  file itself does not shrink — that is fine, you get the capacity back.\n');
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
  }

  switch (command) {
    case 'list':
      return list(args);
    case 'show':
      if (!args[0]) throw new Error('usage: orders.js show <orderId>');
      return show(args[0]);
    case 'paid':
      if (!args[0]) throw new Error('usage: orders.js paid <orderId>');
      return markPaid(args[0]);
    case 'expire':
      return expireStale();
    case 'prune':
      return prune(args);
    case 'stats':
      return stats();
    default:
      console.log(
        [
          'usage:',
          '  node scripts/orders.js list [status] [limit]',
          '  node scripts/orders.js show <orderId>',
          '  node scripts/orders.js paid <orderId>',
          '  node scripts/orders.js expire',
          '  node scripts/orders.js prune [--apply] [--days 180]',
          '  node scripts/orders.js stats',
        ].join('\n'),
      );
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
