// netlify/functions/save-progress.js
// Сохраняет накопленные секунды прослушивания по токену в Supabase
// POST { token, seconds }
//
// Раньше принимала любой токен и любое seconds до 360000 без проверки
// прироста за вызов — клиент мог одним запросом записать 100 часов.
// Теперь: токен проверяется через getValidAccess, а прирост за один вызов
// ограничен разумным потолком (клиент шлёт каждые ~30 сек — даём большой
// запас на переподключение/фоновый таб, но не бесконечность).

const { createClient } = require('@supabase/supabase-js');
const { getValidAccess } = require('./_auth');
const { corsHeaders, getOrigin } = require('./_cors');
const { checkRateLimit, getClientIp } = require('./_rateLimit');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MAX_SECONDS = 360000;      // абсолютный потолок (100 часов) — как и было
const MAX_DELTA_PER_CALL = 3600; // не даём прыгнуть больше чем на час за один save

exports.handler = async (event) => {
  const headers = corsHeaders(getOrigin(event), 'POST, OPTIONS');

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { token, seconds } = body;

  if (!token || typeof seconds !== 'number') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'token and seconds required' }) };
  }

  if (seconds < 0 || seconds > MAX_SECONDS) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid seconds value' }) };
  }

  const ip = getClientIp(event);
  const allowed = await checkRateLimit('save-progress:' + ip, 20, 60);
  if (!allowed) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Too many requests' }) };
  }

  const access = await getValidAccess(token);
  if (!access) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Invalid or revoked token' }) };
  }

  try {
    const { data: existing } = await supabase
      .from('listening_progress')
      .select('seconds')
      .eq('token', token)
      .maybeSingle();

    const currentSeconds = existing?.seconds || 0;

    // Прирост капается MAX_DELTA_PER_CALL, но снижение значения (некорректный
    // клиентский seconds) по-прежнему игнорируется через Math.max — прогресс
    // никогда не уменьшается сам по себе.
    const cappedSeconds = Math.min(seconds, currentSeconds + MAX_DELTA_PER_CALL);
    const newSeconds = Math.max(currentSeconds, cappedSeconds);

    const { error } = await supabase
      .from('listening_progress')
      .upsert(
        { token, seconds: newSeconds, updated_at: new Date().toISOString() },
        { onConflict: 'token' }
      );

    if (error) throw error;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, seconds: newSeconds }),
    };

  } catch (err) {
    console.error('save-progress error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error' }) };
  }
};
