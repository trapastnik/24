/* МТК-24 · каталог медиа-врезок + настраиваемая тонировка.
 * Клипы нарезаны из «Октября» Эйзенштейна (1927), отданы ЧИСТЫМ ч/б (grayscale).
 * Цвет НЕ запечён в файл — накладывается слоем поверх видео и крутится в рантайме
 * (по образцу объекта WATER / applyWaterSettings из scene.js).
 *
 * Подключение (как data/models.js): <script src="assets/footage/footage.js"></script>
 * ДО модуля scene.js → доступно как window.MTK24_FOOTAGE и window.applyFootageTint.
 *
 * Разметка одного клипа (см. preview.html, CSS там же):
 *   <div class="mtk-footage"><video src="…webm" autoplay muted loop playsinline></video></div>
 *   applyFootageTint(divEl, 'vrkRed');           // пресет
 *   applyFootageTint(divEl, {shadow:'#1a0000', highlight:'#ff4326', strength:.9});  // вручную
 */
window.MTK24_FOOTAGE = {
  dir: 'assets/footage/',

  // ── Тонировка: дуотон-слой поверх grayscale. strength=0 → чистое ч/б. ─────────
  tint: {
    default: 'vrkRed',
    presets: {
      mono:     { label: 'Ч/б (нейтрально)',      shadow: '#000000', highlight: '#ffffff', strength: 0.00, brightness: 1.00, contrast: 1.00 },
      vrkRed:   { label: 'ВРК · красный',         shadow: '#1a0000', highlight: '#ff4326', strength: 0.90, brightness: 1.05, contrast: 1.08 },
      vrkAmber: { label: 'ВРК · жёлтый (звёзды)', shadow: '#160f00', highlight: '#ffc233', strength: 0.85, brightness: 1.05, contrast: 1.06 },
      gov:      { label: 'Временные · графит',    shadow: '#05060a', highlight: '#c8ccd6', strength: 0.80, brightness: 1.00, contrast: 1.10 },
      night:    { label: 'Ночь · холод',          shadow: '#00040c', highlight: '#9fc0ff', strength: 0.65, brightness: 1.10, contrast: 1.05 },
    },
  },

  // ── Клипы. kind: insert = врезка к кадру, loop = атмосферный фон-петля. ───────
  clips: [
    { id: 'aurora_neva',     file: 'aurora_neva.webm',     dur: 4.0,  kind: 'insert', scene: 'Кадр 8',     title: 'Аврора / корабли на Неве',          tint: 'vrkRed'   },
    { id: 'bridge_raising',  file: 'bridge_raising.webm',  dur: 9.0,  kind: 'insert', scene: 'Кадр 2',     title: 'Разводка моста',                    tint: 'vrkRed'   },
    { id: 'map_petrograd',   file: 'map_petrograd.webm',   dur: 4.5,  kind: 'insert', scene: 'Кадр 5',     title: 'Историческая карта Петрограда',     tint: 'vrkAmber' },
    { id: 'proclamation',    file: 'proclamation.webm',    dur: 4.5,  kind: 'insert', scene: 'Кадр 6',     title: 'Воззвание «К гражданам России»',    tint: 'vrkAmber' },
    { id: 'gate_eagle',      file: 'gate_eagle.webm',      dur: 7.0,  kind: 'insert', scene: 'Кадр 9',     title: 'Штурм ворот Зимнего',               tint: 'vrkRed'   },
    { id: 'staircase_storm', file: 'staircase_storm.webm', dur: 8.0,  kind: 'insert', scene: 'Кадр 9',     title: 'Толпа по парадной лестнице',        tint: 'vrkRed'   },
    { id: 'smolny_congress', file: 'smolny_congress.webm', dur: 7.0,  kind: 'insert', scene: 'Финал',      title: 'Смольный: делегаты / охрана',       tint: 'vrkRed'   },
    { id: 'winter_roofline', file: 'winter_roofline.webm', dur: 9.0,  kind: 'insert', scene: 'Вступление', title: 'Крыша Зимнего, статуи на фоне неба', tint: 'gov'     },
    { id: 'night_square',    file: 'night_square.webm',    dur: 12.0, kind: 'loop',   scene: 'Кадр 7',     title: 'Дворцовая ночью: огни / толпа',     tint: 'night'    },
    { id: 'storm_smoke',     file: 'storm_smoke.webm',     dur: 12.0, kind: 'loop',   scene: 'Кадр 9',     title: 'Штурм: дым и толпа',                tint: 'vrkRed'   },
  ],
};

/* Наложить тонировку на контейнер .mtk-footage.
 * preset — имя пресета ('vrkRed') или объект {shadow,highlight,strength,brightness,contrast}.
 * Любое поле можно опустить — возьмётся из текущего/пресета. */
window.applyFootageTint = function (el, preset) {
  if (!el) return;
  var F = window.MTK24_FOOTAGE.tint;
  var P = (typeof preset === 'string') ? F.presets[preset] : preset;
  if (!P) P = F.presets[F.default];
  var set = function (k, v) { if (v !== undefined && v !== null) el.style.setProperty(k, v); };
  set('--tint-shadow', P.shadow);
  set('--tint-highlight', P.highlight);
  set('--tint-strength', P.strength);
  set('--f-bright', P.brightness);
  set('--f-contrast', P.contrast);
};
