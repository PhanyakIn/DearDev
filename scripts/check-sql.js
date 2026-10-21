#!/usr/bin/env node
// Validates the SQL in supabase/ against a real Postgres before you paste it
// into the Supabase SQL editor.
//
// It runs the files on PGlite (Postgres compiled to WASM) — the same engine
// as the hosted database — so syntax errors, wrong function signatures and
// bad grants are caught locally instead of in the live project.
//
//   node scripts/check-sql.js
//
// PGlite is not a dependency of the shop. If it is missing, this prints the
// one-line install command (it is only needed when you change the SQL).

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let PGlite;
try {
  ({ PGlite } = require('@electric-sql/pglite'));
} catch {
  console.error('\nPGlite is not installed. Run this once:\n');
  console.error('  npm install --no-save @electric-sql/pglite\n');
  process.exit(1);
}

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

async function main() {
  console.log('\nDearDev SQL check (PGlite = real Postgres)\n');

  const db = await PGlite.create();

  // Supabase always has these roles, and the grants in our SQL need them.
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
  `);

  // hardening.sql is meant for a project that already has the shop tables
  // (it only tightens grants and adds the rate-limit counter).
  await db.exec(`
    create table products (
      id text primary key,
      name text,
      price integer,
      currency text,
      image_url text,
      badge text,
      short_detail text,
      description text,
      video_url text,
      is_active boolean default true,
      created_at timestamptz default now()
    );
  `);

  // --- 1. the hardening file (what an existing project needs) ---------------
  const hardening = fs.readFileSync(path.join(ROOT, 'supabase', 'hardening.sql'), 'utf8');
  try {
    await db.exec(hardening);
    ok('supabase/hardening.sql runs without error');
  } catch (e) {
    bad('supabase/hardening.sql failed', e.message);
  }

  // The counter: allow up to the limit, then block; the window resets.
  const first = (await db.query(`select * from check_rate_limit('k1', 2, 60)`)).rows[0];
  if (first && first.allowed === true && first.hits === 1) ok('check_rate_limit() counts the first hit');
  else bad('check_rate_limit() first hit', JSON.stringify(first));

  await db.query(`select * from check_rate_limit('k1', 2, 60)`);
  const third = (await db.query(`select * from check_rate_limit('k1', 2, 60)`)).rows[0];
  if (third && third.allowed === false && third.hits === 3) ok('check_rate_limit() blocks over the limit');
  else bad('check_rate_limit() third hit', JSON.stringify(third));

  const other = (await db.query(`select * from check_rate_limit('k2', 2, 60)`)).rows[0];
  if (other && other.hits === 1) ok('every key gets its own counter');
  else bad('check_rate_limit() per-key counter', JSON.stringify(other));

  await db.query(`select * from check_rate_limit('k3', 1, 1)`);
  await new Promise((r) => setTimeout(r, 1500));
  const after = (await db.query(`select * from check_rate_limit('k3', 1, 1)`)).rows[0];
  if (after && after.hits === 1 && after.allowed === true) ok('the window resets after it expires');
  else bad('check_rate_limit() window reset', JSON.stringify(after));

  const purged = (await db.query(`select purge_rate_limits()`)).rows[0];
  if (purged) ok('purge_rate_limits() runs');
  else bad('purge_rate_limits() failed');

  // --- 2. the full schema (a fresh install) --------------------------------
  const schema = fs.readFileSync(path.join(ROOT, 'supabase', 'schema.sql'), 'utf8');
  try {
    await db.exec(schema);
    ok('supabase/schema.sql runs without error');
  } catch (e) {
    bad('supabase/schema.sql failed', e.message);
  }

  try {
    await db.exec(schema);
    ok('supabase/schema.sql is idempotent (second run is clean)');
  } catch (e) {
    bad('supabase/schema.sql is not idempotent', e.message);
  }

  // The seed must never overwrite a live row.
  await db.exec(`update products set name = 'LIVE', price = 999 where id = 'prod1';`);
  await db.exec(schema);
  const row = (await db.query(`select name, price from products where id = 'prod1'`)).rows[0];
  if (row && row.name === 'LIVE' && row.price === 999) {
    ok('re-running the seed does not touch live product data');
  } else {
    bad('the seed overwrote live data', JSON.stringify(row));
  }

  // The private path stays server-only.
  await db.exec('set role anon;');
  let blocked = false;
  try {
    await db.query('select file_path from products');
  } catch {
    blocked = true;
  }
  await db.exec('reset role;');
  if (blocked) ok('anon cannot read products.file_path');
  else bad('anon can read products.file_path');

  let serverOk = true;
  try {
    await db.query('select file_path from products');
  } catch {
    serverOk = false;
  }
  if (serverOk) ok('the server role can still read products.file_path');
  else bad('the server role lost products.file_path');

  await db.close();
  console.log('');
  if (failures) {
    console.log(`  ${failures} check(s) failed\n`);
    process.exitCode = 1;
  } else {
    console.log('  all checks passed\n');
  }
}

main().catch((e) => {
  console.error('SQL CHECK FAILED:', e && e.message ? e.message : e);
  process.exit(1);
});
