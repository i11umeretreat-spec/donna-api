// netlify/functions/tilda-lead.js
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const crypto = require('crypto');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY_KATYA);
const PLAYER_BASE = 'https://app.ekaterina-donnat.com';

function respond(statusCode, payload) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    };
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return respond(405, { error: 'Method Not Allowed' });
    }

    let email, utmSource;
    try {
        const contentType = event.headers['content-type'] || '';

        if (contentType.includes('application/json')) {
            const body = JSON.parse(event.body);
            email = body.email || body.Email;
            utmSource = body.utm_source || body.UTM_SOURCE || 'organic';
        } else {
            const params = new URLSearchParams(event.body);
            email = params.get('email') || params.get('Email');
            utmSource = params.get('utm_source') || params.get('UTM_SOURCE') || 'organic';
        }
    } catch (err) {
        console.error('Parse error:', err);
        return respond(400, { error: 'Invalid request body' });
    }

    if (!email || !email.includes('@')) {
        return respond(400, { error: 'Missing or invalid email' });
    }

    email = email.toLowerCase().trim();
    let token;

    try {
        // Проверяем, есть ли уже гость с таким email
        const { data: existing, error: fetchError } = await supabase
            .from('donna_guests')
            .select('token')
            .eq('email', email)
            .single();

        if (existing && existing.token) {
            token = existing.token;
        } else {
            // Если записи нет (fetchError с кодом PGRST116) — создаём новую
            token = crypto.randomUUID();
            
            const { error: insertError } = await supabase
                .from('donna_guests')
                .insert({
                    token,
                    email,
                    promo_track: 'water_energy',
                    utm_source: utmSource,
                    created_at: new Date().toISOString(),
                });

            if (insertError) {
                console.error('Supabase insert error:', insertError);
                return respond(500, { error: 'Database error' });
            }
        }
    } catch (err) {
        console.error('Supabase query failed:', err);
        return respond(500, { error: 'Database connection error' });
    }

    const playerUrl = `${PLAYER_BASE}?token=${token}`;

    // Отправляем письмо
    try {
        await resend.emails.send({
            from: 'Ekaterina Donna <hello@ekaterina-donnat.com>',
            to: email,
            subject: 'Баланс стихий - твоя первая практика от Екатерины Донна',
            html: buildEmail(playerUrl),
        });
    } catch (err) {
        console.error('Resend error:', err);
        // Не возвращаем ошибку клиенту (Тильде) — токен уже создан, 
        // письмо можно переотправить вручную или через крон
    }

    return respond(200, { success: true });
};

function buildEmail(playerUrl) {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#151933;font-family:'Inter',Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#151933;min-height:100vh;">
        <tr>
            <td align="center" style="padding:48px 20px;">
                <table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;">
                    <tr>
                        <td align="center" style="padding-bottom:36px;">
                            <img src="https://optim.tildacdn.com/tild3163-3633-4963-a231-363031656432/-/resize/453x/-/format/webp/logo_gold_final2.png.webp" width="130" alt="Ekaterina Donna" style="opacity:0.9;display:block;margin:0 auto;">
                        </td>
                    </tr>
                    <tr>
                        <td style="padding-bottom:36px;">
                            <table width="100%" cellpadding="0" cellspacing="0">
                                <tr><td style="height:1px;background:linear-gradient(90deg,transparent,rgba(212,175,55,0.4),transparent);font-size:0;">&nbsp;</td></tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="padding-bottom:8px;">
                            <p style="margin:0;font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:rgba(212,175,55,0.7);font-weight:300;">Сеанс самогипноза · Энергетическое наполнение</p>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="padding-bottom:32px;">
                            <h1 style="margin:0;font-size:28px;font-weight:200;color:#f0eae1;line-height:1.3;letter-spacing:0.02em;">Баланс стихий</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="background:rgba(23,27,54,0.6);border:1px solid rgba(212,175,55,0.12);border-radius:16px;padding:36px 32px;margin-bottom:32px;">
                            <p style="margin:0 0 18px 0;font-size:15px;font-weight:300;color:rgba(248,250,252,0.85);line-height:1.75;">Привет. Это Екатерина.</p>
                            <p style="margin:0 0 18px 0;font-size:15px;font-weight:300;color:rgba(248,250,252,0.85);line-height:1.75;">Я очень рада, что наши пути пересеклись.</p>
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                                <tr><td style="height:1px;background:rgba(212,175,55,0.12);font-size:0;">&nbsp;</td></tr>
                            </table>
                            <p style="margin:0 0 8px 0;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(212,175,55,0.6);">Твоя первая практика</p>
                            <p style="margin:0 0 18px 0;font-size:19px;font-weight:300;color:#d4af37;line-height:1.3;">Баланс стихий</p>
                            <p style="margin:0 0 18px 0;font-size:15px;font-weight:300;color:rgba(248,250,252,0.85);line-height:1.75;">Ты когда-нибудь стоял у воды и чувствовал, как что-то внутри успокаивается само собой? Или смотрел на огонь и ощущал, как просыпается сила?</p>
                            <p style="margin:0 0 18px 0;font-size:15px;font-weight:300;color:rgba(248,250,252,0.85);line-height:1.75;">Это не случайность. Это твоё тело вспоминает язык, который оно знало всегда.</p>
                            <p style="margin:0 0 18px 0;font-size:15px;font-weight:300;color:rgba(248,250,252,0.85);line-height:1.75;">Шесть стихий - Вода, Огонь, Земля, Воздух, Металл, Дерево - это шесть разных способов наполнить себя энергией. В этом сеансе самогипноза ты по очереди входишь в каждую стихию и забираешь именно то, чего сейчас не хватает.</p>
                            <p style="margin:0 0 18px 0;font-size:15px;font-weight:300;color:rgba(248,250,252,0.7);line-height:1.75;font-style:italic;">Можно слушать на природе - у реки, у костра, босиком на траве. Можно дома - подсознание не знает разницы, оно работает с образами.</p>
                            <p style="margin:0;font-size:15px;font-weight:300;color:rgba(248,250,252,0.85);line-height:1.75;">Одна медитация - шесть источников силы. Нажимай кнопку ниже, закрывай глаза и позволь звуку сделать всю работу.</p>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="padding:36px 0 24px;">
                            <a href="${playerUrl}" style="display:inline-block;background:#d4af37;color:#0f1123;padding:17px 52px;border-radius:8px;text-decoration:none;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;font-weight:500;">Открыть практику</a>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="padding-bottom:32px;">
                            <p style="margin:0;font-size:11px;font-weight:300;color:rgba(248,250,252,0.25);line-height:1.6;">Это твоя персональная ссылка.<br>Сохрани это письмо - она работает всегда.</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding-bottom:32px;">
                            <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="height:1px;background:rgba(212,175,55,0.12);font-size:0;">&nbsp;</td></tr></table>
                        </td>
                    </tr>
                    <tr>
                        <td style="background:rgba(23,27,54,0.6);border:1px solid rgba(212,175,55,0.1);border-radius:12px;padding:28px 24px;">
                            <p style="margin:0 0 12px 0;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(212,175,55,0.6);">Когда будешь готова идти глубже</p>
                            <p style="margin:0 0 16px 0;font-size:14px;font-weight:300;color:rgba(248,250,252,0.75);line-height:1.7;">Эта практика сняла симптом — напряжение сегодняшнего дня. Но если тревога, усталость или ощущение потери себя возвращаются снова и снова — это не симптом, а паттерн. Его нельзя снять одной практикой.</p>
                            <p style="margin:0 0 20px 0;font-size:14px;font-weight:300;color:rgba(248,250,252,0.75);line-height:1.7;">Ступени работают глубже. Они перестраивают реакцию нервной системы — так чтобы эти состояния перестали быть твоим фоном.</p>
                            <table width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td width="48%" style="padding-right:6px;">
                                        <a href="https://ekaterina-donnat.com/#steps" style="display:block;text-align:center;border:1px solid rgba(212,175,55,0.3);color:#d4af37;padding:12px 8px;border-radius:8px;text-decoration:none;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;">Выбрать ступень</a>
                                    </td>
                                    <td width="4%"></td>
                                    <td width="48%" style="padding-left:6px;">
                                        <a href="https://buy.stripe.com/4gMcN4aB10XOeSj4eMasg0c" style="display:block;text-align:center;background:#d4af37;color:#0f1123;padding:12px 8px;border-radius:8px;text-decoration:none;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;font-weight:500;">Полный альбом 350€</a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:28px 0;">
                            <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="height:1px;background:linear-gradient(90deg,transparent,rgba(212,175,55,0.25),transparent);font-size:0;">&nbsp;</td></tr></table>
                        </td>
                    </tr>
                    <tr>
                        <td align="center">
                            <p style="margin:0;font-size:10px;font-weight:300;color:rgba(248,250,252,0.2);letter-spacing:0.1em;">ekaterina-donnat.com</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}
