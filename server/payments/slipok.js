// SlipOK slip-verification API adapter.
// Docs: https://slipok.com/api-documentation/check-slip/
//
// POST {SLIPOK_API_URL}/{branchId}
// Header: { x-authorization: <apiKey> }
// Body:   { data } | { url } | multipart { files }
//          + optional { amount, log }

const { config } = require('../config');

// Returns { ok, data?, code?, message? }
async function verifySlip({ data, url, imageBase64, imageMime, amountTHB, log = true }) {
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

  const res = await fetch(endpoint, { method: 'POST', headers, body });
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
    message: json.message || 'ตรวจสอบสลิปไม่สำเร็จ',
    data: json.data || null,
  };
}

module.exports = { verifySlip };
