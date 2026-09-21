// netlify/functions/_resendContacts.js
//
// Контакты Resend: найти, создать, добавить в сегмент.
//
// Почему руками, а не пакетом resend: установленная версия 3.5 знает
// только старую модель, где контакт живёт внутри одной аудитории
// (`/audiences/{id}/contacts`). У Кати аккаунт уже на новой: контакт
// один на весь аккаунт, сегменты это метки, а флаг `unsubscribed`
// общий. Именно поэтому проверка «человек отписался» и работает: она
// про аккаунт целиком, а не про один список. Поднимать версию пакета
// ради трёх запросов не стали, новых зависимостей не появилось.
//
// ВНИМАНИЕ, это надо подтвердить первым живым вызовом. Адреса
// эндпоинтов ниже взяты по новой модели, но проверить их из среды
// разработки было нечем: документация Resend недоступна, ключа здесь
// нет. Поэтому при любом отказе в журнал уходит метод, путь и код
// ответа: одна живая отправка с телефона отвечает на вопрос
// окончательно.

const API = 'https://api.resend.com';

function headers() {
    return {
        'Authorization': 'Bearer ' + process.env.RESEND_API_KEY_KATYA,
        'Content-Type': 'application/json',
    };
}

// Ответ Resend в разных местах приходит то объектом, то завёрнутым
// в data. Разворачиваем в одном месте, чтобы вызывающий не гадал.
function unwrap(json) {
    if (json && typeof json === 'object' && json.data && typeof json.data === 'object') return json.data;
    return json;
}

async function request(method, path, body) {
    const res = await fetch(API + path, {
        method: method,
        headers: headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    let json = null;
    try { json = await res.json(); } catch (e) { json = null; }

    return { status: res.status, ok: res.ok, body: unwrap(json) };
}

// Ищет контакт по адресу. Три исхода, и вызывающий обязан различать
// все три: найден, не найден, и «не смогли спросить».
async function findContact(email) {
    const res = await request('GET', '/contacts/' + encodeURIComponent(email));

    if (res.status === 404) return { found: false };
    if (!res.ok) {
        console.error('resend findContact failed:', res.status, 'GET /contacts/:email');
        return { failed: true, status: res.status };
    }
    return { found: true, contact: res.body || {} };
}

async function createContact(email, segmentId, properties) {
    const res = await request('POST', '/contacts', {
        email: email,
        unsubscribed: false,
        segment_ids: [segmentId],
        properties: properties,
    });

    if (!res.ok) {
        console.error('resend createContact failed:', res.status, 'POST /contacts');
        return { failed: true, status: res.status };
    }
    return { ok: true };
}

async function addToSegment(email, segmentId) {
    const res = await request('POST', '/segments/' + encodeURIComponent(segmentId) + '/contacts', {
        email: email,
    });

    if (!res.ok) {
        console.error('resend addToSegment failed:', res.status, 'POST /segments/:id/contacts');
        return { failed: true, status: res.status };
    }
    return { ok: true };
}

module.exports = {
    findContact: findContact,
    createContact: createContact,
    addToSegment: addToSegment,
};
