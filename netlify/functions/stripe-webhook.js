// netlify/functions/stripe-webhook.js
// Принимает webhook от Stripe после оплаты
// Создаёт токен в Supabase и редиректит клиента в плеер

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Верифицируем подпись Stripe
    const sig = event.headers['stripe-signature'];
    let stripeEvent;

    try {
        stripeEvent = stripe.webhooks.constructEvent(
            event.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return { statusCode: 400, body: `Webhook Error: ${err.message}` };
    }

    // Обрабатываем только успешные оплаты
    if (stripeEvent.type !== 'checkout.session.completed') {
        return { statusCode: 200, body: 'Event ignored' };
    }

    const session = stripeEvent.data.object;
    const customerEmail = session.customer_details?.email;
    const trackIds = session.metadata?.track_ids?.split(',') || [];

    if (!customerEmail || trackIds.length === 0) {
        console.error('Missing email or track_ids in session metadata');
        return { statusCode: 400, body: 'Missing required data' };
    }

    // Генерируем уникальный токен
    const token = crypto.randomUUID();

    // Сохраняем в Supabase
    const { error } = await supabase
        .from('purchases')
        .insert({
            token,
            email: customerEmail,
            track_ids: trackIds,
            stripe_session_id: session.id,
            created_at: new Date().toISOString(),
        });

    if (error) {
        console.error('Supabase insert error:', error);
        return { statusCode: 500, body: 'Database error' };
    }

    // Отправляем письмо клиенту
    await sendEmail(customerEmail, token, trackIds);

    console.log(`Purchase created: ${token} for ${customerEmail}`);
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

async function sendEmail(email, token, trackIds) {
    // Здесь подключить Resend / SendGrid / Postmark
    // Пример с Resend:
    /*
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    const playerUrl = `https://app.ekaterina-donna.com?token=${token}`;

    await resend.emails.send({
        from: 'Ekaterina Donna <hello@ekaterina-donna.com>',
        to: email,
        subject: 'Ваша библиотека практик готова',
        html: buildEmailHtml(playerUrl),
    });
    */
    console.log(`Email would be sent to ${email} with token ${token}`);
}

function buildEmailHtml(playerUrl) {
    return `
    <!DOCTYPE html>
    <html>
    <body style="background:#151933;font-family:Inter,sans-serif;margin:0;padding:40px 20px;">
        <div style="max-width:500px;margin:0 auto;text-align:center;">
            <img src="https://optim.tildacdn.com/tild3163-3633-4963-a231-363031656432/-/resize/453x/-/format/webp/logo_gold_final2.png.webp"
                 width="140" style="margin-bottom:32px;">
            <h1 style="color:#f0eae1;font-weight:200;font-size:28px;margin-bottom:12px;">
                Ваша библиотека готова
            </h1>
            <p style="color:rgba(248,250,252,0.7);font-size:14px;line-height:1.7;margin-bottom:40px;">
                Практики ждут вас. Это ваша личная ссылка —<br>
                сохраните это письмо для доступа в любое время.
            </p>
            <a href="${playerUrl}"
               style="display:inline-block;background:#d4af37;color:#0f1123;
                      padding:16px 40px;border-radius:8px;text-decoration:none;
                      font-size:12px;letter-spacing:0.2em;text-transform:uppercase;
                      font-weight:500;">
                Открыть мою библиотеку
            </a>
            <p style="color:rgba(248,250,252,0.3);font-size:11px;margin-top:40px;">
                ekaterina-donna.com
            </p>
        </div>
    </body>
    </html>
    `;
}
