// test/son.test.js
//
// «Фонарщик»: платный продукт и три пробные ночи. Набор из пункта 6
// спеки `donna_spec_fonarshchik.md` от 17.11.
//
// Главные здесь три вещи. Покупка по новой ссылке даёт ровно трек
// «Фонарщика» и ничего больше. Пробный доступ закрывается по сроку,
// а не по доброй воле плеера. Повторная запись срок не продлевает.
//
// Запуск: node --test

const test = require('node:test');
const assert = require('node:assert');
const { loadHandler } = require('./helpers/stub-modules');

const ENV = {
    SUPABASE_URL:         'https://stub.supabase.co',
    SUPABASE_SERVICE_KEY: 'service_stub',
    R2_ENDPOINT:          'https://stub-account.r2.cloudflarestorage.com',
    R2_ACCESS_KEY_ID:     'stub_key',
    R2_SECRET_ACCESS_KEY: 'stub_secret',
    R2_BUCKET_NAME:       'donnameditations',
    RESEND_API_KEY_KATYA: 're_stub',
    RESEND_SEGMENT_SON:   'seg_son',
    LINEUP_MODE_TOKEN:    undefined,
};

const HOUR = 60 * 60 * 1000;

function at(ms, fn) {
    const real = Date.now;
    Date.now = function () { return ms; };
    try { return fn(); } finally { Date.now = real; }
}

async function atAsync(ms, fn) {
    const real = Date.now;
    Date.now = function () { return ms; };
    try { return await fn(); } finally { Date.now = real; }
}

// ── Срок пробных ночей ─────────────────────────────────────────────

function schedule(ms, offset) {
    const { mod } = loadHandler('_trial.js', { env: ENV });
    return mod.trialSchedule(ms, offset);
}

test('запись 17.11 в 23:00 по Женеве: доступ до 20.11 10:00, утро 18.11 9:30, последний вечер 19.11 19:00', function () {
    // Женева зимой UTC+1, getTimezoneOffset() даёт -60.
    const s = schedule(Date.UTC(2026, 10, 17, 22, 0), -60);
    assert.strictEqual(s.expiresAt, '2026-11-20T09:00:00.000Z');
    assert.strictEqual(s.morningAt, '2026-11-18T08:30:00.000Z');
    assert.strictEqual(s.lastEveningAt, '2026-11-19T18:00:00.000Z');
});

test('запись в 02:00 считается той же ночью, срок не сдвигается на день', function () {
    const night = schedule(Date.UTC(2026, 10, 17, 22, 0), -60);
    const after = schedule(Date.UTC(2026, 10, 18, 1, 0), -60);
    assert.deepStrictEqual(after, night);
});

test('часовой пояс человека, а не сервера: Бали, UTC+8', function () {
    const s = schedule(Date.UTC(2026, 10, 17, 14, 0), -480); // 22:00 на Бали
    assert.strictEqual(s.expiresAt, '2026-11-20T02:00:00.000Z');
    assert.strictEqual(s.morningAt, '2026-11-18T01:30:00.000Z');
});

test('мусор вместо смещения: берём Женеву, а не падаем', function () {
    const s = schedule(Date.UTC(2026, 10, 17, 22, 0), 'abc');
    assert.strictEqual(s.expiresAt, '2026-11-20T09:00:00.000Z');
    assert.strictEqual(s.offset, -60);
});

test('оба письма уходят в будущее при записи в любой час суток', function () {
    for (let h = 0; h < 24; h++) {
        const now = Date.UTC(2026, 10, 17, h, 17);
        const s = schedule(now, -60);
        assert.ok(Date.parse(s.morningAt) > now, 'утро в прошлом при записи в ' + h);
        assert.ok(Date.parse(s.lastEveningAt) > Date.parse(s.morningAt), 'вечер раньше утра при ' + h);
        assert.ok(Date.parse(s.expiresAt) > Date.parse(s.lastEveningAt), 'срок раньше вечера при ' + h);
        // Resend держит отложенные письма не дольше 72 часов.
        assert.ok(Date.parse(s.lastEveningAt) - now < 72 * HOUR, 'вечер дальше 72 часов при ' + h);
    }
});

// ── Каталог ────────────────────────────────────────────────────────

test('ссылка «Фонарщика» из env даёт ровно трек son и тип son', function () {
    const { mod } = loadHandler('_products.js', { env: Object.assign({}, ENV, { STRIPE_SON_ID: 'plink_son_test' }) });
    const p = mod.PRODUCTS.plink_son_test;
    assert.ok(p, 'ссылка не опознана');
    assert.deepStrictEqual(p.track_ids, ['son']);
    assert.strictEqual(p.product_type, 'son');
    assert.strictEqual(p.journal, null);
});

test('без env ссылка не появляется и не создаёт ключ undefined', function () {
    const { mod } = loadHandler('_products.js', { env: Object.assign({}, ENV, { STRIPE_SON_ID: undefined }) });
    assert.strictEqual(mod.PRODUCTS.undefined, undefined);
    assert.ok(mod.productByType('son'), 'тип son должен резолвиться для сертификатов');
});

test('полный альбом «Фонарщика» не получает: он продаётся отдельно', function () {
    const { mod } = loadHandler('_products.js', { env: ENV });
    assert.strictEqual(mod.productByType('full_album').track_ids.indexOf('son'), -1);
});

// ── verify-token: гостевая ветка ───────────────────────────────────

function verifyApp(guestRow, purchaseRow) {
    return loadHandler('verify-token.js', {
        env: ENV,
        db: function (rec) {
            if (rec.table === 'purchases') return { data: purchaseRow || null, error: null };
            if (rec.table === 'donna_guests') return { data: guestRow || null, error: null };
            return { data: null, error: null };
        },
    });
}

function verifyRequest(token) {
    return {
        httpMethod: 'GET',
        headers: { 'x-forwarded-for': '203.0.113.9', origin: 'https://app.ekaterina-donnat.com' },
        queryStringParameters: { token: token },
    };
}

const NOW = Date.UTC(2026, 10, 18, 20, 0);

test('гость в срок получает подписанный трек пробной версии и без скачивания', async function () {
    const app = verifyApp({
        email: 'a@example.com', promo_track: 'son_trial', created_at: '2026-11-17T22:00:00Z',
        expires_at: '2026-11-20T09:00:00Z',
    });
    const res = await atAsync(NOW, function () { return app.handler(verifyRequest('tok-1')); });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.type, 'guest');
    assert.strictEqual(body.tracks.length, 1);
    assert.strictEqual(body.tracks[0].id, 'son_trial');
    assert.ok(body.tracks[0].streamUrl.indexOf('son/pervoe_pogruzhenie.mp3') !== -1);
    assert.strictEqual(body.tracks[0].downloadUrl, undefined, 'гостю скачивание не положено');
    assert.strictEqual(app.signed.length, 1, 'подписана ровно одна ссылка');
});

test('после срока гость получает 403 trial_ended и ни одной подписи', async function () {
    const app = verifyApp({
        email: 'a@example.com', promo_track: 'son_trial', created_at: '2026-11-17T22:00:00Z',
        expires_at: '2026-11-20T09:00:00Z',
    });
    const res = await atAsync(Date.UTC(2026, 10, 20, 9, 0), function () { return app.handler(verifyRequest('tok-1')); });
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(JSON.parse(res.body).error, 'trial_ended');
    assert.strictEqual(app.signed.length, 0);
});

test('старый гость без срока работает как раньше: пустой список и промо-трек', async function () {
    const app = verifyApp({ email: 'b@example.com', promo_track: 'water_energy', created_at: '2026-07-01T00:00:00Z', expires_at: null });
    const res = await atAsync(NOW, function () { return app.handler(verifyRequest('tok-2')); });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepStrictEqual(body.tracks, []);
    assert.strictEqual(body.promoTrack, 'water_energy');
});

test('покупатель «Фонарщика» получает поток и скачивание', async function () {
    const app = verifyApp(null, {
        track_ids: ['son'], email: 'c@example.com', created_at: '2026-11-18T10:00:00Z',
        status: 'paid', revoked_at: null, product_type: 'son',
    });
    const res = await atAsync(NOW, function () { return app.handler(verifyRequest('tok-3')); });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.tracks[0].id, 'son');
    assert.ok(body.tracks[0].streamUrl.indexOf('son/fonarshchik.mp3') !== -1);
    assert.ok(body.tracks[0].downloadUrl, 'купившему скачивание положено');
});

// ── son-trial: запись на три ночи ──────────────────────────────────

function trialApp(opts) {
    opts = opts || {};
    const writes = [];
    const app = loadHandler('son-trial.js', {
        env: ENV,
        db: function (rec) {
            if (rec.table === 'donna_guests' && rec.op === 'select') return { data: opts.existing || null, error: null };
            if (rec.op === 'insert' || rec.op === 'update') { writes.push(rec); return { data: null, error: opts.insertError || null }; }
            return { data: null, error: null };
        },
        rpc: opts.rateLimited ? function () { return { data: false, error: null }; } : undefined,
        fetch: function (call) {
            if (call.method === 'GET' && call.url.indexOf('/contacts/') !== -1) {
                return opts.contact ? { status: 200, body: opts.contact } : { status: 404, body: {} };
            }
            return { status: 200, body: { id: 'x' } };
        },
    });
    app.writes = writes;
    return app;
}

function trialRequest(body) {
    return {
        httpMethod: 'POST',
        headers: { origin: 'https://ekaterina-donnat.com', 'x-forwarded-for': '203.0.113.10' },
        body: JSON.stringify(body),
    };
}

function emails(app) {
    return app.fetched.filter(function (c) { return c.method === 'POST' && /\/emails$/.test(c.url); });
}

const SIGNUP = Date.UTC(2026, 10, 17, 22, 0); // 23:00 по Женеве

test('новый адрес: строка с son_trial и сроком, три письма, контакт в сегменте', async function () {
    const app = trialApp();
    const res = await atAsync(SIGNUP, function () {
        return app.handler(trialRequest({ email: ' Anna@Example.com ', tz: -60, source: 'paid', campaign: 'ig_ad_son', sid: 's1' }));
    });
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(res.body), { ok: true });

    const row = app.writes.find(function (w) { return w.table === 'donna_guests' && w.op === 'insert'; });
    assert.ok(row, 'строка не создана');
    assert.strictEqual(row.payload.email, 'anna@example.com');
    assert.strictEqual(row.payload.promo_track, 'son_trial');
    assert.strictEqual(row.payload.expires_at, '2026-11-20T09:00:00.000Z');
    assert.strictEqual(row.payload.campaign, 'ig_ad_son');
    assert.strictEqual(row.payload.utm_source, 'paid');

    const sent = emails(app);
    assert.strictEqual(sent.length, 3, 'должно быть три письма');
    assert.strictEqual(sent[0].body.scheduled_at, undefined, 'первое письмо уходит сразу');
    assert.ok(sent[0].body.html.indexOf(row.payload.token) !== -1, 'в первом письме ссылка с токеном');
    assert.strictEqual(sent[1].body.scheduled_at, '2026-11-18T08:30:00.000Z');
    assert.strictEqual(sent[2].body.scheduled_at, '2026-11-19T18:00:00.000Z');

    const seg = app.fetched.filter(function (c) { return c.url.indexOf('/segments/seg_son/contacts') !== -1; });
    assert.strictEqual(seg.length, 1, 'контакт в сегмент кладётся один раз');
});

test('повторная запись в срок: ссылка ещё раз, срок прежний, новых отложенных писем нет', async function () {
    const app = trialApp({
        existing: { token: 'tok-old', promo_track: 'son_trial', expires_at: '2026-11-20T09:00:00Z' },
    });
    const res = await atAsync(SIGNUP + 20 * HOUR, function () {
        return app.handler(trialRequest({ email: 'anna@example.com', tz: -60 }));
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(app.writes.filter(function (w) { return w.table === 'donna_guests'; }).length, 0, 'строку трогать нельзя');
    const sent = emails(app);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].body.scheduled_at, undefined);
    assert.ok(sent[0].body.html.indexOf('tok-old') !== -1, 'ссылка старая, токен тот же');
});

test('повторная запись после срока: ответ тот же, письмо про полную версию, доступ не открывается', async function () {
    const app = trialApp({
        existing: { token: 'tok-old', promo_track: 'son_trial', expires_at: '2026-11-20T09:00:00Z' },
    });
    const res = await atAsync(Date.UTC(2026, 10, 25, 12, 0), function () {
        return app.handler(trialRequest({ email: 'anna@example.com', tz: -60 }));
    });
    assert.deepStrictEqual(JSON.parse(res.body), { ok: true }, 'ответ не должен выдавать, был ли адрес');
    assert.strictEqual(app.writes.filter(function (w) { return w.table === 'donna_guests'; }).length, 0);
    const sent = emails(app);
    assert.strictEqual(sent.length, 1);
    assert.ok(sent[0].body.html.indexOf('tok-old') === -1, 'в письме не должно быть ссылки на плеер');
});

test('адрес, занятый старым лид-магнитом, пробных ночей не получает и строку не ломает', async function () {
    const app = trialApp({ existing: { token: 'tok-legacy', promo_track: 'water_energy', expires_at: null } });
    const res = await atAsync(SIGNUP, function () { return app.handler(trialRequest({ email: 'anna@example.com', tz: -60 })); });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(app.writes.filter(function (w) { return w.table === 'donna_guests'; }).length, 0);
});

test('отписавшийся получает ссылку, но без отложенных писем и без сегмента', async function () {
    const app = trialApp({ contact: { email: 'anna@example.com', unsubscribed: true } });
    await atAsync(SIGNUP, function () { return app.handler(trialRequest({ email: 'anna@example.com', tz: -60 })); });
    const sent = emails(app);
    assert.strictEqual(sent.length, 1, 'только письмо со ссылкой');
    assert.strictEqual(app.fetched.filter(function (c) { return c.url.indexOf('/segments/') !== -1; }).length, 0);
});

test('кривой адрес: 400 и ни одного письма', async function () {
    const app = trialApp();
    const res = await atAsync(SIGNUP, function () { return app.handler(trialRequest({ email: 'not-an-email' })); });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(emails(app).length, 0);
});

test('ловушка для ботов: успех снаружи, ничего внутри', async function () {
    const app = trialApp();
    const res = await atAsync(SIGNUP, function () { return app.handler(trialRequest({ email: 'a@example.com', hp: 'x' })); });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(app.writes.length, 0);
    assert.strictEqual(emails(app).length, 0);
});

test('лимит запросов: 429 и ни одной записи', async function () {
    const app = trialApp({ rateLimited: true });
    const res = await atAsync(SIGNUP, function () { return app.handler(trialRequest({ email: 'a@example.com' })); });
    assert.strictEqual(res.statusCode, 429);
    assert.strictEqual(app.writes.length, 0);
});

test('база отказала: 500, писем нет, ссылка не ушла в никуда', async function () {
    const app = trialApp({ insertError: { message: 'db down' } });
    const res = await atAsync(SIGNUP, function () { return app.handler(trialRequest({ email: 'a@example.com', tz: -60 })); });
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(emails(app).length, 0);
});
