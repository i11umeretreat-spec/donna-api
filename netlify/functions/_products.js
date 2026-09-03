// netlify/functions/_products.js
//
// Каталог продуктов, один на все функции. Раньше жил внутри
// stripe-webhook.js, но активация подарочного сертификата резолвит
// состав ступени тем же маппингом, а две копии одной истины расходятся
// всегда. Тот же приём, что с _attribution.js.
//
// Ключ Payment Link нужен вебхуку: он опознаёт покупку по ссылке.
// Ключ product_type нужен активации: в сертификате хранится тип,
// а не состав, чтобы получатель получил актуальную ступень, а не ту,
// что была на момент дарения.

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

// Продукт по типу: этим ходит активация сертификата.
const PRODUCTS_BY_TYPE = {};
PRODUCT_DEFINITIONS.forEach(function(def) {
    PRODUCTS_BY_TYPE[def.product_type] = {
        track_ids:    def.track_ids,
        journal:      def.journal,
        name:         def.name,
        product_type: def.product_type,
    };
});

function productByType(type) {
    return PRODUCTS_BY_TYPE[type] || null;
}

module.exports = { PRODUCTS: PRODUCTS, productByType: productByType, R2_BASE: R2_BASE };
