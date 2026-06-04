// netlify/functions/tilda-lead.js
// Ловит вебхук от формы Тильды
// Генерирует гостевой токен, сохраняет в Supabase, отправляет письмо через Resend

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const crypto = require('crypto');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

const PROMO_TRACK_URL = 'https://pub-a1dfcf27afc040398c3bc3e4bf3f6416.r2.dev/promo/water_energy.mp3';
const PLAYER_BASE = 'https://app.ekaterina-donnat.com';

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Tilda шлёт данные как form-urlencoded или JSON
    let email;
    try {
        const contentType = event.headers['content-type'] || '';

        if (contentType.includes('application/json')) {
            const body = JSON.parse(event.body);
            email = body.email || body.Email;
        } else {
            // form-urlencoded
            const params = new URLSearchParams(event.body);
            email = params.get('email') || params.get('Email');
        }
    } catch (err) {
        console.error('Parse error:', err);
        return { statusCode: 400, body: 'Invalid request body' };
    }

    if (!email || !email.includes('@')) {
        console.error('No valid email in request');
        return { statusCode: 400, body: 'Missing or invalid email' };
    }

    email = email.toLowerCase().trim();

    // Проверяем не отправляли ли уже этому адресу
    const { data: existing } = await supabase
        .from('donna_guests')
        .select('token')
        .eq('email', email)
        .single();

    let token;

    if (existing?.token) {
        // Уже есть - переиспользуем токен
        token = existing.token;
        console.log(`Existing guest: ${email}, reusing token`);
    } else {
        // Новый гость - генерируем токен
        token = crypto.randomUUID();

        const { error } = await supabase
            .from('donna_guests')
            .insert({
                token,
                email,
                promo_track: 'water_energy',
                created_at: new Date().toISOString(),
            });

        if (error) {
            console.error('Supabase insert error:', error);
            return { statusCode: 500, body: 'Database error' };
        }

        console.log(`New guest created: ${email}`);
    }

    const playerUrl = `${PLAYER_BASE}?token=${token}`;

    // Отправляем письмо
    try {
        await resend.emails.send({
            from: 'Ekaterina Donna <hello@ekaterina-donna.com>',
            to: email,
            subject: 'Твоя первая практика от Екатерины Донна',
            html: buildEmail(playerUrl),
        });

        console.log(`Email sent to ${email}`);
    } catch (err) {
        console.error('Resend error:', err);
        // Не возвращаем ошибку - токен уже создан, письмо можно переотправить
    }

    return {
        statusCode: 200,
        body: JSON.stringify({ success: true }),
    };
};

function buildEmail(playerUrl) {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#151933;font-family:'Inter',Arial,sans-serif;">

    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background-color:#151933;min-height:100vh;">
        <tr>
            <td align="center" style="padding:48px 20px;">

                <table width="520" cellpadding="0" cellspacing="0" border="0"
                       style="max-width:520px;width:100%;">

                    <!-- Лого -->
                    <tr>
                        <td align="center" style="padding-bottom:36px;">
                            <img src="https://optim.tildacdn.com/tild3163-3633-4963-a231-363031656432/-/resize/453x/-/format/webp/logo_gold_final2.png.webp"
                                 width="130" alt="Ekaterina Donna"
                                 style="opacity:0.9;display:block;margin:0 auto;">
                        </td>
                    </tr>

                    <!-- Верхний разделитель -->
                    <tr>
                        <td style="padding-bottom:36px;">
                            <table width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="height:1px;background:linear-gradient(90deg,transparent,rgba(212,175,55,0.4),transparent);font-size:0;">&nbsp;</td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Заголовок -->
                    <tr>
                        <td align="center" style="padding-bottom:8px;">
                            <p style="margin:0;font-size:10px;letter-spacing:0.25em;
                                      text-transform:uppercase;color:rgba(212,175,55,0.7);
                                      font-weight:300;">
                                Авторская нейроакустика
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="padding-bottom:32px;">
                            <h1 style="margin:0;font-size:28px;font-weight:200;
                                       color:#f0eae1;line-height:1.3;letter-spacing:0.02em;">
                                Энергия воды
                            </h1>
                        </td>
                    </tr>

                    <!-- Текст письма -->
                    <tr>
                        <td style="background:rgba(23,27,54,0.6);border:1px solid rgba(212,175,55,0.12);
                                   border-radius:16px;padding:36px 32px;margin-bottom:32px;">

                            <p style="margin:0 0 18px 0;font-size:15px;font-weight:300;
                                      color:rgba(248,250,252,0.85);line-height:1.75;">
                                Привет. Это Катя.
                            </p>
                            <p style="margin:0 0 18px 0;font-size:15px;font-weight:300;
                                      color:rgba(248,250,252,0.85);line-height:1.75;">
                                Я очень рада, что наши пути пересеклись.
                            </p>
                            <p style="margin:0 0 18px 0;font-size:15px;font-weight:300;
                                      color:rgba(248,250,252,0.85);line-height:1.75;">
                                Прямо сейчас у тебя есть возможность отпустить контроль.
                            </p>

                            <!-- Разделитель -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                                <tr>
                                    <td style="height:1px;background:rgba(212,175,55,0.12);font-size:0;">&nbsp;</td>
                                </tr>
                            </table>

                            <p style="margin:0 0 8px 0;font-size:10px;letter-spacing:0.2em;
                                      text-transform:uppercase;color:rgba(212,175,55,0.6);">
                                Твоя первая практика
                            </p>
                            <p style="margin:0 0 18px 0;font-size:19px;font-weight:300;
                                      color:#d4af37;line-height:1.3;">
                                Энергия воды
                            </p>
                            <p style="margin:0 0 18px 0;font-size:15px;font-weight:300;
                                      color:rgba(248,250,252,0.85);line-height:1.75;">
                                Она создана для того, чтобы мягко смыть суету дня
                                и вернуть тебя в твоё тело.
                            </p>
                            <p style="margin:0 0 18px 0;font-size:15px;font-weight:300;
                                      color:rgba(248,250,252,0.85);line-height:1.75;">
                                Тебе не нужно стараться или работать над собой.
                                Просто найди пятнадцать минут тишины
                                и надень любимые наушники.
                            </p>
                            <p style="margin:0;font-size:15px;font-weight:300;
                                      color:rgba(248,250,252,0.85);line-height:1.75;">
                                Нажимай кнопку ниже, закрывай глаза
                                и позволь звуку сделать всю работу.
                            </p>
                        </td>
                    </tr>

                    <!-- Кнопка -->
                    <tr>
                        <td align="center" style="padding:36px 0 24px;">
                            <a href="${playerUrl}"
                               style="display:inline-block;background:#d4af37;color:#0f1123;
                                      padding:17px 52px;border-radius:8px;text-decoration:none;
                                      font-size:11px;letter-spacing:0.22em;text-transform:uppercase;
                                      font-weight:500;">
                                Открыть практику
                            </a>
                        </td>
                    </tr>

                    <!-- Подсказка -->
                    <tr>
                        <td align="center" style="padding-bottom:40px;">
                            <p style="margin:0;font-size:11px;font-weight:300;
                                      color:rgba(248,250,252,0.25);line-height:1.6;">
                                Это твоя персональная ссылка.<br>
                                Сохрани это письмо — она работает всегда.
                            </p>
                        </td>
                    </tr>

                    <!-- Нижний разделитель -->
                    <tr>
                        <td style="padding-bottom:28px;">
                            <table width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="height:1px;background:linear-gradient(90deg,transparent,rgba(212,175,55,0.25),transparent);font-size:0;">&nbsp;</td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Футер -->
                    <tr>
                        <td align="center">
                            <p style="margin:0;font-size:10px;font-weight:300;
                                      color:rgba(248,250,252,0.2);letter-spacing:0.1em;">
                                ekaterina-donnat
                                .com
                            </p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>

</body>
</html>`;
}
