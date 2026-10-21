// SlipOK slip-verification API adapter.
// Docs: https://slipok.com/api-documentation/check-slip/
//
// POST {SLIPOK_API_URL}/{branchId}
// Header: { x-authorization: <apiKey> }
// Body:   { data } | { url } | multipart { files }
//          + optional { amount, log }

const { config } = require('../config');
const { fetchWithTimeout } = require('../fetch');

// Returns { ok, data?, code?, message? }
async function verifySlip({ data, url, imageBase64, imageMime, amountTHB, log = false }) {
  if (!config.slipokApiKey || !config.slipokBranchId) {
    throw new Error('Missing SLIPOK_API_KEY / SLIPOK_BRANCH_ID');
  }
  const endpoint = `${config.slipokApiUrl}/${config.slipokBranchId}`;
  const headers = { 'x-authorization': config.slipokApiKey };

  let body;
  if (imageBase64) {
    // Multipart upload of a slip image.
    const form = new FormData();
    const buffer = Buffer.from(imageBase64, 'base64');
    const blob = new Blob([buffer], { type: imageMime || 'image/jpeg' });
    form.append('files', blob, 'slip.jpg');
    form.append('log', String(log));
    if (amountTHB != null) form.append('amount', String(amountTHB));
    body = form; // fetch sets the multipart boundary automatically
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({
      ...(data ? { data } : {}),
      ...(url ? { url } : {}),
      log,
      ...(amountTHB != null ? { amount: amountTHB } : {}),
    });
  }

  const res = await fetchWithTimeout(endpoint, { method: 'POST', headers, body }, 8000);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }

  if (res.ok && json.success && json.data && json.data.success) {
    return { ok: true, data: json.data };
  }
  return {
    ok: false,
    code: json.code || res.status,
    message: json.message || 'Slip verification failed',
    data: json.data || null,
  };
}

// SlipOK error codes → buyer-facing English messages.
// SlipOK itself returns Thai text, so we never forward its raw message.
const MESSAGES = {
  1000: 'Please upload a slip image.',
  1001: 'The shop payment setup is incomplete. Please contact us.',
  1002: 'The shop payment setup is incomplete. Please contact us.',
  1003: 'The shop payment setup is incomplete. Please contact us.',
  1004: 'Verification is temporarily unavailable. Please try again later.',
  1005: 'That file is not a supported image. Please upload a JPG or PNG.',
  1006: 'The image looks corrupted. Please upload the original screenshot.',
  1007:
    'We could not find a payment QR code on this slip. Please upload the slip from your banking app — e-wallet slips (e.g. TrueMoney) cannot be verified automatically.',
  1008:
    'This QR code is not a payment verification code. Please upload your bank transfer slip.',
  1009: 'The bank is temporarily unavailable. Please try again in about 15 minutes.',
  1010: 'Your bank is still processing this transfer. Please try again in a few minutes.',
  1011: 'This slip has expired or the transaction could not be found.',
  1012: 'This slip has already been used.',
  1013: 'The amount on the slip does not match this order.',
  1014: "This slip was not paid to the shop's receiving account.",
};

function describeCode(code, data) {
  // 1010 carries the bank's delay in minutes (currently BBL and SCB).
  if (Number(code) === 1010 && data && Number(data.delay) > 0) {
    return `Your bank is still processing this transfer. Please try again in about ${data.delay} minutes.`;
  }
  return (
    MESSAGES[Number(code)] ||
    'We could not verify this slip. Please try again or contact the shop.'
  );
}

module.exports = { verifySlip, describeCode };

