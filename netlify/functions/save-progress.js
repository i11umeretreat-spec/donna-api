// netlify/functions/save-progress.js
// Сохраняет накопленные секунды прослушивания по токену в Supabase
// POST { token, seconds }

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { token, seconds } = body;

  if (!token || typeof seconds !== 'number') {
    return { statusCode: 400, body: JSON.stringify({ error: 'token and seconds required' }) };
  }

  // Не принимаем отрицательные или подозрительно большие значения
  if (seconds < 0 || seconds > 360000) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid seconds value' }) };
  }

  try {
    // upsert — создаём или обновляем запись
    // Обновляем только если новое значение больше (защита от сброса)
    const { data: existing } = await supabase
      .from('listening_progress')
      .select('seconds')
      .eq('token', token)
      .single();

    const currentSeconds = existing?.seconds || 0;
    const newSeconds = Math.max(currentSeconds, seconds);

    const { error } = await supabase
      .from('listening_progress')
      .upsert(
        { token, seconds: newSeconds, updated_at: new Date().toISOString() },
        { onConflict: 'token' }
      );

    if (error) throw error;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, seconds: newSeconds }),
    };

  } catch (err) {
    console.error('save-progress error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error' }),
    };
  }
};
