// netlify/functions/get-progress.js
// Возвращает накопленные секунды прослушивания по токену
// GET ?token=xxx

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const token = event.queryStringParameters?.token;

  if (!token) {
    return { statusCode: 400, body: JSON.stringify({ error: 'token required' }) };
  }

  try {
    const { data, error } = await supabase
      .from('listening_progress')
      .select('seconds, updated_at')
      .eq('token', token)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = row not found, это нормально
      throw error;
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seconds: data?.seconds || 0,
        updated_at: data?.updated_at || null,
      }),
    };

  } catch (err) {
    console.error('get-progress error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error' }),
    };
  }
};
