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
    'qr_journal',
    'tg_channel',
    'tg_post',
    'wa_warm',
    'wa_flagman'
];

// Неизвестное значение обнуляем, а не подменяем дефолтом: лучше пустое
// поле, чем тихо неверная метка, из-за которой воронка считается
// на смешанных данных.
function safeCampaign(value) {
    return VALID_CAMPAIGNS.indexOf(value) !== -1 ? value : null;
}

// client_reference_id собирается на сайте как «кампания|источник»:
// var ref = (from || 'site') + '|' + (utm || 'direct');
// Оба места сборки — кнопка флагмана и кнопки в аккордеоне — пишут
// один формат.
//
// Заглушка 'site' в списке кампаний не значится и обнуляется сама,
// отдельной проверки под неё не нужно.
function parseClientReference(ref) {
    if (typeof ref !== 'string') return { campaign: null, source: null };
    const parts = ref.split('|');
    return {
        campaign: safeCampaign(parts[0]),
        source: parts[1] || null
    };
}

module.exports = { VALID_CAMPAIGNS, safeCampaign, parseClientReference };
