// МТК-24 — генератор дикторской озвучки ГЗК (build-time, на маке).
// Берёт voFull каждого кадра из data/scenario.js, начитывает голосом Milena,
// конвертит в assets/audio/vo_NN.mp3. Прод НЕ зависит от мака — играет готовые mp3.
//
// Запуск:  node tools/make_vo.mjs [rate]        # rate — слов/мин (по умолчанию 178)
// Требует: macOS `say` (голос Milena), ffmpeg, ffprobe.
//
// ВАЖНО: это единственное место, где нужен мак. Сгенерированные mp3 коммитятся и
// отдаются сервером статикой (как wind/boom/crowd.mp3) → ГЗК работает на любом компе.
// НЕ использовать window.speechSynthesis в проде (зависит от голосов компа-зрителя).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const RATE = +(process.argv[2] || 178);
const VOICE = "Milena";
const OUT_DIR = "assets/audio";

// загрузить scenario.js с window-шимом
const src = readFileSync("data/scenario.js", "utf8");
const win = {};
new Function("window", src)(win);
const SCN = win.MTK24_SCENARIO;
if (!SCN || !SCN.shots) { console.error("Не нашёл MTK24_SCENARIO.shots"); process.exit(1); }

mkdirSync(OUT_DIR, { recursive: true });
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"] });

console.log(`МТК24 · озвучка ГЗК · голос ${VOICE} · темп ${RATE} сл/мин\n`);
let i = 0, totalVo = 0;
const rows = [];
for (const s of SCN.shots) {
  if (!s.voFull) continue;
  i++;
  const nn = String(i).padStart(2, "0");
  const txt = `/tmp/vo_${nn}.txt`, aiff = `/tmp/vo_${nn}.aiff`, mp3 = `${OUT_DIR}/vo_${nn}.mp3`;
  writeFileSync(txt, s.voFull, "utf8");
  sh("say", ["-v", VOICE, "-r", String(RATE), "-f", txt, "-o", aiff]);
  sh("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-c:a", "libmp3lame", "-b:a", "96k", "-ac", "1", mp3]);
  const dur = +sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", mp3]).toString().trim();
  const win = s.t1 - s.t0;
  totalVo += dur;
  rows.push({ nn, id: s.id, t0: s.t0, win, dur });
  const over = dur - win;
  console.log(`vo_${nn}  [${s.id.padEnd(13)}] t0=${String(s.t0).padStart(3)}  окно=${String(win).padStart(3)}с  озвучка=${dur.toFixed(1).padStart(5)}с  ${over > 0.3 ? "⚠️  +" + over.toFixed(1) + "с" : "ok"}`);
}
console.log(`\nИтого озвучки: ${totalVo.toFixed(1)}с · хронометраж ролика: ${SCN.duration}с` +
  (totalVo > SCN.duration ? `  ⚠️ озвучка длиннее на ${(totalVo - SCN.duration).toFixed(1)}с` : ""));
console.log(`Файлы: ${OUT_DIR}/vo_01..${String(i).padStart(2, "0")}.mp3`);
