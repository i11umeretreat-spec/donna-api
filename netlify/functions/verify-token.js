// netlify/functions/verify-token.js
const Sentry = require('@sentry/serverless');
Sentry.AWSLambda.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.2,
});

const { createClient } = require('@supabase/supabase-js');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { TRACKS } = require('./_tracks');
const { checkRateLimit } = require('./_rateLimit');
const { guestAccess } = require('./_trial');

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

const BUCKET = process.env.R2_BUCKET_NAME;
const STREAM_EXPIRY = 60 * 45;
const DOWNLOAD_EXPIRY = 60 * 60 * 24;
const LINEUP_MODE_TOKEN = process.env.LINEUP_MODE_TOKEN;

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

// withDownload: false для гостей пробных ночей. Им отдаётся только поток:
// ссылка на скачивание жила бы сутки и пережила бы сам пробный срок.
async function buildTrackList(trackIds, withDownload) {
    var download = withDownload !== false;
    return Promise.all(
        trackIds
            .filter(function(id) { return TRACKS[id]; })
            .map(async function(id) {
                var track = TRACKS[id];
                var results = await Promise.all([
                    generateSignedUrl(id, 'stream', STREAM_EXPIRY),
                    download ? generateSignedUrl(id, 'download', DOWNLOAD_EXPIRY) : Promise.resolve(null),
                ]);
                var item = {
                    id: id,
                    title: track.title,
                    type: track.type,
                    duration: track.duration || null,
                    streamUrl: results[0],
                };
                if (download) item.downloadUrl = results[1];
                return item;
            })
    );
}

exports.handler = Sentry.AWSLambda.wrapHandler(async function(event) {
    var headers = {
        'Access-Control-Allow-Origin': 'https://app.ekaterina-donnat.com',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: headers, body: '' };
    }

    var token = event.queryStringParameters && event.queryStringParameters.token;
    var ip = getClientIp(event);

    // Основная точка перебора токенов — лимит per-IP отдельно от общего
    // Cloudflare WAF rule (тот считает все функции плеера вместе).
    var allowed = await checkRateLimit('verify-token:' + ip, 20, 60);
    if (!allowed) {
        logSecurityEvent('rate_limited', ip, { endpoint: 'verify-token' });
        return { statusCode: 429, headers: headers, body: JSON.stringify({ error: 'Too many requests' }) };
    }

    if (!token) {
        return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'No token provided' }) };
    }

    if (LINEUP_MODE_TOKEN && token === LINEUP_MODE_TOKEN) {
        var allIds = Object.keys(TRACKS);
        var tracks = await buildTrackList(allIds);
        return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify({ valid: true, type: 'lineup', email: 'dev@thelineup.design', tracks: tracks }),
        };
    }

    var purchaseResult = await supabase
        .from('purchases')
        .select('track_ids, email, created_at, status, revoked_at, product_type')
        .eq('token', token)
        .maybeSingle();

    if (purchaseResult.data) {
        // Схема Supabase (status/revoked_at) существует с 05.08 именно под эту
        // проверку — refund/chargeback/ручной revoke обязаны гасить доступ,
        // а не только не давать выдавать. Раньше проверки не было вообще.
        if (purchaseResult.data.status !== 'paid' || purchaseResult.data.revoked_at) {
            logSecurityEvent('revoked_token_access', ip, {
                token_prefix: token.substring(0, 20),
                status: purchaseResult.data.status,
            });
            return { statusCode: 403, headers: headers, body: JSON.stringify({ error: 'Access revoked' }) };
        }

        var purchaseTracks = await buildTrackList(purchaseResult.data.track_ids);
        return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify({
                valid: true,
                type: 'purchase',
                email: purchaseResult.data.email,
                tracks: purchaseTracks,
                purchasedAt: purchaseResult.data.created_at,
                productType: purchaseResult.data.product_type,
            }),
        };
    }

    var guestResult = await supabase
        .from('donna_guests')
        .select('email, promo_track, created_at, expires_at')
        .eq('token', token)
        .maybeSingle();

    if (guestResult.data) {
        // Пробные ночи «Фонарщика» (17.11): срок проверяет сервер, а не плеер.
        // После срока ни одной подписи, только причина, чтобы плеер показал
        // экран окончания, а не «ключ неверен».
        var access = guestAccess(guestResult.data, Date.now());
        if (!access.ok) {
            return { statusCode: 403, headers: headers, body: JSON.stringify({ error: 'trial_ended' }) };
        }

        // Трек из каталога получает подписанную ссылку. Старый лид-магнит
        // (water_energy) в каталоге не значится и живёт как раньше: пустой
        // список, плеер играет публичное промо.
        var promo = guestResult.data.promo_track;
        var guestTracks = TRACKS[promo] ? await buildTrackList([promo], false) : [];

        return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify({
                valid: true,
                type: 'guest',
                email: guestResult.data.email,
                tracks: guestTracks,
                promoTrack: promo,
                expiresAt: guestResult.data.expires_at || null,
            }),
        };
    }

    logSecurityEvent('invalid_token', ip, {
        token_prefix: token.substring(0, 20),
        user_agent: event.headers['user-agent'] || 'unknown',
    });

    return { statusCode: 403, headers: headers, body: JSON.stringify({ error: 'Invalid or expired token' }) };
});
