# Встройка медиа-врезок в основную сцену — HANDOFF

Всё готовое лежит в `assets/footage/` (зона медиа-чата). Сцену (`scene.js`/`index.html`)
правит рабочий чат — здесь точная инструкция, что подключить (минимум строк).

Управление футиджем встаёт в **существующий механизм fx**: у кадра в `data/scenario.js`
уже есть массив `fx: [{type, …, at}]`, а `scene.js` разворачивает его через реестр
`FX_BUILD[f.type]` (≈ строка 820). Добавляем туда новые типы — они зовут модуль
`assets/footage/footage-fx.js`.

## 1. Подключить модуль и контроллер (один раз)

`footage.js` уже грузится в `index.html` как `<script>` (каталог + пресеты тона).
Добавить инициализацию контроллера в `scene.js`:

```js
import { FootageFX } from "./assets/footage/footage-fx.js";

// overlay — DOM-слой ПОВЕРХ канваса для врезок (уголок/лайтбокс/фон). Можно HUD-контейнер.
FootageFX.init({
  scene, camera, renderer,
  dom:   document.getElementById("fx-overlay"),   // любой absolute-контейнер над канвасом
  dir:   "assets/footage/",                        // префикс к файлам клипов
  world: { PW, PD, uvToWorld },                    // ИЗ scene.js — чтобы вода/стены легли пиксель-в-пиксель
  waterData,                                       // уже загруженный petrograd_water_map.json (иначе модуль сам fetch-нет)
});

// зарегистрировать типы fx → методы контроллера
["neva","walls","insert","background"].forEach(t => { FX_BUILD[t] = f => FootageFX[t](f); });
```

В жизненном цикле кадра:
```js
function applyShot(i){ FootageFX.beginShot(); /* …существующее… buildFx(s) */ }  // снимает футидж прошлого кадра
function frame(){      FootageFX.update(animT);  /* в общем цикле, для ряби воды */ }
```
(`world`/`waterData` опциональны: без них модуль берёт свои константы и сам грузит
русло — но для точного совпадения с картой лучше передать из сцены.)

## 2. Вставлять и настраивать — в `fx` кадра (data/scenario.js)

Как `telegrams`/`wave`/`ring`/`flood`, только новые типы:

```js
// Кадр 8 «Аврора» — видео рябит на воде Невы:
fx: [{ type:"neva",  clip:"aurora_neva", tint:"vrkRed", at:0.1 }]

// Кадр 9 «Зимний взят» — горящий город (инверсия маски: видео на суше):
fx: [{ type:"neva",  invert:true, clip:"storm_smoke", tint:"vrkRed" }]

// Кадр 2 «Мосты» — документальная врезка в углу:
fx: [{ type:"insert", clip:"bridge_raising", style:"corner", tint:"vrkRed", at:0.2 }]
//   style: "corner" | "lightbox"

// Вступление — заставка/подложка-текстура:
fx: [{ type:"background", clip:"winter_roofline", mode:"texture", tint:"gov", opacity:0.22 }]
//   mode: "texture" (под картой) | "intro"

// окружение видео-стенами:
fx: [{ type:"walls", sides:3, clips:["storm_smoke","gate_eagle","staircase_storm"], tint:"vrkRed" }]
```

Поля-настройки: `clip` (id из footage.js или имя файла), `tint` (имя пресета или объект),
`invert`, `opacity`, `sides`, `style`, `mode`, `at` (момент появления, 0..1 внутри кадра).

## 3. Тонировка

Пресеты — в `footage.js` (`MTK24_FOOTAGE.tint.presets`): `mono`, `vrkRed`, `vrkAmber`,
`gov`, `night`. Живая смена: `FootageFX.setTint("night")`. Тон **не запечён** в клипы —
накладывается слоем/шейдером, поэтому крутится в рантайме.

## Что отдаёт `footage-fx.js`
- `FootageFX` — контроллер: `init`, `beginShot`, `update`, `clear`, `setTint`,
  методы-эффекты `neva` / `walls` / `insert` / `background`.
- `buildWalls(scene, opts)`, `buildNeva(scene, opts)` — строители 3D-контента
  (видео-стены; вода/суша Невы на риппл-шейдере), те же, что использует демо `usage.html`.

## Проверка/витрина
`assets/footage/usage.html` (превью-сервер `python3 -m http.server`, см. README) —
все варианты вживую со свободной орбитой; использует те же строители.
