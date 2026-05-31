#!/usr/bin/env bash
# МТК-24 — сборка PNG-кадров оффлайн-рендера (render/<run>/frame_*.png) в mp4.
#
# Кадры пишет браузер: в ролике нажми R (текущий кадр) или вызови из консоли
#   MTK24_render(t0, t1, { height: 2160 })
# затем собери:
#   tools/render_mp4.sh <run> [fps] [crf]
#     <run> — имя папки в render/ (или путь к ней). По умолчанию: самый свежий рендер.
#     fps   — кадров/с (по умолчанию 30).
#     crf   — качество H.264, меньше = лучше (0 = без потерь; по умолчанию 12 — почти без потерь).
# Для максимального качества/монтажа можно ProRes:
#   tools/render_mp4.sh <run> 30 prores
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="${1:-}"; FPS="${2:-30}"; CRF="${3:-12}"

# по умолчанию — последняя папка рендера
if [ -z "$RUN" ]; then
  RUN="$(ls -dt "$ROOT"/render/*/ 2>/dev/null | head -1 || true)"
  [ -z "$RUN" ] && { echo "Нет рендеров в render/ — сначала отрендерь кадры (клавиша R)."; exit 1; }
fi
# принять и имя папки, и путь
[ -d "$ROOT/render/$RUN" ] && SRC="$ROOT/render/$RUN" || SRC="${RUN%/}"
NAME="$(basename "$SRC")"
OUT="$ROOT/render/$NAME.mp4"

# авто-определение расширения кадров (jpg / png)
EXT="$(ls "$SRC" 2>/dev/null | grep -oE 'frame_[0-9]+\.(png|jpg|jpeg)$' | head -1 | sed 's/.*\.//')"
[ -z "$EXT" ] && { echo "В $SRC нет кадров frame_*.png|jpg"; exit 1; }
IN="$SRC/frame_%05d.$EXT"

# чётные размеры на всякий случай (yuv420p)
EVEN='scale=trunc(iw/2)*2:trunc(ih/2)*2'

if [ "$CRF" = "prores" ]; then
  ffmpeg -y -framerate "$FPS" -i "$IN" \
    -c:v prores_ks -profile:v 3 -pix_fmt yuv422p10le -vf "$EVEN" "${OUT%.mp4}.mov"
  echo "→ render/$NAME.mov (ProRes 422 HQ, из .$EXT)"
else
  ffmpeg -y -framerate "$FPS" -i "$IN" \
    -c:v libx264 -crf "$CRF" -pix_fmt yuv420p -vf "$EVEN" "$OUT"
  echo "→ render/$NAME.mp4  (H.264 crf=$CRF, ${FPS} fps, из .$EXT)"
fi
