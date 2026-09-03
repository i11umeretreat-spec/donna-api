// test/stripe-webhook.gift.test.js
//
// Подарочная ветка вебхука: покупка сертификата, идемпотентность,
// ревокация. Обычная оплата проверяется здесь же: подарок не должен
// её задеть, это главное ограничение задачи.
//
// Запуск: node --test

const test = require('node:test');
const assert = require('node:assert');
const { loadHandler, webhookEvent } = require('./helpers/stub-modules');

const ENV = {
    STRIPE_SECRET_KEY_LIVE: 'sk_live_stub',
    STRIPE_WEBHOOK_SECRET:  'whsec_stub',
    SUPABASE_URL:           'https://stub.supabase.co',
    SUPABASE_SERVICE_KEY:   'service_stub',
    RESEND_API_KEY_KATYA:   're_stub',
    KATYA_ALERT_EMAIL:      'katya@example.com',
    STRIPE_FLAGSHIP_ID:     'plink_flagship',
    STRIPE_GIFT_FLAGSHIP_ID: 'plink_gift_flagship',
};

const PI = 'pi_gift_1';

function giftSession(over) {
    return Object.assign({
        id:                  'cs_gift_1',
        payment_link:        'plink_flagship',
        amount_total:        9000,
        payment_intent:      PI,
        customer_details:    { email: 'giver@example.com', name: 'Даритель' },
        client_reference_id: 'wa_flagman|paid',
        metadata:            { kind: 'gift' },
    }, over || {});
}

function db(opts) {
    opts = opts || {};
    return function (rec) {
        if (rec.table === 'donna_gift_certificates' && rec.op === 'select') {
            return { data: opts.existingCert ? [opts.existingCert] : [], error: null };
        }
        if (rec.table === 'donna_gift_certificates' && rec.op === 'insert') {
            return { error: opts.certInsertError || null };
        }
        if (rec.table === 'purchases' && rec.op === 'select') return { data: null, error: null };
        return { error: null, data: null };
    };
}

function callsOf(app, table, op) {
    return app.db.calls.filter(function (c) { return c.table === table && c.op === op; });
}

test('подарочная оплата: сертификат создан, в purchases пусто, письмо дарителю', async () => {
    const app = loadHandler('stripe-webhook.js', { env: ENV, db: db({}) });
    const res = await app.handler(webhookEvent('checkout.session.completed', giftSession()));

    assert.strictEqual(res.statusCode, 200, res.body);

    const cert = callsOf(app, 'donna_gift_certificates', 'insert')[0];
    assert.ok(cert, 'сертификат записан');
    assert.strictEqual(cert.payload.product_type, 'flagship');
    assert.strictEqual(cert.payload.product_name, 'Память тела: код освобождения');
    assert.strictEqual(cert.payload.amount, 90);
    assert.strictEqual(cert.payload.buyer_email, 'giver@example.com');
    assert.strictEqual(cert.payload.stripe_session_id, 'cs_gift_1');
    assert.strictEqual(cert.payload.stripe_payment_intent_id, PI);
    assert.strictEqual(cert.payload.status, 'issued');
    assert.strictEqual(cert.payload.campaign, 'wa_flagman', 'атрибуция дарителя сохраняется');
    assert.strictEqual(cert.payload.utm_source, 'paid');
    assert.ok(/^[0-9A-Z]{12}$/.test(cert.payload.code), 'код нормализован при записи: ' + cert.payload.code);
    // Состав ступени в сертификате не хранится: он резолвится при активации.
    assert.ok(!('track_ids' in cert.payload), 'track_ids в сертификате нет');

    assert.strictEqual(callsOf(app, 'purchases', 'insert').length, 0, 'в purchases ничего');

    assert.strictEqual(app.sent.length, 1, 'письмо дарителю');
    assert.strictEqual(app.sent[0].to, 'giver@example.com');
    assert.match(app.sent[0].html, /[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/, 'код показан группами');
});

test('обычная оплата: всё как раньше, в сертификатах пусто', async () => {
    const app = loadHandler('stripe-webhook.js', { env: ENV, db: db({}) });
    const res = await app.handler(webhookEvent('checkout.session.completed',
        giftSession({ id: 'cs_plain_1', metadata: {} })));

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(callsOf(app, 'donna_gift_certificates', 'insert').length, 0);

    const ins = callsOf(app, 'purchases', 'insert')[0];
    assert.ok(ins, 'покупка записана как раньше');
    assert.strictEqual(ins.payload.email, 'giver@example.com');
    assert.strictEqual(ins.payload.status, 'paid');
    assert.strictEqual(app.sent.length, 1);
});

test('оплата без metadata вовсе: обычная ветка, не падаем', async () => {
    const app = loadHandler('stripe-webhook.js', { env: ENV, db: db({}) });
    const s = giftSession({ id: 'cs_plain_2' });
    delete s.metadata;
    const res = await app.handler(webhookEvent('checkout.session.completed', s));

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(callsOf(app, 'donna_gift_certificates', 'insert').length, 0);
    assert.strictEqual(callsOf(app, 'purchases', 'insert').length, 1);
});

test('повторная доставка подарочного события: один сертификат, не два', async () => {
    const app = loadHandler('stripe-webhook.js', {
        env: ENV,
        db: db({ existingCert: { id: 'cert-1', code: 'ABCD2345EFGH' } }),
    });
    const res = await app.handler(webhookEvent('checkout.session.completed', giftSession()));

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(callsOf(app, 'donna_gift_certificates', 'insert').length, 0, 'второй раз не пишем');
    assert.strictEqual(app.sent.length, 0, 'второе письмо не уходит');
});

test('гонка на вставке сертификата: 23505 это не ошибка сервера', async () => {
    const app = loadHandler('stripe-webhook.js', {
        env: ENV,
        db: db({ certInsertError: { code: '23505', message: 'duplicate key' } }),
    });
    const res = await app.handler(webhookEvent('checkout.session.completed', giftSession()));

    assert.strictEqual(res.statusCode, 200);
    assert.match(res.body, /duplicate/);
});

test('возврат гасит и сертификат, и покупку', async () => {
    const app = loadHandler('stripe-webhook.js', { env: ENV, db: db({}) });
    const res = await app.handler(webhookEvent('charge.refunded', { payment_intent: PI, object: 'charge' }));

    assert.strictEqual(res.statusCode, 200);

    const purch = callsOf(app, 'purchases', 'update')[0];
    assert.ok(purch, 'покупка отозвана как раньше');
    assert.strictEqual(purch.payload.status, 'revoked');
    assert.strictEqual(purch.payload.revoked_reason, 'refunded');

    const cert = callsOf(app, 'donna_gift_certificates', 'update')[0];
    assert.ok(cert, 'сертификат отозван');
    assert.strictEqual(cert.payload.status, 'revoked');
    assert.ok(cert.filters.some(function (f) { return f[0] === 'stripe_payment_intent_id' && f[1] === PI; }));
    // Активированный сертификат гасить незачем: доступ снимает ревокация
    // purchases по тому же payment_intent.
    assert.ok(cert.filters.some(function (f) { return f[0] === 'status' && f[1] === 'issued'; }),
        'гасим только невыданный');
});

test('чарджбэк гасит и сертификат, и покупку', async () => {
    const app = loadHandler('stripe-webhook.js', { env: ENV, db: db({}) });
    const res = await app.handler(webhookEvent('charge.dispute.created', { payment_intent: PI, object: 'charge' }));

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(callsOf(app, 'purchases', 'update')[0].payload.revoked_reason, 'dispute_created');
    assert.strictEqual(callsOf(app, 'donna_gift_certificates', 'update')[0].payload.status, 'revoked');
});
