const Anthropic = require('@anthropic-ai/sdk');
const jwt = require('jsonwebtoken');
const { normalizeQuery } = require('./lib/normalize');
const { searchNeeche } = require('./lib/neeche');
const { searchNuvemshop } = require('./lib/nuvemshop');
const { getCached, saveCache } = require('./lib/cache');
const { getDb } = require('./lib/db');

const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

function authGuard(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return false;
  try { jwt.verify(token, process.env.JWT_SECRET); return true; } catch { return false; }
}

async function runSearch(term) {
  const { data: rows } = await getDb().from('price_cache').select('product_slug');
  const existingSlugs = (rows || []).map(r => r.product_slug);
  const { slug, display_name } = await normalizeQuery(term, existingSlugs);

  const cached = await getCached(slug);
  if (cached) return { display_name: cached.display_name, results: cached.results };

  const settled = await Promise.allSettled([
    searchNeeche(slug),
    searchNuvemshop('the_gregs', slug),
    searchNuvemshop('pequi', slug),
    searchNuvemshop('king_of_parfums', slug),
    searchNuvemshop('rivoli', slug),
    searchNuvemshop('mellalta', slug)
  ]);
  const results = settled.filter(r => r.status === 'fulfilled' && r.value !== null).map(r => r.value);
  await saveCache(slug, display_name, results);
  return { display_name, results };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!authGuard(req)) return res.status(401).json({ error: 'Não autorizado' });

  const { message, history = [], collection = [] } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: 'message obrigatória' });

  const collectionInfo = collection.length
    ? `Perfumes que o usuário já possui: ${collection.join(', ')}.`
    : 'O usuário não informou sua coleção ainda.';

  const system = `Você é o assistente do Radar de Perfumes Nicho, especialista em perfumaria masculina de nicho brasileira.

Ajude o usuário a encontrar o perfume ideal com base na ocasião, humor ou preferências descritas. Você busca preços em tempo real em até 6 lojas de nicho no Brasil.

${collectionInfo}

Ao recomendar perfumes:
- Escolha 1 a 3 perfumes específicos adequados ao pedido
- Use a ferramenta search_perfume para cada um antes de mencionar preços
- Se o usuário já possui o perfume na coleção, mencione isso
- Apresente os resultados com loja mais barata e preço
- Seja direto, especialista e fale em português brasileiro`;

  const tools = [{
    name: 'search_perfume',
    description: 'Busca preços em tempo real de um perfume em até 6 lojas de nicho brasileiras.',
    input_schema: {
      type: 'object',
      properties: {
        perfume_name: {
          type: 'string',
          description: 'Nome do perfume com marca. Ex: "Xerjoff Naxos", "Nishane Hacivat", "Initio Oud for Greatness"'
        }
      },
      required: ['perfume_name']
    }
  }];

  let messages = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: message }
  ];

  for (let i = 0; i < 6; i++) {
    const resp = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system,
      tools,
      messages
    });

    if (resp.stop_reason === 'end_turn') {
      const reply = resp.content.find(b => b.type === 'text')?.text || '';
      return res.status(200).json({
        reply,
        history: [...history, { role: 'user', content: message }, { role: 'assistant', content: reply }]
      });
    }

    if (resp.stop_reason === 'tool_use') {
      const toolBlocks = resp.content.filter(b => b.type === 'tool_use');
      messages = [...messages, { role: 'assistant', content: resp.content }];

      const toolResults = await Promise.all(toolBlocks.map(async (tb) => {
        try {
          const data = await runSearch(tb.input.perfume_name);
          const available = (data.results || [])
            .filter(r => r.available !== false)
            .sort((a, b) => a.price_cents - b.price_cents);
          return {
            type: 'tool_result',
            tool_use_id: tb.id,
            content: JSON.stringify({
              display_name: data.display_name,
              found: available.length > 0,
              results: available.map(r => ({
                store: r.store_display_name,
                price: `R$ ${(r.price_cents / 100).toFixed(2).replace('.', ',')}`,
                url: r.product_url
              }))
            })
          };
        } catch {
          return { type: 'tool_result', tool_use_id: tb.id, content: '{"found":false}' };
        }
      }));

      messages = [...messages, { role: 'user', content: toolResults }];
    }
  }

  return res.status(200).json({ reply: 'Não consegui processar sua solicitação. Tente novamente.', history });
};
