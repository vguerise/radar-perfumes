const Anthropic = require('@anthropic-ai/sdk');

const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const STORES = {
  the_gregs: {
    id: 'the_gregs', display_name: 'The Gregs Exclusive', domain: 'thegregsexclusive.com',
    search_url: (q) => `https://thegregsexclusive.com/busca/?q=${encodeURIComponent(q)}`
  },
  pequi: {
    id: 'pequi', display_name: 'Pequi Perfumes', domain: 'www.pequiperfumes.com.br',
    search_url: (q) => `https://www.pequiperfumes.com.br/busca/?q=${encodeURIComponent(q)}`
  },
  king_of_parfums: {
    id: 'king_of_parfums', display_name: 'The King of Parfums', domain: 'www.thekingofparfums.com.br',
    search_url: (q) => `https://www.thekingofparfums.com.br/busca/?q=${encodeURIComponent(q)}`
  },
  rivoli: {
    id: 'rivoli', display_name: 'Rivoli Perfumaria', domain: 'www.rivoliperfumaria.com.br',
    search_url: (q) => `https://www.rivoliperfumaria.com.br/busca/?q=${encodeURIComponent(q)}`
  },
  mellalta: {
    id: 'mellalta', display_name: 'Mell Alta Perfumaria', domain: 'www.mellaltaperfumaria.com.br',
    search_url: (q) => `https://www.mellaltaperfumaria.com.br/loja/busca.php?loja=1053276&palavra_busca=${encodeURIComponent(q)}`
  }
};

const CONFIDENCE_MIN = 85;
const MAX_HTML = 60000;

// Extract data-product-price attributes from Nuvemshop HTML (more reliable than Claude for prices)
function extractNuvemshopPrices(html) {
  const items = [];
  const rx = /data-product-id="(\d+)"[^>]*>[\s\S]*?data-product-price="(\d+)"/g;
  let m;
  while ((m = rx.exec(html)) !== null) {
    items.push({ id: m[1], priceCents: parseInt(m[2], 10) });
  }
  return items;
}

async function searchNuvemshop(storeId, term) {
  const store = STORES[storeId];

  let html;
  try {
    const r = await fetch(store.search_url(term), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Accept': 'text/html'
      },
      signal: AbortSignal.timeout(12000)
    });
    if (!r.ok) return null;
    html = await r.text();
  } catch { return null; }

  // Sanity check: must have product-related content (not a generic error page)
  if (!html.includes('data-product') && !html.includes('produto') && !html.includes('price')) return null;

  const trimmed = html.length > MAX_HTML ? html.slice(0, MAX_HTML) : html;

  let extracted;
  try {
    const msg = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Extraia dados do produto que corresponde a "${term}" neste HTML de loja de perfumes.

Retorne APENAS JSON (sem texto extra):
{"found":true,"product_name":"nome","price_cents":276900,"product_url":"https://dominio.com/produto","image_url":"https://cdn.exemplo.com/img.jpg","available":true,"confidence":95}

Ou se nao encontrar: {"found":false}

Regras:
- price_cents em centavos (R$ 2.769,00 -> 276900). Se houver preco "de/por", use o "por" (menor)
- confidence >= 90 so se tiver certeza que e exatamente o produto buscado
- product_url DEVE comecar com https://${store.domain}/
- O nome do produto buscado (${term.split('-').join(' ')}) deve estar claramente no resultado

HTML:
${trimmed}`
      }]
    });
    const text = msg.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    extracted = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch { return null; }

  if (!extracted.found) return null;
  if ((extracted.confidence ?? 0) < CONFIDENCE_MIN) return null;
  if (!extracted.price_cents || extracted.price_cents <= 0 || extracted.price_cents > 5000000) return null;
  if (!extracted.product_url?.startsWith(`https://${store.domain}`)) return null;

  const termTokens = term.toLowerCase().split(/[-\s]+/).filter(t => t.length > 2);
  const nameStr = (extracted.product_name || '').toLowerCase();
  const matched = termTokens.filter(t => nameStr.includes(t));
  if (matched.length < Math.ceil(termTokens.length * 0.6)) return null;
  if (termTokens.length >= 2) {
    const primary = termTokens.reduce((a, b) => b.length >= a.length ? b : a, termTokens[0]);
    if (!nameStr.includes(primary)) return null;
  }

  return {
    store: store.id,
    store_display_name: store.display_name,
    product_name: extracted.product_name,
    price_cents: extracted.price_cents,
    currency: 'BRL',
    product_url: extracted.product_url,
    image_url: extracted.image_url || null,
    available: extracted.available !== false,
    extraction_confidence: extracted.confidence
  };
}

module.exports = { searchNuvemshop };