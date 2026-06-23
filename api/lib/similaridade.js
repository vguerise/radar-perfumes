const RUIDO = /\b(eau\s+de\s+parfum|eau\s+de\s+toilette|extrait\s+de\s+parfum|parfum\s+de\s+toilette|eau\s+de\s+cologne|edp|edt|edc|parfum|cologne|\d+\s*ml)\b/gi;
const CONTAMINANTE = /\b(kit|tester|travel|mini|miniatura|pack|set|coffret|splash|refil|refill|sample)\b/i;

function normalizar(s) {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b(eau\s+de\s+parfum|eau\s+de\s+toilette|extrait\s+de\s+parfum|parfum\s+de\s+toilette|eau\s+de\s+cologne|edp|edt|edc|parfum|cologne|\d+\s*ml)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const n = b.length + 1;
  const d = new Uint16Array((a.length + 1) * n);
  for (let i = 0; i <= a.length; i++) d[i * n] = i;
  for (let j = 0; j <= b.length; j++) d[j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i * n + j] = a[i - 1] === b[j - 1]
        ? d[(i - 1) * n + (j - 1)]
        : 1 + Math.min(d[(i - 1) * n + j], d[i * n + (j - 1)], d[(i - 1) * n + (j - 1)]);
    }
  }
  return d[a.length * n + b.length];
}

function similaridade(a, b) {
  a = normalizar(a);
  b = normalizar(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
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