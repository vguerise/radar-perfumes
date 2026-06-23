const jwt = require('jsonwebtoken');
const { normalizeQuery } = require('./lib/normalize');
const { searchNeeche } = require('./lib/neeche');
const { searchNuvemshop } = require('./lib/nuvemshop');
const { getCached, saveCache, logSearch } = require('./lib/cache');
const { getDb } = require('./lib/db');

function authGuard(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return false;
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

async function getImagemStorage(slug) {
  const { data } = await getDb()
    .from('perfume_imagens')
    .select('storage_path')
    .eq('nome_normalizado', slug)
    .eq('status', 'ok')
    .maybeSingle();
  if (!data?.storage_path) return null;
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/perfume-images/${data.storage_path}`;
}

function triggerExtracaoImagem(slug) {
  const url = `${process.env.SUPABASE_URL}/functions/v1/extrair-imagem-neeche`;
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ nomeNormalizado: slug, termoBusca: slug }),
    signal: AbortSignal.timeout(5000),
  });
}

function injetarImagem(results, imagemUrl) {
  for (const r of results) r.image_url = imagemUrl;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!authGuard(req)) return res.status(401).json({ error: 'Não autorizado' });

  const { query } = req.body || {};
  if (!query?.trim()) return res.status(400).json({ error: 'query obrigatória' });

  try {
    // 1. slugs existentes para match determinístico (evita chamada ao Claude)
    const { data: rows } = await getDb().from('price_cache').select('product_slug');
    const existingSlugs = (rows || []).map(r => r.product_slug);

    // 2. normalizar termo → slug canônico
    const { slug, display_name } = await normalizeQuery(query.trim(), existingSlugs);

    // 3. verificar imagem permanente no Storage (sempre fresca, independente do price cache)
    const imagemUrl = await getImagemStorage(slug);

    // 4. checar price cache
    const cached = await getCached(slug);
    if (cached) {
      if (imagemUrl) injetarImagem(cached.results, imagemUrl);
      await logSearch(query, slug, true);
      return res.status(200).json({
        slug,
        display_name: cached.display_name,
        results: cached.results,
        cached_at: cached.cached_at
      });
    }

    // 5. buscar nas 6 lojas em paralelo
    const [r0, r1, r2, r3, r4, r5] = await Promise.allSettled([
      searchNeeche(slug),
      searchNuvemshop('the_gregs', slug),
      searchNuvemshop('pequi', slug),
      searchNuvemshop('king_of_parfums', slug),
      searchNuvemshop('rivoli', slug),
      searchNuvemshop('mellalta', slug)
    ]);

    const results = [r0, r1, r2, r3, r4, r5]
      .filter(r => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);

    // 6. injetar imagem permanente ou acionar extração assíncrona (fire-and-forget)
    if (imagemUrl) {
      injetarImagem(results, imagemUrl);
    } else {
      triggerExtracaoImagem(slug).catch(() => {});
    }

    // 7. salvar cache e log
    await saveCache(slug, display_name, results);
    await logSearch(query, slug, false);

    return res.status(200).json({
      slug,
      display_name,
      results,
      cached_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('search error:', err.message);
    return res.status(500).json({ error: 'Erro ao processar busca. Tente novamente.' });
  }
};
