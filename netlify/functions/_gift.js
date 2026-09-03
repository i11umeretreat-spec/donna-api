// netlify/functions/_gift.js
//
// Код подарочного сертификата: как его сделать, как привести к виду
// для сравнения и как показать человеку.
//
// В базе код лежит в нормализованном виде: только заглавные буквы
// и цифры, без разделителей. Показываем группами через дефис, потому
// что так его переписывают с экрана и диктуют голосом. Сравнение всегда
// идёт по нормализованному виду, иначе человек, набравший код без
// дефисов или строчными, получил бы отказ на верном коде.

const crypto = require('crypto');

// Алфавит без пар, которые путают глазами и на слух: нет 0 и O,
// нет 1, I и L, нет U рядом с V. Тридцать символов, двенадцать знаков,
// это порядка 59 бит: подобрать перебором нечего.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 12;
const GROUP = 4;

function generateCode() {
    let out = '';
    // Отбрасываем байты из хвоста диапазона, чтобы не перекосить
    // распределение остатком от деления: 256 на 30 нацело не делится.
    const limit = 256 - (256 % ALPHABET.length);

    while (out.length < CODE_LENGTH) {
        const bytes = crypto.randomBytes(CODE_LENGTH);
        for (let i = 0; i < bytes.length && out.length < CODE_LENGTH; i++) {
            if (bytes[i] >= limit) continue;
            out += ALPHABET[bytes[i] % ALPHABET.length];
        }
    }

    return out;
}

// Всё, что не буква и не цифра, выбрасывается: дефисы, пробелы,
// неразрывные пробелы из письма, случайные точки.
function normalizeCode(input) {
    if (typeof input !== 'string') return '';
    return input.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function formatCode(code) {
    const norm = normalizeCode(code);
    const parts = [];
    for (let i = 0; i < norm.length; i += GROUP) {
        parts.push(norm.slice(i, i + GROUP));
    }
    return parts.join('-');
}

module.exports = {
    generateCode: generateCode,
    normalizeCode: normalizeCode,
    formatCode: formatCode,
    CODE_LENGTH: CODE_LENGTH,
};
