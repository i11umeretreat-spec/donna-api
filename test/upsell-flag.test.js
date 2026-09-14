// test/upsell-flag.test.js
//
// upsell_shown пустая с самого начала. Проверка 08.09 показала, что путь
// записи живой и дело в отсутствии трафика, а не в отказе. Но POST не читал
// результат upsert и в любом случае отвечал ok — то же самое молчание,
// за которым три месяца пряталась поломка listening_progress.
//
// Тесты держат две вещи: ключ, по которому метка ищется потом, и то,
// что отказ записи виден снаружи.
//
// Запуск: node --test

const test = require('node:test');
const assert = require('node:assert');
const { loadHandler } = require('./helpers/stub-modules');

const ENV = {
    SUPABASE_URL:         'https://stub.supabase.co',
    SUPABASE_SERVICE_KEY: 'service_stub',
    LINEUP_MODE_TOKEN:    undefined,
};

const TOKEN = '11111111-2222-3333-4444-555555555555';

const PURCHASE = {
    token:        TOKEN,
    email:        'buyer@example.com',
    track_ids:    ['negative_cleansing'],
    product_type: 'stupen_1',
    status:       'paid',
    revoked_at:   null,
};

// shown — есть ли уже метка. upsertError — отказ базы на записи.
function db(shown, opts) {
    opts = opts || {};
    return function (rec) {
        if (rec.table === 'purchases' && rec.op === 'select') {
            return { data: 'purchase' in opts ? opts.purchase : PURCHASE, error: null };
        }
        if (rec.table === 'donna_guests' && rec.op === 'select') {
            return { data: null, error: null };
        }
        if (rec.table === 'upsell_shown' && rec.op === 'select') {
            return { data: shown ? { shown_at: '2026-09-01T10:00:00.000Z' } : null, error: null };
        }
        if (rec.table === 'upsell_shown' && rec.op === 'upsert') {
            return { error: opts.upsertError || null };
        }
        return { data: null, error: null };
    };
}

function post(step, token) {
    return {
        httpMethod: 'POST',
        headers: { origin: 'https://app.ekaterina-donnat.com' },
        body: JSON.stringify({ token: token === undefined ? TOKEN : token, step: step }),
    };
}

function get(step, token) {
    return {
        httpMethod: 'GET',
        headers: { origin: 'https://app.ekaterina-donnat.com' },
        queryStringParameters: { token: token === undefined ? TOKEN : token, step: String(step) },
    };
}

function upsertsOf(db) {
    return db.calls.filter(function (c) {
        return c.table === 'upsell_shown' && c.op === 'upsert';
    });
}

test('POST пишет метку под ключом токен:ступень', async () => {
    const { handler, db: stub } = loadHandler('upsell-flag.js', { env: ENV, db: db(false) });

    const res = await handler(post(2));

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(res.body), { ok: true });

    const writes = upsertsOf(stub);
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0].payload.key, TOKEN + ':step2');
    assert.ok(writes[0].payload.shown_at, 'shown_at не проставлен');
});

test('отказ записи виден снаружи, а не молча ok', async () => {
    const { handler } = loadHandler('upsell-flag.js', {
        env: ENV,
        db: db(false, { upsertError: { message: 'invalid input', code: '22P02' } }),
    });

    const res = await handler(post(2));

    assert.strictEqual(res.statusCode, 500);
    assert.notDeepStrictEqual(JSON.parse(res.body), { ok: true });
});

test('GET отражает уже показанный апсел', async () => {
    const shown = await loadHandler('upsell-flag.js', { env: ENV, db: db(true) });
    const fresh = await loadHandler('upsell-flag.js', { env: ENV, db: db(false) });

    assert.deepStrictEqual(JSON.parse((await shown.handler(get(2))).body), { shown: true });
    assert.deepStrictEqual(JSON.parse((await fresh.handler(get(2))).body), { shown: false });
});

test('ступень вне списка не доезжает до базы', async () => {
    for (const step of [9, 0, '2; drop', null]) {
        const { handler, db: stub } = loadHandler('upsell-flag.js', { env: ENV, db: db(false) });

        const res = await handler(post(step));

        assert.strictEqual(res.statusCode, 400, 'step=' + step + ' должно быть 400');
        assert.strictEqual(upsertsOf(stub).length, 0, 'step=' + step + ' доехало до базы');
    }
});

test('неизвестный токен не пишет ничего', async () => {
    const { handler, db: stub } = loadHandler('upsell-flag.js', {
        env: ENV,
        db: db(false, { purchase: null }),
    });

    const res = await handler(post(2, 'нет-такого-токена'));

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(upsertsOf(stub).length, 0);
});

test('отозванная покупка не пишет ничего', async () => {
    const revoked = Object.assign({}, PURCHASE, { status: 'refunded' });
    const { handler, db: stub } = loadHandler('upsell-flag.js', {
        env: ENV,
        db: db(false, { purchase: revoked }),
    });

    const res = await handler(post(2));

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(upsertsOf(stub).length, 0);
});
