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
const DOWNLOAD_EXPIRY = 60 * 60;

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body);
        const token = body.token;
        const trackId = body.trackId;

        if (!token || !trackId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing parameters' }) };
        }

        const { data: purchase } = await supabase
            .from('purchases')
            .select('track_ids')
            .eq('token', token)
            .single();

        let fileKey = null;

        if (purchase && purchase.track_ids && purchase.track_ids.includes(trackId)) {
            fileKey = `tracks/full/${trackId}.mp3`;
        } else {
            const { data: guest } = await supabase
                .from('donna_guests')
                .select('promo_track')
                .eq('token', token)
                .single();

            if (guest && trackId === 'water_energy') {
                fileKey = `promo/water_energy.mp3`;
            }
        }

        if (!fileKey) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: 'Not authorized' }) };
        }

        const command = new GetObjectCommand({
            Bucket: BUCKET,
            Key: fileKey,
            ResponseContentDisposition: `attachment; filename="${trackId}.mp3"`
        });

        const url = await getSignedUrl(r2, command, { expiresIn: DOWNLOAD_EXPIRY });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ url })
        };

    } catch (error) {
        console.error('Download URL error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error' }) };
    }
};
