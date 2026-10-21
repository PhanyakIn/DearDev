// Vercel serverless backend — contact channels (single row).
const { fetchWithTimeout } = require('../server/fetch');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!URL || !KEY) {
    res.status(500).json({ error: 'Shop API is not configured' });
    return;
  }
  try {
    const r = await fetchWithTimeout(
      `${URL}/rest/v1/site_contact?select=discord,facebook&id=eq.1`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
      8000,
    );
    if (!r.ok) throw new Error(`supabase ${r.status}`);
    const rows = await r.json();
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).json({
      discord: rows[0]?.discord || '',
      facebook: rows[0]?.facebook || '',
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('contact API:', e.message);
    res.status(500).json({ error: 'Could not load contact details' });
  }
};
