// Vercel serverless backend — contact channels (single row).
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!URL || !KEY) {
    res.status(500).json({ error: 'Missing SUPABASE_URL / SUPABASE_ANON_KEY' });
    return;
  }
  try {
    const r = await fetch(`${URL}/rest/v1/site_contact?select=*&id=eq.1`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    if (!r.ok) throw new Error(`supabase ${r.status}`);
    const rows = await r.json();
    res.status(200).json({
      discord: rows[0]?.discord || '',
      facebook: rows[0]?.facebook || '',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
