// test/save-progress.fractional.test.js
//
// Регрессия 07.09: колонка listening_progress.seconds — integer, а плеер
// копит секунды из audio.currentTime и слал дробь. Postgres отвечал 22P02,
// PostgREST — 400, клиент ошибку глотал. 115 неудачных записей за вечер,
// единственная удачная строка в таблице (13.08, ровно 3600) прошла только
// потому, что её обрезал кап прироста.
//
// Тесты держат границу: что бы ни прислал клиент, в базу уходит integer.
// Заодно закреплены инварианты, которые были до фикса и должны пережить
// следующую правку: прогресс не уменьшается, прирост за вызов ограничен.
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
    token:      TOKEN,
    email:      'buyer@example.com',
    track_ids:  ['negative_cleansing'],
    product_type: 'stupen_1',
    status:     'paid',
    revoked_at: null,
};

// stored — что уже лежит в listening_progress. null = строки ещё нет.
function db(stored, purchase) {
    return function (rec) {
        if (rec.table === 'purchases' && rec.op === 'select') {
            return { data: purchase === undefined ? PURCHASE : purchase, error: null };
        }
        if (rec.table === 'donna_guests' && rec.op === 'select') {
            return { data: null, error: null };
        }
        if (rec.table === 'listening_progress' && rec.op === 'select') {
            return { data: stored === null ? null : { seconds: stored }, error: null };
        }
        if (rec.table === 'listening_progress' && rec.op === 'upsert') {
            return { error: null };
        }
        return { data: null, error: null };
    };
}

function post(seconds, token) {
    return {
        httpMethod: 'POST',
        headers: {
            origin: 'https://app.ekaterina-donnat.com',
            'x-forwarded-for': '203.0.113.7',
        },
        body: JSON.stringify({ token: token === undefined ? TOKEN : token, seconds: seconds }),
    };
}

function upsertsOf(db) {
    return db.calls.filter(function (c) {
        return c.table === 'listening_progress' && c.op === 'upsert';
    });
}

test('дробные секунды пишутся целым числом', async () => {
    const { handler, db: stub } = loadHandler('save-progress.js', { env: ENV, db: db(3600) });

    const res = await handler(post(6031.999564999949));

    assert.strictEqual(res.statusCode, 200);

    const writes = upsertsOf(stub);
    assert.strictEqual(writes.length, 1);
    assert.ok(
        Number.isInteger(writes[0].payload.seconds),
        'в базу ушло не целое: ' + writes[0].payload.seconds
    );
    assert.strictEqual(writes[0].payload.seconds, 6031);
    assert.strictEqual(JSON.parse(res.body).seconds, 6031);
});

test('первая запись без существующей строки тоже целая', async () => {
    const { handler, db: stub } = loadHandler('save-progress.js', { env: ENV, db: db(null) });

    const res = await handler(post(127.4));

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(upsertsOf(stub)[0].payload.seconds, 127);
});

test('прирост за вызов ограничен часом и остаётся целым', async () => {
    const { handler, db: stub } = loadHandler('save-progress.js', { env: ENV, db: db(3600) });

    const res = await handler(post(359999.5));

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(upsertsOf(stub)[0].payload.seconds, 7200);
});

test('прогресс не уменьшается', async () => {
    const { handler, db: stub } = loadHandler('save-progress.js', { env: ENV, db: db(3600) });

    const res = await handler(post(12.3));

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(upsertsOf(stub)[0].payload.seconds, 3600);
});

test('нечисловые секунды не доезжают до базы', async () => {
    for (const raw of ['NaN', 'Infinity', '"600"', 'null']) {
        const { handler, db: stub } = loadHandler('save-progress.js', { env: ENV, db: db(3600) });

        const event = {
            httpMethod: 'POST',
            headers: { origin: 'https://app.ekaterina-donnat.com', 'x-forwarded-for': '203.0.113.7' },
            body: '{"token":"' + TOKEN + '","seconds":' + raw + '}',
        };

        const res = await handler(event);

        // NaN и Infinity не проходят даже JSON.parse — здесь они как границы
        // диапазона, а не как реальный сценарий с боевого клиента.
        assert.strictEqual(res.statusCode, 400, 'seconds=' + raw + ' должно быть 400');
        assert.strictEqual(upsertsOf(stub).length, 0, 'seconds=' + raw + ' доехало до базы');
    }
});

test('потолок в 100 часов на месте', async () => {
    const { handler, db: stub } = loadHandler('save-progress.js', { env: ENV, db: db(3600) });

    const res = await handler(post(360001));

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(upsertsOf(stub).length, 0);
});

test('неизвестный токен не пишет ничего', async () => {
    const { handler, db: stub } = loadHandler('save-progress.js', { env: ENV, db: db(3600, null) });

    const res = await handler(post(600, 'нет-такого-токена'));

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(upsertsOf(stub).length, 0);
});

test('отозванная покупка не пишет ничего', async () => {
    const revoked = Object.assign({}, PURCHASE, { status: 'refunded' });
    const { handler, db: stub } = loadHandler('save-progress.js', { env: ENV, db: db(3600, revoked) });

    const res = await handler(post(600));

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(upsertsOf(stub).length, 0);
});

test('исчерпанный rate limit не пишет ничего', async () => {
    const { handler, db: stub } = loadHandler('save-progress.js', {
        env: ENV,
        db: db(3600),
        rpc: function () { return { data: false, error: null }; },
    });

    const res = await handler(post(6031.99));

    assert.strictEqual(res.statusCode, 429);
    assert.strictEqual(upsertsOf(stub).length, 0);
});
