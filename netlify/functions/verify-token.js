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
};

const PROMO_TRACK = {
    id: 'water_energy',
    title: 'Энергия воды',
    type: 'Ознакомительная практика',
    duration: '15:00',
    streamUrl: 'https://pub-a1dfcf27afc040398c3bc3e4bf3f6416.r2.dev/promo/water_energy.mp3'
};

exports.handler = async (event) => {
    console.log('Verify token function started');
    
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    const token = event.queryStringParameters?.token;
    console.log('Token received:', token);

    if (!token) {
        console.log('Error: No token provided');
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'No token provided' }) };
    }

    console.log('Checking purchases table...');
    const { data: purchase } = await supabase
        .from('purchases')
        .select('track_ids, email, created_at')
        .eq('token', token)
        .single();

    if (purchase) {
        console.log('Found in purchases for email:', purchase.email);
        try {
            const tracks = await Promise.all(
                purchase.track_ids.map(async (id) => {
                    const command = new GetObjectCommand({
                        Bucket: BUCKET,
                        Key: `tracks/full/${id}.mp3`
                    });
                    const streamUrl = await getSignedUrl(r2, command, { expiresIn: STREAM_EXPIRY });
                    return {
                        id,
                        ...TRACK_META[id],
                        streamUrl
                    };
                })
            );
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    valid: true,
                    email: purchase.email,
                    tracks,
                    purchasedAt: purchase.created_at,
                }),
            };
        } catch (err) {
            console.error('S3 signing error:', err);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'Storage error' }) };
        }
    }

    console.log('Not a buyer, checking donna_guests table...');
    const { data: guest } = await supabase
        .from('donna_guests')
        .select('email, promo_track, created_at')
        .eq('token', token)
        .single();

    if (guest) {
        console.log('Found in guests for email:', guest.email);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                valid: true,
                email: guest.email,
                tracks: [PROMO_TRACK],
                purchasedAt: guest.created_at,
            }),
        };
    }

    console.log('Token not found anywhere');
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Invalid or expired token' }) };
};
