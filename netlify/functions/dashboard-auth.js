// netlify/functions/dashboard-auth.js
// Проверяет пароль дашборда и выдаёт сессионный токен
// POST { password: string } → { ok: true, token: string } | { ok: false }

const crypto = require('crypto');

// CORS заголовки для всех ответов
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': 'https://app.ekaterina-donnat.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
};

exports.handler = async (event) => {
    // Preflight — браузер проверяет разрешения перед реальным запросом
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: CORS_HEADERS, body: '{"ok":false,"error":"Method Not Allowed"}' };
    }

    let body;
    try {
        body = JSON.parse(event.body);
    } catch {
        return { statusCode: 400, headers: CORS_HEADERS, body: '{"ok":false,"error":"Invalid JSON"}' };
    }

    const { password } = body;

    if (!password || typeof password !== 'string') {
        return { statusCode: 400, headers: CORS_HEADERS, body: '{"ok":false,"error":"Password required"}' };
    }

    const expectedPassword = process.env.DASHBOARD_PASSWORD;

    if (!expectedPassword) {
        console.error('dashboard-auth: DASHBOARD_PASSWORD env variable is not set');
        return { statusCode: 500, headers: CORS_HEADERS, body: '{"ok":false,"error":"Server misconfigured"}' };
    }

    // Сравниваем через timingSafeEqual — защита от timing-атак
    const inputBuf = Buffer.from(password);
    const expectedBuf = Buffer.from(expectedPassword);

    const passwordOk =
        inputBuf.length === expectedBuf.length &&
        crypto.timingSafeEqual(inputBuf, expectedBuf);

    if (!passwordOk) {
        return {
            statusCode: 401,
            headers: CORS_HEADERS,
            body: '{"ok":false,"error":"Unauthorized"}',
        };
    }

    // Выдаём краткосрочный токен (живёт 8 часов)
    // Токен = HMAC(timestamp_rounded_to_8h, DASHBOARD_PASSWORD)
    // Без базы данных — сервер проверяет его в dashboard-data.js тем же способом
    const windowHours = 8;
    const windowMs = windowHours * 60 * 60 * 1000;
    const timeWindow = Math.floor(Date.now() / windowMs).toString();

    const token = crypto
        .createHmac('sha256', expectedPassword)
        .update('dashboard:' + timeWindow)
        .digest('hex');

    return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ ok: true, token }),
    };
};
