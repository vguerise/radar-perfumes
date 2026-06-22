const Anthropic = require('@anthropic-ai/sdk');

const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const STORES = {
  the_gregs: {
    id: 'the_gregs', display_name: 'The Gregs Exclusive', domain: 'thegregsexclusive.com',
    search_url: (q) => `https://thegregsexclusive.com/busca/?q=${encodeURIComponent(q)}`
  },
  pequi: {
    id: 'pequi', display_name: 'Pequi Perfumes', domain: 'pequiperfumes.com.br',
    search_url: (q) => `https://www.pequiperfumes.com.br/busca/?q=${encodeURIComponent(q)}`
  },
  king_of_parfums: {
    id: 'king_of_parfums', display_name: 'The King of Parfums', domain: 'thekingofparfums.com.br',
    search_url: (q) => `https://www.thekingofparfums.com.br/busca/?q=${encodeURIComponent(q)}`
  },
  rivoli: {
    id: 'rivoli', display_name: 'Rivoli Perfumaria', domain: 'rivoliperfumaria.com.br',
    search_url: (q) => `https://www.rivoliperfumaria.com.br/busca/?q=${encodeURIComponent(q)}`
  },
  mellalta: {
    id: 'mellalta', display_name: 'Mell Alta Perfumaria', domain: 'mellaltaperfumaria.com.br',
    search_url: (q) => `https://www.mellaltaperfumaria.com.br/loja/busca.php?loja=1053276&palavra_busca=${encodeURIComponent(q)}`
  }
};

const CONFIDENCE_MIN = 90;
const MAX_HTML = 80000;

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

  const trimmed = html.length > MAX_HTML ? html.slice(0, MAX_HTML) : html;

  let extracted;
  try {
    const msg = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Voce extrai dados de produtos de uma pagina de e-commerce em HTML.

Dado o HTML abaixo de uma pagina de resultados de busca de uma loja de perfumes,
encontre o produto que melhor corresponde ao termo de busca "${term}"
e retorne APENAS um JSON neste formato, sem texto adicional:

{"found":true,"product_name":"nome exato do produto","price_cents":276900,"product_url":"https://dominio.com/produto","image_url":"https://cdn.exemplo.com/imagem.jpg","available":true,"confidence":95,"notes":""}

Se nao encontrar nenhum produto correspondente, retorne:
{"found":false}

Regras criticas:
- price_cents em centavos inteiros (R$ 2.769,00 -> 276900)
- Se houver preco "de/por", use APENAS o preco "por"
- confidence < 70 se houver ambiguidade entre produtos similares
- product_url absoluta com https://
- image_url: URL completa da imagem principal do produto; null se nao encontrar
- O produto retornado DEVE ter o nome do perfume buscado; se o resultado for outro perfume, confidence deve ser < 50
- Nunca invente preco; se nao estiver legivel no HTML retorne found:false

HTML:
${trimmed}`
      }]
    });
    extracted = JSON.parse(msg.content[0].text.trim());
  } catch { return null; }

  if (!extracted.found) return null;
  if ((extracted.confidence ?? 0) < CONFIDENCE_MIN) return null;
  if (!extracted.price_cents || extracted.price_cents <= 0 || extracted.price_cents > 5000000) return null;
  if (!extracted.product_url?.startsWith(`https://${store.domain}`)) return null;

  // Tiebreaker: nome do perfume (nao so a marca) deve estar no resultado
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
