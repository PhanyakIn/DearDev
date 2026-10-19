// GET /api/health
//
// Two jobs:
//   1. Uptime probe for external monitors.
//   2. Keep the free Supabase project awake. Free projects are paused after
//      ONE WEEK of inactivity — a paused project means every customer sees
//      errors until it is restored by hand. A daily cron hit avoids that.

const { rest } = require('../server/supabase');
const { sendJson } = require('../server/http');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const startedAt = Date.now();
  try {
    // Smallest possible read that still touches Postgres.
    await rest('products?select=id&limit=1');
    sendJson(res, 200, {
      ok: true,
      db: 'up',
      latencyMs: Date.now() - startedAt,
      time: new Date().toISOString(),
    });
  } catch (e) {
    sendJson(res, 503, {
      ok: false,
      db: 'down',
      error: e.message,
      time: new Date().toISOString(),
    });
  }
};
