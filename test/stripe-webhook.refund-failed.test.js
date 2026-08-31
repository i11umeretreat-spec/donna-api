// test/stripe-webhook.refund-failed.test.js
//
// Таблица приёмки из спеки от 31.08, плюс случаи, которые в ней
// не названы, но лежат на том же пути: отсутствующий payment_intent,
// упавший Resend, незаданный адрес получателя.
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
};

const PI = 'pi_3U3ct4CQps4bJWCV08OWYb3i';

function refund(over) {
    return Object.assign({
        id:             're_1TestRefund',
        object:         'refund',
        amount:         9000,
        currency:       'eur',
        payment_intent: PI,
        status:         'failed',
        failure_reason: 'declined',
    }, over || {});
}

// Строка покупки, которую отдаёт подменённый Supabase на select.
function withPurchase(purchase, updateError) {
    return function (rec) {
        if (rec.table === 'purchases' && rec.op === 'select') {
            return { data: purchase ? [purchase] : [], error: null };
        }
        if (rec.table === 'purchases' && rec.op === 'update') {
            return { error: updateError || null };
        }
        return { data: null, error: null };
    };
}

const PURCHASE = {
    email:          'naritsyna.polina@example.com',
    amount:         90,
    revoked_reason: 'refunded',
};

function updatesOf(db) {
    return db.calls.filter(function (c) { return c.table === 'purchases' && c.op === 'update'; });
}

test('failed: пишет причину, не трогает status, шлёт письмо', async () => {
    const app = loadHandler('stripe-webhook.js', { env: ENV, db: withPurchase(PURCHASE) });
    const res = await app.handler(webhookEvent('refund.updated', refund()));

    assert.strictEqual(res.statusCode, 200);

    const upd = updatesOf(app.db);
    assert.strictEqual(upd.length, 1, 'ровно одна запись в purchases');
    assert.deepStrictEqual(upd[0].payload, { revoked_reason: 'refund_failed' });
    assert.ok(!('status' in upd[0].payload), 'status не переписывается');
    assert.ok(!('revoked_at' in upd[0].payload), 'revoked_at не переписывается');
    assert.deepStrictEqual(upd[0].filters, [['stripe_payment_intent_id', PI]]);

    assert.strictEqual(app.sent.length, 1, 'письмо ушло');
    const mail = app.sent[0];
    assert.strictEqual(mail.to, 'katya@example.com', 'получатель из окружения');

    // Спека требует в письме сумму, почту покупателя, id возврата и причину.
    assert.match(mail.html, /90[.,]00/);
    assert.match(mail.html, /EUR/);
    assert.match(mail.html, /naritsyna\.polina@example\.com/);
    assert.match(mail.html, /re_1TestRefund/);
    assert.match(mail.html, /declined/);
});

test('устаревшее имя charge.refund.updated обрабатывается так же', async () => {
    const app = loadHandler('stripe-webhook.js', { env: ENV, db: withPurchase(PURCHASE) });
    const res = await app.handler(webhookEvent('charge.refund.updated', refund()));

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(updatesOf(app.db).length, 1);
    assert.strictEqual(app.sent.length, 1);
});

test('canceled обрабатывается наравне с failed', async () => {
    const app = loadHandler('stripe-webhook.js', { env: ENV, db: withPurchase(PURCHASE) });
    const res = await app.handler(
        webhookEvent('refund.updated', refund({ status: 'canceled', failure_reason: undefined }))
    );

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(updatesOf(app.db).length, 1);
    assert.strictEqual(app.sent.length, 1);
});

test('succeeded: 200 и ни одной записи в базу', async () => {
    const app = loadHandler('stripe-webhook.js', { env: ENV, db: withPurchase(PURCHASE) });
    const res = await app.handler(webhookEvent('refund.updated', refund({ status: 'succeeded' })));

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(app.db.calls.length, 0, 'до базы не ходим вовсе');
    assert.strictEqual(app.sent.length, 0);
});

test('неизвестный payment_intent: 200, без записи и без падения', async () => {
    const app = loadHandler('stripe-webhook.js', { env: ENV, db: withPurchase(null) });
    const res = await app.handler(webhookEvent('refund.updated', refund()));

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(updatesOf(app.db).length, 0);
    assert.strictEqual(app.sent.length, 0);
});

test('payment_intent отсутствует в payload: 200', async () => {
    const app = loadHandler('stripe-webhook.js', { env: ENV, db: withPurchase(PURCHASE) });
    const res = await app.handler(
        webhookEvent('refund.updated', refund({ payment_intent: null }))
    );

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(updatesOf(app.db).length, 0);
    assert.strictEqual(app.sent.length, 0);
});

test('повторная доставка: причина уже записана, второго письма нет', async () => {
    const already = Object.assign({}, PURCHASE, { revoked_reason: 'refund_failed' });
    const app = loadHandler('stripe-webhook.js', { env: ENV, db: withPurchase(already) });
    const res = await app.handler(webhookEvent('refund.updated', refund()));

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(updatesOf(app.db).length, 0, 'повторно не пишем');
    assert.strictEqual(app.sent.length, 0, 'второе письмо не уходит');
});

test('упавшее письмо не валит вебхук: причина записана, ответ 200', async () => {
    const env = Object.assign({}, ENV, { KATYA_ALERT_EMAIL: 'throw@example.com' });
    const app = loadHandler('stripe-webhook.js', { env: env, db: withPurchase(PURCHASE) });
    const res = await app.handler(webhookEvent('refund.updated', refund()));

    assert.strictEqual(res.statusCode, 200, 'иначе Stripe будет ретраить уже сделанное');
    assert.strictEqual(updatesOf(app.db).length, 1);
});

test('адрес получателя не задан: причина записана, вебхук отвечает 200', async () => {
    const env = Object.assign({}, ENV, { KATYA_ALERT_EMAIL: undefined });
    const app = loadHandler('stripe-webhook.js', { env: env, db: withPurchase(PURCHASE) });
    const res = await app.handler(webhookEvent('refund.updated', refund()));

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(updatesOf(app.db).length, 1, 'запись в базу важнее письма');
    assert.strictEqual(app.sent.length, 0);
});

test('ошибка записи в базу: 500, чтобы Stripe повторил доставку', async () => {
    const app = loadHandler('stripe-webhook.js', {
        env: ENV,
        db: withPurchase(PURCHASE, { message: 'permission denied' }),
    });
    const res = await app.handler(webhookEvent('refund.updated', refund()));

    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(app.sent.length, 0);
});

// ── Прежнее поведение. Новая ветка стоит выше по коду, и сломать
//    её соседей проще всего именно здесь. ───────────────────────────

test('charge.refunded по-прежнему гасит доступ', async () => {
    const app = loadHandler('stripe-webhook.js', { env: ENV, db: withPurchase(PURCHASE) });
    const res = await app.handler(
        webhookEvent('charge.refunded', { payment_intent: PI, object: 'charge' })
    );

    assert.strictEqual(res.statusCode, 200);
    const upd = updatesOf(app.db);
    assert.strictEqual(upd.length, 1);
    assert.strictEqual(upd[0].payload.status, 'revoked');
    assert.strictEqual(upd[0].payload.revoked_reason, 'refunded');
    assert.ok(upd[0].payload.revoked_at, 'revoked_at проставляется');
});

test('charge.dispute.created по-прежнему гасит доступ', async () => {
    const app = loadHandler('stripe-webhook.js', { env: ENV, db: withPurchase(PURCHASE) });
    const res = await app.handler(
        webhookEvent('charge.dispute.created', { payment_intent: PI, object: 'charge' })
    );

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(updatesOf(app.db)[0].payload.revoked_reason, 'dispute_created');
});

test('checkout.session.completed по-прежнему выдаёт доступ и письмо', async () => {
    const app = loadHandler('stripe-webhook.js', {
        env: ENV,
        db: function (rec) {
            if (rec.op === 'select') return { data: null, error: null };
            return { error: null };
        },
    });

    const res = await app.handler(webhookEvent('checkout.session.completed', {
        id:               'cs_test_1',
        payment_link:     'plink_flagship',
        amount_total:     9000,
        payment_intent:   PI,
        customer_details: { email: 'buyer@example.com' },
        client_reference_id: 'wa_flagman|paid',
    }));

    assert.strictEqual(res.statusCode, 200);

    const ins = app.db.calls.filter(function (c) { return c.table === 'purchases' && c.op === 'insert'; });
    assert.strictEqual(ins.length, 1, 'покупка записана');
    assert.strictEqual(ins[0].payload.email, 'buyer@example.com');
    assert.strictEqual(ins[0].payload.campaign, 'wa_flagman');
    assert.strictEqual(ins[0].payload.status, 'paid');

    assert.strictEqual(app.sent.length, 1);
    assert.strictEqual(app.sent[0].to, 'buyer@example.com');
});

test('нераспознанное событие: 200, иначе Stripe будет ретраить', async () => {
    const app = loadHandler('stripe-webhook.js', { env: ENV, db: withPurchase(PURCHASE) });
    const res = await app.handler(webhookEvent('invoice.paid', { id: 'in_1' }));

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(app.db.calls.length, 0);
});

test('событие из тестового режима не касается боевых данных', async () => {
    const app = loadHandler('stripe-webhook.js', { env: ENV, db: withPurchase(PURCHASE) });
    const res = await app.handler(webhookEvent('refund.updated', refund(), false));

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(app.db.calls.length, 0);
    assert.strictEqual(app.sent.length, 0);
});

test('битая подпись: 400 и ничего не пишем', async () => {
    const app = loadHandler('stripe-webhook.js', { env: ENV, db: withPurchase(PURCHASE) });
    const ev = webhookEvent('refund.updated', refund());
    ev.headers['stripe-signature'] = 'bad-signature';

    const res = await app.handler(ev);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(updatesOf(app.db).length, 0);
});
