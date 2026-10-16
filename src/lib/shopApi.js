// Thin Supabase REST client — no extra dependencies.
// Reads public shop data via PostgREST. Falls back to local files
// when env vars are missing (local dev without Supabase).

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

async function supabaseFetch(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${path}`);
  return res.json();
}

// Map snake_case DB row → camelCase shape the UI already uses.
function mapProduct(row, containsRows = []) {
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
    contains: containsRows
      .filter((c) => c.product_id === row.id)
      .sort((a, b) => a.position - b.position)
      .map((c) => c.item),
  };
}

export async function fetchProducts() {
  if (!isSupabaseConfigured) {
    // NOTE: imports products.example (committed) — never products.js
    // (git-ignored, absent on Vercel, would break the build).
    const local = await import('../data/products.example');
    return local.products;
  }
  const [rows, contains] = await Promise.all([
    supabaseFetch('products?select=*&is_active=eq.true&order=created_at'),
    supabaseFetch('product_contains?select=*&order=position'),
  ]);
  return rows.map((r) => mapProduct(r, contains));
}

export async function fetchProductById(id) {
  const all = await fetchProducts();
  return all.find((p) => p.id === id);
}

export async function fetchContact() {
  if (!isSupabaseConfigured) {
    const local = await import('../data/products.example');
    return local.contact;
  }
  const rows = await supabaseFetch('site_contact?select=*&id=eq.1');
  return { discord: rows[0]?.discord || '', facebook: rows[0]?.facebook || '' };
}
