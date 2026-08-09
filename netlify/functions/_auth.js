// netlify/functions/_auth.js
// Единая проверка доступа по токену. Используется в get-progress,
// save-progress, upsell-flag, get-download-url — везде, где раньше токен
// принимался без сверки со статусом покупки в Supabase.
//
// "Доступ навсегда" (без token_expires_at) остаётся архитектурным решением
// (см. donna_session_update 08.08) — expiry сюда не добавляем.
// Но status/revoked_at в purchases уже существуют в схеме (с 05.08) именно
// под эту проверку — этот модуль реализует то, что схема ждала.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const LINEUP_MODE_TOKEN = process.env.LINEUP_MODE_TOKEN;

// Возвращает объект доступа или null.
// { isLineup: true, track_ids: null }               — Lineup Mode, все треки
// { isLineup: false, track_ids: [...], email, source: 'purchase' }
// { isLineup: false, track_ids: [],   email, source: 'guest' }   — гость, без треков
async function getValidAccess(token) {
    if (!token || typeof token !== 'string' || token.length > 200) {
        return null;
    }

    if (LINEUP_MODE_TOKEN && token === LINEUP_MODE_TOKEN) {
        return { token: token, isLineup: true, track_ids: null, email: null, source: 'lineup' };
    }

    var purchaseResult = await supabase
        .from('purchases')
        .select('token, email, track_ids, product_type, status, revoked_at')
        .eq('token', token)
        .maybeSingle();

    if (purchaseResult.data) {
        var p = purchaseResult.data;

        // Схема Supabase: status = paid | refunded | chargeback | revoked.
        // Только paid и без revoked_at даёт доступ.
        if (p.status !== 'paid' || p.revoked_at) {
            return null;
        }

        return {
            token: p.token,
            isLineup: false,
            track_ids: p.track_ids,
            product_type: p.product_type,
            email: p.email,
            source: 'purchase',
        };
    }

    // Гостевой токен (лид-магнит) — не имеет статуса/revoke, всегда активен,
    // но не даёт прав на платные треки.
    var guestResult = await supabase
        .from('donna_guests')
        .select('token, email')
        .eq('token', token)
        .maybeSingle();

    if (guestResult.data) {
        return {
            token: guestResult.data.token,
            isLineup: false,
            track_ids: [],
            product_type: null,
            email: guestResult.data.email,
            source: 'guest',
        };
    }

    return null;
}

// Право на конкретный трек — используется в get-download-url.
function hasTrackAccess(access, trackId) {
    if (!access) return false;
    if (access.isLineup) return true;
    return Array.isArray(access.track_ids) && access.track_ids.indexOf(trackId) !== -1;
}

module.exports = { getValidAccess: getValidAccess, hasTrackAccess: hasTrackAccess };
