#!/usr/bin/env node
// Popula perfume_imagens percorrendo os slugs mais buscados ainda sem imagem ok.
// Uso: node baixar_imagens_neeche.js
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (mesmo .env do projeto)
// Opcional: LIMITE=50 PAUSA_MS=1500

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const LIMITE    = parseInt(process.env.LIMITE    || '50',   10);
const PAUSA_MS  = parseInt(process.env.PAUSA_MS  || '1500', 10);
const EDGE_URL  = `${process.env.SUPABASE_URL}/functions/v1/extrair-imagem-neeche`;

async function main() {
  // 1. Top slugs mais buscados (últimas 500 entradas do search_log)
  const { data: logs, error } = await supabase
    .from('search_log')
    .select('resolved_slug')
    .not('resolved_slug', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) { console.error('Erro ao buscar search_log:', error.message); process.exit(1); }

  const freq = {};
  for (const { resolved_slug } of logs || []) {
    freq[resolved_slug] = (freq[resolved_slug] || 0) + 1;
  }

  const candidatos = Object.entries(freq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, LIMITE)
    .map(([slug]) => slug);

  if (!candidatos.length) { console.log('Nenhum slug encontrado no search_log.'); return; }

  // 2. Filtrar os que já têm imagem ok
  const { data: comImagem } = await supabase
    .from('perfume_imagens')
    .select('nome_normalizado')
    .in('nome_normalizado', candidatos)
    .eq('status', 'ok');

  const jaOk = new Set((comImagem || []).map(r => r.nome_normalizado));
  const pendentes = candidatos.filter(s => !jaOk.has(s));

  console.log(`Candidatos: ${candidatos.length} | Já ok: ${jaOk.size} | A processar: ${pendentes.length}`);
  if (!pendentes.length) { console.log('Nada a fazer.'); return; }

  // 3. Processar sequencialmente com pausa
  for (const slug of pendentes) {
    try {
      const r = await fetch(EDGE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({ nomeNormalizado: slug, termoBusca: slug }),
      });
      const json = await r.json();
      const conf = json.confianca ? ` (${(json.confianca * 100).toFixed(0)}%)` : '';
      const motivo = json.motivo ? ` — ${json.motivo}` : '';
      console.log(`[${slug}] ${json.status}${conf}${motivo}`);
    } catch (e) {
      console.error(`[${slug}] ERRO: ${e.message}`);
    }
    await new Promise(res => setTimeout(res, PAUSA_MS));
  }

  console.log('Concluído.');
}

main().catch(console.error);