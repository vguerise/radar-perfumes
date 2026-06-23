const { encontrarMelhorCorrespondencia } = require('./similaridade');

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

const MAX_HTML = 80000;

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'");
}

async function fetchHtml(url, timeout) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      'Accept': 'text/html,application/xhtml+xml'
    },
    signal: AbortSignal.timeout(timeout)
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

// Extract all product entries from Nuvemshop data-product-* attributes (deterministic, no AI)
function extractProducts(html, domain) {
  const products = [];
  const tagRx = /<[a-z][^>]*\bdata-product-id="(\d+)"([^>]*)>/gi;
  let m;
  while ((m = tagRx.exec(html)) !== null) {
    const attrs = m[0];
    const name = decodeEntities((attrs.match(/\bdata-product-name="([^"]*)"/) || [])[1] || '');
    const priceStr = (attrs.match(/\bdata-product-price="(\d+)"/) || [])[1] || '';
    let url = (attrs.match(/\bdata-product-url="([^"]*)"/) || [])[1] || '';
    const avail = (attrs.match(/\bdata-product-available="([^"]*)"/) || [])[1];

    if (!name || !priceStr) continue;

    if (url && !url.startsWith('http')) {
      url = `https://${domain}${url.startsWith('/') ? '' : '/'}${url}`;
    }

    products.push({
      productName: name, // field expected by similaridade.js
      price_cents: parseInt(priceStr, 10),
      url: url || null,
      available: avail !== 'false'
    });
  }
  return products;
}

// Extract schema.org/Product JSON-LD from a product page (the check_jsonld.js approach)
function extractJsonLd(html) {
  const rx = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = rx.exec(html)) !== null) {
    try {
      const obj = JSON.parse(m[1].trim());
      if (obj['@type'] === 'Product' || obj.offers) return obj;
      if (Array.isArray(obj['@graph'])) {
        const p = obj['@graph'].find(n => n['@type'] === 'Product');
        if (p) return p;
      }
    } catch {}
  }
  return null;
}

async function searchNuvemshop(storeId, term) {
  const store = STORES[storeId];

  let html;
  try {
    html = await fetchHtml(store.search_url(term), 10000);
  } catch { return null; }

  if (!html.includes('data-product')) return null;

  const products = extractProducts(html.slice(0, MAX_HTML), store.domain);
  if (!products.length) return null;

  const match = encontrarMelhorCorrespondencia(term, products);
  if (!match) return null;

  const { produto: p, confianca } = match;
  let priceCents = p.price_cents;
  let imageUrl = null;

  // Fetch product page for JSON-LD: canonical price (handles "de/por") and official image
  if (p.url) {
    try {
      const productHtml = await fetchHtml(p.url, 6000);
      const jsonld = extractJsonLd(productHtml);
      if (jsonld) {
        const offers = Array.isArray(jsonld.offers) ? jsonld.offers[0] : jsonld.offers;
        if (offers?.price) {
          const parsed = parseFloat(String(offers.price).replace(',', '.'));
          if (parsed > 0 && parsed < 50000) priceCents = Math.round(parsed * 100);
        }
        const img = Array.isArray(jsonld.image) ? jsonld.image[0] : jsonld.image;
        if (img) imageUrl = typeof img === 'string' ? img : (img.url || null);
      }
    } catch {}
  }

  if (!priceCents || priceCents <= 0 || priceCents > 5000000) return null;

  return {
    store: store.id,
    store_display_name: store.display_name,
    product_name: p.productName,
    price_cents: priceCents,
    currency: 'BRL',
    product_url: p.url || store.search_url(term),
    image_url: imageUrl,
    available: p.available,
    extraction_confidence: Math.round(confianca * 100)
  };
}

module.exports = { searchNuvemshop };
