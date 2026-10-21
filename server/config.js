// Server-only configuration. Never import this from src/ (frontend).
// All values come from Vercel Environment Variables (see .env.example).

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const config = {
  // Supabase (server uses the service_role key — bypasses RLS)
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  // PromptPay proxy (phone number or citizen id) used to build the QR.
  // Recommend a dedicated/secondary number to avoid leaking your personal one.
  promptpayProxy: process.env.PROMPTPAY_PROXY || '',

  // SlipOK slip-verification API
  slipokApiKey: process.env.SLIPOK_API_KEY || '',
  slipokBranchId: process.env.SLIPOK_BRANCH_ID || '',
  slipokApiUrl: process.env.SLIPOK_API_URL || 'https://api.slipok.com/api/line/apikey',

  // Email is optional. If RESEND_API_KEY/EMAIL_FROM are not set, fulfilment
  // still works and the success page warns the buyer to save the link.
  resendApiKey: process.env.RESEND_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || '',

  // Public site URL (used for links inside emails). If it is missing or points
  // at localhost, the API derives the URL from the request headers instead.
  siteUrl: (process.env.SITE_URL || '').replace(/\/$/, ''),

  // Secret used to sign order success/download links. Optional: if unset, the
  // service-role key is used (also server-only).
  orderTokenSecret: process.env.ORDER_TOKEN_SECRET || '',

  // Storage
  bucket: process.env.DIGITAL_BUCKET || 'digital-products',

  // Behaviour
  downloadLimit: Number(process.env.DOWNLOAD_LIMIT || 3),
  signedUrlTtl: Number(process.env.SIGNED_URL_TTL || 300), // seconds
  qrTtlMinutes: Number(process.env.QR_TTL_MINUTES || 15),

  // How long after the QR countdown finishes we still accept a late slip.
  // A buyer who already transferred the money must not be punished, so this is
  // generous; beyond it the order is closed and they must contact the shop.
  qrGraceMinutes: Number(process.env.QR_GRACE_MINUTES || 120),

  // Abuse guards (each SlipOK check costs a credit, so cap retries per order).
  maxVerifyAttempts: Number(process.env.MAX_VERIFY_ATTEMPTS || 12),
  checkoutWindowMinutes: Number(process.env.CHECKOUT_WINDOW_MINUTES || 10),
  checkoutMaxPerWindow: Number(process.env.CHECKOUT_MAX_PER_WINDOW || 5),

  // Per-IP abuse guards. The per-email limit above is easy to bypass with a
  // throwaway email, so the expensive parts are also capped per IP. The
  // counter lives in Postgres (see supabase/schema.sql) and is shared by
  // every serverless instance.
  rateLimitWindowSeconds: Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 600),
  checkoutMaxPerIp: Number(process.env.CHECKOUT_MAX_PER_IP || 10),
  verifyMaxPerIp: Number(process.env.VERIFY_MAX_PER_IP || 6),

  // Reject oversized uploads before spending a SlipOK credit (~4.5 MB Vercel cap).
  maxSlipBytes: Number(process.env.MAX_SLIP_BYTES || 4000000),

  // How much clock skew we allow between the bank's transaction timestamp and
  // our order creation time. The slip must still be from this order's window.
  slipClockSkewMinutes: Number(process.env.SLIP_CLOCK_SKEW_MINUTES || 5),

  // SlipOK's dashboard log stores the slip image + payer data. Keep it off in
  // production to reduce PII; set SLIPOK_LOG=true only while debugging.
  slipokLog: process.env.SLIPOK_LOG === 'true',

  // By default production only accepts an uploaded image. `data`/`url` inputs
  // are a dev/integration convenience and are disabled unless explicitly enabled.
  allowSlipData: process.env.ALLOW_SLIP_DATA === '1',
};

module.exports = { config, required };
