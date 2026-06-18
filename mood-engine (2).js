// mood-engine.js
// Mood Engine · демо-плеер Екатерина Донна
// Читает время суток и скорость соединения, адаптирует атмосферу
// Debug: ?mood_debug=1

(function MoodEngine() {

  // ─── Профили ──────────────────────────────────────────────────────────────

  var PROFILES = {
    night_slow: {
      label: 'ночь · тишина',
      particleDensity: 0.25,
      pulseSpeed:      0.0008,
      pulseDepth:      0.03,
      sphereColor:     '#1a1f45',
      particleOpacity: 0.35
    },
    night_fast: {
      label: 'ночь · дома',
      particleDensity: 0.35,
      pulseSpeed:      0.001,
      pulseDepth:      0.04,
      sphereColor:     '#1e2348',
      particleOpacity: 0.4
    },
    morning_slow: {
      label: 'утро · в движении',
      particleDensity: 0.55,
      pulseSpeed:      0.0015,
      pulseDepth:      0.05,
      sphereColor:     '#1f2040',
      particleOpacity: 0.55
    },
    morning_fast: {
      label: 'утро · пробуждение',
      particleDensity: 0.65,
      pulseSpeed:      0.002,
      pulseDepth:      0.06,
      sphereColor:     '#1d1f3e',
      particleOpacity: 0.65
    },
    day: {
      label: 'день · нейтрально',
      particleDensity: 1.0,
      pulseSpeed:      0.0018,
      pulseDepth:      0.05,
      sphereColor:     '#151933',
      particleOpacity: 0.7
    }
  };

  // ─── Время суток ──────────────────────────────────────────────────────────

  function getTimeSlot() {
    var h = new Date().getHours();
    if (h >= 6  && h < 11) return 'morning';
    if (h >= 11 && h < 18) return 'day';
    return 'night';
  }

  // ─── Скорость соединения ──────────────────────────────────────────────────
  // NetworkInformation API (Chrome/Android). Safari/Firefox — fallback 'fast'

  function getConnectionSpeed() {
    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return 'fast';

    var type = conn.effectiveType;
    if (type === 'slow-2g' || type === '2g' || type === '3g') return 'slow';
    if (conn.saveData) return 'slow';

    return 'fast';
  }

  // ─── Выбор профиля ────────────────────────────────────────────────────────

  function resolveProfile(timeSlot, speed) {
    if (timeSlot === 'day') return PROFILES.day;
    var key = timeSlot + '_' + speed;
    return PROFILES[key] || PROFILES.day;
  }

  // ─── Применение профиля ───────────────────────────────────────────────────
  // Пишем в window.moodConfig — canvas-loop читает каждый кадр

  function applyProfile(profile) {
    window.moodConfig = {
      particleDensity: profile.particleDensity,
      pulseSpeed:      profile.pulseSpeed,
      pulseDepth:      profile.pulseDepth,
      sphereColor:     profile.sphereColor,
      particleOpacity: profile.particleOpacity,
      profileLabel:    profile.label,
      appliedAt:       new Date().toISOString()
    };

    if (typeof window.PULSE_SPEED !== 'undefined') {
      window.PULSE_SPEED = profile.pulseSpeed;
    }
    if (typeof window.PULSE_DEPTH !== 'undefined') {
      window.PULSE_DEPTH = profile.pulseDepth;
    }

    // CSS custom properties для canvas bg
    document.documentElement.style.setProperty('--mood-sphere-color', profile.sphereColor);
    document.documentElement.style.setProperty('--mood-particle-opacity', String(profile.particleOpacity));
  }

  // ─── Debug-бейдж ──────────────────────────────────────────────────────────
  // Класс .mood-debug-badge должен быть в donna_tilda_global.css

  function showDebugBadge(profile, timeSlot, speed) {
    var badge = document.createElement('div');
    badge.className = 'mood-debug-badge';

    var h = new Date().getHours();
    var m = new Date().getMinutes();
    var mm = m < 10 ? '0' + m : String(m);
    var conn = navigator.connection;
    var effectiveType = conn ? conn.effectiveType : 'unknown';
    var saveData = conn ? conn.saveData : false;

    badge.innerHTML =
      '<div class="mood-debug-title">MOOD ENGINE</div>' +
      '<div>время: ' + h + ':' + mm + ' → ' + timeSlot + '</div>' +
      '<div>сеть: ' + effectiveType + (saveData ? ' (save-data)' : '') + ' → ' + speed + '</div>' +
      '<div>профиль: ' + profile.label + '</div>' +
      '<div class="mood-debug-detail">' +
        'density ' + profile.particleDensity + ' · pulse ' + profile.pulseSpeed +
      '</div>';

    document.body.appendChild(badge);
  }

  // ─── Breath Sync (только index.html) ──────────────────────────────────────
  // Синхронизирует пульс сферы с ритмом дыхания в блоке «Грудь»

  var BREATH_SYNC = {
    start:   742,
    end:    1108,
    fadeIn:    8,
    fadeOut:   8
  };

  var BREATH_DURATION_NORMAL = 4;
  var BREATH_DURATION_TARGET = 10;
  var SPHERE_ROTATION_NORMAL = 0.004;
  var SPHERE_ROTATION_TARGET = 0.001;

  function easeInOutSine(t) {
    return -(Math.cos(Math.PI * t) - 1) / 2;
  }

  function lerpBreath(a, b, t) {
    var clamped = Math.max(0, Math.min(1, t));
    return a + (b - a) * easeInOutSine(clamped);
  }

  function initBreathSync() {
    var audioEl = document.getElementById('mainAudio');
    if (!audioEl) return;

    var sphereWrap = document.querySelector('.sphere-wrap');
    if (!sphereWrap) return;

    var activeSync = false;

    audioEl.addEventListener('timeupdate', function () {
      var t = audioEl.currentTime;
      var bs = BREATH_SYNC;

      if (t < bs.start - bs.fadeIn || t > bs.end + bs.fadeOut) {
        if (activeSync) {
          activeSync = false;
          sphereWrap.classList.remove('breath-sync');
          document.documentElement.style.setProperty('--breath-duration', BREATH_DURATION_NORMAL + 's');
          window.moodConfig.breathSyncRotation = SPHERE_ROTATION_NORMAL;
        }
        return;
      }

      activeSync = true;
      sphereWrap.classList.add('breath-sync');

      var progress;
      if (t < bs.start) {
        progress = (t - (bs.start - bs.fadeIn)) / bs.fadeIn;
      } else if (t > bs.end) {
        progress = 1 - (t - bs.end) / bs.fadeOut;
      } else {
        progress = 1;
      }

      var duration = lerpBreath(BREATH_DURATION_NORMAL, BREATH_DURATION_TARGET, progress);
      var rotation = lerpBreath(SPHERE_ROTATION_NORMAL, SPHERE_ROTATION_TARGET, progress);

      document.documentElement.style.setProperty('--breath-duration', duration.toFixed(2) + 's');
      window.moodConfig.breathSyncRotation = rotation;
    });

    audioEl.addEventListener('pause', function () {
      if (!activeSync) return;
      sphereWrap.classList.remove('breath-sync');
      document.documentElement.style.setProperty('--breath-duration', BREATH_DURATION_NORMAL + 's');
      window.moodConfig.breathSyncRotation = SPHERE_ROTATION_NORMAL;
      activeSync = false;
    });
  }

  // ─── Pause Detection (demo.html) ─────────────────────────────────────────
  // Показывает мягкий CTA если человек остановился в «глубоком» диапазоне
  // и не вернулся в течение минуты

  function setupPauseDetection(audioElement) {
    if (!audioElement || !(audioElement instanceof HTMLAudioElement)) {
      return null;
    }

    var PAUSE_WINDOW_START = 300;
    var PAUSE_WINDOW_END = 420;
    var DELAY_MS = 60000;
    var pauseTimerId = null;

    function clearPauseTimer() {
      if (pauseTimerId !== null) {
        clearTimeout(pauseTimerId);
        pauseTimerId = null;
      }
    }

    function handlePause() {
      var currentTime = audioElement.currentTime;
      if (currentTime < PAUSE_WINDOW_START || currentTime > PAUSE_WINDOW_END) {
        return;
      }

      clearPauseTimer();
      pauseTimerId = setTimeout(function () {
        var overlay = document.querySelector('.donna-cta-overlay');
        if (overlay) overlay.classList.add('visible');
        pauseTimerId = null;
      }, DELAY_MS);
    }

    function handlePlay() {
      clearPauseTimer();
      var overlay = document.querySelector('.donna-cta-overlay');
      if (overlay && overlay.classList.contains('visible')) {
        overlay.classList.remove('visible');
      }
    }

    audioElement.addEventListener('pause', handlePause);
    audioElement.addEventListener('play', handlePlay);

    return {
      destroy: function () {
        clearPauseTimer();
        audioElement.removeEventListener('pause', handlePause);
        audioElement.removeEventListener('play', handlePlay);
      }
    };
  }

  // ─── Запуск ───────────────────────────────────────────────────────────────

  function init() {
    var timeSlot = getTimeSlot();
    var speed = getConnectionSpeed();
    var profile = resolveProfile(timeSlot, speed);

    applyProfile(profile);

    var params = new URLSearchParams(window.location.search);

    // Debug-бейдж
    if (params.has('mood_debug')) {
      if (document.body) {
        showDebugBadge(profile, timeSlot, speed);
      } else {
        document.addEventListener('DOMContentLoaded', function () {
          showDebugBadge(profile, timeSlot, speed);
        });
      }
    }
  }

  // Запускаем до DOMContentLoaded — canvas читает moodConfig при инициализации
  init();

  // BreathSync (index.html) — нужен DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBreathSync);
  } else {
    initBreathSync();
  }

  // Экспортируем setupPauseDetection — demo.html вызывает при инициализации плеера
  window.setupPauseDetection = setupPauseDetection;

})();
