// netlify/functions/_tracks.js
// Единый источник правды о треках.
// Импортируется в verify-token.js и get-download-url.js.
// При добавлении нового трека — только сюда.

const TRACKS = {
    'track-01': { file: 'release/money_freedom.mp3',      title: 'Освобождение от денежных ограничений', type: 'Сессия самогипноза' },
    'track-02': { file: 'release/negative_cleansing.mp3', title: 'Очищение от негативных программ',       type: 'Сеанс самогипноза',            duration: '51:12' },
    'track-03': { file: 'release/be_yourself.mp3',        title: 'Роскошь быть собой',                   type: 'Женская практика',              duration: '24:41' },
    'track-04': { file: 'release/true_confidence.mp3',    title: 'Укрепление уверенности',               type: 'Мягкие нейрокорректоры',        duration: '29:57' },
    'track-05': { file: 'release/happiness_creator.mp3',  title: 'Творец своего счастья',                type: 'Сеанс самогипноза',             duration: '27:20' },
    'track-06': { file: 'release/stop_fighting.mp3',      title: 'Против апатии и прокрастинации',       type: 'Гипномедитация',                duration: '32:41' },
    'track-07': { file: 'release/body_reboot.mp3',        title: 'Перезапуск здоровья и молодости',      type: 'Сеанс самогипноза',             duration: '34:24' },
    'track-08': { file: 'release/personal_boundaries.mp3',title: 'Личные границы',                       type: 'Гипномедитация',                duration: '25:04' },
    'track-09': { file: 'release/Shults_2.mp3',           title: 'Расслабление по Шульцу',               type: 'Самогипноз',                    duration: '40:32' },
    'track-10': { file: 'release/crock.mp3',              title: 'Крокодил: обнуление тревоги',          type: 'Метафорический сеанс гипноза' },
    'track-11': { file: 'release/immune_booster.mp3',     title: 'Иммунный бустер',                      type: 'Аудиопрактика' },
    'track-12': { file: 'release/weight_release.mp3',     title: 'Сеанс самогипноза, снижение веса',     type: 'Глубинная перестройка' },
    'track-13': { file: 'release/three_totems.mp3',       title: 'Три Тотема',                           type: 'Ресурсный транс' },
    'track-14': { file: 'release/goals.mp3',               title: 'Достижение целей',                     type: 'Активация целевого мышления' },
    'track-15': { file: 'release/unlock_emotions.mp3',     title: 'Разблокировка целей и эмоций',         type: 'Эмоциональная разблокировка' },
    'track-16': { file: 'release/inner_child.mp3',         title: 'Исцеление внутреннего ребёнка',        type: 'Работа с внутренним ребёнком' },
};

module.exports = { TRACKS };
