// netlify/functions/get-progress.js
// Возвращает накопленные секунды прослушивания по токену
// GET ?token=xxx
//
// Раньше принимала любой токен без сверки с purchases — можно было читать
// прогресс по произвольной строке. Теперь токен обязан пройти getValidAccess.

const { createClient } = require('@supabase/supabase-js');
const { getValidAccess } = require('./_auth');
const { corsHeaders, getOrigin } = require('./_cors');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  const headers = corsHeaders(getOrigin(event), 'GET, OPTIONS');

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const token = event.queryStringParameters?.token;

  if (!token) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'token required' }) };
  }

  const access = await getValidAccess(token);
  if (!access) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Invalid or revoked token' }) };
  }

  try {
    const { data, error } = await supabase
      .from('listening_progress')
      .select('seconds, updated_at')
      .eq('token', token)
      .maybeSingle();

    if (error) throw error;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        seconds: data?.seconds || 0,
        updated_at: data?.updated_at || null,
      }),
    };

  } catch (err) {
    console.error('get-progress error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error' }) };
  }
};
