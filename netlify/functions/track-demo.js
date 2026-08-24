// netlify/functions/track-demo.js
const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, getClientIp } = require('./_rateLimit');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// hero_preview_play добавлен 24.08: хиро-блок на сайте слал 'play', то есть
// то же имя, что демо-плеер при запуске полной практики на 21 минуту.
// В базе два разных действия лежали вперемешку и не различались, из-за чего
// воронка «просмотр → play» считалась неверно. Старое имя оставлено в списке:
// оно живёт в demo.html и в записях до 24.08.
const VALID_EVENTS  = ['pageview', 'play', 'lead', 'welcome_play', 'flagship_preview_1_play', 'flagship_preview_2_play', 'demo_click', 'hero_preview_play'];
const VALID_SOURCES = ['paid', 'referral', 'pinterest', 'organic'];

// Поверхность: сайт на Тильде или демо-плеер на app-поддомене.
const VALID_SURFACES = ['site', 'player'];

// Метка from из адреса. Белый список, а не произвольная строка: поле
// приходит из публичного запроса, а в базу пишется сервисным ключом.
const VALID_CAMPAIGNS = ['email_demo', 'email_site', 'email_flagship', 'ig_bio', 'qr_journal'];

// Хиро-блок живёт на ekaterina-donnat.com (Тильда), демо-плеер на
// app.ekaterina-donnat.com — обоим нужен доступ к этой функции.
// Не переключаем на '*': по чеклисту CORS должен быть на конкретные домены.
const ALLOWED_ORIGINS = [
    'https://app.ekaterina-donnat.com',
    'https://ekaterina-donnat.com',
];

function corsHeaders(requestOrigin) {
    const allowOrigin = ALLOWED_ORIGINS.includes(requestOrigin)
        ? requestOrigin
        : ALLOWED_ORIGINS[0];

    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json',
    };
}

exports.handler = async (event) => {
    const CORS_HEADERS = corsHeaders(event.headers.origin || event.headers.Origin);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: CORS_HEADERS, body: '{"error":"Method Not Allowed"}' };
    }

    let body;
    try {
        body = JSON.parse(event.body);
    } catch {
        return { statusCode: 400, headers: CORS_HEADERS, body: '{"error":"Invalid JSON"}' };
    }

    const { event: eventName, source, session_id, surface, campaign } = body;

    if (!VALID_EVENTS.includes(eventName)) {
        return { statusCode: 400, headers: CORS_HEADERS, body: '{"error":"Invalid event"}' };
    }

    // Публичная, без токена — более щедрый лимит: реклама на Instagram/FB
    // может привести много одновременных слушателей демо с одного IP (NAT,
    // офис, кампус), плюс несколько событий (pageview/play/lead) на сессию.
    const ip = getClientIp(event);
    const allowed = await checkRateLimit('track-demo:' + ip, 40, 60);
    if (!allowed) {
        return { statusCode: 429, headers: CORS_HEADERS, body: '{"error":"Too many requests"}' };
    }

    const safeSource = VALID_SOURCES.includes(source) ? source : 'organic';
    // Неизвестное значение не подменяем на дефолт, а обнуляем: лучше пустое
    // поле, чем тихо неверная метка, из-за которой снова будем считать
    // воронку на смешанных данных.
    const safeSurface  = VALID_SURFACES.includes(surface) ? surface : null;
    const safeCampaign = VALID_CAMPAIGNS.includes(campaign) ? campaign : null;
    const safeSessionId = (typeof session_id === 'string' && session_id.length > 0)
        ? session_id.slice(0, 100)
        : null;

    try {
        const { data, error } = await supabase
            .from('demo_events')
            .insert({
                event: eventName,
                source: safeSource,
                session_id: safeSessionId,
                surface: safeSurface,
                campaign: safeCampaign,
                created_at: new Date().toISOString(),
            });
            if (error) {
            console.error('track-demo supabase error:', error.message, error.code);
            return { statusCode: 500, headers: CORS_HEADERS, body: '{"error":"DB error"}' };
        }

        return { statusCode: 200, headers: CORS_HEADERS, body: '{"ok":true}' };
    } catch (err) {
        console.error('track-demo error:', err);
        return { statusCode: 500, headers: CORS_HEADERS, body: '{"error":"Server error"}' };
    }
};
