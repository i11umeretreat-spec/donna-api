// netlify/functions/upsell-flag.js
// GET  ?token=xxx&step=1  → { shown: true/false }
// POST { token, step }    → { ok: true }

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  const { token, step } = event.httpMethod === 'GET'
    ? event.queryStringParameters
    : JSON.parse(event.body || '{}');

  if (!token || !step) {
    return { statusCode: 400, body: JSON.stringify({ error: 'token and step required' }) };
  }

  const key = `${token}:step${step}`;

  if (event.httpMethod === 'GET') {
    const { data } = await supabase
      .from('upsell_shown')
      .select('shown_at')
      .eq('key', key)
      .single();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shown: !!data }),
    };
  }

  if (event.httpMethod === 'POST') {
    await supabase
      .from('upsell_shown')
      .upsert({ key, shown_at: new Date().toISOString() }, { onConflict: 'key' });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
