// test/pamyat-subscribe.test.js
//
// Подписка со страницы «Памяти тела». Набор из раздела «Тесты» спеки
// от 21.09.
//
// Главный здесь четвёртый: человек, однажды отписавшийся от писем
// Кати, не должен вернуться в рассылку оттого, что ввёл адрес
// на странице. Остальные держат форму ответа и то, что адрес
// не утекает в аналитику.
//
// Запуск: node --test

const test = require('node:test');
const assert = require('node:assert');
const { loadHandler } = require('./helpers/stub-modules');

const ENV = {
    SUPABASE_URL:          'https://stub.supabase.co',
    SUPABASE_SERVICE_KEY:  'service_stub',
    RESEND_API_KEY_KATYA:  're_stub_key',
    RESEND_SEGMENT_PAMYAT: 'seg_pamyat_stub',
};

function request(payload, headers) {
    return {
        httpMethod: 'POST',
        headers: Object.assign({ origin: 'https://app.ekaterina-donnat.com', 'x-forwarded-for': '203.0.113.7' }, headers || {}),
        body: JSON.stringify(payload),
    };
}

// Resend по умолчанию: такого контакта нет, создание проходит.
function resendStub(state) {
    state = state || {};
    return function (call) {
        if (call.method === 'GET' && call.url.indexOf('/contacts/') > -1) {
            if (state.contact) return { status: 200, body: state.contact };
            return { status: 404, body: { message: 'Contact not found' } };
        }
        if (call.method === 'POST' && state.failWrites) {
            return { status: 500, body: { message: 'resend is unhappy about segment seg_pamyat_stub' } };
        }
        if (call.method === 'POST' && state.failSegment && call.url.indexOf('/segments/') > -1) {
            return { status: 422, body: { message: 'no such segment seg_pamyat_stub' } };
        }
        if (call.method === 'GET' && state.failLookup) {
            return { status: 500, body: { message: 'resend is down' } };
        }
        return { status: 200, body: { id: 'contact_1', object: 'contact' } };
    };
}

function load(opts) {
    opts = opts || {};
    return loadHandler('pamyat-subscribe.js', {
        env: ENV,
        db: opts.db,
        rpc: opts.rpc,
        fetch: opts.fetch || resendStub(opts.state),
    });
}

function writes(app) {
    // Всё, что меняет состояние на стороне Resend.
    return app.fetched.filter(function (c) { return c.method !== 'GET'; });
}

const GOOD = { email: 'olga@example.com', sid: 'sid-777', source: 'organic', campaign: 'post_pamyat', hp: '' };

// ── 1. Адрес ───────────────────────────────────────────────────────

test('пустой и кривой адрес отбиваются', async () => {
    const bad = [undefined, '', '   ', 'не-адрес', 'olga@', '@example.com', 'olga@example', 'o@e.c om'];

    for (const value of bad) {
        const app = load();
        const res = await app.handler(request({ email: value, sid: 'sid-1' }));
        assert.strictEqual(res.statusCode, 400, 'адрес ' + JSON.stringify(value) + ' должен быть отбит');
        assert.strictEqual(app.fetched.length, 0, 'до Resend дело не доходит');
    }
});

test('слишком длинный адрес отбивается', async () => {
    const app = load();
    const long = 'o'.repeat(250) + '@example.com';
    const res = await app.handler(request({ email: long }));
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(app.fetched.length, 0);
});

test('пробелы и регистр приводятся к одному виду', async () => {
    const app = load();
    await app.handler(request({ email: '  Olga@Example.COM  ', sid: 'sid-1' }));

    const created = writes(app)[0];
    assert.ok(created, 'контакт создан');
    assert.strictEqual(created.body.email, 'olga@example.com');
});

// ── 2. Ловушка для ботов ───────────────────────────────────────────

test('заполненная ловушка: вежливый успех и ни одного вызова', async () => {
    const app = load();
    const res = await app.handler(request({ email: 'bot@example.com', hp: 'я робот' }));

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(res.body), { ok: true });
    assert.strictEqual(app.fetched.length, 0, 'Resend не вызывается');
    assert.strictEqual(app.db.calls.filter(function (c) { return c.op === 'insert'; }).length, 0,
        'событие тоже не пишется: это бот, а не человек');
});

// ── 3. Новый адрес ─────────────────────────────────────────────────

test('новый адрес: контакт заведён и положен в сегмент', async () => {
    const app = load();
    const res = await app.handler(request(GOOD));

    assert.strictEqual(res.statusCode, 200);

    const w = writes(app);
    assert.strictEqual(w.length, 2, 'создание и добавление, без лишнего: ' + JSON.stringify(w.map(function (c) { return c.url; })));

    assert.ok(w[0].url.indexOf('/contacts') > -1 && w[0].url.indexOf('/segments/') === -1,
        'сначала заводим контакт: ' + w[0].url);
    assert.strictEqual(w[0].body.unsubscribed, false);

    const props = w[0].body.properties || {};
    assert.strictEqual(props.source, 'organic');
    assert.strictEqual(props.campaign, 'post_pamyat');
    assert.ok(props.signup_at, 'дата подписки записана');

    assert.ok((w[0].headers.Authorization || '').indexOf('re_stub_key') > -1, 'ключ уходит заголовком');
});

test('после создания контакта добавление в сегмент идёт ровно один раз', async () => {
    // 21.09 живьём: создание принимает поле с сегментом и молча его
    // не применяет. Контакт был, свойства были, списков ноль. Кладёт
    // только отдельный вызов, и он должен случиться один раз.
    const app = load();
    await app.handler(request(GOOD));

    const toSegment = writes(app).filter(function (c) { return c.url.indexOf('/segments/') > -1; });
    assert.strictEqual(toSegment.length, 1, 'вызов добавления один: ' + JSON.stringify(toSegment));
    assert.ok(toSegment[0].url.indexOf('seg_pamyat_stub') > -1, 'адресован нужному сегменту: ' + toSegment[0].url);
    assert.strictEqual(toSegment[0].body.email, 'olga@example.com');
});

test('отказ добавления в сегмент это не ok', async () => {
    // Контакт заведён, но в списке его нет. Отвечать успехом тут
    // нельзя: человек будет думать, что подписан, а письма не придут.
    const app = load({ state: { failSegment: true } });
    const res = await app.handler(request(GOOD));

    assert.strictEqual(res.statusCode, 500);
    assert.ok(res.body.indexOf('seg_pamyat_stub') === -1, 'идентификатор сегмента не наружу: ' + res.body);

    const inserts = app.db.calls.filter(function (c) { return c.op === 'insert'; });
    assert.strictEqual(inserts.length, 0, 'несостоявшуюся подписку в статистику не пишем');
});

test('существующий подписанный контакт добавляется в сегмент', async () => {
    const app = load({ state: { contact: { id: 'c_1', email: 'olga@example.com', unsubscribed: false } } });
    const res = await app.handler(request(GOOD));

    assert.strictEqual(res.statusCode, 200);
    const w = writes(app);
    assert.strictEqual(w.length, 1, 'существующий контакт заново не создаётся');
    assert.ok(w[0].url.indexOf('seg_pamyat_stub') > -1, 'вызов адресован сегменту: ' + w[0].url);
});

// ── 4. Отписавшийся. Главный тест набора ───────────────────────────

test('существующий отписанный контакт: ни одного изменяющего вызова', async () => {
    const app = load({ state: { contact: { id: 'c_2', email: 'olga@example.com', unsubscribed: true } } });
    const res = await app.handler(request(GOOD));

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(res.body), { ok: true });
    assert.deepStrictEqual(writes(app), [], 'человека, попросившего не писать, не возвращают в рассылку');
});

test('сбой проверки контакта не приводит к созданию', async () => {
    // Не знаем, отписан человек или нет — значит не трогаем ничего.
    const app = load({ fetch: function (call) {
        if (call.method === 'GET') return { status: 500, body: { message: 'resend is down' } };
        return { status: 200, body: {} };
    } });

    const res = await app.handler(request(GOOD));
    assert.strictEqual(res.statusCode, 500, 'честно говорим, что не вышло');
    assert.deepStrictEqual(writes(app), [], 'вслепую не пишем');
});

// ── 5. Ответ одинаковый ────────────────────────────────────────────

test('тело ответа одно и то же для нового, подписанного и отписанного', async () => {
    const bodies = [];

    for (const state of [{}, { contact: { id: 'c', unsubscribed: false } }, { contact: { id: 'c', unsubscribed: true } }]) {
        const app = load({ state: state });
        const res = await app.handler(request(GOOD));
        bodies.push(res.statusCode + ' ' + res.body);
    }

    assert.strictEqual(bodies[0], bodies[1], 'новый и подписанный отвечают одинаково');
    assert.strictEqual(bodies[1], bodies[2], 'отписанный отвечает так же: функция не говорит, есть ли такой человек у Кати');
});

// ── 6. Событие без адреса ──────────────────────────────────────────

test('в demo_events уходит событие без адреса', async () => {
    const app = load();
    await app.handler(request(GOOD));

    const inserts = app.db.calls.filter(function (c) { return c.op === 'insert'; });
    assert.strictEqual(inserts.length, 1, 'ровно одна запись события');
    assert.strictEqual(inserts[0].table, 'demo_events');

    const row = inserts[0].payload;
    assert.strictEqual(row.event, 'email_submit');
    assert.strictEqual(row.surface, 'pamyat');
    assert.strictEqual(row.campaign, 'post_pamyat');
    assert.strictEqual(row.source, 'organic');
    assert.strictEqual(row.session_id, 'sid-777');

    const asText = JSON.stringify(row);
    assert.ok(asText.indexOf('olga') === -1 && asText.indexOf('@') === -1,
        'адреса в аналитике не держим: ' + asText);
});

test('отписанный тоже считается: событие пишется, адрес нет', async () => {
    const app = load({ state: { contact: { id: 'c', unsubscribed: true } } });
    await app.handler(request(GOOD));

    const inserts = app.db.calls.filter(function (c) { return c.op === 'insert'; });
    assert.strictEqual(inserts.length, 1, 'форму заполнил человек, и это событие');
    assert.ok(JSON.stringify(inserts[0].payload).indexOf('@') === -1);
});

test('незнакомая метка кампании обнуляется, а не пишется как есть', async () => {
    const app = load();
    await app.handler(request({ email: 'olga@example.com', sid: 'sid-1', source: 'хулиган', campaign: 'сам_придумал' }));

    const row = app.db.calls.filter(function (c) { return c.op === 'insert'; })[0].payload;
    assert.strictEqual(row.campaign, null);
    assert.strictEqual(row.source, 'organic', 'неизвестный источник сводится к organic, как в track-demo');
});

// ── Доступ и ошибки ────────────────────────────────────────────────

test('CORS только на страницу окна, OPTIONS 200, чужой метод 405', async () => {
    const app = load();

    const post = await app.handler(request(GOOD, { origin: 'https://example.com' }));
    assert.strictEqual(post.headers['Access-Control-Allow-Origin'], 'https://app.ekaterina-donnat.com');

    const pre = await app.handler({ httpMethod: 'OPTIONS', headers: {}, body: null });
    assert.strictEqual(pre.statusCode, 200);

    const get = await app.handler({ httpMethod: 'GET', headers: {}, body: null });
    assert.strictEqual(get.statusCode, 405);
});

test('лимит перебора отбивает 429 и ничего не пишет', async () => {
    const app = load({ rpc: function () { return { data: false, error: null }; } });
    const res = await app.handler(request(GOOD));

    assert.strictEqual(res.statusCode, 429);
    assert.strictEqual(app.fetched.length, 0);
});

test('сбой Resend не выносит наружу текст ошибки', async () => {
    // Грабли 30.08, коммит 4b2683c: наружу ушли детали ошибки базы.
    const app = load({ state: { failWrites: true } });
    const res = await app.handler(request(GOOD));

    assert.strictEqual(res.statusCode, 500);
    assert.ok(res.body.indexOf('seg_pamyat_stub') === -1, 'идентификатор сегмента не наружу: ' + res.body);
    assert.ok(res.body.indexOf('unhappy') === -1, 'текст ошибки не наружу: ' + res.body);
});

test('без сегмента в окружении не ходим в сеть вовсе', async () => {
    const app = loadHandler('pamyat-subscribe.js', {
        env: Object.assign({}, ENV, { RESEND_SEGMENT_PAMYAT: undefined }),
        fetch: resendStub(),
    });

    const res = await app.handler(request(GOOD));
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(app.fetched.length, 0, 'причина видна до первого запроса');
});

test('кривое тело запроса это 400, а не падение', async () => {
    const app = load();
    const res = await app.handler({ httpMethod: 'POST', headers: {}, body: '{не json' });
    assert.strictEqual(res.statusCode, 400);
});
