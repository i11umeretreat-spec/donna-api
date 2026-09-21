// netlify/functions/_attribution.js
//
// Метка кампании, одна на все функции. До 31.08 список жил копиями
// в track-demo.js и podbor-save.js, с припиской «не забудь второй
// файл». Приписка помогала ровно до третьего места, которому список
// понадобился, поэтому список переехал сюда.
//
// Белый список, а не произвольная строка: значение приходит из адреса,
// то есть из публичного запроса, а пишется сервисным ключом.

const VALID_CAMPAIGNS = [
    'email_demo',
    'email_site',
    'email_flagship',
    'ig_bio',
    'ig_fl',
    'ig_pr',
    'ig_acc',
    'ig_test',
    'tg_channel',
    'tg_post',
    'wa_warm',
    'wa_flagman',
    // Окно «Память тела», 15-17.09: письмо по базе и пост в ленте.
    // Две метки, потому что главный вопрос операции, кто приводит
    // людей, письмо или лента, впервые получает ответ.
    'email_pamyat',
    'post_pamyat',
    // Пост про ступени.
    'post_stupeni'
];

// Неизвестное значение обнуляем, а не подменяем дефолтом: лучше пустое
// поле, чем тихо неверная метка, из-за которой воронка считается
// на смешанных данных.
function safeCampaign(value) {
    return VALID_CAMPAIGNS.indexOf(value) !== -1 ? value : null;
}

// client_reference_id собирается как «кампания, разделитель, источник».
//
// Разделителей два, и это не небрежность. На сайте Тильды стоит
// вертикальная черта: var ref = (from || 'site') + '|' + (utm || 'direct').
// Stripe же принимает в client_reference_id только [A-Za-z0-9_-], и
// на прямых платёжных ссылках черта ломала покупку, было в августе.
// Поэтому страница окна «Память тела» склеивает то же самое дефисом.
//
// Дефис безопасен как разделитель: ни одна метка из VALID_CAMPAIGNS
// и ни один источник его не содержат, они пишутся через подчёркивание.
//
// Заглушка 'site' в списке кампаний не значится и обнуляется сама,
// отдельной проверки под неё не нужно.
function parseClientReference(ref) {
    if (typeof ref !== 'string') return { campaign: null, source: null };
    const parts = ref.indexOf('|') !== -1 ? ref.split('|') : ref.split('-');
    return {
        campaign: safeCampaign(parts[0]),
        source: parts[1] || null
    };
}

module.exports = { VALID_CAMPAIGNS, safeCampaign, parseClientReference };
