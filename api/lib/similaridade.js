function semAcento(s) {
  return s.split('').map(function(c) {
    var code = c.charCodeAt(0);
    if (code >= 0xC0 && code <= 0xC6) return 'a';
    if (code >= 0xC8 && code <= 0xCB) return 'e';
    if (code >= 0xCC && code <= 0xCF) return 'i';
    if (code >= 0xD2 && code <= 0xD6) return 'o';
    if (code >= 0xD9 && code <= 0xDC) return 'u';
    if (code >= 0xE0 && code <= 0xE6) return 'a';
    if (code >= 0xE8 && code <= 0xEB) return 'e';
    if (code >= 0xEC && code <= 0xEF) return 'i';
    if (code >= 0xF2 && code <= 0xF6) return 'o';
    if (code >= 0xF9 && code <= 0xFC) return 'u';
    if (code === 0xF1 || code === 0xD1) return 'n';
    if (code === 0xE7 || code === 0xC7) return 'c';
    return c;
  }).join('');
}

const CONTAMINANTE = /\b(kit|tester|travel|mini|miniatura|pack|set|coffret|splash|refil|refill|sample)\b/i;

function normalizar(s) {
  const r = semAcento(s.toLowerCase())
    .replace(/[-_]/g, ' ')
    .replace(/\b(eau\s+de\s+parfum|eau\s+de\s+toilette|extrait\s+de\s+parfum|parfum\s+de\s+toilette|eau\s+de\s+cologne|after\s+shave|aftershave|edp|edt|edc|parfum|cologne|perfume|unissex|masculino|feminino|masculina|feminina|spray|lotion|body|gel|shower|deodorant|desodorante|\d+\s*ml)\b/gi, '')
    .replace(/\s+/g, ' ').trim();
  return r.split(' ').sort().join(' ');
}

function levenshtein(a, b) {
  const n = b.length + 1;
  const d = new Uint16Array((a.length + 1) * n);
  for (let i = 0; i <= a.length; i++) d[i * n] = i;
  for (let j = 0; j <= b.length; j++) d[j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i*n+j] = a[i-1] === b[j-1]
        ? d[(i-1)*n+(j-1)]
        : 1 + Math.min(d[(i-1)*n+j], d[i*n+(j-1)], d[(i-1)*n+(j-1)]);
  return d[a.length * n + b.length];
}

function similaridade(a, b) {
  a = normalizar(a); b = normalizar(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function encontrarMelhorCorrespondencia(termoBuscado, produtos, limiarConfianca = 0.65) {
  let melhor = null;
  let melhorScore = 0;

  for (const produto of produtos) {
    const nome = produto.productName || '';
    if (CONTAMINANTE.test(nome)) continue;
    const score = similaridade(termoBuscado, nome);
    if (score > melhorScore) {
      melhorScore = score;
      melhor = produto;
    }
  }

  if (!melhor || melhorScore < limiarConfianca) return null;
  return { produto: melhor, confianca: melhorScore };
}

module.exports = { similaridade, encontrarMelhorCorrespondencia };