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
const { parseClientReference } = require('./_attribution');
const { PRODUCTS } = require('./_products');
const { sendEmail } = require('./_accessEmail');
const { generateCode, formatCode } = require('./_gift');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const resend  = new Resend(process.env.RESEND_API_KEY_KATYA);

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

        // Тем же платежом гасим невыданный подарочный сертификат.
        // Условие status = issued тут не оптимизация: у активированного
        // сертификата payment_intent записан в строку purchases, и доступ
        // снимает ревокация выше. Гасить его второй раз нечем и незачем,
        // а вот затирать след активации нельзя.
        const { error: certRevokeError } = await supabase
            .from('donna_gift_certificates')
            .update({ status: 'revoked' })
            .eq('stripe_payment_intent_id', paymentIntentId)
            .eq('status', 'issued');

        if (certRevokeError) {
            console.error('Gift certificate revoke error:', certRevokeError.message);
            return { statusCode: 500, body: 'Database error' };
        }

        logSecurityEvent('purchase_revoked', ip, {
            payment_intent: paymentIntentId,
            reason:         revokedReason,
        });

        return { statusCode: 200, body: JSON.stringify({ received: true, revoked: true }) };
    }

    // Возврат, который Stripe создал, а карточная сеть отбила.
    //
    // charge.refunded приходит в момент создания возврата, и на этом
    // наблюдение кончалось. Если возврат позже проваливался, покупка
    // оставалась revoked, деньги тихо возвращались на баланс Stripe,
    // человек оставался без денег и без доступа, и узнать об этом можно
    // было только открыв конкретный платёж в панели руками.
    //
    // Имени у события два: новое refund.updated и устаревшее
    // charge.refund.updated. Payload одинаковый, поэтому ветка общая:
    // переименование на стороне Stripe логику не сломает.
    if (stripeEvent.type === 'refund.updated' || stripeEvent.type === 'charge.refund.updated') {
        const refundObject = stripeEvent.data.object;

        // succeeded не обрабатываем вовсе: это рядовое присвоение ARN,
        // реагировать на него нечем.
        if (refundObject.status !== 'failed' && refundObject.status !== 'canceled') {
            return { statusCode: 200, body: JSON.stringify({ received: true }) };
        }

        const refundPaymentIntent = refundObject.payment_intent;

        if (!refundPaymentIntent) {
            return { statusCode: 200, body: JSON.stringify({ received: true }) };
        }

        // Строка нужна дважды: из неё берётся почта покупателя для письма,
        // и по ней видно, не обработано ли это событие раньше.
        // limit(1), а не maybeSingle(): maybeSingle отдаёт ошибку, если
        // строк оказалось две, а записать причину важнее, чем упасть.
        const { data: refundRows, error: refundLookupError } = await supabase
            .from('purchases')
            .select('email, amount, revoked_reason')
            .eq('stripe_payment_intent_id', refundPaymentIntent)
            .limit(1);

        if (refundLookupError) {
            console.error('Refund lookup error:', refundLookupError.message);
            return { statusCode: 500, body: 'Database error' };
        }

        const refundPurchase = refundRows && refundRows[0];

        // Возврат не по нашей покупке. У Кати в Stripe есть свои продукты
        // вне этой системы, их вебхук не опознаёт, и это нормально.
        if (!refundPurchase) {
            return { statusCode: 200, body: JSON.stringify({ received: true }) };
        }

        // Повторная доставка того же события: причина уже записана,
        // второе письмо Кате ничего не добавит.
        if (refundPurchase.revoked_reason === 'refund_failed') {
            return { statusCode: 200, body: JSON.stringify({ received: true, duplicate: true }) };
        }

        // Пишем только причину. status остаётся revoked намеренно: сбой
        // доставки денег не отменяет решения их вернуть, а вернуть доступ
        // автоматически значит отдать продукт тому, кому Катя решила его
        // не оставлять, и она об этом не узнает. Решает человек, письмо
        // ниже для этого и нужно.
        const { error: refundReasonError } = await supabase
            .from('purchases')
            .update({ revoked_reason: 'refund_failed' })
            .eq('stripe_payment_intent_id', refundPaymentIntent);

        if (refundReasonError) {
            console.error('Refund reason write error:', refundReasonError.message);
            return { statusCode: 500, body: 'Database error' };
        }

        logSecurityEvent('refund_failed', ip, {
            payment_intent: refundPaymentIntent,
            refund:         refundObject.id,
            status:         refundObject.status,
        });

        try {
            await sendRefundFailedEmail(refundObject, refundPurchase);
        } catch (err) {
            // Причина уже записана. Уронить вебхук из-за письма значит
            // получить от Stripe повтор того, что уже сделано.
            console.error('Refund alert email error:', err.message);
        }

        return { statusCode: 200, body: JSON.stringify({ received: true, refund_failed: true }) };
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

    // Подарок это не новый способ оплаты, а обычная покупка, отложенная
    // во времени: сейчас пишем сертификат, а строка в purchases появится
    // при активации, ровно такая же и по той же логике. Поэтому вся
    // выдача доступа ниже остаётся нетронутой.
    //
    // Метка kind живёт в metadata подарочной Payment Link и наследуется
    // сессией. Отсутствие metadata это обычная покупка, а не ошибка.
    if (session.metadata && session.metadata.kind === 'gift') {
        return await handleGiftPurchase(session, product, ip);
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
    // client_reference_id приходит из ссылки на сайте в виде
    // «кампания|источник». Раньше отсюда брался только источник, а метка
    // кампании выбрасывалась, и покупка по короткой ссылке из вотсапа
    // выглядела в дашборде как organic, неотличимо от человека, который
    // сам зашёл на сайт. Вопрос «продала ли рассылка» по таблице продаж
    // было не ответить.
    const ref        = parseClientReference(session.client_reference_id);
    const utmSource  = session.metadata?.utm_source || ref.source || 'direct';

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
            campaign:                  ref.campaign,
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


// Покупка подарочного сертификата. В purchases не пишем ничего:
// получатель ещё неизвестен, а строка появится при активации.
async function handleGiftPurchase(session, product, ip) {
    const buyerEmail = session.customer_details?.email;

    // Идемпотентность тем же приёмом, что и у обычной покупки: сначала
    // дешёвая проверка по сессии, а гонку добивает уникальный индекс.
    const { data: existingCert, error: certLookupError } = await supabase
        .from('donna_gift_certificates')
        .select('id, code')
        .eq('stripe_session_id', session.id)
        .limit(1);

    if (certLookupError) {
        console.error('Gift certificate lookup error:', certLookupError.message);
        return { statusCode: 500, body: 'Database error' };
    }

    if (existingCert && existingCert[0]) {
        return { statusCode: 200, body: JSON.stringify({ received: true, duplicate: true }) };
    }

    const ref = parseClientReference(session.client_reference_id);
    const certificate = {
        code:                     generateCode(),
        product_type:             product.product_type,
        product_name:             product.name,
        amount:                   session.amount_total ? Math.round(session.amount_total / 100) : 0,
        buyer_email:              buyerEmail,
        buyer_name:               session.customer_details?.name || null,
        utm_source:               session.metadata?.utm_source || ref.source || 'direct',
        campaign:                 ref.campaign,
        stripe_session_id:        session.id,
        stripe_payment_intent_id: session.payment_intent || null,
        status:                   'issued',
    };

    // Состав ступени в сертификат не кладём намеренно: он резолвится
    // при активации, и получатель получает актуальный состав, а не тот,
    // что был на момент дарения.
    const { error: certError } = await supabase
        .from('donna_gift_certificates')
        .insert(certificate);

    if (certError) {
        if (certError.code === '23505') {
            return { statusCode: 200, body: JSON.stringify({ received: true, duplicate: true }) };
        }
        console.error('Gift certificate insert error:', certError.message);
        return { statusCode: 500, body: 'Database error' };
    }

    logSecurityEvent('gift_issued', ip, {
        stripe_session: session.id,
        product_type:   certificate.product_type,
    });

    try {
        await sendGiftCertificateEmail(certificate);
    } catch (err) {
        // Сертификат уже записан. Уронить вебхук из-за письма значит
        // получить от Stripe повтор того, что уже сделано.
        console.error('Gift certificate email error:', err.message);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true, gift: true }) };
}

// ЧЕРНОВИК, ждёт подписи Кати. Текст ниже держится правил проекта:
// регистр «Вы», без обещаний результата, без длинных тире.
async function sendGiftCertificateEmail(certificate) {
    await resend.emails.send({
        from:    'Ekaterina Donnat <hello@ekaterina-donnat.com>',
        replyTo: 'swiss.hypnosis@gmail.com',
        to:      certificate.buyer_email,
        subject: `Ваш подарочный сертификат: ${certificate.product_name}`,
        html:    buildGiftCertificateEmail(certificate),
    });
}

function buildGiftCertificateEmail(certificate) {
    const code = formatCode(certificate.code);
    const page = 'https://app.ekaterina-donnat.com/gift.html';

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#151933;font-family:'Outfit',Arial,sans-serif;color:#f4f1ea;margin:0;padding:40px 20px;">
  <div style="max-width:520px;margin:0 auto;">
    <p style="margin:0 0 20px;font-size:16px;">Сертификат готов.</p>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;">
      ${escapeHtml(certificate.product_name)}
    </p>
    <p style="margin:0 0 8px;font-size:13px;opacity:0.7;">Код сертификата</p>
    <p style="margin:0 0 28px;font-size:26px;letter-spacing:2px;font-family:'Outfit',Arial,sans-serif;">
      ${escapeHtml(code)}
    </p>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">
      Передайте код тому, кому предназначен подарок, любым удобным способом.
      Он вводит его на странице <a href="${page}" style="color:#f4f1ea;">${page}</a>,
      указывает свою почту и получает доступ к практике.
    </p>
    <p style="margin:0;font-size:15px;line-height:1.6;">
      Срока у сертификата нет, воспользоваться им можно когда угодно.
    </p>
  </div>
</body>
</html>`;
}

// Письмо Кате о провалившемся возврате. Адрес получателя из окружения:
// репозиторий публичный, почтам в коде не место, и сменить получателя
// проще, не трогая функцию.
async function sendRefundFailedEmail(refundObject, purchase) {
    const to = process.env.KATYA_ALERT_EMAIL;

    if (!to) {
        console.error('KATYA_ALERT_EMAIL is not set, refund alert not sent');
        return;
    }

    await resend.emails.send({
        from:    'Ekaterina Donnat <hello@ekaterina-donnat.com>',
        replyTo: 'swiss.hypnosis@gmail.com',
        to:      to,
        subject: `Возврат не прошёл: ${purchase.email}`,
        html:    buildRefundFailedEmail(refundObject, purchase),
    });
}

// Значения приходят из Stripe и из базы, то есть снаружи. В письмо они
// попадают внутрь разметки, поэтому экранируются.
function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildRefundFailedEmail(refundObject, purchase) {
    const amount = typeof refundObject.amount === 'number'
        ? `${(refundObject.amount / 100).toFixed(2)} ${String(refundObject.currency || '').toUpperCase()}`
        : (purchase.amount === null || purchase.amount === undefined ? 'неизвестна' : String(purchase.amount));

    const rows = [
        ['Покупатель',     purchase.email],
        ['Сумма',          amount],
        ['Возврат',        refundObject.id],
        ['Статус',         refundObject.status],
        ['Причина отказа', refundObject.failure_reason || 'не указана'],
        ['Платёж',         refundObject.payment_intent],
    ];

    const cells = rows.map(function (row) {
        return `<tr>
      <td style="padding:6px 16px 6px 0;color:#6b7089;white-space:nowrap;">${escapeHtml(row[0])}</td>
      <td style="padding:6px 0;color:#151933;word-break:break-all;">${escapeHtml(row[1])}</td>
    </tr>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#ffffff;font-family:'Outfit',Arial,sans-serif;color:#151933;line-height:1.6;margin:0;padding:32px 20px;">
  <p style="margin:0 0 16px;">Возврат по этой покупке Stripe создал, но карточная сеть его отбила. Деньги вернулись на баланс Stripe, до человека они не дошли.</p>
  <table style="border-collapse:collapse;font-size:15px;margin:0 0 20px;">
${cells}
  </table>
  <p style="margin:0 0 12px;">Доступ остался закрытым, сами мы его не возвращали: решение по возврату Ваше, и сбой доставки денег его не отменяет.</p>
  <p style="margin:0;">Дальше смотреть в панели Stripe по id возврата.</p>
</body>
</html>`;
}
