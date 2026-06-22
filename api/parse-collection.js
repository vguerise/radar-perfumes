const Anthropic = require('@anthropic-ai/sdk');
const jwt = require('jsonwebtoken');

const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

function authGuard(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return false;
  try { jwt.verify(token, process.env.JWT_SECRET); return true; } catch { return false; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!authGuard(req)) return res.status(401).json({ error: 'Não autorizado' });

  const { content, fileType } = req.body || {};
  if (!content) return res.status(400).json({ error: 'content obrigatório' });

  const prompt = 'Extraia todos os nomes de perfumes mencionados. Retorne APENAS JSON no formato: {"perfumes":["Marca NomeDoPerfume"]}. Padronize como "Marca Nome". Se não houver perfumes, retorne {"perfumes":[]}.';

  let msgContent;
  if (fileType === 'pdf') {
    msgContent = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: content } },
      { type: 'text', text: prompt }
    ];
  } else {
    msgContent = `${prompt}\n\nTexto:\n${content.slice(0, 10000)}`;
  }

  try {
    const resp = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{ role: 'user', content: msgContent }]
    });
    const parsed = JSON.parse(resp.content[0].text.trim());
    return res.status(200).json(parsed);
  } catch {
    return res.status(200).json({ perfumes: [] });
  }
};
