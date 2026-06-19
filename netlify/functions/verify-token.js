// netlify/functions/verify-token.js
// Проверяет токен в purchases и donna_guests
// Возвращает подписанные URL с правильными путями к R2

const { createClient } = require('@supabase/supabase-js');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { TRACKS } = require('./_tracks');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET          = process.env.R2_BUCKET_NAME;
const STREAM_EXPIRY   = 60 * 45;       // 45 минут — достаточно для сессии
const DOWNLOAD_EXPIRY = 60 * 60 * 24;  // 24 часа — для скачивания
const LINEUP_MODE_TOKEN = process.env.LINEUP_MODE_TOKEN; // без fallback на ''

// Пишем подозрительные события в security_log (fire-and-forget, не блокируем ответ)
function logSecurityEvent(event, ip, details) {
    supabase
        .from('security_log')
        .insert({ event: event, ip: ip, details: details })
        .then(function() {})
        .catch(function(err) { console.error('security_log write error:', err.message); });
}

function getClientIp(event) {
    var forwarded = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
    return forwarded.split(',')[0].trim();
}

async function generateSignedUrl(trackId, type, expiry) {
    var track = TRACKS[trackId];
    if (!track) return null;

    var params = { Bucket: BUCKET, Key: track.file };

    if (type === 'download') {
        var filename = track.title + '.mp3';
        params.ResponseContentDisposition = 'attachment; filename="' + encodeURIComponent(filename) + '"';
    }

    var command = new GetObjectCommand(params);
    return getSignedUrl(r2, command, { expiresIn: expiry });
}

async function buildTrackList(trackIds) {
    return Promise.all(
        trackIds
            .filter(function(id) { return TRACKS[id]; })
            .map(async function(id) {
                var track = TRACKS[id];
                var results = await Promise.all([
                    generateSignedUrl(id, 'stream', STREAM_EXPIRY),
                    generateSignedUrl(id, 'download', DOWNLOAD_EXPIRY),
                ]);
                return {
                    id:          id,
                    title:       track.title,
                    type:        track.type,
                    duration:    track.duration || null,
                    streamUrl:   results[0],
                    downloadUrl: results[1],
                };
            })
    );
}

exports.handler = async function(event) {
    var headers = {
        'Access-Control-Allow-Origin':  'https://app.ekaterina-donnat.com',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: headers, body: '' };
    }

    var token = event.queryStringParameters && event.queryStringParameters.token;
    var ip    = getClientIp(event);

    if (!token) {
        return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'No token provided' }) };
    }

    // Lineup Mode — переменная должна быть задана в Netlify env
    if (LINEUP_MODE_TOKEN && token === LINEUP_MODE_TOKEN) {
        var allIds = Object.keys(TRACKS);
        var tracks = await buildTrackList(allIds);
        return {
            statusCode: 200,
            headers:    headers,
            body:       JSON.stringify({ valid: true, type: 'lineup', email: 'dev@thelineup.design', tracks: tracks }),
        };
    }

    // 1. Ищем в покупках
    var purchaseResult = await supabase
        .from('purchases')
        .select('track_ids, email, created_at')
        .eq('token', token)
        .single();

    if (purchaseResult.data) {
        var purchaseTracks = await buildTrackList(purchaseResult.data.track_ids);
        return {
            statusCode: 200,
            headers:    headers,
            body:       JSON.stringify({
                valid:       true,
                type:        'purchase',
                email:       purchaseResult.data.email,
                tracks:      purchaseTracks,
                purchasedAt: purchaseResult.data.created_at,
            }),
        };
    }

    // 2. Ищем в гостях
    var guestResult = await supabase
        .from('donna_guests')
        .select('email, promo_track, created_at')
        .eq('token', token)
        .single();

    if (guestResult.data) {
        return {
            statusCode: 200,
            headers:    headers,
            body:       JSON.stringify({
                valid:      true,
                type:       'guest',
                email:      guestResult.data.email,
                tracks:     [],
                promoTrack: guestResult.data.promo_track,
            }),
        };
    }

    // 3. Не нашли — логируем и возвращаем 403
    // Первые 20 символов токена достаточно для диагностики, не храним полный
    logSecurityEvent('invalid_token', ip, {
        token_prefix: token.substring(0, 20),
        user_agent:   event.headers['user-agent'] || 'unknown',
    });

    return { statusCode: 403, headers: headers, body: JSON.stringify({ error: 'Invalid or expired token' }) };
};
