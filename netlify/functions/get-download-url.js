// netlify/functions/get-download-url.js
const Sentry = require('@sentry/serverless');
Sentry.AWSLambda.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.2,
});

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { TRACKS } = require('./_tracks');
const { getValidAccess, hasTrackAccess } = require('./_auth');
const { checkRateLimit, getClientIp } = require('./_rateLimit');

const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET = process.env.R2_BUCKET_NAME;
// Было 86400 (24ч) — ссылку можно было переслать и она работала сутки.
// Кнопка скачивания в плеере запрашивает URL заново по клику, поэтому
// короткий срок не портит UX.
const DOWNLOAD_EXPIRY = 60 * 60;

exports.handler = Sentry.AWSLambda.wrapHandler(async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': 'https://app.ekaterina-donnat.com',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: 'Method Not Allowed' };
    }

    let body;
    try {
        body = JSON.parse(event.body);
    } catch {
        return { statusCode: 400, headers, body: 'Invalid JSON' };
    }

    const { token, trackId } = body;

    if (!token || !trackId) {
        return { statusCode: 400, headers, body: 'Missing token or trackId' };
    }

    const ip = getClientIp(event);
    const allowed = await checkRateLimit('get-download-url:' + ip, 15, 60);
    if (!allowed) {
        return { statusCode: 429, headers, body: 'Too many requests' };
    }

    const access = await getValidAccess(token);
    if (!access || !hasTrackAccess(access, trackId)) {
        return { statusCode: 403, headers, body: 'Invalid token or track not purchased' };
    }

    const track = TRACKS[trackId];
    if (!track) {
        return { statusCode: 404, headers, body: 'Track not found' };
    }

    const filename = `${track.title}.mp3`;
    const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: track.file,
        ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
    });

    const signedUrl = await getSignedUrl(r2, command, { expiresIn: DOWNLOAD_EXPIRY });

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ url: signedUrl }),
    };
});
