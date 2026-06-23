const jwt = require('jsonwebtoken');
const { getDb } = require('./lib/db');

function getEmail(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload.sub;
  } catch { return null; }
}

module.exports = async function handler(req, res) {
  const email = getEmail(req);
  if (!email) return res.status(401).json({ error: 'Não autorizado' });

  if (req.method === 'GET') {
    const { data } = await getDb()
      .from('price_alerts')
      .select('product_slug, display_name, baseline_price_cents, enabled, created_at')
      .eq('user_email', email)
      .eq('enabled', true);
    return res.status(200).json({ alerts: data || [] });
  }

  if (req.method === 'POST') {
    const { slug, display_name, current_price_cents } = req.body || {};
    if (!slug) return res.status(400).json({ error: 'slug obrigatório' });

    const { data: existing } = await getDb()
      .from('price_alerts')
      .select('id, enabled')
      .eq('user_email', email)
      .eq('product_slug', slug)
      .maybeSingle();

    if (existing) {
      const newEnabled = !existing.enabled;
      await getDb()
        .from('price_alerts')
        .update({ enabled: newEnabled })
        .eq('id', existing.id);
      return res.status(200).json({ enabled: newEnabled });
    }

    await getDb().from('price_alerts').insert({
      user_email: email,
      product_slug: slug,
      display_name: display_name || slug,
      baseline_price_cents: current_price_cents || null,
      enabled: true
    });
    return res.status(200).json({ enabled: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
