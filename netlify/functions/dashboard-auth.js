// netlify/functions/dashboard-auth.js
// Проверка пароля для дашборда - пароль только на сервере

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let body;
    try { body = JSON.parse(event.body); }
    catch { return { statusCode: 400, body: 'Invalid JSON' }; }

    const { password } = body;
    const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;

    if (!DASHBOARD_PASSWORD) {
        return { statusCode: 500, body: 'Server misconfigured' };
    }

    if (password !== DASHBOARD_PASSWORD) {
        return {
            statusCode: 401,
            body: JSON.stringify({ ok: false })
        };
    }

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true })
    };
};
