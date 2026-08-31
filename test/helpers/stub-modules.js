// test/helpers/stub-modules.js
//
// Стенд для serverless-функций: подменяет stripe, supabase и resend
// до того, как функция их затребует. Без новых зависимостей, поэтому
// подмена идёт через require.cache, а не через мок-библиотеку.
//
// Функция создаёт клиентов на уровне модуля, при первом require. Значит
// порядок жёсткий: сначала переменные окружения, потом заглушки, и только
// потом сам обработчик. loadHandler ниже держит этот порядок за нас.

const path = require('path');
const Module = require('module');

const FUNCTIONS_DIR = path.join(__dirname, '..', '..', 'netlify', 'functions');

function stub(name, exports) {
    const resolved = require.resolve(name, { paths: [FUNCTIONS_DIR] });
    require.cache[resolved] = new Module(resolved, null);
    require.cache[resolved].filename = resolved;
    require.cache[resolved].loaded = true;
    require.cache[resolved].exports = exports;
    return resolved;
}

// Запрос к Supabase: собирает вызовы цепочки в запись и отдаёт ответ,
// который тест задал через resolver. Thenable, а не Promise, потому что
// ответ должен зависеть от полностью собранной цепочки: await случается
// уже после .eq() и .limit().
function makeSupabase(resolver) {
    const calls = [];

    function from(table) {
        const rec = { table: table, op: null, payload: null, filters: [], cols: null };
        calls.push(rec);

        const builder = {
            select: function (cols) { rec.op = 'select'; rec.cols = cols; return builder; },
            update: function (v) { rec.op = 'update'; rec.payload = v; return builder; },
            insert: function (v) { rec.op = 'insert'; rec.payload = v; return builder; },
            upsert: function (v) { rec.op = 'upsert'; rec.payload = v; return builder; },
            eq: function (c, v) { rec.filters.push([c, v]); return builder; },
            limit: function (n) { rec.limit = n; return builder; },
            maybeSingle: function () { rec.single = true; return builder; },
            then: function (onOk, onErr) {
                return Promise.resolve(resolver(rec)).then(onOk, onErr);
            },
            catch: function (onErr) {
                return Promise.resolve(resolver(rec)).catch(onErr);
            },
        };

        return builder;
    }

    return { client: { from: from }, calls: calls };
}

// Загружает обработчик начисто: и его самого, и всё, что он тянет
// относительными путями. Иначе второй тест получил бы клиентов,
// захваченных первым.
function loadHandler(relPath, opts) {
    opts = opts || {};

    Object.keys(opts.env || {}).forEach(function (k) {
        if (opts.env[k] === undefined) delete process.env[k];
        else process.env[k] = opts.env[k];
    });

    const sent = [];
    const supabase = makeSupabase(opts.db || function () { return { data: null, error: null }; });

    stub('stripe', function () {
        return {
            webhooks: {
                constructEvent: function (body, sig) {
                    if (sig === 'bad-signature') throw new Error('No signatures found');
                    return JSON.parse(body);
                },
            },
        };
    });

    stub('@supabase/supabase-js', { createClient: function () { return supabase.client; } });

    stub('resend', {
        Resend: function () {
            return {
                emails: {
                    send: function (opts2) {
                        sent.push(opts2);
                        if (opts2.to === 'throw@example.com') {
                            return Promise.reject(new Error('Resend is down'));
                        }
                        return Promise.resolve({ id: 'email_1' });
                    },
                },
            };
        },
    });

    const target = path.join(FUNCTIONS_DIR, relPath);

    Object.keys(require.cache).forEach(function (k) {
        if (k.indexOf(FUNCTIONS_DIR) === 0) delete require.cache[k];
    });

    return { handler: require(target).handler, db: supabase, sent: sent };
}

function webhookEvent(type, object, livemode) {
    return {
        httpMethod: 'POST',
        headers: { 'stripe-signature': 'good', 'x-forwarded-for': '203.0.113.7' },
        body: JSON.stringify({
            type: type,
            livemode: livemode === undefined ? true : livemode,
            data: { object: object },
        }),
    };
}

module.exports = { loadHandler, webhookEvent, FUNCTIONS_DIR };
