// test/attribution.test.js
//
// Разбор client_reference_id. Через него метка кампании доезжает
// от кнопки до покупки в Stripe, и когда он ломается, покупка всё
// равно проходит, а в отчёте появляется строка без источника.
// Заметить это можно только спустя неделю, поэтому разбор проверен
// отдельно от вебхука.
//
// Запуск: node --test

const test = require('node:test');
const assert = require('node:assert');
const { parseClientReference } = require('../netlify/functions/_attribution');

test('формат сайта: метка и источник через вертикальную черту', () => {
    assert.deepStrictEqual(parseClientReference('wa_flagman|paid'),
        { campaign: 'wa_flagman', source: 'paid' });
});

test('формат страницы окна: то же самое через дефис', () => {
    // Stripe принимает в client_reference_id только [A-Za-z0-9_-],
    // и на прямой платёжной ссылке черта ломала покупку.
    assert.deepStrictEqual(parseClientReference('post_pamyat-organic'),
        { campaign: 'post_pamyat', source: 'organic' });

    assert.deepStrictEqual(parseClientReference('email_pamyat-referral'),
        { campaign: 'email_pamyat', source: 'referral' });
});

test('дефис не режет метку: подчёркивание внутри метки остаётся', () => {
    assert.strictEqual(parseClientReference('post_pamyat-organic').campaign, 'post_pamyat');
});

test('заглушка site обнуляется, источник остаётся', () => {
    assert.deepStrictEqual(parseClientReference('site-direct'),
        { campaign: null, source: 'direct' });
});

test('незнакомая метка обнуляется, а не пишется как есть', () => {
    assert.strictEqual(parseClientReference('сам_придумал-organic').campaign, null);
});

test('одна метка без источника и мусор не роняют разбор', () => {
    assert.deepStrictEqual(parseClientReference('wa_flagman'), { campaign: 'wa_flagman', source: null });
    assert.deepStrictEqual(parseClientReference(''), { campaign: null, source: null });
    assert.deepStrictEqual(parseClientReference(undefined), { campaign: null, source: null });
    assert.deepStrictEqual(parseClientReference(null), { campaign: null, source: null });
});
