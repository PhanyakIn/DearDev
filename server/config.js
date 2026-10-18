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

  // Resend email
  resendApiKey: process.env.RESEND_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || 'DearDev <onboarding@resend.dev>',

  // Public site URL (used for links inside emails)
  siteUrl: (process.env.SITE_URL || '').replace(/\/$/, ''),

  // Storage
  bucket: process.env.DIGITAL_BUCKET || 'digital-products',

  // Behaviour
  downloadLimit: Number(process.env.DOWNLOAD_LIMIT || 3),
  signedUrlTtl: Number(process.env.SIGNED_URL_TTL || 300), // seconds
  qrTtlMinutes: Number(process.env.QR_TTL_MINUTES || 15),
};

module.exports = { config, required };
