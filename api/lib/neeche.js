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
  } catch { return null; }

  if (!Array.isArray(products) || !products.length) return null;

  // Find first product whose name matches the search term tokens
  const termTokens = term.toLowerCase().split(/[-\s]+/).filter(t => t.length > 2);
  const p = products.find(prod => {
    const name = (prod.productName || '').toLowerCase();
    const matched = termTokens.filter(t => name.includes(t));
    if (matched.length < Math.ceil(termTokens.length * 0.6)) return false;
    // Tiebreaker: token mais especifico (nome do perfume) deve estar presente
    if (termTokens.length >= 2) {
      const primary = termTokens.reduce((a, b) => b.length >= a.length ? b : a, termTokens[0]);
      if (!name.includes(primary)) return false;
    }
    return true;
  });
  if (!p) return null;

  const item = p.items?.[0];
  const offer = item?.sellers?.[0]?.commertialOffer;
  if (!offer || offer.Price <= 0) return null;

  // Extract image URL from VTEX response
  const rawImageUrl = item?.images?.[0]?.imageUrl || null;
  const imageUrl = rawImageUrl ? rawImageUrl.replace(/-\d+x\d+\.(\w+)$/, '.$1') : null;

  return {
    store: 'neeche',
    store_display_name: 'Neeche',
    product_name: p.productName,
    price_cents: Math.round(offer.Price * 100),
    currency: 'BRL',
    product_url: `https://www.neeche.com.br/${p.linkText}/p`,
    image_url: imageUrl,
    available: (offer.AvailableQuantity || 0) > 0,
    extraction_confidence: 100
  };
}

module.exports = { searchNeeche };
