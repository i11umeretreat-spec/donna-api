// netlify/functions/track-demo.js
// Лёгкий трекер событий демо-плеера
// POST { event: 'pageview'|'play'|'lead', source: 'paid'|'referral'|'organic' }

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const VALID_EVENTS = ['pageview', 'play', 'lead'];
const VALID_SOURCES = ['paid', 'referral', 'pinterest', 'organic'];

const ALLOWED_ORIGINS = [
    'https://app.ekaterina-donnat.com',
    'https://ekaterina-donnat.com',
];

exports.handler = async (event) => {
    const origin = event.headers.origin || '';
    const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    const corsHeaders = {
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    // CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let body;
    try { body = JSON.parse(event.body); }
    catch { return { statusCode: 400, body: 'Invalid JSON' }; }

    const { event: eventName, source } = body;

    if (!VALID_EVENTS.includes(eventName)) {
        return { statusCode: 400, body: 'Invalid event' };
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

        return { statusCode: 200, headers: corsHeaders, body: '{"ok":true}' };
    } catch (err) {
        console.error('track-demo error:', err);
        return { statusCode: 500, body: 'Server error' };
    }
};
