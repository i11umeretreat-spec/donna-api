// netlify/functions/verify-token.js
// Проверяет токен в ОБЕИХ таблицах: purchases и donna_guests
// Возвращает подписанные URL для купленных треков или демо для гостей

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
const STREAM_EXPIRY = 60 * 60 * 6;
const DOWNLOAD_EXPIRY = 60 * 60 * 24;

const TRACK_META = {
    'track-01': { title: 'Освобождение от денежных ограничений', type: 'Сессия самогипноза', duration: null },
    'track-02': { title: 'Очищение от негативных программ', type: 'Сеанс самогипноза', duration: '51:12' },
    'track-03': { title: 'Роскошь быть собой', type: 'Женская практика', duration: '24:41' },
    'track-04': { title: 'Укрепление уверенности', type: 'Мягкие нейрокорректоры', duration: '29:57' },
    'track-05': { title: 'Творец своего счастья', type: 'Сеанс самогипноза', duration: '27:20' },
    'track-06': { title: 'Против апатии и прокрастинации', type: 'Гипномедитация', duration: '32:41' },
    'track-07': { title: 'Перезапуск здоровья и молодости', type: 'Сеанс самогипноза', duration: '34:24' },
    'track-08': { title: 'Личные границы', type: 'Гипномедитация', duration: '25:04' },
    'track-09': { title: 'Расслабление по Шульцу', type: 'Самогипноз', duration: '40:32' },
    'track-10': { title: 'Крокодил: обнуление тревоги', type: 'Метафорический сеанс гипноза', duration: null },
    'track-11': { title: 'Иммунный бустер', type: 'Аудиопрактика', duration: null },
    'track-12': { title: 'Сброс лишнего веса', type: 'Глубинная перестройка', duration: null },
    'track-13': { title: 'Три Тотема', type: 'Ресурсный транс', duration: null },
    'track-14': { title: 'Достижение целей', type: 'Активация целевого мышления', duration: null },
};

async function generateSignedUrl(trackId, type, expiry) {
    const params = { Bucket: BUCKET, Key: `tracks/full/${trackId}.mp3` };

    if (type === 'download') {
        const meta = TRACK_META[trackId];
        const filename = meta ? `${meta.title}.mp3` : `${trackId}.mp3`;
        params.ResponseContentDisposition = `attachment; filename="${encodeURIComponent(filename)}"`;
    }

    const command = new GetObjectCommand(params);
    return getSignedUrl(r2, command, { expiresIn: expiry });
}

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': 'https://app.ekaterina-donnat.com',
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

    // Lineup Mode - вечный дев-токен, полный доступ
    const LINEUP_MODE_TOKEN = 'lineup-dev-permanent';
    if (token === LINEUP_MODE_TOKEN) {
        const allTrackIds = Object.keys(TRACK_META);
        const tracks = await Promise.all(
            allTrackIds.map(async (id) => {
                const [streamUrl, downloadUrl] = await Promise.all([
                    generateSignedUrl(id, 'stream', STREAM_EXPIRY),
                    generateSignedUrl(id, 'download', DOWNLOAD_EXPIRY),
                ]);
                return { id, ...TRACK_META[id], streamUrl, downloadUrl };
            })
        );

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                valid: true,
                type: 'lineup',
                email: 'dev@thelineup.design',
                tracks,
            }),
        };
    }

    // 1. Сначала ищем в таблице покупателей
    const { data: purchase } = await supabase
        .from('purchases')
        .select('track_ids, email, created_at')
        .eq('token', token)
        .single();

    if (purchase) {
        // Платный клиент - генерируем подписанные URL
        const tracks = await Promise.all(
            purchase.track_ids.map(async (id) => {
                const [streamUrl, downloadUrl] = await Promise.all([
                    generateSignedUrl(id, 'stream', STREAM_EXPIRY),
                    generateSignedUrl(id, 'download', DOWNLOAD_EXPIRY),
                ]);
                return { id, ...TRACK_META[id], streamUrl, downloadUrl };
            })
        );

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                valid: true,
                type: 'purchase',
                email: purchase.email,
                tracks,
                purchasedAt: purchase.created_at,
            }),
        };
    }

    // 2. Не нашли в покупках - ищем в гостях
    const { data: guest } = await supabase
        .from('donna_guests')
        .select('email, promo_track, created_at')
        .eq('token', token)
        .single();

    if (guest) {
        // Гость - возвращаем пустой список треков, плеер покажет демо + апсейл
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                valid: true,
                type: 'guest',
                email: guest.email,
                tracks: [],
                promoTrack: guest.promo_track,
            }),
        };
    }

    // 3. Нигде не нашли
    return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Invalid or expired token' }),
    };
};
