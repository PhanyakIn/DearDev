#!/usr/bin/env node
// Verifies that the payment hardening actually landed in Supabase.
//
//   1. check_rate_limit() exists, counts hits and blocks over the limit
//   2. the anon key (which ships in the browser bundle) can no longer read
//      products.file_path — the private storage object name
//   3. the anon key can still read the public product columns
//
// Run this AFTER pasting supabase/hardening.sql into the Supabase SQL editor.
//
//   node scripts/check-hardening.js
//
// It never prints key values and never changes shop data.

const { loadEnv } = require('./lib/env');

loadEnv();

const { config } = require('../server/config');
const { rpc } = require('../server/supabase');

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

function anonKey() {
  return process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || '';
}

async function anonQuery(select) {
  const res = await fetch(`${config.supabaseUrl}/rest/v1/products?select=${select}&limit=1`, {
    headers: { apikey: anonKey(), Authorization: `Bearer ${anonKey()}` },
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function main() {
  console.log('\nDearDev hardening check\n');
  console.log(`  project: ${config.supabaseUrl}`);
  console.log(`  bucket:  ${config.bucket}\n`);

  // --- 1. the rate-limit function -----------------------------------------
  const key = `check:${Date.now()}`;
  try {
    const first = await rpc('check_rate_limit', {
      p_key: key,
      p_limit: 1,
      p_window_seconds: 60,
    });
    const row = Array.isArray(first) ? first[0] : first;
    if (row && row.allowed === true && Number(row.hits) === 1) {
      ok('check_rate_limit() counts the first hit');
    } else {
      bad('check_rate_limit() returned an unexpected shape', JSON.stringify(row));
    }

    const second = await rpc('check_rate_limit', {
      p_key: key,
      p_limit: 1,
      p_window_seconds: 60,
    });
    const row2 = Array.isArray(second) ? second[0] : second;
    if (row2 && row2.allowed === false) {
      ok('check_rate_limit() blocks over the limit');
    } else {
      bad('check_rate_limit() did not block', JSON.stringify(row2));
    }
  } catch (e) {
    bad('check_rate_limit() is not available', e && e.message ? e.message : String(e));
    console.log('      → run supabase/hardening.sql in the Supabase SQL editor');
  }

  // --- 2. the private storage path must not be public ---------------------
  if (!anonKey()) {
    bad('no anon key found (SUPABASE_ANON_KEY) — cannot check the column grants');
  } else {
    const priv = await anonQuery('file_path');
    if (priv.status === 200) {
      bad('the anon key can still read products.file_path', JSON.stringify(priv.body));
      console.log('      → run supabase/hardening.sql in the Supabase SQL editor');
    } else {
      ok('the anon key cannot read products.file_path', `HTTP ${priv.status}`);
    }

    const pub = await anonQuery('id,name,price,image_url');
    if (pub.status === 200) {
      ok('the anon key can still read the public product columns');
    } else {
      bad('the anon key lost access to the public columns', `HTTP ${pub.status} ${JSON.stringify(pub.body)}`);
      console.log('      → the column grant in supabase/hardening.sql may be missing a column');
    }
  }

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
