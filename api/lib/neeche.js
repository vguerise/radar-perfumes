async function searchNeeche(term) {
  const url = `https://www.neeche.com.br/api/catalog_system/pub/products/search?ft=${encodeURIComponent(term)}`;

  let products;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RadarPerfumes/1.0)' },
      signal: AbortSignal.timeout(12000)
    });
    if (!r.ok) return null;
    products = await r.json();
  } catch {
    return null;
  }

  if (!Array.isArray(products) || !products.length) return null;

  // Validate that the returned product name matches the search term
  const termTokens = term.toLowerCase().split(/[-\s]+/).filter(t => t.length > 2);
  const p = products.find(prod => {
    const name = (prod.productName || '').toLowerCase();
    const matched = termTokens.filter(t => name.includes(t));
    return matched.length >= Math.ceil(termTokens.length * 0.6);
  });
  if (!p) return null;

  const item = p.items?.[0];
  const offer = item?.sellers?.[0]?.commertialOffer;
  if (!offer || offer.Price <= 0) return null;

  return {
    store: 'neeche',
    store_display_name: 'Neeche',
    product_name: p.productName,
    price_cents: Math.round(offer.Price * 100),
    currency: 'BRL',
    product_url: `https://www.neeche.com.br/${p.linkText}/p`,
    available: (offer.AvailableQuantity || 0) > 0,
    extraction_confidence: 100
  };
}

module.exports = { searchNeeche };
