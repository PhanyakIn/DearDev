#!/usr/bin/env node
// Storage health check — proves the private bucket is configured correctly
// BEFORE a customer pays. Catches the most expensive class of bug: "paid but
// cannot download" caused by a wrong file_path or a public bucket.
//
//   node scripts/check-storage.js
//
// Reads credentials from .env.local / .env. Never prints key values.

const { loadEnv } = require('./lib/env');

loadEnv();

const { config } = require('../server/config');
const { rest, createSignedUrl } = require('../server/supabase');

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

function authHeaders() {
  return {
    apikey: config.supabaseServiceKey,
    Authorization: `Bearer ${config.supabaseServiceKey}`,
  };
}

async function listObjects() {
  const res = await fetch(`${config.supabaseUrl}/storage/v1/object/list/${config.bucket}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: '', limit: 200, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
  });
  if (!res.ok) {
    bad(`cannot list bucket "${config.bucket}"`, `HTTP ${res.status}`);
    return null;
  }
  return res.json();
}

async function main() {
  console.log('\nDearDev storage check\n');

  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
  }
  console.log(`  bucket: ${config.bucket}`);
  console.log(`  project: ${config.supabaseUrl}\n`);

  // 1. The bucket must NOT be publicly readable.
  const objects = await listObjects();
  if (objects) ok(`bucket "${config.bucket}" exists`, `${objects.length} object(s)`);

  if (objects && objects.length) {
    const sample = objects.find((o) => o.name) || objects[0];
    const publicUrl = `${config.supabaseUrl}/storage/v1/object/public/${config.bucket}/${sample.name}`;
    const res = await fetch(publicUrl, { method: 'GET' });
    if (res.status === 200) {
      bad('bucket is PUBLIC', 'anyone can download your paid files — make it private!');
    } else {
      ok('bucket is private', `public URL returned HTTP ${res.status}`);
    }
  }

  // 2. Every active product must point at a real object.
  const products = await rest('products?select=id,name,file_path,is_active&is_active=eq.true');
  const names = new Set((objects || []).map((o) => o.name));
  console.log('');
  for (const product of products || []) {
    if (!product.file_path) {
      bad(`product "${product.id}" has no file_path`, '/api/checkout will return 409');
      continue;
    }
    if (objects && !names.has(product.file_path)) {
      bad(`product "${product.id}" file_path not found`, `"${product.file_path}" is not in the bucket`);
      continue;
    }
    ok(`product "${product.id}" → ${product.file_path}`);
  }

  // 3. A signed URL must actually download the right bytes.
  const target = (products || []).find((p) => p.file_path);
  if (target) {
    console.log('');
    try {
      const signed = await createSignedUrl(config.bucket, target.file_path, 60);
      const res = await fetch(signed);
      const bytes = Number(res.headers.get('content-length') || 0);
      if (res.status === 200) {
        ok('signed URL download works', `${bytes} bytes, expires in ${config.signedUrlTtl}s by default`);
      } else {
        bad('signed URL download failed', `HTTP ${res.status}`);
      }
    } catch (e) {
      bad('could not create a signed URL', e.message);
    }
  }

  console.log('');
  if (failures) {
    console.log(`${FAIL} ${failures} problem(s) found — fix these before selling.\n`);
    process.exitCode = 1;
  } else {
    console.log(`${PASS} storage is ready.\n`);
  }
}

main().catch((e) => {
  console.error(`\n${FAIL} ${e.message}\n`);
  process.exit(1);
});
