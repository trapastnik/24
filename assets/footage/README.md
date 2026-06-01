# assets/footage — медиа-врезки из «Октября» (Эйзенштейн, 1927)

Лёгкие ч/б клипы (webm VP9, без звука) для оформления видео-проекции МТК-24:
**врезки** к кадрам сценария и **фоновые петли**. Тонировка в файл НЕ запекается —
цвет накладывается слоем-настройкой в рантайме (как объект `WATER` в сцене).

## Файлы
- `*.webm` — сами клипы (нейтральный grayscale).
- `footage.js` — каталог (`window.MTK24_FOOTAGE`) + `applyFootageTint()` и пресеты палитры.
- `footage-fx.js` — встройка в основную сцену: контроллер `FootageFX` (init/beginShot/
  update/neva/walls/insert/background) + строители `buildWalls`/`buildNeva`. См. `HANDOFF.md`.
- `HANDOFF.md` — как подключить футидж в `scene.js`/`scenario.js` (рабочий чат).
- `preview.html` — стенд: все клипы + живые регуляторы тонировки.
- `usage.html` — мокап применения на карте: фон (подложка/виньетка/Нева/заставка),
  врезки (уголок/плашка/лайтбокс/маркер/триптих) и окружение
  (видео-стены по дальним граням сцены, П- или Г-образно; карта — «пол»).
- инструмент нарезки: `../../tools/cut_footage.sh`.
- ⚠️ исходный фильм лежит в `IN/` и в git НЕ идёт (см. `.gitignore`).

## Смотреть локально
```
python3 -m http.server 8126           # из корня репо
# → http://localhost:8126/assets/footage/preview.html   (тонировка)
# → http://localhost:8126/assets/footage/usage.html     (применение на карте)
```

## Как добавить клип
1. Найти таймкод в фильме (контактные листы — см. шапку `tools/cut_footage.sh`).
2. Нарезать:
   - разово: `bash tools/cut_footage.sh add НАЗВАНИЕ СЕКУНДА ДЛИТЕЛЬНОСТЬ`
   - либо дописать строку в массив `CLIPS` и `bash tools/cut_footage.sh НАЗВАНИЕ`.
3. Добавить запись в `footage.js` (`id/file/dur/kind/scene/title/tint`).

Это может делать и ассистент (находит сцену по контактным листам и режет), и ты сам
командой `add` с готовым таймкодом.

## Тонировка в сцене
```html
<div class="mtk-footage"><video src="assets/footage/aurora_neva.webm" autoplay muted loop playsinline></video></div>
```
```js
applyFootageTint(el, 'vrkRed');                              // пресет
applyFootageTint(el, { highlight:'#ff4326', strength:0.7 }); // вручную
```
CSS дуотон-слоёв (`.mtk-footage::before/::after`) — см. `preview.html`.
