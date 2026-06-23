import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encontrarMelhorCorrespondencia } from '../_shared/similaridade.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const LIMIAR_CONFIANCA = 0.65;

Deno.serve(async (req) => {
  const { nomeNormalizado, termoBusca } = await req.json();

  if (!nomeNormalizado || !termoBusca) {
    return new Response(
      JSON.stringify({ erro: 'nomeNormalizado e termoBusca são obrigatórios' }),
      { status: 400 }
    );
  }

  // Evitar reprocessar imagens que já estão ok
  const { data: existente } = await supabase
    .from('perfume_imagens')
    .select('status')
    .eq('nome_normalizado', nomeNormalizado)
    .eq('status', 'ok')
    .maybeSingle();

  if (existente) {
    return new Response(JSON.stringify({ status: 'ok', motivo: 'ja_existe' }), { status: 200 });
  }

  try {
    // 1. Busca na API VTEX da Neeche
    const url = `https://www.neeche.com.br/api/catalog_system/pub/products/search?ft=${encodeURIComponent(termoBusca)}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RadarPerfumes/1.0)' },
      signal: AbortSignal.timeout(12000),
    });

    if (!resp.ok) {
      await registrar(nomeNormalizado, null, 'erro', `HTTP ${resp.status} da Neeche`);
      return new Response(JSON.stringify({ status: 'erro', motivo: 'falha_api_neeche' }), { status: 200 });
    }

    const produtos = await resp.json();

    if (!Array.isArray(produtos) || !produtos.length) {
      await registrar(nomeNormalizado, null, 'pendente', 'sem_resultado');
      return new Response(JSON.stringify({ status: 'pendente', motivo: 'sem_resultado' }), { status: 200 });
    }

    // 2. Validar correspondência pelo nome (não aceita o primeiro sem checar)
    const correspondencia = encontrarMelhorCorrespondencia(termoBusca, produtos, LIMIAR_CONFIANCA);

    if (!correspondencia) {
      await registrar(nomeNormalizado, null, 'pendente', 'confianca_baixa');
      return new Response(JSON.stringify({ status: 'pendente', motivo: 'confianca_baixa' }), { status: 200 });
    }

    const { produto, confianca } = correspondencia;
    const rawImageUrl = produto.items?.[0]?.images?.[0]?.imageUrl;
    const imagemUrl = rawImageUrl ? rawImageUrl.replace(/-\d+x\d+\.(\w+)$/, '.$1') : null;

    if (!imagemUrl) {
      await registrar(nomeNormalizado, produto.productName ?? null, 'pendente', 'produto_sem_imagem');
      return new Response(JSON.stringify({ status: 'pendente', motivo: 'sem_imagem' }), { status: 200 });
    }

    // 3. Baixar a imagem
    const respImagem = await fetch(imagemUrl);
    if (!respImagem.ok) {
      await registrar(nomeNormalizado, produto.productName ?? null, 'erro', 'falha_download_imagem');
      return new Response(JSON.stringify({ status: 'erro', motivo: 'falha_download' }), { status: 200 });
    }

    const buffer = await respImagem.arrayBuffer();
    const ext = (imagemUrl.split('.').pop()?.split('?')[0]?.toLowerCase()) || 'jpg';
    const caminhoArquivo = `${nomeNormalizado}.${ext}`;

    // 4. Subir para Supabase Storage
    const { error: erroUpload } = await supabase.storage
      .from('perfume-images')
      .upload(caminhoArquivo, buffer, {
        contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
        upsert: true,
      });

    if (erroUpload) {
      await registrar(nomeNormalizado, produto.productName ?? null, 'erro', erroUpload.message);
      return new Response(JSON.stringify({ status: 'erro', motivo: 'falha_upload' }), { status: 200 });
    }

    // 5. Gravar sucesso na tabela
    await supabase.from('perfume_imagens').upsert({
      nome_normalizado: nomeNormalizado,
      nome_produto_neeche: produto.productName,
      storage_path: caminhoArquivo,
      fonte: 'neeche',
      confianca_match: confianca,
      status: 'ok',
      atualizado_em: new Date().toISOString(),
    }, { onConflict: 'nome_normalizado' });

    return new Response(
      JSON.stringify({ status: 'ok', confianca, storagePath: caminhoArquivo }),
      { status: 200 }
    );

  } catch (e) {
    await registrar(nomeNormalizado, null, 'erro', String(e));
    return new Response(JSON.stringify({ status: 'erro', motivo: String(e) }), { status: 200 });
  }
});

async function registrar(
  nomeNormalizado: string,
  nomeProduto: string | null,
  status: string,
  motivo: string
) {
  await supabase.from('perfume_imagens').upsert({
    nome_normalizado: nomeNormalizado,
    nome_produto_neeche: nomeProduto,
    storage_path: null,
    fonte: 'neeche',
    confianca_match: null,
    status,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: 'nome_normalizado' });
  console.warn(`[${nomeNormalizado}] ${status}: ${motivo}`);
}