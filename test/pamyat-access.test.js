// test/pamyat-access.test.js
//
// Окно «Память тела». Набор из раздела «Тесты» спеки от 14.09.
// Главный здесь пятый: он защищает от раздачи продукта после
// закрытия окна, остальные держат границы и форму ответа.
//
// Первый тест стоит особняком. Все прочие меряют границы от своих же
// констант, поэтому переносом окна их не сломать: правят код, правят
// константы рядом, набор снова зелёный, а договорённость разошлась
// с продом, и выясняется это на живых людях. Первый тест сверяет
// даты со спекой буквально, строками, и переносить окно теперь можно
// только вместе с ним.
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
};

// Границы окна: 17.09 17:00 и 20.09 17:00 по Женеве, оба конца 15:00 UTC.
const START = Date.UTC(2026, 8, 17, 15, 0, 0);
const END   = Date.UTC(2026, 8, 20, 15, 0, 0);
const MIN   = 60 * 1000;

function request(origin) {
    return {
        httpMethod: 'GET',
        headers: { origin: origin || 'https://app.ekaterina-donnat.com' },
        body: null,
    };
}

// Время подменяем на уровне Date.now: функция обязана читать часы
// оттуда, иначе её невозможно проверить, не дожидаясь пятнадцатого.
function at(ms, fn) {
    const real = Date.now;
    Date.now = function () { return ms; };
    try { return fn(); } finally { Date.now = real; }
}

function load() {
    return loadHandler('pamyat-access.js', { env: ENV });
}

// Через стенд, а не напрямую: модуль тянет подпись R2, а пакетов
// @aws-sdk на диске нет, они приезжают из окружения Lambda.
function windowState(ms) {
    return load().mod.getWindowState(new Date(ms));
}

// ── Даты операции ──────────────────────────────────────────────────

test('окно стоит ровно там, где договорились', () => {
    // Даты спеки, написанные руками. Ни одна из них не берётся из кода
    // функции: в этом весь смысл проверки.
    const st = windowState(Date.UTC(2026, 8, 18, 12, 0, 0));

    assert.strictEqual(st.startsAt, '2026-09-17T15:00:00.000Z',
        'открытие: четверг, 17:00 по Женеве');
    assert.strictEqual(st.endsAt, '2026-09-20T15:00:00.000Z',
        'закрытие: воскресенье, 17:00 по Женеве');
});

// ── Границы окна ───────────────────────────────────────────────────

test('за минуту до старта окно закрыто', () => {
    const st = windowState(START - MIN);
    assert.strictEqual(st.open, false);
    assert.ok(st.startsAt, 'дата открытия названа');
    assert.ok(st.endsAt, 'дата закрытия названа');
});

test('через минуту после старта окно открыто', () => {
    assert.strictEqual(windowState(START + MIN).open, true);
});

test('за минуту до конца окно ещё открыто', () => {
    assert.strictEqual(windowState(END - MIN).open, true);
});

test('через минуту после конца окно закрыто', () => {
    assert.strictEqual(windowState(END + MIN).open, false);
});

// ── Форма ответа ───────────────────────────────────────────────────

test('закрытое окно: ни одной ссылки в теле ответа', async () => {
    const app = load();
    const res = await at(START - MIN, function () { return app.handler(request()); });

    assert.strictEqual(res.statusCode, 200, 'отвечаем 200, а не ошибкой');

    const body = JSON.parse(res.body);
    assert.strictEqual(body.open, false);
    assert.ok(!('trackUrl' in body), 'ключа trackUrl нет');
    assert.ok(!('warmupUrl' in body), 'ключа warmupUrl нет');
    assert.ok(body.startsAt && body.endsAt, 'даты окна отданы');

    // Главная проверка спеки: никакого адреса в теле, ни в каком виде.
    assert.ok(res.body.indexOf('http') === -1, 'в теле нет подстроки http: ' + res.body);
    assert.strictEqual(app.signed.length, 0, 'подпись даже не запрашивалась');
});

test('закрытое окно после конца: тоже ни одной ссылки', async () => {
    const app = load();
    const res = await at(END + MIN, function () { return app.handler(request()); });
    const body = JSON.parse(res.body);

    assert.strictEqual(body.open, false);
    assert.ok(res.body.indexOf('http') === -1);
    assert.strictEqual(app.signed.length, 0);
});

test('открытое окно: ровно один адрес, подписанный на шесть часов', async () => {
    const app = load();
    const res = await at(START + MIN, function () { return app.handler(request()); });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);

    assert.strictEqual(body.open, true);
    assert.ok(body.endsAt, 'конец окна отдан, странице нужно показать срок');

    assert.ok(body.trackUrl, 'trackUrl отдан');
    assert.ok(body.trackUrl.indexOf('X-Amz-Signature') > -1, 'адрес подписан');
    assert.ok(body.trackUrl.indexOf('X-Amz-Expires=21600') > -1, 'живёт шесть часов');
    assert.ok(body.trackUrl.indexOf('r2.cloudflarestorage.com') > -1, 'ведёт в бакет');

    // Файл склеен, второго адреса больше нет. Ключ warmupUrl не просто
    // пустой, его нет: страница не должна выбирать между двумя файлами.
    assert.ok(!('warmupUrl' in body), 'ключа warmupUrl в ответе нет: ' + res.body);

    assert.deepStrictEqual(app.signed.map(function (s) { return s.key; }),
        ['flagship/body_memory_full.mp3'], 'подписан ровно один ключ, склеенный файл');

    // TTL не режется концом окна: начавший за десять минут до закрытия
    // должен дослушать практику, а не упереться в 403 на середине.
    app.signed.forEach(function (s) { assert.strictEqual(s.expiresIn, 21600); });
});

test('ни один ответ не ведёт на публичный домен аудио', async () => {
    for (const ms of [START - MIN, START + MIN, END - MIN, END + MIN]) {
        const app = load();
        const res = await at(ms, function () { return app.handler(request()); });
        assert.ok(res.body.indexOf('audio.ekaterina-donnat.com') === -1,
            'публичный домен в ответе при ' + new Date(ms).toISOString());
    }
});

// ── Доступ и ошибки ────────────────────────────────────────────────

test('CORS только на страницу окна', async () => {
    const app = load();
    const res = await at(START + MIN, function () { return app.handler(request('https://example.com')); });
    assert.strictEqual(res.headers['Access-Control-Allow-Origin'], 'https://app.ekaterina-donnat.com');
});

test('OPTIONS отвечает 200, посторонний метод 405', async () => {
    const app = load();
    const pre = await app.handler({ httpMethod: 'OPTIONS', headers: {}, body: null });
    assert.strictEqual(pre.statusCode, 200);

    const post = await app.handler({ httpMethod: 'POST', headers: {}, body: '{}' });
    assert.strictEqual(post.statusCode, 405);
});

test('сбой подписи не выносит наружу текст ошибки', async () => {
    // Грабли 30.08, коммит 4b2683c: наружу ушли детали ошибки базы.
    const app = loadHandler('pamyat-access.js', { env: ENV, signFails: true });

    const res = await at(START + MIN, function () { return app.handler(request()); });
    assert.strictEqual(res.statusCode, 500);
    assert.ok(res.body.indexOf('secret bucket detail') === -1, 'текст ошибки не наружу');
    assert.ok(res.body.indexOf('http') === -1, 'и ссылок тоже нет');
});
