// netlify/functions/_cors.js
// Единый паттерн CORS, уже проверенный в track-demo.js (08.08).
// Раньше verify-token.js и get-download-url.js хардкодили один origin,
// а get-progress.js, save-progress.js и upsell-flag.js не отдавали
// CORS-заголовки вообще — ломается на превью-деплоях, локальной разработке
// и при любом вызове не с app.ekaterina-donnat.com.

const ALLOWED_ORIGINS = [
    'https://app.ekaterina-donnat.com',
    'https://ekaterina-donnat.com',
];

function corsHeaders(requestOrigin, methods) {
    var allowOrigin = ALLOWED_ORIGINS.indexOf(requestOrigin) !== -1
        ? requestOrigin
        : ALLOWED_ORIGINS[0];

    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': methods || 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Vary': 'Origin',
        'Content-Type': 'application/json',
    };
}

function getOrigin(event) {
    return (event.headers && (event.headers.origin || event.headers.Origin)) || '';
}

module.exports = { corsHeaders: corsHeaders, getOrigin: getOrigin };
