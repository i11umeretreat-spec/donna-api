// netlify/functions/_r2sign.js
//
// Подпись ключа бакета R2 на заданный срок.
//
// ОСОЗНАННЫЙ ДУБЛЬ. Та же логика живёт в get-download-url.js, и она
// обслуживает выдачу купленного. Трогать её ради акции на трое суток
// нельзя: цена ошибки там выше цены дубля здесь. Свести оба места
// в один модуль отдельной задачей после акции, долг записан в спеке
// операции от 14.09.
//
// Пакеты @aws-sdk в package.json не объявлены и на диске их нет:
// в проде они приезжают из окружения Lambda, где живут функции
// Netlify. Так же устроены get-download-url.js, verify-token.js
// и health-check.js, то есть это не новая зависимость, а та же самая.

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

// Подписывает ключ бакета. Возвращает адрес, живущий ttlSeconds.
function signKey(key, ttlSeconds) {
    const command = new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
    });

    return getSignedUrl(r2, command, { expiresIn: ttlSeconds });
}

module.exports = { signKey: signKey };
