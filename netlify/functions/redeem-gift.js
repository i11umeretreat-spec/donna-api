// netlify/functions/redeem-gift.js
//
// Активация подарочного сертификата. Вход: POST { code, email }.
//
// Порядок операций здесь важнее всего остального в файле. Сначала
// сертификат погашается атомарным условным апдейтом, и только потом
// пишется покупка. Если поменять местами, две одновременные активации
// одного кода дадут две строки в purchases и два доступа за одни деньги.

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { checkRateLimit, getClientIp } = require('./_rateLimit');
const { productByType } = require('./_products');
const { sendEmail } = require('./_accessEmail');
const { normalizeCode, CODE_LENGTH } = require('./_gift');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// Страница активации живёт на app-поддомене, но код могут вставить
// и со стороны сайта. Не '*': по чеклисту CORS только на свои домены.
const ALLOWED_ORIGINS = [
    'https://app.ekaterina-donnat.com',
    'https://ekaterina-donnat.com',
];

function corsHeaders(requestOrigin) {
    const allowOrigin = ALLOWED_ORIGINS.includes(requestOrigin)
        ? requestOrigin
        : ALLOWED_ORIGINS[0];

    return {
        'Access-Control-Allow-Origin':  allowOrigin,
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type':                 'application/json',
    };
}

// Fire-and-forget: неудачные попытки интересны пачкой, а не поштучно,
// и запись в журнал не должна задерживать ответ человеку.
function logSecurityEvent(eventName, ip, details) {
    supabase
        .from('security_log')
        .insert({ event: eventName, ip: ip, details: details })
        .then(function () {})
        .catch(function (err) { console.error('security_log write error:', err.message); });
}

function isEmail(value) {
    return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

exports.handler = async (event) => {
    const CORS = corsHeaders(event.headers.origin || event.headers.Origin);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method_not_allowed' }) };
    }

    const ip = getClientIp(event);

    let payload;
    try {
        payload = JSON.parse(event.body || '{}');
    } catch (e) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'bad_request' }) };
    }

    // Лимит до всякой работы: подбор кода это перебор, и отбивать его
    // надо раньше, чем мы сходим в базу.
    const allowed = await checkRateLimit('ip:redeem-gift:' + ip, 10, 600);
    if (!allowed) {
        logSecurityEvent('gift_redeem_rate_limited', ip, {});
        return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: 'rate_limited' }) };
    }

    const code = normalizeCode(payload.code);
    const email = isEmail(payload.email) ? payload.email.trim().toLowerCase() : null;

    if (code.length !== CODE_LENGTH || !email) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'bad_request' }) };
    }

    // Атомарный условный апдейт, а не «прочитать и записать». Условие
    // status = issued живёт внутри самого UPDATE, поэтому из двух
    // одновременных запросов строку получает ровно один, без блокировок.
    // Ноль строк в ответе значит: кода нет, он уже погашен или отозван.
    const { data: claimed, error: claimError } = await supabase
        .from('donna_gift_certificates')
        .update({
            status:         'redeemed',
            redeemed_at:    new Date().toISOString(),
            redeemed_email: email,
        })
        .eq('code', code)
        .eq('status', 'issued')
        .select();

    if (claimError) {
        console.error('Gift claim error:', claimError.message);
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'server_error' }) };
    }

    const certificate = claimed && claimed[0];

    if (!certificate) {
        return await refuse(code, ip, CORS);
    }

    const product = productByType(certificate.product_type);

    if (!product) {
        // Тип из базы не совпал с каталогом: скорее наша ошибка, чем
        // чужая. Сертификат возвращаем, чтобы человек не остался
        // с погашенным кодом и без доступа.
        console.error('Unknown product_type in certificate:', certificate.product_type);
        await release(certificate.id);
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'server_error' }) };
    }

    const token = crypto.randomUUID();

    // Строка ровно такая же, как у обычной покупки, отличий три:
    // amount 0, потому что деньги посчитаны при покупке сертификата
    // и второй раз их считать нельзя; campaign gift, чтобы такие строки
    // отделялись в отчётах; stripe_session_id null, сессии тут нет.
    // Источник берём дарителя: покупку привёл он.
    const { error: insertError } = await supabase
        .from('purchases')
        .insert({
            token,
            email:                    email,
            track_ids:                product.track_ids,
            stripe_session_id:        null,
            stripe_payment_intent_id: certificate.stripe_payment_intent_id,
            utm_source:               certificate.utm_source,
            campaign:                 'gift',
            product_name:             product.name,
            product_type:             product.product_type,
            amount:                   0,
            status:                   'paid',
            created_at:               new Date().toISOString(),
        });

    if (insertError) {
        // Сертификат уже погашен, а доступа нет. Возвращаем статус,
        // иначе человек остаётся с потраченным кодом и без практики.
        console.error('Gift purchase insert error:', insertError.message);
        await release(certificate.id);
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'server_error' }) };
    }

    // Токен в сертификат: по нему потом видно, какой именно доступ выдан.
    // Не критично для человека, поэтому ошибку только логируем.
    const { error: tokenError } = await supabase
        .from('donna_gift_certificates')
        .update({ redeemed_token: token })
        .eq('id', certificate.id);

    if (tokenError) console.error('Gift token write error:', tokenError.message);

    try {
        await sendEmail(email, token, product);
    } catch (err) {
        // Доступ уже выдан. Письмо не должно превращать успех в отказ:
        // человек напишет, и мы вышлем ссылку руками.
        console.error('Gift access email error:', err.message);
    }

    return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ ok: true, product_name: product.name }),
    };
};

// Почему условный апдейт не сработал. Отдельным чтением, уже без гонки:
// решение принято, здесь только объяснение человеку.
async function refuse(code, ip, CORS) {
    const { data: rows } = await supabase
        .from('donna_gift_certificates')
        .select('status')
        .eq('code', code)
        .limit(1);

    const found = rows && rows[0];

    logSecurityEvent('gift_redeem_failed', ip, {
        code:   code,
        status: found ? found.status : 'not_found',
    });

    if (!found) {
        return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'not_found' }) };
    }

    return {
        statusCode: 409,
        headers: CORS,
        body: JSON.stringify({ error: found.status === 'revoked' ? 'revoked' : 'redeemed' }),
    };
}

// Откат: сертификат снова доступен к активации.
async function release(id) {
    const { error } = await supabase
        .from('donna_gift_certificates')
        .update({ status: 'issued', redeemed_at: null, redeemed_email: null })
        .eq('id', id);

    if (error) console.error('Gift release error:', error.message);
}
