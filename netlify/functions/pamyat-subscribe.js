// netlify/functions/pamyat-subscribe.js
//
// Приём адреса со страницы «Памяти тела».
//
// Окно 17-20.09 дало первый твёрдый факт проекта: из 47 нажавших play
// 17 дослушали двадцать девять минут до конца. И ни одного адреса:
// семнадцать человек прошли практику целиком, а написать им некому
// и некуда. Эта функция закрывает ровно эту дыру.
//
// Главное правило файла: человек, однажды отписавшийся от писем Кати,
// не возвращается в рассылку оттого, что ввёл адрес на странице.
// Поэтому сначала спрашиваем Resend про контакт и только потом
// решаем, писать ли вообще. Если спросить не вышло, не пишем ничего:
// лучше сказать человеку «не получилось», чем вернуть в рассылку
// того, кто просил его не беспокоить.

const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, getClientIp } = require('./_rateLimit');
const { safeCampaign } = require('./_attribution');
const { findContact, createContact, addToSegment } = require('./_resendContacts');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// Форма живёт только на странице окна, поэтому origin ровно один.
const CORS = {
    'Access-Control-Allow-Origin': 'https://app.ekaterina-donnat.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
};

// Тот же закрытый список, что в track-demo.js и podbor-save.js.
// Списки в проекте продублированы слово в слово, это известная
// заплатка: незнакомое значение сводится к organic, а не пишется
// как есть.
const VALID_SOURCES = ['paid', 'referral', 'pinterest', 'organic'];

// 254 это предел длины адреса по RFC 5321. Проверка формы намеренно
// простая: точную границу допустимого адреса знает только почтовый
// сервер, а наше дело отсечь мусор и опечатки.
const MAX_EMAIL = 254;

function normalizeEmail(value) {
    if (typeof value !== 'string') return null;

    const email = value.trim().toLowerCase();
    if (!email || email.length > MAX_EMAIL) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;

    return email;
}

function respond(statusCode, payload) {
    return { statusCode: statusCode, headers: CORS, body: JSON.stringify(payload) };
}

// Ответ один и тот же во всех случаях, когда человек всё сделал
// правильно: новый адрес, уже подписанный, отписавшийся. Иначе
// функция отвечала бы на вопрос «а есть ли такой человек у Кати».
function ok() {
    return respond(200, { ok: true });
}

// Событие без адреса: в аналитике почты не держим. Связь «кто
// дослушал» это отдельная задача со своей спекой.
async function trackSubmit(payload, campaign) {
    const source = VALID_SOURCES.includes(payload.source) ? payload.source : 'organic';
    const sid = (typeof payload.sid === 'string' && payload.sid.length > 0)
        ? payload.sid.slice(0, 100)
        : null;

    const { error } = await supabase.from('demo_events').insert({
        event: 'email_submit',
        source: source,
        session_id: sid,
        surface: 'pamyat',
        campaign: campaign,
        created_at: new Date().toISOString(),
    });

    if (error) {
        // Событие потеряно, подписка при этом состоялась. Ронять ответ
        // из-за статистики нельзя: человек сделал свою часть.
        console.error('pamyat-subscribe event write error:', error.message);
    }
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return respond(405, { error: 'method_not_allowed' });
    }

    let payload;
    try {
        payload = JSON.parse(event.body || '{}');
    } catch (e) {
        return respond(400, { error: 'bad_request' });
    }

    // Ловушка для ботов: поле спрятано от человека, и заполнить его
    // может только машина, читающая разметку. Отвечаем успехом,
    // чтобы не подсказывать, что ловушка есть.
    if (typeof payload.hp === 'string' && payload.hp.trim() !== '') {
        return ok();
    }

    const ip = getClientIp(event);
    const allowed = await checkRateLimit('pamyat-subscribe:' + ip, 10, 600);
    if (!allowed) {
        return respond(429, { error: 'rate_limited' });
    }

    const email = normalizeEmail(payload.email);
    if (!email) {
        return respond(400, { error: 'bad_email' });
    }

    const campaign = safeCampaign(payload.campaign);

    // Без сегмента писать некуда: Resend отбил бы создание контакта
    // с пустым списком, а в журнале осталась бы его ошибка вместо
    // нашей причины. Проверяем до сети, чтобы причина читалась
    // с первой строки.
    const segmentId = process.env.RESEND_SEGMENT_PAMYAT;
    if (!segmentId) {
        console.error('pamyat-subscribe: RESEND_SEGMENT_PAMYAT не задан, подписка невозможна');
        return respond(500, { error: 'subscribe_failed' });
    }

    const existing = await findContact(email);

    // Не смогли спросить: молчим и ничего не трогаем.
    if (existing.failed) {
        return respond(500, { error: 'subscribe_failed' });
    }

    // Отписавшийся. Ничего не делаем и не говорим об этом наружу.
    if (existing.found && existing.contact.unsubscribed) {
        await trackSubmit(payload, campaign);
        return ok();
    }

    // Нет контакта, заводим. Дальше путь общий: разницы между «завели
    // только что» и «был раньше» с этого места нет.
    if (!existing.found) {
        const properties = { signup_at: new Date().toISOString() };
        if (VALID_SOURCES.includes(payload.source)) properties.source = payload.source;
        if (campaign) properties.campaign = campaign;

        const created = await createContact(email, properties);
        if (created.failed) {
            // Наружу только код. Ни адреса сегмента, ни текста ошибки.
            return respond(500, { error: 'subscribe_failed' });
        }
    }

    // В сегмент кладёт только этот вызов. Создание контакта поле
    // с сегментом принимает и молча не применяет, проверено живьём
    // 21.09: контакт есть, свойства есть, списков ноль.
    const added = await addToSegment(email, segmentId);
    if (added.failed) {
        return respond(500, { error: 'subscribe_failed' });
    }

    await trackSubmit(payload, campaign);
    return ok();
};
