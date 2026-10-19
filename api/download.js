// GET /api/download?orderId=...
// Atomically consumes one download, then redirects to a short-lived signed URL.
// Returns 403 when the order is unpaid or the download cap is reached.

const { rest, rpc, createSignedUrl } = require('../server/supabase');
const { sendJson } = require('../server/http');
const { config } = require('../server/config');

function normalizeRpcRow(value) {
  const row = Array.isArray(value) ? value[0] : value;
  // PostgREST serialises a NULL composite (the function returned no row) as an
  // object whose every field is null — not as JSON null. Treat that as "no row".
  if (!row || row.id == null) return null;
  return row;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const orderId = String((req.query && req.query.orderId) || '').trim();
  if (!orderId) return sendJson(res, 400, { error: 'Missing orderId' });

  try {
    // Atomic guard: increments download_count only while paid and under the cap.
    const consumed = normalizeRpcRow(
      await rpc('consume_download', { p_order_id: orderId, p_max: config.downloadLimit }),
    );
    if (!consumed) {
      sendJson(res, 403, { error: 'Download limit reached or order not paid' });
      return;
    }

    const rows = await rest(
      `products?select=file_path&id=eq.${encodeURIComponent(consumed.product_id)}&limit=1`,
    );
    const filePath = rows && rows[0] && rows[0].file_path;
    if (!filePath) {
      sendJson(res, 404, { error: 'File not available' });
      return;
    }

    const signedUrl = await createSignedUrl(config.bucket, filePath, config.signedUrlTtl);

    res.statusCode = 302;
    res.setHeader('Location', signedUrl);
    res.setHeader('Cache-Control', 'no-store');
    res.end();
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
};
