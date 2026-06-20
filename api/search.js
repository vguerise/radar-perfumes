const jwt = require('jsonwebtoken');

function authGuard(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return false;
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!authGuard(req)) return res.status(401).json({ error: 'Não autorizado' });

  const { query } = req.body || {};
  if (!query || !query.trim()) return res.status(400).json({ error: 'query obrigatória' });

  // TODO: implementar busca (etapas 2–5 da spec)
  return res.status(200).json({
    display_name: query,
    results: [],
    cached_at: new Date().toISOString()
  });
};
