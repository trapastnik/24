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
  let ctx = null, master = null, started = false, playing = true, night = 0;
  let windGain = null, crowdGain = null, radioSrc = null, stepsSrc = null;
  const buf = {};                                   // декодированные сэмплы (или undefined → синтез)

  function noiseBuffer(sec) {
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate);
    const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b;
  }
  function loopBuf(b, g) { const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; const gn = ctx.createGain(); gn.gain.value = g; s.connect(gn); gn.connect(master); s.start(); return gn; }
  function playBuf(b, g) { const s = ctx.createBufferSource(); s.buffer = b; const gn = ctx.createGain(); gn.gain.value = g == null ? 1 : g; s.connect(gn); gn.connect(master); s.start(); }

  async function loadSamples() {
    await Promise.all(Object.entries(FILES).map(async ([k, url]) => {
      try { const r = await fetch(url); if (!r.ok) return; buf[k] = await ctx.decodeAudioData(await r.arrayBuffer()); }
      catch (e) { /* нет файла → синтез-фолбэк */ }
    }));
  }

  // ---- синтез-фолбэки (если сэмпла нет) ----
  function synthWind() {
    const wn = ctx.createBufferSource(); wn.buffer = noiseBuffer(6); wn.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 130;
    const g = ctx.createGain(); g.gain.value = 0.05; wn.connect(lp); lp.connect(g); g.connect(master); wn.start();
    const wlfo = ctx.createOscillator(); wlfo.frequency.value = 0.08; const wlg = ctx.createGain(); wlg.gain.value = 0.035; wlfo.connect(wlg); wlg.connect(g.gain); wlfo.start();
    const flfo = ctx.createOscillator(); flfo.frequency.value = 0.05; const flg = ctx.createGain(); flg.gain.value = 55; flfo.connect(flg); flg.connect(lp.frequency); flfo.start();
    return g;
  }
  function synthDrone() {
    [[55, 0.06], [82.4, 0.042], [110.5, 0.028]].forEach(([f, base], i) => {
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = base;
      const lo = ctx.createOscillator(); lo.frequency.value = 0.04 + 0.02 * i; const lg = ctx.createGain(); lg.gain.value = base * 0.5; lo.connect(lg); lg.connect(g.gain); lo.start();
      o.connect(g); g.connect(master); o.start();
    });
  }
  function synthCrowd() { const cn = ctx.createBufferSource(); cn.buffer = noiseBuffer(6); cn.loop = true; const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 500; bp.Q.value = 0.8; const g = ctx.createGain(); g.gain.value = 0.012; cn.connect(bp); bp.connect(g); g.connect(master); cn.start(); return g; }
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
    windGain = buf.wind ? loopBuf(buf.wind, 0.5) : synthWind();
    crowdGain = buf.crowd ? loopBuf(buf.crowd, 0.0) : synthCrowd();
    if (buf.drone) loopBuf(buf.drone, 0.5); else synthDrone();
    console.log("%cМТК24 · звук: сэмплы [" + Object.keys(buf).join(",") + "]" + (Object.keys(buf).length ? "" : " — нет файлов, синтез"), "color:#c9a86a");
  }
  function boom() { if (!ctx || !started) return; if (buf.boom) playBuf(buf.boom, 0.95); else synthBoom(); }
  function click() { if (!ctx || !started) return; if (buf.telegraph) playBuf(buf.telegraph, 0.7); else synthClick(); }

  function resume() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
      loadSamples().then(() => { startBed(); setNight(night); });
    }
    if (ctx.state === "suspended") ctx.resume();
    started = true;
    master.gain.linearRampToValueAtTime(playing ? 0.85 : 0.0, ctx.currentTime + 0.8);
  }
  function setPlaying(b) { playing = b; if (ctx && started) master.gain.linearRampToValueAtTime(b ? 0.85 : 0.0, ctx.currentTime + 0.3); }
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

  window.MTK24_AUDIO = { resume, setPlaying, setNight, fx, shot, radioOn, radioOff, stepsOn, stepsOff };
  // АВТО-СТАРТ: создаём контекст и грузим сэмплы сразу (прелоад). Реальное звучание включается
  // автоматически при первом же взаимодействии/возврате фокуса (политику автоплея Safari иначе не обойти),
  // и срабатывает мгновенно, т.к. всё уже загружено. resume() идемпотентен.
  ["pointerdown", "keydown", "touchstart"].forEach((e) => window.addEventListener(e, resume));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") resume(); });
  resume();
})();
