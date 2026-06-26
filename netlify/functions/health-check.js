// netlify/functions/health-check.js
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
const HEALTH_KEY = process.env.HEALTH_CHECK_KEY;

exports.handler = async (event) => {
    const authHeader = event.headers.authorization || '';
    const hasValidToken = authHeader === `Bearer ${HEALTH_KEY}`;
    const hasValidQuery = event.queryStringParameters?.key === HEALTH_KEY;

    if (!HEALTH_KEY || (!hasValidToken && !hasValidQuery)) {
        return { statusCode: 401, body: 'Unauthorized' };
    }

    try {
        const { error: dbError } = await supabase
            .from('purchases')
            .select('*', { count: 'exact', head: true });

        if (dbError) throw new Error(`Database ping failed: ${dbError.message}`);

        const testTrack = Object.values(TRACKS)[0];
        if (testTrack) {
            const command = new GetObjectCommand({ Bucket: BUCKET, Key: testTrack.file });
            await getSignedUrl(r2, command, { expiresIn: 60 });
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ status: 'healthy', database: 'ok', storage: 'ok' }),
        };
    } catch (error) {
        console.error('Health check failed:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ status: 'error', detail: error.message }),
        };
    }
};
