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

const BUCKET = process.env.R2_BUCKET_NAME;
const STREAM_EXPIRY   = 60 * 45;       // 45 минут — достаточно для сессии, нельзя расшарить
const DOWNLOAD_EXPIRY = 60 * 60 * 24;  // 24 часа — для скачивания нормально
const LINEUP_MODE_TOKEN = process.env.LINEUP_MODE_TOKEN; // без fallback на ''

async function generateSignedUrl(trackId, type, expiry) {
    const track = TRACKS[trackId];
    if (!track) return null;

    const params = { Bucket: BUCKET, Key: track.file };

    if (type === 'download') {
        const filename = `${track.title}.mp3`;
        params.ResponseContentDisposition = `attachment; filename="${encodeURIComponent(filename)}"`;
    }

    const command = new GetObjectCommand(params);
    return getSignedUrl(r2, command, { expiresIn: expiry });
}

async function buildTrackList(trackIds) {
    return Promise.all(
        trackIds
            .filter(id => TRACKS[id]) // пропускаем ещё не загруженные
            .map(async (id) => {
                const track = TRACKS[id];
                const [streamUrl, downloadUrl] = await Promise.all([
                    generateSignedUrl(id, 'stream', STREAM_EXPIRY),
                    generateSignedUrl(id, 'download', DOWNLOAD_EXPIRY),
                ]);
                return {
                    id,
                    title:    track.title,
                    type:     track.type,
                    duration: track.duration || null,
                    streamUrl,
                    downloadUrl,
                };
            })
    );
}

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin':  'https://app.ekaterina-donnat.com',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    const token = event.queryStringParameters?.token;

    if (!token) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'No token provided' }) };
    }

    // Lineup Mode — переменная должна быть задана в Netlify env, иначе не пропускаем
    if (LINEUP_MODE_TOKEN && token === LINEUP_MODE_TOKEN) {
        const allIds = Object.keys(TRACKS);
        const tracks = await buildTrackList(allIds);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ valid: true, type: 'lineup', email: 'dev@thelineup.design', tracks }),
        };
    }

    // 1. Ищем в покупках
    const { data: purchase } = await supabase
        .from('purchases')
        .select('track_ids, email, created_at')
        .eq('token', token)
        .single();

    if (purchase) {
        const tracks = await buildTrackList(purchase.track_ids);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ valid: true, type: 'purchase', email: purchase.email, tracks, purchasedAt: purchase.created_at }),
        };
    }

    // 2. Ищем в гостях
    const { data: guest } = await supabase
        .from('donna_guests')
        .select('email, promo_track, created_at')
        .eq('token', token)
        .single();

    if (guest) {
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ valid: true, type: 'guest', email: guest.email, tracks: [], promoTrack: guest.promo_track }),
        };
    }

    // 3. Не нашли
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Invalid or expired token' }) };
};
