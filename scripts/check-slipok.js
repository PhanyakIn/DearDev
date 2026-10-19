#!/usr/bin/env node
// SlipOK health check.
//
//   node scripts/check-slipok.js                    # credentials + quota only (free)
//   node scripts/check-slipok.js --slip slip.jpg    # send a real slip (uses 1 quota)
//   node scripts/check-slipok.js --slip slip.jpg --amount 199
//
// The quota call proves the branch + API key are valid. Only a real slip can
// prove the receiving account is bound correctly in the LINE LIFF, so run
// --slip once before going live. Never prints the API key.

const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./lib/env');

loadEnv();

const { config } = require('../server/config');
const { verifySlip, describeCode } = require('../server/payments/slipok');

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

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1] || null;
}

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.jfif': 'image/jpeg',
  '.webp': 'image/webp',
};

async function quotaCheck() {
  const url = `${config.slipokApiUrl}/${config.slipokBranchId}/quota`;
  const res = await fetch(url, { headers: { 'x-authorization': config.slipokApiKey } });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error page */
  }

  if (res.ok && json.success && json.data) {
    const { quota, overQuota } = json.data;
    ok('credentials accepted', `quota ${quota} remaining, ${overQuota} over`);
    if (Number(quota) <= 0) {
      bad('quota exhausted', 'top up or upgrade the SlipOK plan before selling');
    } else if (Number(quota) < 20) {
      console.log(`      ! only ${quota} slips left this period`);
    }
    return true;
  }

  bad('credentials rejected', `HTTP ${res.status} ${json.message || text.slice(0, 120)}`);
  return false;
}

async function slipCheck(file, amount) {
  const ext = path.extname(file).toLowerCase();
  const mime = MIME[ext];
  if (!mime) {
    bad(`unsupported file type "${ext}"`, 'use JPG, JPEG, PNG, JFIF or WEBP');
    return;
  }

  const buffer = fs.readFileSync(file);
  console.log(`\n  slip: ${path.basename(file)} (${buffer.length} bytes)`);

  try {
    const result = await verifySlip({
      imageBase64: buffer.toString('base64'),
      imageMime: mime,
      amountTHB: amount == null ? null : Number(amount),
      log: true,
    });

    if (result.ok) {
      const d = result.data || {};
      ok('slip verified', `${d.amount} THB`);
      console.log(`      from     : ${d.sender?.displayName || '-'} (bank ${d.sendingBank || '?'})`);
      console.log(`      to       : ${d.receiver?.displayName || '-'} (bank ${d.receivingBank || '?'})`);
      console.log(`      transRef : ${d.transRef || '-'}`);
    } else {
      bad(`slip rejected — code ${result.code}`, describeCode(result.code, result.data));
      const code = Number(result.code);
      if (code === 1014) {
        console.log('      → the receiving account bound in the SlipOK LINE LIFF does not match this slip.');
        console.log('      → bind the SAME account as PROMPTPAY_PROXY, then redeploy.');
      } else if (code === 1013) {
        console.log(`      → the slip says ${result.data?.amount ?? '?'} THB; that is not the amount you passed.`);
      } else if (code === 1012) {
        console.log('      → this slip was already submitted once. Use a fresh transfer to test.');
      } else if (code === 1010) {
        console.log(`      → bank delay: wait ${result.data?.delay ?? 'a few'} minutes, then check again.`);
      } else if (code === 1002) {
        console.log('      → check SLIPOK_API_KEY (it is rejected before any slip is read).');
      } else if (code === 1004) {
        console.log('      → quota or subscription problem on the SlipOK account.');
      }
    }
  } catch (e) {
    bad('request failed', e.message);
  }
}

async function main() {
  console.log('\nDearDev SlipOK check\n');

  if (!config.slipokApiKey || !config.slipokBranchId) {
    console.error('  Missing SLIPOK_API_KEY / SLIPOK_BRANCH_ID in .env.local');
    console.error('  Get both from the SlipOK LINE LIFF after choosing the "API" channel.\n');
    process.exit(1);
  }

  console.log(`  branch: ${config.slipokBranchId}`);
  console.log(`  key   : set (${config.slipokApiKey.length} chars)`);
  console.log('');

  const credentialsOk = await quotaCheck();

  const slip = arg('--slip');
  if (credentialsOk && slip) {
    await slipCheck(path.resolve(slip), arg('--amount'));
  } else if (credentialsOk) {
    console.log('\n  next: --slip <file.jpg> to test a real slip (uses 1 quota)');
    console.log('        that is the only way to prove the receiving account is bound.');
  }

  console.log('');
  if (failures) {
    console.log(`${FAIL} ${failures} problem(s) found.\n`);
    process.exitCode = 1;
  } else {
    console.log(`${PASS} SlipOK is ready.\n`);
  }
}

main().catch((e) => {
  console.error(`\n${FAIL} ${e.message}\n`);
  process.exit(1);
});
