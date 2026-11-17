// netlify/functions/son-trial.js
//
// Запись на три пробные ночи «Первого погружения». Спека:
// donna_spec_fonarshchik.md, часть Б, 17.11.
//
// Катя полную практику бесплатно не отдаёт, поэтому за почту человек
// получает двадцатиминутную версию на три ночи. Продавать практику для
// сна вечером бессмысленно: если она сработала, человек спит. Поэтому
// разговор о покупке идёт утром, письмом от Кати, и ещё раз на третий
// вечер. Оба письма ставятся в очередь Resend сразу при записи, своих
// часов и планировщика у проекта нет.
//
// Три правила файла.
// Ответ наружу один и тот же для всех правильных запросов: новый адрес,
// повторный, закончившийся. Иначе форма отвечала бы на вопрос, брал ли
// этот человек пробную практику для сна.
// Повторная запись срок не продлевает: активная пробная получает ссылку
// ещё раз, закончившаяся получает письмо про полную версию.
// Отписавшийся получает ссылку, потому что сам её попросил, но ни
// отложенных писем, ни сегмента.

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, getClientIp } = require('./_rateLimit');
const { safeCampaign } = require('./_attribution');
const { corsHeaders, getOrigin } = require('./_cors');
const { findContact, createContact, addToSegment } = require('./_resendContacts');
const { TRIAL_TRACK, trialSchedule, guestAccess } = require('./_trial');
const mails = require('./_trialEmails');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const FROM = 'Ekaterina Donnat <hello@ekaterina-donnat.com>';
// Домен без MX, ответ на hello@ отскакивает. Ответ на утреннее письмо
// это главное, ради чего оно пишется, поэтому уводим его в живой ящик.
const REPLY_TO = 'swiss.hypnosis@gmail.com';

const VALID_SOURCES = ['paid', 'referral', 'pinterest', 'organic'];
const MAX_EMAIL = 254;

function normalizeEmail(value) {
    if (typeof value !== 'string') return null;
    const email = value.trim().toLowerCase();
    if (!email || email.length > MAX_EMAIL) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
    return email;
}

// Письмо через REST, а не пакетом: установленный resend 3.5 про
// отложенную отправку не знает, а поднимать версию ради одного поля
// не стоит (тот же выбор, что в _resendContacts.js).
async function sendMail(to, mail, scheduledAt) {
    const body = { from: FROM, to: [to], reply_to: REPLY_TO, subject: mail.subject, html: mail.html };
    if (scheduledAt) body.scheduled_at = scheduledAt;

    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + process.env.RESEND_API_KEY_KATYA,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            console.error('son-trial send failed:', res.status, scheduledAt ? 'scheduled' : 'now');
            return false;
        }
        return true;
    } catch (err) {
        console.error('son-trial send error:', err.message);
        return false;
    }
}

async function trackSignup(payload, source, campaign) {
    const sid = (typeof payload.sid === 'string' && payload.sid.length > 0) ? payload.sid.slice(0, 100) : null;
    const { error } = await supabase.from('demo_events').insert({
        event: 'son_trial_signup',
        source: source,
        session_id: sid,
        surface: 'site',
        campaign: campaign,
        created_at: new Date(Date.now()).toISOString(),
    });
    // Событие потеряно, запись при этом состоялась: ответ не роняем.
    if (error) console.error('son-trial event write error:', error.message);
}

exports.handler = async (event) => {
    const CORS = corsHeaders(getOrigin(event), 'POST, OPTIONS');
    function respond(code, payload) { return { statusCode: code, headers: CORS, body: JSON.stringify(payload) }; }
    function ok() { return respond(200, { ok: true }); }

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
    if (event.httpMethod !== 'POST') return respond(405, { error: 'method_not_allowed' });

    let payload;
    try {
        payload = JSON.parse(event.body || '{}');
    } catch (e) {
        return respond(400, { error: 'bad_request' });
    }

    // Ловушка для ботов: отвечаем успехом, чтобы не подсказывать.
    if (typeof payload.hp === 'string' && payload.hp.trim() !== '') return ok();

    const allowed = await checkRateLimit('son-trial:' + getClientIp(event), 10, 600);
    if (!allowed) return respond(429, { error: 'rate_limited' });

    const email = normalizeEmail(payload.email);
    if (!email) return respond(400, { error: 'bad_email' });

    const source = VALID_SOURCES.indexOf(payload.source) !== -1 ? payload.source : 'organic';
    const campaign = safeCampaign(payload.campaign);
    const now = Date.now();

    const existingRes = await supabase
        .from('donna_guests')
        .select('token, promo_track, expires_at')
        .eq('email', email)
        .maybeSingle();

    if (existingRes.error) {
        console.error('son-trial read error:', existingRes.error.message);
        return respond(500, { error: 'trial_failed' });
    }

    const existing = existingRes.data;

    if (existing) {
        // Адрес занят старым лид-магнитом: строку не трогаем, пробные
        // ночи ему не положены (одна строка на адрес, UNIQUE(email)).
        if (existing.promo_track !== TRIAL_TRACK) return ok();

        if (guestAccess(existing, now).ok) {
            await sendMail(email, mails.welcome(existing.token));
        } else {
            await sendMail(email, mails.alreadyUsed());
        }
        return ok();
    }

    const schedule = trialSchedule(now, payload.tz);
    const token = crypto.randomUUID();

    const insertRes = await supabase.from('donna_guests').insert({
        token: token,
        email: email,
        promo_track: TRIAL_TRACK,
        expires_at: schedule.expiresAt,
        utm_source: source,
        campaign: campaign,
        created_at: new Date(now).toISOString(),
    });

    if (insertRes.error) {
        console.error('son-trial insert error:', insertRes.error.message);
        return respond(500, { error: 'trial_failed' });
    }

    // Ссылка не ушла: человек увидит ошибку и попробует ещё раз, а повтор
    // пойдёт по ветке «активная пробная» и пришлёт ту же ссылку.
    const sent = await sendMail(email, mails.welcome(token));
    if (!sent) return respond(500, { error: 'send_failed' });

    // Отложенные письма и сегмент только тем, кто не просил его не беспокоить.
    // Не смогли спросить Resend: молчим, как в pamyat-subscribe.js.
    const contact = await findContact(email);
    const mayWrite = !contact.failed && !(contact.found && contact.contact.unsubscribed);

    if (mayWrite) {
        await sendMail(email, mails.morning(token), schedule.morningAt);
        await sendMail(email, mails.lastEvening(token), schedule.lastEveningAt);

        const segmentId = process.env.RESEND_SEGMENT_SON;
        if (segmentId) {
            if (!contact.found) {
                const props = { signup_at: new Date(now).toISOString(), source: source };
                if (campaign) props.campaign = campaign;
                await createContact(email, props);
            }
            await addToSegment(email, segmentId);
        } else {
            console.error('son-trial: RESEND_SEGMENT_SON не задан, контакт в сегмент не попал');
        }
    }

    await trackSignup(payload, source, campaign);
    return ok();
};
