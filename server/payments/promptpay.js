// PromptPay adapter: build a per-order payload and render it as a QR image.
// The QR is generated server-side so the proxy value never appears in the
// frontend bundle — the client only receives the rendered image.

const generatePayload = require('promptpay-qr');
const QRCode = require('qrcode');
const { config } = require('../config');

function satangToTHB(satang) {
  return Math.round(Number(satang)) / 100;
}

function assertProxy() {
  if (!config.promptpayProxy) throw new Error('Missing PROMPTPAY_PROXY');
}

// Build the EMVCo PromptPay payload string (proxy + amount).
function buildPayload({ amountSatang, proxy = config.promptpayProxy }) {
  assertProxy();
  return generatePayload(proxy, { amount: satangToTHB(amountSatang) });
}

async function renderQrDataUrl(payload, { width = 320 } = {}) {
  return QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width });
}

module.exports = { buildPayload, renderQrDataUrl, satangToTHB, assertProxy };
