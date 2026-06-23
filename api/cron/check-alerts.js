const { getDb } = require('../lib/db');
const { getCached } = require('../lib/cache');

async function sendEmail(to, subject, htmlBody) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Radar Perfumes <alertas@vguerise.com.br>',
      to,
      subject,
      html: htmlBody
    })
  });
  if (!r.ok) throw new Error(`Email error: ${r.status}`);
}

module.exports = async function handler(req, res) {
  const auth = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (auth !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  try {
    const { data: alerts } = await getDb()
      .from('price_alerts')
      .select('*')
      .eq('enabled', true);

    if (!alerts?.length) return res.status(200).json({ checked: 0, notified: 0 });

    let notified = 0;

    for (const alert of alerts) {
      try {
        const cached = await getCached(alert.product_slug);
        if (!cached?.results?.length) continue;

        const available = cached.results.filter(r => r.available !== false);
        if (!available.length) continue;

        available.sort((a, b) => a.price_cents - b.price_cents);
        const cheapest = available[0];
        const currentPrice = cheapest.price_cents;
        const baseline = alert.baseline_price_cents;

        const dropped = !baseline || currentPrice <= Math.round(baseline * 0.97);

        if (!dropped) {
          if (baseline && currentPrice < baseline) {
            await getDb().from('price_alerts')
              .update({ baseline_price_cents: currentPrice })
              .eq('id', alert.id);
          }
          continue;
        }

        const fmt = (c) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
        const diffStr = baseline ? ` (era ${fmt(baseline)})` : '';

        await sendEmail(
          alert.user_email,
          `Preco caiu: ${alert.display_name} por ${fmt(currentPrice)}`,
          `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0D0D0D;color:#F0F0F0;padding:32px">
<div style="max-width:480px;margin:auto;background:#161616;border:1px solid #2A2A2A;border-radius:16px;padding:32px">
  <p style="color:#E85D04;font-size:11px;letter-spacing:.2em;text-transform:uppercase;margin:0 0 8px">Radar &middot; Alerta de Preco</p>
  <h2 style="margin:0 0 20px;font-size:22px">${alert.display_name}</h2>
  <p style="margin:0 0 6px;color:#9A9A9A">Menor preco detectado</p>
  <p style="font-size:36px;font-weight:900;color:#E85D04;margin:0 0 6px">${fmt(currentPrice)}</p>
  <p style="color:#9A9A9A;margin:0 0 24px">${cheapest.store_display_name}${diffStr}</p>
  <a href="${cheapest.product_url}" style="display:inline-block;background:#E85D04;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700">Ver oferta</a>
  <p style="margin-top:28px;font-size:11px;color:#555">Para desativar, abra o Radar e clique no sino ao lado do perfume.</p>
</div></body></html>`
        );

        await getDb().from('price_alerts').update({
          baseline_price_cents: currentPrice,
          last_notified_price_cents: currentPrice,
          last_alerted_at: new Date().toISOString()
        }).eq('id', alert.id);

        notified++;
      } catch (err) {
        console.error(`Alert check failed for ${alert.product_slug}:`, err.message);
      }
    }

    return res.status(200).json({ checked: alerts.length, notified });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
