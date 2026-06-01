/* МТК №24 — звуковой слой (WebAudio).
 *
 * РЕЖИМ СЭМПЛОВ: грузит реальные аудиофайлы из assets/audio/ (петли + one-shot).
 * Если файла нет — мягкий откат на синтез (чтобы звук был всегда). Положи свои
 * royalty-free файлы с этими именами — заиграют сразу:
 *   assets/audio/wind.mp3       — петля: ветер/атмосфера (база)
 *   assets/audio/crowd.mp3      — петля: дальний гул толпы (громче в массовых кадрах)
 *   assets/audio/drone.mp3      — петля: низкая тревожная подложка (опц.)
 *   assets/audio/boom.mp3       — one-shot: холостой выстрел «Авроры»
 *   assets/audio/telegraph.mp3  — one-shot: щелчок телеграфа
 * Формат — mp3/m4a/wav (Safari не всегда играет ogg). Финальное видео получит
 * отдельно сведённую дорожку (см. VIDEO-PLAN.md).
 *
 * Старт только по ПЕРВОМУ ЖЕСТУ (autoplay-политика). API вызывает scene.js:
 *   resume() · setPlaying(bool) · setNight(0..1) · shot(i,shotObj) · fx(type)
 */
(function () {
  // тихий режим: ?noaudio в URL — звук не инициализируется (для headless-превью/автоматизации,
  // чтобы не гудеть в системные динамики). В обычном ролике (без параметра) звук работает.
  if (new URLSearchParams(location.search).has("noaudio")) return;
  const FILES = {
    wind: "./assets/audio/wind.mp3", crowd: "./assets/audio/crowd.mp3", drone: "./assets/audio/drone.mp3",
    boom: "./assets/audio/boom.mp3", telegraph: "./assets/audio/telegraph.mp3",
    footsteps: "./assets/audio/footsteps.mp3",        // петля: шаги Ленина на маршруте к Смольному
  };
  let ctx = null, master = null, bedBus = null, started = false, playing = true, night = 0;
  let windGain = null, crowdGain = null, radioSrc = null, stepsSrc = null;
  let voSrc = null, voGain = null, voToken = 0;     // дикторская озвучка ГЗК (текущий кадр)
  let vol = 0.85, bedVol = 1, voEnabled = true, voDucked = false;   // громкости (вкладка «Звук»)
  const buf = {};                                   // декодированные сэмплы (или undefined → синтез)
  const VO_COUNT = 11;                              // assets/audio/vo_01..11.mp3 — ГЗК по кадрам (build-time say-Milena)
  const voBuf = [];                                 // декодированная озвучка по индексу кадра
  const DUCK = 0.32;                                // во сколько приглушаем фон под голос
  const fileState = {};                             // ключ сэмпла → 'wait'|'ok'|'miss' (для панели статуса звука)
  let samplesDone = false, voDone = false;          // флаги завершения загрузки (диагностика задержки звука)

  function noiseBuffer(sec) {
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate);
    const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b;
  }
  function loopBuf(b, g, dest) { const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; const gn = ctx.createGain(); gn.gain.value = g; s.connect(gn); gn.connect(dest || master); s.start(); return gn; }
  function playBuf(b, g) { const s = ctx.createBufferSource(); s.buffer = b; const gn = ctx.createGain(); gn.gain.value = g == null ? 1 : g; s.connect(gn); gn.connect(master); s.start(); }

  async function loadSamples() {
    Object.keys(FILES).forEach((k) => { fileState[k] = "wait"; });
    await Promise.all(Object.entries(FILES).map(async ([k, url]) => {
      try { const r = await fetch(url); if (!r.ok) { fileState[k] = "miss"; return; } buf[k] = await ctx.decodeAudioData(await r.arrayBuffer()); fileState[k] = "ok"; }
      catch (e) { fileState[k] = "miss"; /* нет файла → синтез-фолбэк */ }
    }));
    samplesDone = true;
    await loadVo();
  }
  async function loadVo() {                          // дикторская озвучка ГЗК по кадрам (с обходом кэша — после перегенерации)
    if (!ctx) return;
    voDone = false;
    const bust = "?v=" + Date.now();
    await Promise.all(Array.from({ length: VO_COUNT }, (_, i) => i).map(async (i) => {
      const nn = String(i + 1).padStart(2, "0");
      try { const r = await fetch(`./assets/audio/vo_${nn}.mp3` + bust); if (!r.ok) return; voBuf[i] = await ctx.decodeAudioData(await r.arrayBuffer()); }
      catch (e) { /* нет файла → кадр без озвучки */ }
    }));
    voDone = true;
  }

  // ---- синтез-фолбэки (если сэмпла нет) ----
  function synthWind() {
    const wn = ctx.createBufferSource(); wn.buffer = noiseBuffer(6); wn.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 130;
    const g = ctx.createGain(); g.gain.value = 0.05; wn.connect(lp); lp.connect(g); g.connect(bedBus || master); wn.start();
    const wlfo = ctx.createOscillator(); wlfo.frequency.value = 0.08; const wlg = ctx.createGain(); wlg.gain.value = 0.035; wlfo.connect(wlg); wlg.connect(g.gain); wlfo.start();
    const flfo = ctx.createOscillator(); flfo.frequency.value = 0.05; const flg = ctx.createGain(); flg.gain.value = 55; flfo.connect(flg); flg.connect(lp.frequency); flfo.start();
    return g;
  }
  function synthDrone() {
    [[55, 0.06], [82.4, 0.042], [110.5, 0.028]].forEach(([f, base], i) => {
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = base;
      const lo = ctx.createOscillator(); lo.frequency.value = 0.04 + 0.02 * i; const lg = ctx.createGain(); lg.gain.value = base * 0.5; lo.connect(lg); lg.connect(g.gain); lo.start();
      o.connect(g); g.connect(bedBus || master); o.start();
    });
  }
  function synthCrowd() { const cn = ctx.createBufferSource(); cn.buffer = noiseBuffer(6); cn.loop = true; const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 500; bp.Q.value = 0.8; const g = ctx.createGain(); g.gain.value = 0.012; cn.connect(bp); bp.connect(g); g.connect(bedBus || master); cn.start(); return g; }
  function synthBoom() {
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.7);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1.0, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 1.7);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.8);
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(0.6); const nf = ctx.createBiquadFilter(); nf.type = "lowpass"; nf.frequency.value = 850;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.8, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.55); n.connect(nf); nf.connect(ng); ng.connect(master); n.start(t); n.stop(t + 0.6);
  }
  function synthClick() { const t = ctx.currentTime; const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = 1700 + Math.random() * 400; const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.06); }
  function swell() { if (!ctx) return; const t = ctx.currentTime; const o = ctx.createOscillator(); o.frequency.value = 150; const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.35); g.gain.exponentialRampToValueAtTime(0.001, t + 1.5); o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.6); }
  function synthStep() { const t = ctx.currentTime; const o = ctx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.08); const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.13, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.16); }

  // ---- петлевые слои БЕЗ наложения (start идемпотентен: второй экземпляр не создаётся) ----
  function radioOn() {
    if (!ctx || !started || radioSrc) return;
    if (buf.telegraph) { const s = ctx.createBufferSource(); s.buffer = buf.telegraph; s.loop = true; const g = ctx.createGain(); g.gain.value = 0.6; s.connect(g); g.connect(master); s.start(); radioSrc = s; }
    else radioSrc = setInterval(() => { if (playing && started) synthClick(); }, 230);    // короткие щелчки — не накладываются
  }
  function radioOff() { if (!radioSrc) return; if (typeof radioSrc === "number") clearInterval(radioSrc); else { try { radioSrc.stop(); } catch (e) {} } radioSrc = null; }
  function stepsOn() {
    if (!ctx || !started || stepsSrc) return;
    if (buf.footsteps) { const s = ctx.createBufferSource(); s.buffer = buf.footsteps; s.loop = true; const g = ctx.createGain(); g.gain.value = 0.5; s.connect(g); g.connect(master); s.start(); stepsSrc = s; }
    else stepsSrc = setInterval(() => { if (playing && started) synthStep(); }, 430);     // мерный шаг
  }
  function stepsOff() { if (!stepsSrc) return; if (typeof stepsSrc === "number") clearInterval(stepsSrc); else { try { stepsSrc.stop(); } catch (e) {} } stepsSrc = null; }

  function startBed() {
    windGain = buf.wind ? loopBuf(buf.wind, 0.5, bedBus) : synthWind();
    crowdGain = buf.crowd ? loopBuf(buf.crowd, 0.0, bedBus) : synthCrowd();
    if (buf.drone) loopBuf(buf.drone, 0.5, bedBus); else synthDrone();
    console.log("%cМТК24 · звук: сэмплы [" + Object.keys(buf).join(",") + "]" + (Object.keys(buf).length ? "" : " — нет файлов, синтез"), "color:#c9a86a");
  }
  function boom() { if (!ctx || !started) return; if (buf.boom) playBuf(buf.boom, 0.95); else synthBoom(); }
  function click() { if (!ctx || !started) return; if (buf.telegraph) playBuf(buf.telegraph, 0.7); else synthClick(); }

  function resume() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
      bedBus = ctx.createGain(); bedBus.gain.value = 1; bedBus.connect(master);   // фоновые слои → шина (дакаются под ГЗК; голос идёт мимо, в master)
      loadSamples().then(() => { startBed(); setNight(night); });
    }
    if (ctx.state === "suspended" && playing) ctx.resume();   // не будим контекст, если стоим на паузе
    started = true;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now); master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(playing ? vol : 0.0, now + 0.8);
  }
  function setPlaying(b) {
    playing = b;
    if (!ctx || !started) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);                   // сбросить рамп от res() (иначе пауза «отыгрывает» назад)
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(b ? vol : 0.0, now + 0.25);
    if (b) { if (ctx.state === "suspended") ctx.resume(); }    // play → разморозить контекст
    else setTimeout(() => { if (!playing && ctx && ctx.state === "running") ctx.suspend(); }, 300);   // пауза → заморозить ПОСЛЕ фейда (беды и ГЗК встают на месте)
  }
  function setMasterVol(v) { vol = Math.max(0, Math.min(1, v)); if (ctx && started && playing) master.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.2); }
  function setBedVol(v) { bedVol = Math.max(0, Math.min(1, v)); if (bedBus && ctx) bedBus.gain.linearRampToValueAtTime((voDucked ? DUCK : 1) * bedVol, ctx.currentTime + 0.2); }
  function setVoEnabled(b) { voEnabled = !!b; if (!b && voSrc) { try { voSrc.onended = null; voSrc.stop(); } catch (e) {} voSrc = null; setVoDuck(false); } }
  function setNight(nf) { night = nf; if (windGain) windGain.gain.value = (buf.wind ? 0.4 : 0.04) + (buf.wind ? 0.3 : 0.05) * nf; }
  function fx(type) {
    if (!ctx || !started) return;
    if (type === "shot") boom();
    else if (type === "flash" || type === "wave" || type === "rays") swell();
  }
  function shot(i, s) {
    if (!ctx || !started) return;
    const types = ((s && s.fx) || []).map((f) => f.type);
    // толпа — тише и реже: только в штурмовых кадрах (кольцо/выстрел/заливка), иначе тишина
    const storm = types.includes("ring") || types.includes("shot") || types.includes("flood");
    if (crowdGain) crowdGain.gain.linearRampToValueAtTime(storm ? (buf.crowd ? 0.16 : 0.012) : 0.0, ctx.currentTime + 2.5);
    swell();   // мягкий акцент на смене кадра (радио/телеграф теперь триггерится из FX один раз)
  }

  // дикторская озвучка ГЗК: голос кадра index → играет, фон приглушается (duck); смена кадра обрывает прошлый голос (без наложения)
  function setVoDuck(on) { voDucked = on; if (bedBus && ctx) bedBus.gain.linearRampToValueAtTime((on ? DUCK : 1) * bedVol, ctx.currentTime + 0.4); }
  function vo(index) {
    if (!ctx || !started) return;
    if (voSrc) { try { voSrc.onended = null; voSrc.stop(); } catch (e) {} voSrc = null; }
    if (!voEnabled) { setVoDuck(false); return; }    // озвучка выключена (вкладка «Звук»)
    const b = voBuf[index];
    if (!b) { setVoDuck(false); return; }            // на этот кадр нет файла → фон не приглушаем
    voGain = ctx.createGain(); voGain.gain.value = 1.0; voGain.connect(master);
    voSrc = ctx.createBufferSource(); voSrc.buffer = b; voSrc.connect(voGain);
    const token = ++voToken;
    voSrc.onended = () => { if (token === voToken) setVoDuck(false); };   // голос договорил → фон обратно вверх
    voSrc.start();
    setVoDuck(true);
  }

  function reloadVo() { return loadVo(); }           // перечитать озвучку после перегенерации (редактор ГЗК)
  function status() {                                // диагностика: почему звук молчит / грузится (панель статуса)
    return { ctx: ctx ? ctx.state : "—", started, playing,
      files: Object.assign({}, fileState), samplesDone,
      voLoaded: voBuf.filter(Boolean).length, voTotal: VO_COUNT, voDone };
  }
  window.MTK24_AUDIO = { resume, setPlaying, setMasterVol, setBedVol, setVoEnabled, setNight, fx, shot, vo, reloadVo, status, radioOn, radioOff, stepsOn, stepsOff };
  // АВТО-СТАРТ: создаём контекст и грузим сэмплы сразу (прелоад). Реальное звучание включается
  // автоматически при первом же взаимодействии/возврате фокуса (политику автоплея Safari иначе не обойти),
  // и срабатывает мгновенно, т.к. всё уже загружено. resume() идемпотентен.
  ["pointerdown", "keydown", "touchstart"].forEach((e) => window.addEventListener(e, resume));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") resume(); });
  resume();
})();
