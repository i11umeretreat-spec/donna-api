// netlify/functions/_accessEmail.js
//
// Письмо с доступом к плееру. Вынесено из stripe-webhook.js, потому что
// активация подарочного сертификата шлёт ровно его же: получатель
// подарка не должен получить письмо, чем-то отличающееся от письма
// обычного покупателя. Копия шаблона разошлась бы с оригиналом
// на первой же правке.

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY_KATYA);

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

module.exports = { sendEmail: sendEmail, buildEmail: buildEmail };
