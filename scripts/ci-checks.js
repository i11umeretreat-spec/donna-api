#!/usr/bin/env node
// scripts/ci-checks.js
//
// Гейт перед деплоем. Проверяет:
//   1. Синтаксис (node --check) каждой Netlify-функции в netlify/functions/
//   2. Синтаксис инлайновых <script> в index.html / demo.html
//   3. ES5-чистоту клиентского кода (index.html, demo.html, mood-engine.js) —
//      const/let/arrow function/template literals запрещены, т.к. плеер
//      должен работать в Instagram WebView на старом Android.
//
// netlify.toml дёргает этот скрипт перед npm audit — при ненулевом коде
// выхода деплой не публикуется. Тот же скрипт гоняет .github/workflows/ci.yml
// на каждый push/PR для быстрой обратной связи в GitHub.
//
// Сам скрипт — build-time Node, не клиентский код, поэтому ES5 на него
// не распространяется.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let failed = false;

function fail(msg) {
    console.error('✗ ' + msg);
    failed = true;
}

function ok(msg) {
    console.log('✓ ' + msg);
}

function checkSyntax(label, code) {
    const tmp = path.join(
        os.tmpdir(),
        'cicheck-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.js'
    );
    fs.writeFileSync(tmp, code);
    try {
        execFileSync('node', ['--check', tmp], { stdio: 'pipe' });
        ok(label + ' — синтаксис ок');
    } catch (err) {
        fail(label + ' — синтаксическая ошибка:\n' + (err.stderr ? err.stderr.toString() : err.message));
    } finally {
        fs.unlinkSync(tmp);
    }
}

const ES5_VIOLATIONS = [
    { name: 'const', re: /\bconst\b/ },
    { name: 'let', re: /\blet\b/ },
    { name: 'стрелочная функция (=>)', re: /=>/ },
    { name: 'template literal (`)', re: /`/ },
];

function checkEs5(label, code) {
    ES5_VIOLATIONS.forEach(function (v) {
        if (v.re.test(code)) {
            fail(label + ' — ES5-нарушение: ' + v.name);
        }
    });
}

function extractInlineScripts(html) {
    const scripts = [];
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        if (m[1].trim()) scripts.push(m[1]);
    }
    return scripts;
}

// ── 1. Netlify functions — только синтаксис (это Node-код, ES5 не требуется) ─
const fnDir = path.join(ROOT, 'netlify', 'functions');
if (fs.existsSync(fnDir)) {
    const fnFiles = fs.readdirSync(fnDir).filter(function (f) { return f.endsWith('.js'); });
    fnFiles.forEach(function (f) {
        const full = path.join(fnDir, f);
        try {
            execFileSync('node', ['--check', full], { stdio: 'pipe' });
            ok('netlify/functions/' + f + ' — синтаксис ок');
        } catch (err) {
            fail('netlify/functions/' + f + ' — синтаксическая ошибка:\n' + (err.stderr ? err.stderr.toString() : err.message));
        }
    });
} else {
    fail('netlify/functions/ не найдена');
}

// ── 2. Инлайновые <script> в index.html / demo.html — синтаксис + ES5 ───────
['index.html', 'demo.html', 'vybor.html'].forEach(function (file) {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) return;
    const html = fs.readFileSync(full, 'utf8');
    const scripts = extractInlineScripts(html);
    if (scripts.length === 0) {
        fail(file + ' — не найдено ни одного инлайн <script> (изменилась структура файла?)');
        return;
    }
    scripts.forEach(function (code, i) {
        const label = file + ' <script>#' + (i + 1);
        checkSyntax(label, code);
        checkEs5(label, code);
    });
});

// ── 3. mood-engine.js — отдельный файл, синтаксис + ES5 ─────────────────────
const moodEngine = path.join(ROOT, 'mood-engine.js');
if (fs.existsSync(moodEngine)) {
    const code = fs.readFileSync(moodEngine, 'utf8');
    checkSyntax('mood-engine.js', code);
    checkEs5('mood-engine.js', code);
}

// ── Итог ─────────────────────────────────────────────────────────────────
if (failed) {
    console.error('\nCI-проверка провалена. Деплой остановлен.');
    process.exit(1);
} else {
    console.log('\nВсе CI-проверки пройдены (' + fnFilesCountSafe() + ' функций + клиентский код).');
    process.exit(0);
}

function fnFilesCountSafe() {
    try {
        return fs.readdirSync(fnDir).filter(function (f) { return f.endsWith('.js'); }).length;
    } catch (e) {
        return '?';
    }
}
