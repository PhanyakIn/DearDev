// Supabase admin client using the service_role key.
// NEVER import this from src/ — it bypasses Row Level Security.

const { config } = require('./config');
const { fetchWithTimeout } = require('./fetch');

const TIMEOUT_MS = 8000;

function assertConfigured() {
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }
}

const baseHeaders = () => ({
  apikey: config.supabaseServiceKey,
  Authorization: `Bearer ${config.supabaseServiceKey}`,
});

// Thin PostgREST wrapper: get/post/patch rows.
async function rest(path, { method = 'GET', body, prefer } = {}) {
  assertConfigured();
  const res = await fetchWithTimeout(
    `${config.supabaseUrl}/rest/v1/${path}`,
    {
      method,
      headers: {
        ...baseHeaders(),
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    TIMEOUT_MS,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`supabase ${res.status}: ${text}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Call a Postgres function (RPC), e.g. consume_download.
async function rpc(fn, args) {
  assertConfigured();
  const res = await fetchWithTimeout(
    `${config.supabaseUrl}/rest/v1/rpc/${fn}`,
    {
      method: 'POST',
      headers: { ...baseHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {}),
    },
    TIMEOUT_MS,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`supabase rpc ${fn} ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Create a short-lived signed URL for a private Storage object.
async function createSignedUrl(bucket, objectPath, expiresIn) {
  assertConfigured();
  const clean = String(objectPath).replace(/^\/+/, '');
  const res = await fetchWithTimeout(
    `${config.supabaseUrl}/storage/v1/object/sign/${bucket}/${clean}`,
    {
      method: 'POST',
      headers: { ...baseHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn }),
    },
    TIMEOUT_MS,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`storage sign ${res.status}: ${text}`);
  }
  const json = await res.json();
  const signed = json.signedURL || json.signedUrl;
  if (!signed) throw new Error('storage sign: missing signedURL');
  return signed.startsWith('http') ? signed : `${config.supabaseUrl}/storage/v1${signed}`;
}

module.exports = { rest, rpc, createSignedUrl };
