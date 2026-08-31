// netlify/functions/podbor-save.js
//
// Сохраняет прохождение подбора практики в таблицу podbor_sessions.
// Одна строка на сессию, дописывается по ходу: так видно не только
// «прошёл или бросил», но и на каком вопросе человек ушёл.
//
// События подбора (podbor_start, podbor_complete) идут отдельно
// через track-demo.js, чтобы весь путь человека лежал в одной ленте
// demo_events. Здесь хранится только содержимое ответов.

const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, getClientIp } = require('./_rateLimit');
const { safeCampaign } = require('./_attribution');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const VALID_SOURCES = ['paid', 'referral', 'pinterest', 'organic'];
const VALID_SURFACES = ['site', 'player'];
// Метка кампании: список и проверка в _attribution.js.

// Ключи веток результата. Произвольную строку в базу не пускаем:
// поле приходит из публичного запроса, а пишем сервисным ключом.
const VALID_RESULTS = ['s1', 's2', 's3', 's4', 'flagship', 'checkup'];

const ALLOWED_ORIGINS = [
    'https://app.ekaterina-donnat.com',
    'https://ekaterina-donnat.com',
];

// Девять вопросов, максимум шесть вариантов в первом.
// Пределы намеренно с запасом: Катя ещё правит формулировки.
const MAX_ANSWERS = 20;
const MAX_OPTION_INDEX = 20;

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

// Ответы приходят как [[номер вопроса, номер варианта], ...].
// Пропускаем через фильтр: в базу должны попасть только числа
// в разумных пределах, ничего больше.
function sanitizeAnswers(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const item of raw.slice(0, MAX_ANSWERS)) {
        if (!Array.isArray(item) || item.length !== 2) continue;
        const q = Number(item[0]);
        const o = Number(item[1]);
        if (!Number.isInteger(q) || !Number.isInteger(o)) continue;
        if (q < 0 || q >= MAX_ANSWERS) continue;
        if (o < 0 || o >= MAX_OPTION_INDEX) continue;
        out.push([q, o]);
    }
    return out;
}

function sanitizeScores(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    for (const key of ['s1', 's2', 's3', 's4']) {
        const v = Number(raw[key]);
        out[key] = Number.isInteger(v) && v >= 0 && v <= 50 ? v : 0;
    }
    return out;
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

    const { session_id, source, surface, campaign, answers, scores, result_key, completed } = body;

    const safeSessionId = (typeof session_id === 'string' && session_id.length > 0)
        ? session_id.slice(0, 100)
        : null;

    if (!safeSessionId) {
        return { statusCode: 400, headers: CORS_HEADERS, body: '{"error":"No session"}' };
    }

    // Девять ответов на прохождение плюс завершение: лимит с запасом,
    // но от перебора защищает.
    const ip = getClientIp(event);
    const allowed = await checkRateLimit('podbor-save:' + ip, 40, 60);
    if (!allowed) {
        return { statusCode: 429, headers: CORS_HEADERS, body: '{"error":"Too many requests"}' };
    }

    const safeAnswers = sanitizeAnswers(answers);
    const safeScores = sanitizeScores(scores);
    const safeResult = VALID_RESULTS.includes(result_key) ? result_key : null;

    const row = {
        session_id: safeSessionId,
        source: VALID_SOURCES.includes(source) ? source : 'organic',
        surface: VALID_SURFACES.includes(surface) ? surface : null,
        campaign: safeCampaign(campaign),
        answers: safeAnswers,
        answered: safeAnswers.length,
        scores: safeScores,
        result_key: safeResult,
        completed: completed === true,
        updated_at: new Date().toISOString(),
    };

    try {
        // Upsert по уникальному session_id: строка создаётся на первом
        // ответе и переписывается на каждом следующем. Поэтому одна
        // сессия это всегда одна строка с последним состоянием.
        const { error } = await supabase
            .from('podbor_sessions')
            .upsert(row, { onConflict: 'session_id' });

        if (error) {
            console.error('podbor-save supabase error:', error.message, error.code);
            return { statusCode: 500, headers: CORS_HEADERS, body: '{"error":"DB error"}' };
        }

        return { statusCode: 200, headers: CORS_HEADERS, body: '{"ok":true}' };
    } catch (err) {
        console.error('podbor-save error:', err);
        return { statusCode: 500, headers: CORS_HEADERS, body: '{"error":"Server error"}' };
    }
};
