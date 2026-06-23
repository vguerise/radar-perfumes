const jwt = require('jsonwebtoken');
const { getDb } = require('./lib/db');

function authGuard(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return false;
  try { jwt.verify(token, process.env.JWT_SECRET); return true; } catch { return false; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!authGuard(req)) return res.status(401).json({ error: 'Não autorizado' });

  try {
    const { data } = await getDb()
      .from('price_cache')
      .select('product_slug, display_name, results, cached_at')
      .gt('expires_at', new Date().toISOString())
      .order('cached_at', { ascending: false })
      .limit(12);

    const items = (data || [])
      .map(row => {
        const available = (row.results || []).filter(r => r.available !== false);
        if (!available.length) return null;
        available.sort((a, b) => a.price_cents - b.price_cents);
        const cheapest = available[0];
        const withImage = available.find(r => r.image_url);
        return {
          slug: row.product_slug,
          display_name: row.display_name,
          cheapest_price_cents: cheapest.price_cents,
          cheapest_store: cheapest.store_display_name,
          cheapest_url: cheapest.product_url,
          image_url: withImage?.image_url || null
        };
      })
      .filter(Boolean)
      .slice(0, 6);

    return res.status(200).json({ items });
  } catch {
    return res.status(500).json({ error: 'Erro interno' });
  }
};
