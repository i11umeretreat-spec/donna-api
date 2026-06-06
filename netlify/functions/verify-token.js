// netlify/functions/verify-token.js
// Проверяет токен в purchases и donna_guests
// Возвращает подписанные URL с правильными путями к R2

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
const LINEUP_MODE_TOKEN = 'lineup-dev-permanent';

// Маппинг track-id → реальное имя файла в R2 + метаданные
const TRACKS = {
    'track-01': { file: 'release/money_freedom.mp3', title: 'Освобождение от денежных ограничений', type: 'Сессия самогипноза' },
    'track-02': { file: 'release/negative_cleansing.mp3', title: 'Очищение от негативных программ', type: 'Сеанс самогипноза', duration: '51:12' },
    'track-03': { file: 'release/be_yourself.mp3', title: 'Роскошь быть собой', type: 'Женская практика', duration: '24:41' },
    'track-04': { file: 'release/true_confidence.mp3', title: 'Укрепление уверенности', type: 'Мягкие нейрокорректоры', duration: '29:57' },
    'track-05': { file: 'release/happiness_creator.mp3', title: 'Творец своего счастья', type: 'Сеанс самогипноза', duration: '27:20' },
    'track-06': { file: 'release/stop_fighting.mp3', title: 'Против апатии и прокрастинации', type: 'Гипномедитация', duration: '32:41' },
    'track-07': { file: 'release/body_reboot.mp3', title: 'Перезапуск здоровья и молодости', type: 'Сеанс самогипноза', duration: '34:24' },
    'track-08': { file: 'release/personal_boundaries.mp3', title: 'Личные границы', type: 'Гипномедитация', duration: '25:04' },
    'track-09': { file: 'release/Shults_2.mp3', title: 'Расслабление по Шульцу', type: 'Самогипноз', duration: '40:32' },
    'track-10': { file: 'release/crock.mp3', title: 'Крокодил: обнуление тревоги', type: 'Метафорический сеанс гипноза' },
    'track-11': { file: 'release/immune_booster.mp3', title: 'Иммунный бустер', type: 'Аудиопрактика' },
    // Добавить когда Катя загрузит:
    // 'track-12': { file: 'release/weight_loss.mp3', title: 'Сброс лишнего веса', type: 'Глубинная перестройка' },
    // 'track-13': { file: 'release/three_totems.mp3', title: 'Три Тотема', type: 'Ресурсный транс' },
    // 'track-14': { file: 'release/goals.mp3', title: 'Достижение целей', type: 'Активация целевого мышления' },
};

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
                    title: track.title,
                    type: track.type,
                    duration: track.duration || null,
                    streamUrl,
                    downloadUrl,
                };
            })
    );
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

    // Lineup Mode - все доступные треки
    if (token === LINEUP_MODE_TOKEN) {
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
