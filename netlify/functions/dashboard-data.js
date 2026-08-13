// netlify/functions/dashboard-data.js
// Аналитика для дашборда — защищена серверным токеном
// GET → Authorization: Bearer <token> → данные воронки и продаж

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// CORS — только наш домен
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': 'https://app.ekaterina-donnat.com',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
};

// Проверяем токен — тот же алгоритм, что и в dashboard-auth.js
function isValidToken(token) {
    if (!token || typeof token !== 'string') return false;

    const expectedPassword = process.env.DASHBOARD_PASSWORD;
    if (!expectedPassword) return false;

    const windowHours = 8;
    const windowMs = windowHours * 60 * 60 * 1000;

    // Принимаем текущее окно и предыдущее (на случай смены окна прямо во время сессии)
    for (let delta = 0; delta <= 1; delta++) {
        const timeWindow = Math.floor((Date.now() - delta * windowMs) / windowMs).toString();
        const expected = crypto
            .createHmac('sha256', expectedPassword)
            .update('dashboard:' + timeWindow)
            .digest('hex');

        try {
            const tokenBuf = Buffer.from(token, 'hex');
            const expectedBuf = Buffer.from(expected, 'hex');
            if (
                tokenBuf.length === expectedBuf.length &&
                crypto.timingSafeEqual(tokenBuf, expectedBuf)
            ) {
                return true;
            }
        } catch {
            // Некорректный hex — продолжаем проверку
        }
    }

    return false;
}

exports.handler = async (event) => {
    // Preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers: CORS_HEADERS, body: '{"error":"Method Not Allowed"}' };
    }

    // Проверяем токен из заголовка Authorization: Bearer <token>
    const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!isValidToken(token)) {
        return {
            statusCode: 401,
            headers: CORS_HEADERS,
            body: '{"error":"Unauthorized"}',
        };
    }

    try {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

        // Параллельно тянем все данные
        const [
            purchasesResult,
            guestsResult,
            progressResult,
            demoEventsResult,
            demoEventsSourceResult,
        ] = await Promise.all([
            // Все покупки за 30 дней
            supabase
                .from('purchases')
                .select('email, amount, product_name, product_type, utm_source, status, created_at')
                .gte('created_at', thirtyDaysAgo)
                .order('created_at', { ascending: false }),

            // Гости через форму (email-база)
            supabase
                .from('donna_guests')
                .select('email, created_at', { count: 'exact' }),

            // Часы прослушивания (все токены)
            supabase
                .from('listening_progress')
                .select('token, seconds'),

            // Демо события за 30 дней — общие цифры
            supabase
                .from('demo_events')
                .select('event')
                .gte('created_at', thirtyDaysAgo),

            // Демо события с разбивкой по источнику
            supabase
                .from('demo_events')
                .select('event, source')
                .gte('created_at', thirtyDaysAgo),
        ]);

        // Подсчёт демо-событий (общий)
        const demoEvents = demoEventsResult.data || [];
        const demo = {
            pageviews: { total: 0, paid: 0, referral: 0, pinterest: 0, organic: 0 },
            plays:     { total: 0, paid: 0, referral: 0, pinterest: 0, organic: 0 },
            leads:     { total: 0, paid: 0, referral: 0, pinterest: 0, organic: 0 },
        };

        for (const e of (demoEventsSourceResult.data || [])) {
            const src = e.source || 'organic';
            const srcKey = ['paid', 'referral', 'pinterest'].includes(src) ? src : 'organic';

            if (e.event === 'pageview') {
                demo.pageviews.total++;
                demo.pageviews[srcKey]++;
            } else if (e.event === 'play') {
                demo.plays.total++;
                demo.plays[srcKey]++;
            } else if (e.event === 'lead') {
                demo.leads.total++;
                demo.leads[srcKey]++;
            }
        }

        // Покупки. Возвращённые исключаем: строка остаётся в базе
        // со status 'revoked', но денег по ней нет. Раньше выручка
        // считалась по всем строкам подряд, и после возврата дашборд
        // показывал сумму, которой уже не существует.
        const allPurchases = purchasesResult.data || [];
        const purchases = allPurchases.filter(p => p.status !== 'revoked');
        const refunded = allPurchases.length - purchases.length;
        const revenue = purchases.reduce((sum, p) => sum + (p.amount || 0), 0);
        const avgCheck = purchases.length > 0 ? Math.round(revenue / purchases.length) : 0;

        const referralPurchases = purchases.filter(p =>
            (p.utm_source || '').includes('referral')
        ).length;
        const referralPercent = purchases.length > 0
            ? Math.round((referralPurchases / purchases.length) * 100)
            : 0;

        // Последние 10 продаж для таблицы
        const sales = purchases.slice(0, 10).map(p => ({
            product: p.product_name || 'Ступень 1',
            amount: p.amount || 0,
            source: p.utm_source || 'organic',
            date: p.created_at,
        }));

        // Часы прослушивания
        const allSeconds = (progressResult.data || []).reduce((sum, r) => sum + (r.seconds || 0), 0);
        const totalHours = Math.round(allSeconds / 3600);

        // Конверсия ступень 1 → 2 (пользователи кто купил ст.2)
        // Пока нет отдельной таблицы — считаем через product
        const step2Buyers = purchases.filter(p => p.product_type === 'step_2').length;
        const step1Buyers = purchases.filter(p => p.product_type === 'step_1').length;
        const retentionPercent = step1Buyers > 0
            ? Math.round((step2Buyers / step1Buyers) * 100)
            : 0;

        return {
            statusCode: 200,
            headers: CORS_HEADERS,
            body: JSON.stringify({
                updated: now.toISOString(),
                revenue,
                refunded,
                avgCheck,
                referralPercent,
                emailBase: guestsResult.count || 0,
                demo,
                funnel: {
                    purchases: purchases.length,
                    leads: demo.leads.total,
                    hours: totalHours,
                    retentionPercent,
                },
                sales,
            }),
        };

    } catch (err) {
        console.error('dashboard-data error:', err);
        return {
            statusCode: 500,
            headers: CORS_HEADERS,
            body: '{"error":"Server error"}',
        };
    }
};
