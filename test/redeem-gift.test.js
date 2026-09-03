// test/redeem-gift.test.js
//
// Активация подарочного сертификата. Таблица приёмки из спеки от 03.09:
// валидный код, повтор, две одновременные активации, мусорный код,
// откат при сбое insert, превышение лимита попыток.
//
// Запуск: node --test

const test = require('node:test');
const assert = require('node:assert');
const { loadHandler } = require('./helpers/stub-modules');

const ENV = {
    STRIPE_SECRET_KEY_LIVE: 'sk_live_stub',
    STRIPE_WEBHOOK_SECRET:  'whsec_stub',
    SUPABASE_URL:           'https://stub.supabase.co',
    SUPABASE_SERVICE_KEY:   'service_stub',
    RESEND_API_KEY_KATYA:   're_stub',
    STRIPE_FLAGSHIP_ID:     'plink_flagship',
};

const CERT = {
    id:                       'cert-uuid-1',
    code:                     'ABCD2345EFGH',
    product_type:             'flagship',
    product_name:             'Память тела: код освобождения',
    amount:                   90,
    buyer_email:              'giver@example.com',
    utm_source:               'paid',
    campaign:                 'wa_flagman',
    stripe_payment_intent_id: 'pi_gift_1',
    status:                   'issued',
};

function request(body, ip) {
    return {
        httpMethod: 'POST',
        headers: { 'x-forwarded-for': ip || '203.0.113.9', origin: 'https://app.ekaterina-donnat.com' },
        body: JSON.stringify(body),
    };
}

// db: сколько строк вернул условный апдейт и чем закончился insert.
function db(opts) {
    opts = opts || {};
    return function (rec) {
        // Лимит: RPC отдаёт true, пока попытки в пределах окна.
        if (rec.op === 'rpc') return { data: opts.rateLimited ? false : true, error: null };
        if (rec.table === 'donna_gift_certificates' && rec.op === 'update') {
            // Апдейт со статусом в фильтре это активация, без него откат.
            const conditional = rec.filters.some(function (f) { return f[0] === 'status'; });
            if (conditional) return { data: opts.claimed === false ? [] : [CERT], error: null };
            return { data: [], error: null };
        }
        if (rec.table === 'donna_gift_certificates' && rec.op === 'select') {
            return { data: opts.lookup === undefined ? [CERT] : opts.lookup, error: null };
        }
        if (rec.table === 'purchases' && rec.op === 'insert') {
            return { error: opts.insertError || null };
        }
        return { data: [], error: null };
    };
}

function callsOf(app, table, op) {
    return app.db.calls.filter(function (c) { return c.table === table && c.op === op; });
}

test('валидный код: строка в purchases, сертификат погашен, письмо ушло', async () => {
    const app = loadHandler('redeem-gift.js', { env: ENV, db: db({}) });
    const res = await app.handler(request({ code: 'abcd-2345-efgh', email: 'gift@example.com' }));

    assert.strictEqual(res.statusCode, 200, res.body);

    const claim = callsOf(app, 'donna_gift_certificates', 'update')[0];
    assert.ok(claim, 'условный апдейт выполнен');
    assert.strictEqual(claim.payload.status, 'redeemed');
    assert.strictEqual(claim.payload.redeemed_email, 'gift@example.com');
    // Гонка снимается фильтром по статусу в самом апдейте, а не чтением.
    assert.ok(claim.filters.some(function (f) { return f[0] === 'status' && f[1] === 'issued'; }),
        'в фильтре апдейта есть status = issued');
    // Дефисы и регистр нормализуются до сравнения.
    assert.ok(claim.filters.some(function (f) { return f[0] === 'code' && f[1] === 'ABCD2345EFGH'; }),
        'код нормализован');

    const ins = callsOf(app, 'purchases', 'insert')[0];
    assert.ok(ins, 'покупка записана');
    assert.strictEqual(ins.payload.email, 'gift@example.com');
    assert.strictEqual(ins.payload.amount, 0, 'деньги посчитаны при покупке сертификата');
    assert.strictEqual(ins.payload.campaign, 'gift');
    assert.strictEqual(ins.payload.utm_source, 'paid', 'источник дарителя сохраняется');
    assert.strictEqual(ins.payload.product_type, 'flagship');
    assert.deepStrictEqual(ins.payload.track_ids, ['flagship'], 'состав резолвится, а не берётся из сертификата');
    assert.strictEqual(ins.payload.stripe_payment_intent_id, 'pi_gift_1');
    assert.strictEqual(ins.payload.stripe_session_id, null);
    assert.strictEqual(ins.payload.status, 'paid');
    assert.ok(ins.payload.token && ins.payload.token.length > 20, 'токен выдан');

    assert.strictEqual(app.sent.length, 1, 'письмо с доступом ушло получателю');
    assert.strictEqual(app.sent[0].to, 'gift@example.com');
});

test('повторная активация: отказ, вторая строка не создана', async () => {
    const app = loadHandler('redeem-gift.js', {
        env: ENV,
        db: db({ claimed: false, lookup: [Object.assign({}, CERT, { status: 'redeemed' })] }),
    });
    const res = await app.handler(request({ code: 'ABCD2345EFGH', email: 'other@example.com' }));

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(callsOf(app, 'purchases', 'insert').length, 0);
    assert.strictEqual(app.sent.length, 0);
    assert.match(res.body, /redeemed/);
});

test('две одновременные активации: покупка создаётся ровно один раз', async () => {
    // Второй запрос видит ноль строк из условного апдейта, потому что
    // первый уже перевёл статус. Ни блокировок, ни чтения перед записью.
    const first = loadHandler('redeem-gift.js', { env: ENV, db: db({}) });
    const second = loadHandler('redeem-gift.js', {
        env: ENV,
        db: db({ claimed: false, lookup: [Object.assign({}, CERT, { status: 'redeemed' })] }),
    });

    const [r1, r2] = await Promise.all([
        first.handler(request({ code: 'ABCD2345EFGH', email: 'a@example.com' })),
        second.handler(request({ code: 'ABCD2345EFGH', email: 'b@example.com' })),
    ]);

    const inserts = callsOf(first, 'purchases', 'insert').length + callsOf(second, 'purchases', 'insert').length;
    assert.strictEqual(inserts, 1, 'ровно одна строка в purchases');
    assert.strictEqual(r1.statusCode, 200);
    assert.strictEqual(r2.statusCode, 409);
});

test('отозванный сертификат: активация отказывает', async () => {
    const app = loadHandler('redeem-gift.js', {
        env: ENV,
        db: db({ claimed: false, lookup: [Object.assign({}, CERT, { status: 'revoked' })] }),
    });
    const res = await app.handler(request({ code: 'ABCD2345EFGH', email: 'x@example.com' }));

    assert.strictEqual(res.statusCode, 409);
    assert.match(res.body, /revoked/);
    assert.strictEqual(callsOf(app, 'purchases', 'insert').length, 0);
});

// Мусорный код правильной длины: до базы доходит, там его нет. Именно
// это интересно журналу безопасности, потому что так выглядит перебор.
// Кривой ввод другой длины отбивается раньше, отдельным тестом ниже.
test('мусорный код: отказ, запись в security_log, без падения', async () => {
    const app = loadHandler('redeem-gift.js', { env: ENV, db: db({ claimed: false, lookup: [] }) });
    const res = await app.handler(request({ code: 'ZZZZ9999ZZZZ', email: 'x@example.com' }));

    assert.strictEqual(res.statusCode, 404);
    const log = callsOf(app, 'security_log', 'insert');
    assert.strictEqual(log.length, 1, 'неудачная попытка записана');
    assert.strictEqual(log[0].payload.event, 'gift_redeem_failed');
    assert.strictEqual(callsOf(app, 'purchases', 'insert').length, 0);
});

test('сбой записи покупки: сертификат возвращается в issued, ответ 500', async () => {
    const app = loadHandler('redeem-gift.js', {
        env: ENV,
        db: db({ insertError: { message: 'permission denied', code: '42501' } }),
    });
    const res = await app.handler(request({ code: 'ABCD2345EFGH', email: 'x@example.com' }));

    assert.strictEqual(res.statusCode, 500);

    const updates = callsOf(app, 'donna_gift_certificates', 'update');
    assert.strictEqual(updates.length, 2, 'активация и откат');
    assert.strictEqual(updates[1].payload.status, 'issued', 'статус возвращён');
    assert.strictEqual(updates[1].payload.redeemed_at, null);
    assert.strictEqual(updates[1].payload.redeemed_email, null);
    assert.strictEqual(app.sent.length, 0, 'письмо не уходит');
});

test('превышение лимита попыток: 429, до сертификата не идём', async () => {
    const app = loadHandler('redeem-gift.js', { env: ENV, db: db({ rateLimited: true }) });
    const res = await app.handler(request({ code: 'ABCD2345EFGH', email: 'x@example.com' }));

    assert.strictEqual(res.statusCode, 429);
    assert.strictEqual(callsOf(app, 'donna_gift_certificates', 'update').length, 0);
    assert.strictEqual(callsOf(app, 'purchases', 'insert').length, 0);
});

test('кривой ввод: пустой код и не почта отбиваются до базы', async () => {
    const app1 = loadHandler('redeem-gift.js', { env: ENV, db: db({}) });
    const r1 = await app1.handler(request({ code: '', email: 'x@example.com' }));
    assert.strictEqual(r1.statusCode, 400);
    assert.strictEqual(app1.db.calls.filter(function (c) { return c.table === 'donna_gift_certificates'; }).length, 0);

    const app2 = loadHandler('redeem-gift.js', { env: ENV, db: db({}) });
    const r2 = await app2.handler(request({ code: 'ABCD2345EFGH', email: 'не почта' }));
    assert.strictEqual(r2.statusCode, 400);
    assert.strictEqual(app2.db.calls.filter(function (c) { return c.table === 'donna_gift_certificates'; }).length, 0);
});

test('не POST: 405, OPTIONS: 200 с заголовками CORS', async () => {
    const app = loadHandler('redeem-gift.js', { env: ENV, db: db({}) });
    const get = await app.handler({ httpMethod: 'GET', headers: {}, body: null });
    assert.strictEqual(get.statusCode, 405);

    const pre = await app.handler({ httpMethod: 'OPTIONS', headers: { origin: 'https://app.ekaterina-donnat.com' }, body: null });
    assert.strictEqual(pre.statusCode, 200);
    assert.ok(pre.headers['Access-Control-Allow-Origin']);
});
