// Vercel serverless backend — public shop API backed by Supabase.
// Env vars (Vercel → Settings → Environment Variables):
//   SUPABASE_URL, SUPABASE_ANON_KEY

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;

async function supabase(path) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`supabase ${res.status}`);
  return res.json();
}

function mapProduct(row, contains) {
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    currency: row.currency,
    image: row.image_url,
    badge: row.badge,
    shortDetail: row.short_detail,
    description: row.description,
    videoUrl: row.video_url,
    contains: contains
      .filter((c) => c.product_id === row.id)
      .sort((a, b) => a.position - b.position)
      .map((c) => c.item),
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!URL || !KEY) {
    res.status(500).json({ error: 'Missing SUPABASE_URL / SUPABASE_ANON_KEY' });
    return;
  }
  try {
    const { id } = req.query || {};
    if (id) {
      const [rows, contains] = await Promise.all([
        supabase(`products?select=*&id=eq.${encodeURIComponent(id)}&is_active=eq.true`),
        supabase(`product_contains?select=*&product_id=eq.${encodeURIComponent(id)}&order=position`),
      ]);
      if (!rows[0]) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.status(200).json(mapProduct(rows[0], contains));
      return;
    }
    const [rows, contains] = await Promise.all([
      supabase('products?select=*&is_active=eq.true&order=created_at'),
      supabase('product_contains?select=*&order=position'),
    ]);
    res.status(200).json(rows.map((r) => mapProduct(r, contains)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
