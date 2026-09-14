// netlify/functions/pamyat-access.js
//
// Окно «Память тела», 48 часов, 15.09 18:00 — 17.09 18:00 по Женеве.
//
// 14.09 закрыт публичный доступ к платным файлам R2, и прямых адресов
// у страницы больше нет. Поэтому функция не просто «прячет кнопку»,
// а действительно нечем кормить плеер вне окна: ссылок в ответе
// не существует, а не «они есть, но спрятаны».

const { signKey } = require('./_r2sign');

// Границы окна в UTC. Женева в сентябре живёт по CEST, это плюс два,
// поэтому 18:00 по Женеве это 16:00 UTC на обоих концах.
const WINDOW_START = Date.UTC(2026, 8, 15, 16, 0, 0);
const WINDOW_END   = Date.UTC(2026, 8, 17, 16, 0, 0);

// Срок подписи шесть часов, а не «до конца окна». Человек, нажавший
// play за десять минут до закрытия, должен дослушать двадцать семь
// минут, а не упереться в 403 на середине практики.
const SIGN_TTL = 21600;

const KEYS = {
    warmup: 'flagship/body_memory_progrev.mp3',
    track:  'flagship/body_memory.mp3',
};

const CORS = {
    'Access-Control-Allow-Origin': 'https://app.ekaterina-donnat.com',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    // Ответ зависит от минуты: кэшировать его нельзя ни на краю,
    // ни в браузере, иначе окно закроется, а ссылка останется жить.
    'Cache-Control': 'no-store',
};

// Чистая функция: всё решение об окне здесь, и именно её проверяют
// тесты. Часы приходят аргументом, иначе проверить границы можно
// было бы только пятнадцатого числа.
function getWindowState(now) {
    const t = now instanceof Date ? now.getTime() : Number(now);

    return {
        open: t >= WINDOW_START && t < WINDOW_END,
        startsAt: new Date(WINDOW_START).toISOString(),
        endsAt: new Date(WINDOW_END).toISOString(),
    };
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS, body: '' };
    }

    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method_not_allowed' }) };
    }

    const state = getWindowState(new Date(Date.now()));

    // Закрыто: отдаём только даты. Ни ключей с адресами, ни самих
    // адресов в теле, и до подписи дело не доходит вовсе.
    if (!state.open) {
        return {
            statusCode: 200,
            headers: CORS,
            body: JSON.stringify({
                open: false,
                startsAt: state.startsAt,
                endsAt: state.endsAt,
            }),
        };
    }

    try {
        const warmupUrl = await signKey(KEYS.warmup, SIGN_TTL);
        const trackUrl  = await signKey(KEYS.track, SIGN_TTL);

        return {
            statusCode: 200,
            headers: CORS,
            body: JSON.stringify({
                open: true,
                endsAt: state.endsAt,
                warmupUrl: warmupUrl,
                trackUrl: trackUrl,
            }),
        };
    } catch (err) {
        // Наружу только код. Грабли 30.08, коммит 4b2683c: тогда
        // в теле ответа уехали детали ошибки базы.
        console.error('pamyat-access sign error:', err.message);
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'sign_failed' }) };
    }
};

// Наружу для тестов: границы окна проверяются без обращения к R2.
exports.getWindowState = getWindowState;
