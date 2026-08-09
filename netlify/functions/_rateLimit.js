// netlify/functions/_rateLimit.js
// Rate limiting поверх Cloudflare WAF (WAF даёт общий rule 5 req/10 sec на
// весь /.netlify/functions/ — см. чеклист безопасности в мастер-доке; этот
// модуль добавляет per-endpoint лимиты, которых общий WAF-rule не различает,
// в первую очередь как защита от перебора токенов на verify-token/
// get-download-url).
//
// Атомарный счётчик живёт в Supabase (rate_limits + RPC check_rate_limit,
// миграция rate_limits_table_and_rpc) — fixed window с upsert в одном SQL
// запросе, без гонок при параллельных вызовах.
//
// Fail-open: если сам чек лимита не смог выполниться (Supabase недоступен
// и т.п.), запрос пропускаем и логируем ошибку — сбой инфраструктуры
// подсчёта не должен блокировать легитимных покупателей.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

async function checkRateLimit(key, limit, windowSeconds) {
    try {
        const { data, error } = await supabase.rpc('check_rate_limit', {
            p_key: key,
            p_limit: limit,
            p_window_seconds: windowSeconds,
        });
        if (error) {
            console.error('rate limit check error:', error.message);
            return true;
        }
        return data === true;
    } catch (err) {
        console.error('rate limit check exception:', err.message);
        return true;
    }
}

function getClientIp(event) {
    const forwarded = (event.headers && (event.headers['x-forwarded-for'] || event.headers['client-ip'])) || 'unknown';
    return forwarded.split(',')[0].trim();
}

module.exports = { checkRateLimit: checkRateLimit, getClientIp: getClientIp };
