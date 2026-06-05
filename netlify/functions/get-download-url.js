// netlify/functions/get-download-url.js
// Генерирует подписанный URL для скачивания
// Проверяет purchases + пропускает lineup-dev-permanent

const { createClient } = require('@supabase/supabase-js');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

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
const LINEUP_MODE_TOKEN = 'lineup-dev-permanent';

exports.handler = async (event) => {
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

    // Lineup Mode - пропускаем без проверки
    if (token === LINEUP_MODE_TOKEN) {
        console.log('🏄 Lineup Mode download:', trackId);
    } else {
        // Обычный клиент - проверяем в Supabase
        const { data: purchase, error } = await supabase
            .from('purchases')
            .select('track_ids, email')
            .eq('token', token)
            .single();

        if (error || !purchase) {
            return { statusCode: 403, headers, body: 'Invalid token' };
        }

        if (!purchase.track_ids.includes(trackId)) {
            return { statusCode: 403, headers, body: 'Track not purchased' };
        }
    }

    // Генерируем подписанный URL на 24 часа
    const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: `tracks/full/${trackId}.mp3`,
        ResponseContentDisposition: `attachment; filename="${trackId}.mp3"`,
    });

    const signedUrl = await getSignedUrl(r2, command, { expiresIn: 86400 });

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ url: signedUrl }),
    };
};
