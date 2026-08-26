// netlify/functions/stripe-webhook.js
// Обрабатывает checkout.session.completed от Stripe
// Создаёт токен, пишет в Supabase, отправляет письмо

// ВАЖНО: в Netlify задан STRIPE_SECRET_KEY_LIVE (и отдельно _TEST), общего
// STRIPE_SECRET_KEY не существует. Вебхук игнорирует тестовые события ниже
// (!stripeEvent.livemode), поэтому здесь всегда нужен live-ключ.
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY_LIVE);
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const crypto  = require('crypto');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const resend  = new Resend(process.env.RESEND_API_KEY_KATYA);
const R2_BASE = 'https://audio.ekaterina-donnat.com';

// Маппинг Stripe Payment Link ID → треки + журнал + product_type
//
// ВАЖНО: собираем из массива и фильтруем неопределённые env-переменные,
// а не строим объектный литерал напрямую. Раньше несколько ключей
// одновременно ссылались на process.env.НЕ_СУЩЕСТВУЕТ → все они
// превращались в один и тот же строковый ключ "undefined" и
// перезаписывали друг друга (последний в списке побеждал молча).
// На 31.07 в Netlify живёт только STRIPE_STEP_1_ID из всего списка —
// остальные ID нужно добавить в env по мере создания ссылок в Stripe.
// 04.08: у каждой ступени теперь два Payment Link — база и с сопровождением
// (150/370 у ступеней 1-3, 250/470 у ступени 4). Оба ведут на один и тот же
// контент, отличается только сопровождающая сессия, поэтому оба ID из пары
// маппятся на одно и то же определение продукта через ids: [...].
const PRODUCT_DEFINITIONS = [
    {
        ids:        [process.env.STRIPE_STEP_1_BASE_ID, process.env.STRIPE_STEP_1_ESCORT_ID],
        track_ids:  ['track-02', 'track-09', 'track-10', 'track-12'],
        journal:    `${R2_BASE}/journals/donna_journal_telo.pdf`,
        name:       'Возвращение в тело',
        product_type: 'step_1',
    },
    {
        ids:        [process.env.STRIPE_STEP_2_BASE_ID, process.env.STRIPE_STEP_2_ESCORT_ID],
        track_ids:  ['track-03', 'track-04', 'track-08', 'track-13'],
        journal:    `${R2_BASE}/journals/donna_journal_sterzhen.pdf`,
        name:       'Внутренний стержень',
        product_type: 'step_2',
    },
    {
        ids:        [process.env.STRIPE_STEP_3_BASE_ID, process.env.STRIPE_STEP_3_ESCORT_ID],
        track_ids:  ['track-06', 'track-07', 'track-11', 'track-16'],
        journal:    `${R2_BASE}/journals/donna_journal_impuls.pdf`,
        name:       'Чистый импульс',
        product_type: 'step_3',
    },
    {
        ids:        [process.env.STRIPE_STEP_4_BASE_ID, process.env.STRIPE_STEP_4_ESCORT_ID],
        track_ids:  ['track-01', 'track-05', 'track-14', 'track-15'],
        journal:    `${R2_BASE}/journals/donna_journal_masshtab.pdf`,
        name:       'Масштаб и новая реальность',
        product_type: 'step_4',
    },
    {
        ids:        [process.env.STRIPE_ALBUM_ID],
        track_ids:  ['track-01','track-02','track-03','track-04','track-05',
                     'track-06','track-07','track-08','track-09','track-10',
                     'track-11','track-12','track-13','track-14','track-15','track-16',
                     'flagship'],
        journal:    `${R2_BASE}/journals/donna_journal_complete.pdf`,
        name:       'Полный альбом',
        product_type: 'full_album',
    },
    {
        ids:        [process.env.STRIPE_FLAGSHIP_ID],
        track_ids:  ['flagship'],
        journal:    null,
        name:       'Память тела: код освобождения',
        product_type: 'flagship',
    },
    {
        ids:        [process.env.STRIPE_CHECKUP_ID],
        track_ids:  [],
        journal:    null,
        name:       'Чек-ап сессия',
        // 25.08: было null, из-за чего покупки чек-апа не попадали
        // в разбивку дашборда по типам продукта.
        product_type: 'checkup',
    },
    {
        // Трек комбо утверждён Катей 12.08: track-10, crock.mp3,
        // "Крокодил: обнуление тревоги", 17 минут, Ступень 1.
        // Выбран как самый короткий в линейке: человек слушает его целиком
        // до встречи, а не откладывает на "когда будет сорок свободных минут".
        // Раньше здесь стоял track-09 (Шульц, 40:32), при этом сайт обещал
        // "трек на выбор", механики выбора не существует.
        // Метаданные товара в Stripe обновлены синхронно.
        ids:        [process.env.STRIPE_COMBO_ID],
        track_ids:  ['track-10'],
        journal:    null,
        name:       'Комбо: трек и чек-ап',
        // 25.08: было null, см. комментарий у чек-апа выше.
        product_type: 'combo',
    },
];

const PRODUCTS = {};
PRODUCT_DEFINITIONS.forEach(function(def) {
    def.ids.forEach(function(id) {
        if (!id) return; // env-переменная ещё не задана — пропускаем, не коллизируем
        PRODUCTS[id] = {
            track_ids:    def.track_ids,
            journal:      def.journal,
            name:         def.name,
            product_type: def.product_type,
        };
    });
});

// Fire-and-forget логирование подозрительных событий
function logSecurityEvent(eventName, ip, details) {
    supabase
        .from('security_log')
        .insert({ event: eventName, ip: ip, details: details })
        .then(function() {})
        .catch(function(err) { console.error('security_log write error:', err.message); });
}

function getClientIp(event) {
    return (event.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const sig = event.headers['stripe-signature'];
    const ip  = getClientIp(event);
    let stripeEvent;

    try {
        stripeEvent = stripe.webhooks.constructEvent(
            event.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('Webhook signature error:', err.message);
        logSecurityEvent('stripe_signature_failed', ip, { error: err.message });
        return { statusCode: 400, body: `Webhook Error: ${err.message}` };
    }

    // Пункт 30: тестовые события не касаются продакшн данных
    if (!stripeEvent.livemode) {
        return { statusCode: 200, body: 'Test event ignored' };
    }

    // Ревокация доступа при рефанде/чарджбэке. До этого патча status/
    // revoked_at проверялись в verify-token.js/get-download-url.js/
    // get-progress.js/save-progress.js/upsell-flag.js, но ничто не
    // выставляло revoked_at — refund в Stripe никак не гасил доступ.
    //
    // Проверено 12.08 через API: эндпоинт один, адрес
    // app.ekaterina-donnat.com/.netlify/functions/stripe-webhook,
    // подписан на checkout.session.completed, charge.refunded
    // и charge.dispute.created. События приходят.
    if (stripeEvent.type === 'charge.refunded' || stripeEvent.type === 'charge.dispute.created') {
        const chargeObject   = stripeEvent.data.object;
        const paymentIntentId = chargeObject.payment_intent;

        if (!paymentIntentId) {
            return { statusCode: 200, body: JSON.stringify({ received: true }) };
        }

        const revokedReason = stripeEvent.type === 'charge.refunded' ? 'refunded' : 'dispute_created';

        const { error: revokeError } = await supabase
            .from('purchases')
            .update({
                status:          'revoked',
                revoked_at:      new Date().toISOString(),
                revoked_reason:  revokedReason,
            })
            .eq('stripe_payment_intent_id', paymentIntentId);

        if (revokeError) {
            console.error('Purchase revoke error:', revokeError.message);
            return { statusCode: 500, body: 'Database error' };
        }

        logSecurityEvent('purchase_revoked', ip, {
            payment_intent: paymentIntentId,
            reason:         revokedReason,
        });

        return { statusCode: 200, body: JSON.stringify({ received: true, revoked: true }) };
    }

    if (stripeEvent.type !== 'checkout.session.completed') {
        return { statusCode: 200, body: 'Event ignored' };
    }

    const session       = stripeEvent.data.object;
    const customerEmail = session.customer_details?.email;
    const paymentLinkId = session.payment_link;

    if (!customerEmail) {
        console.error('No customer email in session:', session.id);
        return { statusCode: 400, body: 'Missing email' };
    }

    const product = PRODUCTS[paymentLinkId];

    if (!product) {
        console.error('Unknown payment link:', paymentLinkId);
        logSecurityEvent('stripe_unknown_link', ip, {
            payment_link:    paymentLinkId,
            stripe_session:  session.id,
        });
        return { statusCode: 400, body: 'Unknown product' };
    }

    // Идемпотентность: Stripe может повторно доставить один и тот же вебхук
    // (таймаут, 5xx, обрыв сети до подтверждения) — а сейчас в Stripe вообще
    // зарегистрировано два webhook endpoint на один и этот же URL, оба
    // подписаны на checkout.session.completed, так что КАЖДАЯ успешная оплата
    // и так придёт минимум дважды уже сегодня, не только при ретраях.
    // Уникальный индекс на stripe_session_id в Supabase — вторая линия
    // защиты от гонки (см. обработку error.code 23505 ниже), эта проверка —
    // для быстрого понятного ответа 200 без похода до insert.
    const { data: existingPurchase, error: lookupError } = await supabase
        .from('purchases')
        .select('token')
        .eq('stripe_session_id', session.id)
        .maybeSingle();

    if (lookupError) {
        console.error('Existing purchase lookup error:', lookupError.message);
        return { statusCode: 500, body: 'Database error' };
    }

    if (existingPurchase) {
        return { statusCode: 200, body: JSON.stringify({ received: true, duplicate: true }) };
    }

    const token      = crypto.randomUUID();
    const amountPaid = session.amount_total ? Math.round(session.amount_total / 100) : null;
    const utmSource  = session.metadata?.utm_source
                    || session.client_reference_id?.split('|')[1]
                    || 'direct';

    // Пишем в purchases для любой завершённой оплаты, включая продукты без
    // треков (чек-ап). Раньше вставка пропускалась при пустом track_ids —
    // из-за этого чек-ап-сессии не попадали ни в purchases, ни в аналитику
    // дашборда, хотя оплата и письмо клиенту проходили нормально. Плеер эту
    // разницу не путает: verify-token.js спокойно отдаёт пустой tracks: []
    // для токена с track_ids: [], а письмо ниже само решает, показывать
    // кнопку плеера или нет, через тот же product.track_ids.length.
    const { error } = await supabase
        .from('purchases')
        .insert({
            token,
            email:                     customerEmail,
            track_ids:                 product.track_ids,
            stripe_session_id:         session.id,
            stripe_payment_intent_id:  session.payment_intent || null,
            stripe_customer_id:        session.customer || null,
            utm_source:                utmSource,
            product_name:              product.name,
            product_type:              product.product_type,
            amount:                    amountPaid,
            status:                    'paid',
            created_at:                new Date().toISOString(),
        });

    if (error) {
        // Гонка: два одновременных вебхука прошли lookup ДО того, как любой
        // из них успел вставить строку — оба увидели "дубля нет" и оба
        // попытались insert. Уникальный индекс на stripe_session_id отклонит
        // второй insert с 23505 — это ожидаемо, а не ошибка сервера.
        if (error.code === '23505') {
            return { statusCode: 200, body: JSON.stringify({ received: true, duplicate: true }) };
        }

        console.error('Supabase insert error:', error.message);
        return { statusCode: 500, body: 'Database error' };
    }

    try {
        await sendEmail(customerEmail, token, product);
    } catch (err) {
        // Покупка записана — не фейлим весь вебхук из-за письма
        console.error('Email send error:', err.message);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

async function sendEmail(email, token, product) {
    const playerUrl = `https://app.ekaterina-donnat.com?token=${token}`;

    await resend.emails.send({
        from:    'Ekaterina Donnat <hello@ekaterina-donnat.com>',
        // Домен без MX: ответ на hello@ отскакивает. Ответы уводим
        // в живой ящик Кати. Ответ клиента — ещё и сильнейший
        // положительный сигнал для почтовых фильтров.
        replyTo: 'swiss.hypnosis@gmail.com',
        to:      email,
        subject: `Ваша практика готова: ${product.name}`,
        html:    buildEmail(playerUrl, product),
    });
}

function buildEmail(playerUrl, product) {
    const hasPlayer  = product.track_ids.length > 0;
    const hasJournal = !!product.journal;

    return `<!DOCTYPE html>
<html>
<head>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@200;300;400&display=swap" rel="stylesheet">
</head>
<body style="background:#151933;font-family:'Outfit',sans-serif;margin:0;padding:40px 20px;">
    <div style="max-width:520px;margin:0 auto;text-align:center;">

        <img src="https://optim.tildacdn.com/tild3163-3633-4963-a231-363031656432/-/resize/453x/-/format/webp/logo_gold_final2.png.webp"
             width="140" style="margin-bottom:32px;opacity:0.9;" alt="Ekaterina Donnat">

        <h1 style="color:#f0eae1;font-weight:200;font-size:26px;margin-bottom:8px;font-family:'Outfit',sans-serif;">
            ${product.name}
        </h1>
        <p style="color:rgba(248,250,252,0.45);font-size:12px;letter-spacing:0.15em;
                  text-transform:uppercase;margin-bottom:40px;font-family:'Outfit',sans-serif;">
            готово к работе
        </p>

        ${hasPlayer ? `
        <a href="${playerUrl}"
           style="display:inline-block;background:#d4af37;color:#0f1123;
                  padding:16px 48px;border-radius:8px;text-decoration:none;
                  font-size:11px;letter-spacing:0.2em;text-transform:uppercase;
                  font-weight:500;margin-bottom:32px;font-family:'Outfit',sans-serif;">
            Открыть мою библиотеку
        </a>
        <p style="color:rgba(248,250,252,0.35);font-size:12px;margin-bottom:32px;font-family:'Outfit',sans-serif;">
            Кнопка скачивания каждого трека внутри плеера
        </p>
        ` : `
        <p style="color:rgba(248,250,252,0.7);font-size:14px;line-height:1.7;margin-bottom:32px;font-family:'Outfit',sans-serif;">
            Екатерина свяжется с Вами в ближайшее время<br>для записи на сессию.
        </p>
        `}

        ${hasJournal ? `
        <div style="border-top:1px solid rgba(212,175,55,0.15);padding-top:28px;margin-top:8px;">
            <a href="${product.journal}"
               style="display:inline-block;border:1px solid rgba(212,175,55,0.35);
                      color:#d4af37;padding:12px 32px;border-radius:8px;
                      text-decoration:none;font-size:10px;letter-spacing:0.18em;
                      text-transform:uppercase;font-family:'Outfit',sans-serif;">
                Скачать дневник состояний
            </a>
            <p style="color:rgba(248,250,252,0.25);font-size:11px;margin-top:12px;font-family:'Outfit',sans-serif;">
                Личный дневник интеграции для этой ступени
            </p>
        </div>
        ` : ''}

        ${hasPlayer ? buildGuideSection(product.track_ids.length) : ''}

        <p style="color:rgba(248,250,252,0.2);font-size:11px;margin-top:48px;font-family:'Outfit',sans-serif;">
            ekaterina-donnat.com
        </p>
    </div>
</body>
</html>`;
}

// Памятка «Как слушать практики» от Кати, дословно.
// Ставится в конец письма: сначала кнопка доступа и дневник, потом чтение.
// Выравнивание по левому краю намеренно: остальное письмо центрировано,
// но центрированный абзац на несколько строк нечитаем.
//
// Регистр. Письмо приведено к «Вы» целиком (CONT-02, решение Дре 18.08):
// тема «Ваша практика готова», «свяжется с Вами». Расхождения с текстом
// Кати внутри одного письма больше нет.
//
// Три формулировки смягчены по тому же решению (CONT-03, обещание
// результата и скорости). Вопрос закрыт, исходные формулировки
// не возвращать.
//
// Текст дословно совпадает с i18n.ru.guide в index.html.
// При правке менять оба места.
function buildGuideSection(trackCount) {
    // Разделы про порядок ступеней и «начните с первой ступени» имеют смысл
    // только там, где практик несколько. Покупателю одного флагмана они
    // рассказывали бы про структуру, которой у него нет.
    const isMultiTrack = trackCount > 1;

    const sections = [
        ['Как часто', 'Идеально заниматься каждый день или через день. Одну практику стоит слушать пять-семь дней подряд: именно повторение закрепляет новое состояние, так устроена наша психика. Потом можно чередовать. Двух практик в день не нужно, лучше одна, но глубокая. Кто-то чувствует отклик уже после первого прослушивания, кому-то нужно больше времени, и это тоже нормально. Ориентируйтесь не на скорость, а на регулярность: за две-три недели практика обычно входит в ритм и становится частью дня.'],
        ['После практики', 'Дайте себе пять-десять минут покоя: выпейте воды, не берите сразу телефон. За руль и к активным делам возвращайтесь минут через десять-пятнадцать, когда почувствуете полную бодрость. Если слушали глубокую практику вечером, паузу лучше продлить или просто лечь спать, это самый мягкий вариант. Вообще вечер и время перед сном подходят лучше всего, а утренние сеансы хороши для энергии и ясности.'],
        ['Если тело откликнулось', 'Если после практики тянет в сон, или наоборот появился прилив сил, или подступили слёзы и яркие эмоции, не пугайтесь. Это хороший знак: процесс идёт, подсознание работает.'],
    ];

    if (isMultiTrack) {
        sections.push(['Порядок ступеней', 'Ступени выстроены как путь, каждая опирается на предыдущую, поэтому идите по порядку. Внутри ступени четыре практики: первый круг слушайте по очереди, а дальше выбирайте по состоянию, по тому, что откликается именно сегодня.']);
        sections.push(['С чего начать', 'Если Вы только начинаете, начните с первой ступени. Или выберите практику под свой запрос. Когда есть тревога и ощущение внутреннего бега, Вам подойдёт практика на успокоение и опору. Когда усталость и пустота, начните с наполнения ресурсом. Когда тяжесть и чувство, что всё накопилось, выбирайте практику отпускания. Доверьтесь первому импульсу: Ваше подсознание уже знает, что ему нужно.']);
    }

    sections.push(['Если мы уже работали вместе', 'Если Вы уже бывали у меня на сеансах, выбирайте свободно: знакомые практики или новые. Ваше подсознание помнит мой голос, и со знакомым звучанием многим проще расслабиться и остаться в практике.']);

    const body = sections.map(([heading, text]) => `
            <p style="color:#d4af37;font-size:14px;font-weight:400;line-height:1.4;
                      margin:24px 0 6px;font-family:'Outfit',sans-serif;">
                ${heading}
            </p>
            <p style="color:rgba(248,250,252,0.6);font-size:14px;line-height:1.75;
                      margin:0;font-family:'Outfit',sans-serif;">
                ${text}
            </p>`).join('');

    return `
        <div style="border-top:1px solid rgba(212,175,55,0.15);margin-top:40px;
                    padding-top:28px;text-align:left;">
            <p style="color:#f0eae1;font-size:18px;font-weight:300;margin:0;
                      font-family:'Outfit',sans-serif;">
                Как слушать практики
            </p>${body}
        </div>`;
}
