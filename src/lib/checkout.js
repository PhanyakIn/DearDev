// Client helpers for the payment flow. Talks to the /api/* serverless routes.

async function request(url, options) {
  const res = await fetch(url, options);
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(data.error || data.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function startCheckout(productId, email) {
  return request('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, email }),
  });
}

export function submitSlip(orderId, accessToken, slip) {
  return request('/api/verify-slip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, token: accessToken, slip }),
  });
}

export function fetchOrder(orderId, accessToken) {
  return request(
    `/api/order?orderId=${encodeURIComponent(orderId)}&token=${encodeURIComponent(accessToken)}`,
  );
}

export function downloadUrl(orderId, accessToken) {
  return (
    `/api/download?orderId=${encodeURIComponent(orderId)}` +
    `&token=${encodeURIComponent(accessToken)}`
  );
}

// Keep a pointer to the last order in this browser. Email delivery is optional
// (and may be disabled), so this is the safety net for a buyer who loses the
// success page. The token is still required; this is not a password recovery.
const LAST_ORDER_KEY = 'dearcheckout:last-order';
const LAST_ORDER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function rememberOrder({ orderId, accessToken, productId }) {
  if (!orderId || !accessToken) return;
  try {
    window.localStorage.setItem(
      LAST_ORDER_KEY,
      JSON.stringify({ orderId, accessToken, productId, savedAt: Date.now() }),
    );
  } catch {
    /* private mode / storage full: the success page still works right now */
  }
}

export function readLastOrder() {
  try {
    const raw = window.localStorage.getItem(LAST_ORDER_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || !saved.orderId || !saved.accessToken) return null;
    if (!Number.isFinite(saved.savedAt) || Date.now() - saved.savedAt > LAST_ORDER_TTL_MS) {
      window.localStorage.removeItem(LAST_ORDER_KEY);
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

// Read a File/Blob as a base64 string (no data: prefix).
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Slip image preparation
//
// Vercel caps a serverless request body at ~4.5 MB, and base64 inflates bytes
// by ~33%. An untouched phone photo (3-8 MB) would therefore be rejected before
// it ever reaches SlipOK. We downscale + re-encode in the browser first, trying
// a few settings and keeping the smallest result.
// ---------------------------------------------------------------------------

const MAX_BASE64_CHARS = 3200000; // ≈ 2.4 MB of binary data — safely under the cap

const SHRINK_ATTEMPTS = [
  { maxDim: 1600, quality: 0.82 },
  { maxDim: 1280, quality: 0.72 },
  { maxDim: 1000, quality: 0.6 },
];

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = src;
  });
}

function encodeWithCanvas(img, { maxDim, quality }) {
  try {
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (!srcW || !srcH) return null;

    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
    if (!base64) return null;
    return { imageBase64: base64, imageMime: 'image/jpeg' };
  } catch {
    return null;
  }
}

export function base64Bytes(base64) {
  return Math.ceil((String(base64 || '').length * 3) / 4);
}

// Returns { imageBase64, imageMime, bytes } ready for POST /api/verify-slip.
// Throws an error with status 413 when even the smallest attempt is too big.
export async function prepareSlipImage(file, { attempts = SHRINK_ATTEMPTS } = {}) {
  const rawBase64 = await fileToBase64(file);
  const rawMime = file.type || 'image/jpeg';

  let best = { imageBase64: rawBase64, imageMime: rawMime };
  let img = null;
  try {
    img = await loadImage(`data:${rawMime};base64,${rawBase64}`);
  } catch {
    img = null; // e.g. HEIC the browser cannot decode — fall back to the original
  }

  if (img) {
    for (const opts of attempts) {
      const candidate = encodeWithCanvas(img, opts);
      if (candidate && candidate.imageBase64.length < best.imageBase64.length) {
        best = candidate;
      }
      if (best.imageBase64.length <= MAX_BASE64_CHARS) break;
    }
  }

  if (best.imageBase64.length > MAX_BASE64_CHARS) {
    const err = new Error(
      'That photo is too large. Please choose a smaller screenshot or take a lower-resolution photo.',
    );
    err.status = 413;
    throw err;
  }

  return { ...best, bytes: base64Bytes(best.imageBase64) };
}
