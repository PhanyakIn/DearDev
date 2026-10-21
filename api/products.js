// Vercel serverless backend — public shop API backed by Supabase.
// Env vars (Vercel → Settings → Environment Variables):
//   SUPABASE_URL, SUPABASE_ANON_KEY

const { fetchWithTimeout } = require('../server/fetch');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;

async function supabase(path) {
  const res = await fetchWithTimeout(
    `${URL}/rest/v1/${path}`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
    8000,
  );
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

const PRODUCT_COLUMNS =
  'id,name,price,currency,image_url,badge,short_detail,description,video_url,is_active,created_at';

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
    const { id } = req.query || {};
    if (id) {
      const [rows, contains] = await Promise.all([
        supabase(
          `products?select=${PRODUCT_COLUMNS}&id=eq.${encodeURIComponent(id)}&is_active=eq.true`,
        ),
        supabase(
          `product_contains?select=product_id,item,position&product_id=eq.${encodeURIComponent(id)}&order=position`,
        ),
      ]);
      if (!rows[0]) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.status(200).json(mapProduct(rows[0], contains));
      return;
    }
    const [rows, contains] = await Promise.all([
      supabase(`products?select=${PRODUCT_COLUMNS}&is_active=eq.true&order=created_at`),
      supabase('product_contains?select=product_id,item,position&order=position'),
    ]);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).json(rows.map((r) => mapProduct(r, contains)));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('products API:', e.message);
    res.status(500).json({ error: 'Could not load products' });
  }
};
