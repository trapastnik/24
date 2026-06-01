#!/usr/bin/env bash
# МТК-24 · нарезка медиа-врезок из фильма «Октябрь» (Эйзенштейн, 1927) → assets/footage/.
# Источник тяжёлый и в .gitignore — лежит локально в IN/, в git НЕ идёт.
# Клипы: ч/б (grayscale), без звука, лёгкая чистка контраста, web VP9 (webm).
# ТОНИРОВКА В ФАЙЛ НЕ ЗАПЕКАЕТСЯ — отдаём нейтральный grayscale, цвет под кадр
# накладывается слоем-настройкой в сцене (см. assets/footage/footage.js).
#
# РЕЖИМЫ:
#   bash tools/cut_footage.sh                 # пересобрать ВСЕ клипы из списка CLIPS ниже
#   bash tools/cut_footage.sh aurora_neva     # пересобрать один клип из списка
#   bash tools/cut_footage.sh add NAME SS DUR # разовая нарезка БЕЗ правки списка
#         пример:  bash tools/cut_footage.sh add telegraph 2954 6
#
# КАК ДОБАВИТЬ КЛИП НАВСЕГДА (3 шага):
#   1) найти таймкод в фильме (контактные листы: см. ниже SHEET) или режимом `add`;
#   2) дописать строку в массив CLIPS ниже  →  bash tools/cut_footage.sh NAME;
#   3) добавить запись в каталог assets/footage/footage.js (id/file/scene/title/tint).
#
# ПОИСК СЦЕН — контактный лист с таймкодами по позиции ячейки (drawtext в этой
# сборке ffmpeg отсутствует, поэтому время = индекс_ячейки * шаг):
#   ffmpeg -skip_frame nokey -i "$SRC" -vf "fps=1/45,scale=200:-1,tile=8x10" -frames:v 2 sheet_%02d.jpg
set -euo pipefail
cd "$(dirname "$0")/.."                              # → корень репо
SRC="IN/1927._Октябрь_(Эйзенштейн).webm.480p.vp9.webm"
OUT="assets/footage"
mkdir -p "$OUT"
[ -f "$SRC" ] || { echo "НЕТ ИСХОДНИКА: $SRC (положи фильм в IN/)"; exit 1; }

# name              ss        dur   (кадр/назначение в комментарии)
CLIPS=(
  "aurora_neva       3036.0    4.0"   # Кадр 8 — Аврора/корабли на Неве
  "bridge_raising    1099      9.0"   # Кадр 2 — разводка моста
  "map_petrograd     3010.5    4.5"   # Кадр 5 — историческая карта Петрограда
  "proclamation      4001      4.5"   # Кадр 6 — воззвание «К гражданам России»
  "gate_eagle        6197      7.0"   # Кадр 9 — штурм ворот Зимнего (орёл)
  "staircase_storm   6249      8.0"   # Кадр 9 — толпа по парадной лестнице
  "smolny_congress   3908      7.0"   # Финал — Смольный, делегаты в коридорах
  "winter_roofline   5260      9.0"   # Вступление — крыша Зимнего, статуи
  "night_square      6100     12.0"   # фон — Дворцовая ночью, огни/толпа
  "storm_smoke       6160     12.0"   # фон — штурм: дым и толпа
)

# Чистый ч/б + мягкая нормализация под проекцию. Цвет НЕ трогаем (s=0).
VF="eq=contrast=1.10:brightness=0.012,hue=s=0,format=yuv420p"
ENC=(-c:v libvpx-vp9 -b:v 0 -crf 34 -row-mt 1 -cpu-used 2 -deadline good -an)

one() {
  local name="$1" ss="$2" dur="$3"
  echo "→ $name  (ss=$ss dur=$dur)"
  ffmpeg -y -loglevel error -ss "$ss" -t "$dur" -i "$SRC" \
    -vf "$VF" "${ENC[@]}" "$OUT/$name.webm"
  printf '   %s  %s\n' "$(du -h "$OUT/$name.webm" | cut -f1)" "$OUT/$name.webm"
}

# Режим разовой нарезки: cut_footage.sh add NAME SS DUR
if [ "${1:-}" = "add" ]; then
  [ $# -eq 4 ] || { echo "usage: cut_footage.sh add NAME SS DUR"; exit 1; }
  one "$2" "$3" "$4"; echo "Готово. Не забудь добавить запись в assets/footage/footage.js"; exit 0
fi

FILTER="${1:-}"
for row in "${CLIPS[@]}"; do
  read -r name ss dur <<<"$row"
  [ -n "$FILTER" ] && [ "$FILTER" != "$name" ] && continue
  one "$name" "$ss" "$dur"
done
echo "Готово."
