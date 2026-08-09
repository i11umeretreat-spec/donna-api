// netlify/functions/upsell-flag.js
// GET  ?token=xxx&step=1  → { shown: true/false }
// POST { token, step }    → { ok: true }
//
// Раньше принимала любой token и любой step без проверки — можно было
// писать произвольные записи в upsell_shown. Теперь step ограничен
// допустимыми значениями, а token проходит getValidAccess.

const { createClient } = require('@supabase/supabase-js');
const { getValidAccess } = require('./_auth');
const { corsHeaders, getOrigin } = require('./_cors');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ALLOWED_STEPS = ['1', '2', '3', '4'];

exports.handler = async (event) => {
  const headers = corsHeaders(getOrigin(event), 'GET, POST, OPTIONS');

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  let params;
  try {
    params = event.httpMethod === 'GET'
      ? (event.queryStringParameters || {})
      : JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { token, step } = params;

  if (!token || !step || ALLOWED_STEPS.indexOf(String(step)) === -1) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'token and valid step required' }) };
  }

  const access = await getValidAccess(token);
  if (!access) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Invalid or revoked token' }) };
  }

  const key = `${token}:step${step}`;

  if (event.httpMethod === 'GET') {
    const { data } = await supabase
      .from('upsell_shown')
      .select('shown_at')
      .eq('key', key)
      .maybeSingle();

    return { statusCode: 200, headers, body: JSON.stringify({ shown: !!data }) };
  }

  if (event.httpMethod === 'POST') {
    await supabase
      .from('upsell_shown')
      .upsert({ key, shown_at: new Date().toISOString() }, { onConflict: 'key' });

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
};
