// netlify/functions/track-demo.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const VALID_EVENTS  = ['pageview', 'play', 'lead', 'welcome_play'];
const VALID_SOURCES = ['paid', 'referral', 'pinterest', 'organic'];

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': 'https://app.ekaterina-donnat.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
};

exports.handler = async (event) => {
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

    const { event: eventName, source, session_id } = body;

    if (!VALID_EVENTS.includes(eventName)) {
        return { statusCode: 400, headers: CORS_HEADERS, body: '{"error":"Invalid event"}' };
    }

    const safeSource = VALID_SOURCES.includes(source) ? source : 'organic';
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
