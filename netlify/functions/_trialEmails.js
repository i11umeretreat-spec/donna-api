// netlify/functions/_trialEmails.js
//
// Письма пробной ночи. Тексты черновые: подписывает Катя,
// и править их удобнее здесь, отдельно от логики son-trial.js.
//
// Вёрстка светлая, кнопка терракотовая и `color-scheme: light only`:
// урок рассылки 17.09, когда Gmail в тёмной теме инвертировал белую
// карточку и тёмная кнопка в ней растворилась.
//
// Правила текста те же, что на сайте: без длинных тире, без обещаний
// результата, без слова «бессонница». Регистр «Вы»: это письмо, а не практика (решение 23.11).

const PLAYER_BASE = 'https://app.ekaterina-donnat.com/';

// Страница «Фонарщика» в Тильде. Адрес задаётся при создании страницы;
// если он поменяется, править здесь и в плеере (index.html, SON_PAGE_URL).
const SON_PAGE_URL = 'https://ekaterina-donnat.com/fonarshchik';

function playerUrl(token, campaign) {
    return PLAYER_BASE + '?token=' + encodeURIComponent(token) +
        '&surface=player&utm_source=referral&from=' + campaign;
}

function pageUrl(campaign) {
    return SON_PAGE_URL + '?utm_source=referral&from=' + campaign;
}

function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function button(href, label) {
    return '<p style="margin:28px 0;text-align:center;">' +
        '<a href="' + esc(href) + '" style="display:inline-block;background:#a85334;color:#ffffff;' +
        'text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;letter-spacing:0.02em;">' +
        esc(label) + '</a></p>';
}

function quietLink(href, label) {
    return '<p style="margin:24px 0;text-align:center;">' +
        '<a href="' + esc(href) + '" style="color:#a85334;font-size:15px;">' + esc(label) + '</a></p>';
}

function p(text) {
    return '<p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#2b2622;">' + text + '</p>';
}

function layout(preheader, inner) {
    return '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">' +
        '<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">' +
        '</head><body style="margin:0;padding:0;background:#f4efe8;">' +
        '<div style="display:none;max-height:0;overflow:hidden;">' + esc(preheader) + '</div>' +
        '<div style="max-width:520px;margin:0 auto;padding:32px 20px;font-family:Georgia,\'Times New Roman\',serif;">' +
        '<div style="background:#ffffff;border-radius:16px;padding:32px 28px;">' + inner + '</div>' +
        '<p style="margin:20px 8px 0;font-size:12px;line-height:1.6;color:#8a7f74;font-family:Arial,sans-serif;">' +
        'Это письмо пришло, потому что на сайте ekaterina-donnat.com на этот адрес взяли пробную ночь ' +
        'с практикой «Фонарщик». Если писать больше не нужно, просто ответьте на него словом «стоп».' +
        '</p></div></body></html>';
}

const SIGN = p('С теплом,<br>Екатерина');

function welcome(token) {
    return {
        subject: '«Первое погружение»: Ваша пробная ночь',
        html: layout('Двадцать минут голоса и тёплого звука. Лучше в наушниках, когда свет уже выключен.',
            p('Здравствуйте.') +
            p('Вот Ваша ссылка на «Первое погружение». Это первые двадцать минут практики «Фонарщик», и они Ваши на эту ночь: ссылка открывается до десяти утра.') +
            button(playerUrl(token, 'son_mail_welcome'), 'Слушать') +
            p('Включайте, когда свет уже выключен. Лучше в наушниках: голос и звук будут медленно ходить вокруг головы. Уснёте на десятой минуте или дослушаете до конца, всё одинаково правильно.') +
            p('Только не слушайте её за рулём и там, где нужно внимание.') +
            p('Утром я Вам напишу.') +
            SIGN),
    };
}

// Уходит в момент закрытия доступа, поэтому ссылки на плеер здесь нет:
// она бы уже не открылась.
function morning() {
    return {
        subject: 'Как прошла ночь?',
        html: layout('Ответьте одной строкой, я читаю сама.',
            p('Доброе утро.') +
            p('Как прошла ночь? Ответьте на это письмо одной строкой, я читаю всё сама. Мне правда интересно, на какой минуте голос перестал быть нужен.') +
            p('Пробная ночь закончилась, и ссылка на «Первое погружение» больше не открывается.') +
            p('Если захочется продолжить: в полной версии сорок минут вместо двадцати, история фонарщика и короткий ритуал на каждую ночь, который можно повторять и без записи. Доступ навсегда.') +
            button(pageUrl('son_mail_morning'), 'Полная практика') +
            SIGN),
    };
}

// Адрес уже брал пробные ночи, и они прошли. Ссылки на плеер здесь
// нет намеренно: второй раз пробный доступ не открывается.
function alreadyUsed() {
    return {
        subject: '«Фонарщик»: пробная ночь уже была',
        html: layout('Полная практика ждёт по ссылке внутри.',
            p('Здравствуйте.') +
            p('Пробная ночь с этого адреса уже была, второй раз она не открывается.') +
            p('Если хочется продолжить, полная практика здесь: сорок минут, история фонарщика и ритуал на каждую ночь, доступ навсегда.') +
            button(pageUrl('son_mail_used'), 'Полная практика') +
            SIGN),
    };
}

module.exports = {
    SON_PAGE_URL: SON_PAGE_URL,
    welcome: welcome,
    morning: morning,
    alreadyUsed: alreadyUsed,
};
