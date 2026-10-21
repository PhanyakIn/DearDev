// Dev-only mock API so the checkout and Success pages can be previewed with
// `npm start` (CRA's dev server has no /api/* routes). This file is used by the
// dev server only — it is never bundled into a production build.
//
// Open: http://localhost:3000/checkout/prod1  (QR screen)
//       http://localhost:3000/success?orderId=demo
//
// Slip verification is NOT a rubber stamp: only scripts/assets/demo-slip.png
// is accepted. Any other image is rejected the way the real backend would
// reject a slip that does not belong to this order.
//
// Change the values below to preview the other states:
//   status: "pending"  → not paid yet
//   remaining: 0       → download limit reached
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const generatePayload = require("promptpay-qr");
const { verifySlip, describeCode } = require("../server/payments/slipok");
const { config } = require("../server/config");

const SLIPOK_READY = Boolean(config.slipokApiKey && config.slipokBranchId);

// PromptPay proxy used for the preview QR. Prefer the real PROMPTPAY_PROXY from
// .env.local so the QR shows the shop's own account name (the same one the
// production /api/checkout uses). Falls back to a fake number when unset.
const ENV_PROXY = (process.env.PROMPTPAY_PROXY || "").trim();
const DEMO_PROXY = ENV_PROXY || "0812345678";
const DEMO_AMOUNT_SATANG = 19900;
const DEMO_DOWNLOAD_LIMIT = 3;
// In-memory counter so the dev Success page shows a real, shrinking quota.
let demoDownloadCount = 0;
const DEMO_SLIP_PATH = path.join(__dirname, "..", "scripts", "assets", "demo-slip.png");

function maskProxy(proxy) {
  if (!proxy || proxy.length <= 4) return proxy || "(none)";
  return `${proxy.slice(0, 2)}${"*".repeat(proxy.length - 4)}${proxy.slice(-2)}`;
}

// eslint-disable-next-line no-console
console.log(
  ENV_PROXY
    ? `[setupProxy] preview QR uses PROMPTPAY_PROXY ${maskProxy(DEMO_PROXY)} — the QR is payable for real`
    : "[setupProxy] PROMPTPAY_PROXY not set — preview QR uses the fake number 0812345678",
);
// eslint-disable-next-line no-console
console.log(
  SLIPOK_READY
    ? "[setupProxy] verify-slip calls the real SlipOK API (each attempt costs a credit)"
    : "[setupProxy] SlipOK keys missing — verify-slip only accepts scripts/assets/demo-slip.png",
);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

// Hash of the one slip the dev mock treats as valid. Read once at startup so
// regenerating the PNG is enough — no hash to update by hand.
let demoSlipHash = null;
try {
  demoSlipHash = sha256(fs.readFileSync(DEMO_SLIP_PATH).toString("base64"));
} catch {
  // Missing sample: every upload gets rejected (fail closed, like production).
}

module.exports = function (app) {
  // POST /api/checkout → returns a mock charge so the QR screen renders
  // without Supabase or a real PROMPTPAY_PROXY. The request body is ignored.
  app.post("/api/checkout", async (req, res) => {
    try {
      const payload = generatePayload(DEMO_PROXY, {
        amount: DEMO_AMOUNT_SATANG / 100,
      });
      const qr = await QRCode.toDataURL(payload, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 320,
      });
      demoDownloadCount = 0; // a new order starts with a fresh quota
      res.json({
        orderId: "demo-order",
        accessToken: "dev-token",
        qr,
        amount: DEMO_AMOUNT_SATANG,
        amountTHB: DEMO_AMOUNT_SATANG / 100,
        currency: "THB",
        productName: "Movement System R6 V1",
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        downloadLimit: DEMO_DOWNLOAD_LIMIT,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/verify-slip → real SlipOK check when keys are configured, so a
  // genuine slip for the preview amount/receiver passes and anything else gets
  // the same rejection codes as production. Without keys it falls back to
  // accepting only scripts/assets/demo-slip.png.
  app.post("/api/verify-slip", async (req, res) => {
    const body = await readJsonBody(req);
    const slip = body.slip || {};
    const base64 = String(slip.imageBase64 || "");

    if (SLIPOK_READY) {
      try {
        const result = await verifySlip({
          imageBase64: base64,
          imageMime: slip.imageMime || "image/jpeg",
          amountTHB: DEMO_AMOUNT_SATANG / 100,
          log: false,
        });

        if (result.ok) {
          demoDownloadCount = 0;
          res.json({
            status: "paid",
            licenseKey: "DEAR-7K3M-QX9P-B4NT",
            downloadLimit: DEMO_DOWNLOAD_LIMIT,
            remaining: DEMO_DOWNLOAD_LIMIT,
            emailSent: false,
          });
          return;
        }

        // The real handler keeps the order pending and lets the buyer retry
        // until the attempt cap; mirror that in the dev preview.
        res.status(202).json({
          status: "pending",
          code: result.code,
          message: describeCode(result.code, result.data),
          retryable: true,
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
      return;
    }

    // Offline fallback: only the bundled demo slip is accepted.
    const accepted = Boolean(demoSlipHash && base64 && sha256(base64) === demoSlipHash);
    setTimeout(() => {
      if (!accepted) {
        res.status(202).json({
          status: "pending",
          code: 1013,
          message: "The slip does not match this order. Please upload the right slip.",
          retryable: true,
        });
        return;
      }
      res.json({
        status: "paid",
        licenseKey: "DEAR-7K3M-QX9P-B4NT",
        downloadLimit: DEMO_DOWNLOAD_LIMIT,
        remaining: DEMO_DOWNLOAD_LIMIT,
        emailSent: false,
      });
    }, 800);
  });

  // GET /api/download → placeholder file, but the quota is enforced exactly like
  // the real api/download.js (403 once downloadLimit is reached).
  app.get("/api/download", (req, res) => {
    if (demoDownloadCount >= DEMO_DOWNLOAD_LIMIT) {
      res.status(403).json({ error: "Download limit reached or order not paid" });
      return;
    }
    demoDownloadCount += 1;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="deardev-demo.txt"');
    res.send(
      `DearDev demo download #${demoDownloadCount} — placeholder from src/setupProxy.js.\n`,
    );
  });

  app.get("/api/order", (req, res) => {
    res.json({
      orderId: "demo-order",
      status: "paid",
      productName: "Movement System R6 V1",
      amount: 19900,
      currency: "THB",
      email: "de***@example.com",
      licenseKey: "DEAR-7K3M-QX9P-B4NT",
      downloadCount: demoDownloadCount,
      downloadLimit: DEMO_DOWNLOAD_LIMIT,
      remaining: Math.max(DEMO_DOWNLOAD_LIMIT - demoDownloadCount, 0),
      paidAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
  });
};
