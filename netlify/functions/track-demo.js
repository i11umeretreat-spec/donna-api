// netlify/functions/track-demo.js
// Лёгкий трекер событий демо-плеера
// POST { event: 'pageview'|'play'|'lead', source: 'paid'|'referral'|'pinterest'|'organic' }

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const VALID_EVENTS  = ['pageview', 'play', 'lead'];
const VALID_SOURCES = ['paid', 'referral', 'pinterest', 'organic'];

// CORS — только наш домен
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': 'https://app.ekaterina-donnat.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
};

exports.handler = async (event) => {
    // Preflight — браузер отправляет перед реальным запросом
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

    const { event: eventName, source } = body;

    if (!VALID_EVENTS.includes(eventName)) {
        return { statusCode: 400, headers: CORS_HEADERS, body: '{"error":"Invalid event"}' };
    }

    const safeSource = VALID_SOURCES.includes(source) ? source : 'organic';

    try {
        await supabase
            .from('demo_events')
            .insert({
                event: eventName,
                source: safeSource,
                created_at: new Date().toISOString(),
            });

        return { statusCode: 200, headers: CORS_HEADERS, body: '{"ok":true}' };
    } catch (err) {
        console.error('track-demo error:', err);
        return { statusCode: 500, headers: CORS_HEADERS, body: '{"error":"Server error"}' };
    }
};
