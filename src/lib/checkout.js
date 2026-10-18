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

export function submitSlip(orderId, slip) {
  return request('/api/verify-slip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, slip }),
  });
}

export function fetchOrder(orderId) {
  return request(`/api/order?orderId=${encodeURIComponent(orderId)}`);
}

export function downloadUrl(orderId) {
  return `/api/download?orderId=${encodeURIComponent(orderId)}`;
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
