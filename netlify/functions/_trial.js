// netlify/functions/_trial.js
//
// Пробная ночь «Первого погружения». Спека: donna_spec_fonarshchik.md,
// часть Б, 17.11. С 23.11 ночь одна, а не три: Катя боится, что после
// трёх бесплатных ночей полную уже не купят.
//
// Здесь только арифметика сроков и решение «пускать или нет». Часы
// и часовой пояс приходят аргументами: иначе проверить границы можно
// было бы, только дождавшись нужного утра (тот же приём, что
// в pamyat-access.js).
//
// Смещение пояса в том же виде, что отдаёт браузер через
// Date.getTimezoneOffset(): UTC минус местное время, в минутах.
// Женева зимой даёт -60, Бали -480.

const NIGHTS = 1;

// Запись до пяти утра считается прошедшей ночью. Человек, который
// в два часа не может уснуть и записывается, слушает сейчас, а не ждёт
// следующего вечера.
const NIGHT_CUTOFF_HOUR = 5;

// Доступ до десяти утра после ночи: проснулся, дослушал хвост, если
// надо, и только потом ссылка перестаёт открываться.
const EXPIRES_HOUR = 10;

// Браузер не прислал смещение или прислал мусор: считаем по Женеве,
// это часовой пояс Кати и большей части её аудитории.
const DEFAULT_OFFSET = -60;

function normalizeOffset(value) {
    if (value === null || value === undefined || value === '') return DEFAULT_OFFSET;
    var n = Number(value);
    // Реальные пояса лежат между UTC-12 и UTC+14.
    if (!isFinite(n) || n < -840 || n > 720) return DEFAULT_OFFSET;
    return Math.round(n);
}

// Местное время как поля UTC-даты: сдвигаем момент на смещение
// и читаем getUTC*. Так не нужен ни Intl, ни база часовых поясов.
function localParts(ms, offset) {
    var d = new Date(ms - offset * 60000);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours() };
}

// Обратно: местные дата и время в момент UTC. Date.UTC сам переносит
// день через границу месяца, поэтому «тридцать первое плюс три» работает.
function localToIso(y, mo, d, h, m, offset) {
    return new Date(Date.UTC(y, mo, d, h, m, 0) + offset * 60000).toISOString();
}

function trialSchedule(nowMs, offsetValue) {
    var offset = normalizeOffset(offsetValue);
    var p = localParts(nowMs, offset);
    var nightDay = p.h < NIGHT_CUTOFF_HOUR ? p.d - 1 : p.d;

    var expiresAt = localToIso(p.y, p.mo, nightDay + NIGHTS, EXPIRES_HOUR, 0, offset);

    // «Как прошла ночь?» уходит в момент закрытия доступа. Раньше нельзя:
    // письмо разбудило бы того, кто ещё спит. Позже незачем: в письме уже
    // нет ссылки на плеер, только на полную практику.
    return {
        offset: offset,
        expiresAt: expiresAt,
        morningAt: expiresAt,
    };
}

// Пускать ли гостя. Строка без срока это старый лид-магнит, он
// бессрочный и остаётся таким.
function guestAccess(row, nowMs) {
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.expires_at && nowMs >= Date.parse(row.expires_at)) {
        return { ok: false, reason: 'trial_ended' };
    }
    return { ok: true };
}

module.exports = {
    TRIAL_TRACK: 'son_trial',
    trialSchedule: trialSchedule,
    guestAccess: guestAccess,
    normalizeOffset: normalizeOffset,
};
