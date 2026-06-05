const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const R2_BASE = 'https://pub-a1dfcf27afc040398c3bc3e4bf3f6416.r2.dev';

// Маппинг Stripe Payment Link ID → треки + журнал
const PRODUCTS = {
    [process.env.STRIPE_STEP_1_ID]: {
        track_ids: ['track-02', 'track-09', 'track-10', 'track-12'],
        journal: `${R2_BASE}/journals/donna_journal_telo.pdf`,
        name: 'Возвращение в тело',
    },
    [process.env.STRIPE_STEP_2_ID]: {
        track_ids: ['track-03', 'track-04', 'track-08'],
        journal: `${R2_BASE}/journals/donna_journal_sterzhen.pdf`,
        name: 'Внутренний стержень',
    },
    [process.env.STRIPE_STEP_3_ID]: {
        track_ids: ['track-06', 'track-07', 'track-11', 'track-13'],
        journal: `${R2_BASE}/journals/donna_journal_impuls.pdf`,
        name: 'Чистый импульс',
    },
    [process.env.STRIPE_STEP_4_ID]: {
        track_ids: ['track-01', 'track-05', 'track-14'],
        journal: `${R2_BASE}/journals/donna_journal_masshtab.pdf`,
        name: 'Масштаб и новая реальность',
    },
    [process.env.STRIPE_ALBUM_ID]: {
        track_ids: ['track-01','track-02','track-03','track-04','track-05',
                    'track-06','track-07','track-08','track-09','track-10',
                    'track-11','track-12','track-13','track-14'],
        journal: `${R2_BASE}/journals/donna_journal_complete.pdf`,
        name: 'Полный альбом',
    },
    [process.env.STRIPE_FLAGSHIP_ID]: {
        track_ids: ['track-01', 'track-05', 'track-14'],
        journal: `${R2_BASE}/journals/donna_journal_masshtab.pdf`,
        name: 'Флагманский блок с разбором',
    },
    [process.env.STRIPE_CHECKUP_ID]: {
        track_ids: [],
        journal: null,
        name: 'Чек-ап сессия',
    },
    [process.env.STRIPE_COMBO_ID]: {
        track_ids: [],
        journal: null,
        name: 'Комбо - трек и чек-ап',
    },
};

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const sig = event.headers['stripe-signature'];
    let stripeEvent;

    try {
        stripeEvent = stripe.webhooks.constructEvent(
            event.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('Webhook signature error:', err.message);
        return { statusCode: 400, body: `Webhook Error: ${err.message}` };
    }

    if (stripeEvent.type !== 'checkout.session.completed') {
        return { statusCode: 200, body: 'Event ignored' };
    }

    const session = stripeEvent.data.object;
    const customerEmail = session.customer_details?.email;
    const paymentLinkId = session.payment_link;

    if (!customerEmail) {
        console.error('No customer email in session');
        return { statusCode: 400, body: 'Missing email' };
    }

    const product = PRODUCTS[paymentLinkId];

    if (!product) {
        console.error('Unknown payment link:', paymentLinkId);
        return { statusCode: 400, body: 'Unknown product' };
    }

    const token = crypto.randomUUID();

    // Сохраняем в Supabase только если есть треки
    if (product.track_ids.length > 0) {
        const { error } = await supabase
            .from('purchases')
            .insert({
                token,
                email: customerEmail,
                track_ids: product.track_ids,
                stripe_session_id: session.id,
                created_at: new Date().toISOString(),
            });

        if (error) {
            console.error('Supabase error:', error);
            return { statusCode: 500, body: 'Database error' };
        }
    }

    await sendEmail(customerEmail, token, product);

    console.log(`Purchase OK: ${product.name} → ${customerEmail}`);
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

async function sendEmail(email, token, product) {
    const playerUrl = `https://app.ekaterina-donnat.com?token=${token}`;

    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY_KATYA);
    await resend.emails.send({
        from: 'Ekaterina Donna <hello@ekaterina-donnat.com>',
        to: email,
        subject: `Твоя практика готова — ${product.name}`,
        html: buildEmail(playerUrl, product),
    });

    console.log(`Email sent to ${email}: ${product.name}`);
}

function buildEmail(playerUrl, product) {
    const hasPlayer = product.track_ids.length > 0;
    const hasJournal = !!product.journal;

    return `<!DOCTYPE html>
<html>
<body style="background:#151933;font-family:Inter,sans-serif;margin:0;padding:40px 20px;">
    <div style="max-width:520px;margin:0 auto;text-align:center;">

        <img src="https://optim.tildacdn.com/tild3163-3633-4963-a231-363031656432/-/resize/453x/-/format/webp/logo_gold_final2.png.webp"
             width="140" style="margin-bottom:32px;opacity:0.9;">

        <h1 style="color:#f0eae1;font-weight:200;font-size:26px;margin-bottom:8px;">
            ${product.name}
        </h1>
        <p style="color:rgba(248,250,252,0.45);font-size:12px;letter-spacing:0.15em;
                  text-transform:uppercase;margin-bottom:40px;">
            готово к работе
        </p>

        ${hasPlayer ? `
        <a href="${playerUrl}"
           style="display:inline-block;background:#d4af37;color:#0f1123;
                  padding:16px 48px;border-radius:8px;text-decoration:none;
                  font-size:11px;letter-spacing:0.2em;text-transform:uppercase;
                  font-weight:500;margin-bottom:32px;">
            Открыть мою библиотеку
        </a>
        <p style="color:rgba(248,250,252,0.35);font-size:12px;margin-bottom:32px;">
            Кнопка скачивания каждого трека — внутри плеера
        </p>
        ` : `
        <p style="color:rgba(248,250,252,0.7);font-size:14px;line-height:1.7;margin-bottom:32px;">
            Екатерина свяжется с тобой в ближайшее время<br>для записи на сессию.
        </p>
        `}

        ${hasJournal ? `
        <div style="border-top:1px solid rgba(212,175,55,0.15);padding-top:28px;margin-top:8px;">
            <a href="${product.journal}"
               style="display:inline-block;border:1px solid rgba(212,175,55,0.35);
                      color:#d4af37;padding:12px 32px;border-radius:8px;
                      text-decoration:none;font-size:10px;letter-spacing:0.18em;
                      text-transform:uppercase;">
                Скачать дневник состояний
            </a>
            <p style="color:rgba(248,250,252,0.25);font-size:11px;margin-top:12px;">
                Личный дневник интеграции для этой ступени
            </p>
        </div>
        ` : ''}

        <p style="color:rgba(248,250,252,0.2);font-size:11px;margin-top:48px;">
            ekaterina-donnat.com
        </p>
    </div>
</body>
</html>`;
}
