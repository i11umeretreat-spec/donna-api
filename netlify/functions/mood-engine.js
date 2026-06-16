/**
 * Mood Engine · demo.html
 * The Lineup / Ekaterina Donnat
 *
 * Читает два сигнала: время суток и скорость соединения.
 * Незаметно меняет атмосферу плеера.
 * Debug-режим: ?mood_debug=1 — показывает бейдж в углу.
 */

(function MoodEngine() {

  // ─── Профили ──────────────────────────────────────────────────────────────

  const PROFILES = {
    // Ночь + медленный → максимальная тишина
    night_slow: {
      label: 'ночь · тишина',
      particleDensity: 0.25,   // доля от базового количества частиц
      pulseSpeed:      0.0008, // угловая скорость дыхания сферы
      pulseDepth:      0.03,   // амплитуда пульса (радиус ±%)
      sphereColor:     '#1a1f45', // глубокий индиго
      particleOpacity: 0.35,
    },
    // Ночь + быстрый
    night_fast: {
      label: 'ночь · дома',
      particleDensity: 0.35,
      pulseSpeed:      0.001,
      pulseDepth:      0.04,
      sphereColor:     '#1e2348',
      particleOpacity: 0.4,
    },
    // Утро + медленный
    morning_slow: {
      label: 'утро · в движении',
      particleDensity: 0.55,
      pulseSpeed:      0.0015,
      pulseDepth:      0.05,
      sphereColor:     '#1f2040',
      particleOpacity: 0.55,
    },
    // Утро + быстрый
    morning_fast: {
      label: 'утро · пробуждение',
      particleDensity: 0.65,
      pulseSpeed:      0.002,
      pulseDepth:      0.06,
      sphereColor:     '#1d1f3e',
      particleOpacity: 0.65,
    },
    // День (нейтральный) — базовое поведение плеера
    day: {
      label: 'день · нейтрально',
      particleDensity: 1.0,
      pulseSpeed:      0.0018,
      pulseDepth:      0.05,
      sphereColor:     '#151933',
      particleOpacity: 0.7,
    },
  };

  // ─── Определяем время суток ────────────────────────────────────────────────

  function getTimeSlot() {
    const h = new Date().getHours();
    if (h >= 6  && h < 11) return 'morning';
    if (h >= 11 && h < 18) return 'day';
    return 'night'; // 18:00 – 05:59
  }

  // ─── Определяем скорость соединения ───────────────────────────────────────
  // NetworkInformation API (Chrome/Android). На iOS и Safari недоступно —
  // fallback 'fast', чтобы не занижать атмосферу напрасно.

  function getConnectionSpeed() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return 'fast'; // Safari / Firefox — не знаем, считаем домом

    const slowTypes = ['slow-2g', '2g'];
    const medTypes  = ['3g'];

    if (slowTypes.includes(conn.effectiveType)) return 'slow';
    if (medTypes.includes(conn.effectiveType))  return 'slow'; // 3G тоже "медленный" в нашей логике
    if (conn.saveData) return 'slow'; // режим экономии трафика = в дороге

    return 'fast';
  }

  // ─── Выбираем профиль ─────────────────────────────────────────────────────

  function resolveProfile(timeSlot, speed) {
    if (timeSlot === 'day') return PROFILES.day;
    return PROFILES[`${timeSlot}_${speed}`] || PROFILES.day;
  }

  // ─── Применяем профиль ────────────────────────────────────────────────────
  // Функция мягко адаптирует переменные которые canvas-loop читает каждый кадр.
  // Предполагаем что в demo.html есть глобальные:
  //   window.moodConfig — объект который canvas читает (мы его и создаём)
  //   window.PARTICLE_BASE_COUNT — исходное количество частиц (опционально)

  function applyProfile(profile) {
    // Создаём или обновляем глобальный конфиг
    window.moodConfig = {
      particleDensity: profile.particleDensity,
      pulseSpeed:      profile.pulseSpeed,
      pulseDepth:      profile.pulseDepth,
      sphereColor:     profile.sphereColor,
      particleOpacity: profile.particleOpacity,
      profileLabel:    profile.label,
      appliedAt:       new Date().toISOString(),
    };

    // Если canvas уже запущен — пробуем подтолкнуть параметры напрямую.
    // Эти имена переменных нужно уточнить под реальный код demo.html.
    if (typeof window.PULSE_SPEED !== 'undefined') {
      window.PULSE_SPEED = profile.pulseSpeed;
    }
    if (typeof window.PULSE_DEPTH !== 'undefined') {
      window.PULSE_DEPTH = profile.pulseDepth;
    }

    // CSS custom property для фонового цвета (canvas bg / body)
    document.documentElement.style.setProperty('--mood-sphere-color', profile.sphereColor);
    document.documentElement.style.setProperty('--mood-particle-opacity', profile.particleOpacity);
  }

  // ─── Debug-бейдж ──────────────────────────────────────────────────────────

  function showDebugBadge(profile, timeSlot, speed) {
    const badge = document.createElement('div');
    badge.id = 'mood-debug-badge';
    badge.style.cssText = `
      position: fixed;
      bottom: 16px;
      left: 16px;
      z-index: 9999;
      background: rgba(21, 25, 51, 0.85);
      border: 1px solid #d4af37;
      border-radius: 8px;
      padding: 10px 14px;
      font-family: 'DM Mono', monospace;
      font-size: 11px;
      color: rgba(248, 250, 252, 0.7);
      line-height: 1.7;
      backdrop-filter: blur(8px);
      pointer-events: none;
      max-width: 220px;
    `;

    const h = new Date().getHours();
    const conn = navigator.connection;
    const effectiveType = conn ? conn.effectiveType : 'unknown';
    const saveData = conn ? conn.saveData : false;

    badge.innerHTML = `
      <div style="color:#d4af37;font-size:10px;letter-spacing:0.08em;margin-bottom:4px;">MOOD ENGINE</div>
      <div>время: ${h}:${String(new Date().getMinutes()).padStart(2,'0')} → ${timeSlot}</div>
      <div>сеть: ${effectiveType}${saveData ? ' (save-data)' : ''} → ${speed}</div>
      <div>профиль: ${profile.label}</div>
      <div style="margin-top:4px;color:rgba(248,250,252,0.4);font-size:10px;">
        density ${profile.particleDensity} · pulse ${profile.pulseSpeed}
      </div>
    `;

    document.body.appendChild(badge);
  }

  // ─── Логируем в Supabase (для анализа через неделю) ──────────────────────
  // Пишем только агрегированные данные: профиль, час, utm_source.
  // Никаких персональных данных.

  function logToSupabase(profile, timeSlot, speed) {
    const params = new URLSearchParams(window.location.search);
    const utmSource = params.get('utm_source') || 'direct';

    // Используем существующую функцию save-progress или шлём напрямую.
    // Если функции нет — тихо пропускаем, не ломаем плеер.
    try {
      fetch('/.netlify/functions/save-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event:       'mood_engine_applied',
          profile:     profile.label,
          time_slot:   timeSlot,
          speed:       speed,
          hour:        new Date().getHours(),
          utm_source:  utmSource,
          user_agent:  navigator.userAgent.substring(0, 80), // не полный, только тип устройства
        }),
      }).catch(() => {}); // тихий fail, плеер не знает
    } catch (e) {
      // совсем тихо
    }
  }

  // ─── Запуск ───────────────────────────────────────────────────────────────

  function init() {
    const timeSlot = getTimeSlot();
    const speed    = getConnectionSpeed();
    const profile  = resolveProfile(timeSlot, speed);

    applyProfile(profile);

    const isDebug = new URLSearchParams(window.location.search).has('mood_debug');
    if (isDebug) {
      // Бейдж вешаем после того как DOM готов
      if (document.body) {
        showDebugBadge(profile, timeSlot, speed);
      } else {
        document.addEventListener('DOMContentLoaded', () =>
          showDebugBadge(profile, timeSlot, speed)
        );
      }
    }

    // Логируем в фоне (не блокируем загрузку)
    setTimeout(() => logToSupabase(profile, timeSlot, speed), 2000);
  }

  // Запускаем сразу — до DOMContentLoaded,
  // чтобы canvas мог прочитать moodConfig при инициализации
  init();

})();
