/* МТК №24 «Ленин в октябре» — кинематографичная видео-проекция (three.js).
 *
 * Историческая карта Петрограда — текстурированная «земля». Над ней
 * перспективная камера с плавным наездом по кадрам сценария (без вращения).
 * На карте — точки сил (ВРК / Временное прав-во), маршруты по улицам,
 * спецэффекты. Титры/таймлайн/врезки — HUD поверх. Озвучка — слотами.
 *
 * 3D-модели зданий и кораблей подключаются позже (см. loadModels / GLTF).
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// ----------------------------------------------------------------- palette
const COL = {
  paper: 0xF7F9EF, brass: 0xD2B773, red: 0xA02128, graphite: 0x435059,
  vrk: 0xE8C24A, pg: 0x14181B, redLight: 0xE2412B, ink: 0x0C1012,
};
const hex = (n) => "#" + n.toString(16).padStart(6, "0");

// ----------------------------------------------------------------- map dims
const TEX = "./assets/map/petrograd_5000.jpg";
const TEX_W = 4200, TEX_H = 5000;
const PD = 100, PW = PD * TEX_W / TEX_H;     // плоскость карты (world units)

// нормированные [u,v] (0..1, верх-лево) → мировые координаты на плоскости
function uvToWorld(u, v, y = 0) {
  return new THREE.Vector3((u - 0.5) * PW, y, (v - 0.5) * PD);
}

// ----------------------------------------------------------------- data
const LOC = window.MTK24_LOCATIONS || { points: {}, routes: {}, directions: {} };
const SCN = window.MTK24_SCENARIO || { duration: 60, shots: [] };
function loc(key) { return LOC.points[key] || LOC.directions[key] || null; }

// ----------------------------------------------------------------- 3D-модели ориентиров (GLTF)
// Конфиг моделей вынесен в data/models.js (window.MTK24_MODELS) — им владеет
// сессия генерации моделей; здесь только читаем. cfg[key] = { file, size, yaw }.
const MODELS = window.MTK24_MODELS || { dir: "./assets/models/", cfg: {} };
const MODEL_CFG = MODELS.cfg;
const MODEL_DIR = MODELS.dir;
const modelCache = {};        // key → нормированный THREE.Group (шаблон для clone)
let modelsReady = false;
function preloadModels() {
  const loader = new GLTFLoader();
  const jobs = Object.entries(MODEL_CFG).map(([key, cfg]) => new Promise((res) => {
    loader.load(MODEL_DIR + cfg.file, (gltf) => {
      const g = gltf.scene;
      // нормировка: центр по XZ, база на y=0, масштаб по горизонтальному габариту
      const bbox = new THREE.Box3().setFromObject(g);
      const size = bbox.getSize(new THREE.Vector3()), c = bbox.getCenter(new THREE.Vector3());
      g.position.set(-c.x, -bbox.min.y, -c.z);
      const s = cfg.size / Math.max(size.x, size.z, 1e-3);
      const root = new THREE.Group(); root.add(g);
      root.scale.setScalar(s); root.rotation.y = cfg.yaw || 0;
      modelCache[key] = root;
      res();
    }, undefined, (err) => { console.warn("МТК24: модель не загрузилась", cfg.file, err); res(); });
  }));
  return Promise.all(jobs).then(() => { modelsReady = true; });
}

// ----------------------------------------------------------------- three core
const canvas = document.getElementById("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(COL.ink);
scene.fog = new THREE.Fog(COL.ink, 220, 480);

const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 3000);

// lighting (for 3D models; map itself is unlit/basic)
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const key = new THREE.DirectionalLight(0xfff1d6, 1.1);
key.position.set(-60, 120, 40); scene.add(key);
// мягкое IBL, чтобы латунь (шпиль/купола) читалась как золото без скайбокса
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

// ----------------------------------------------------------------- map plane
let mapPlane;
const texLoader = new THREE.TextureLoader();
texLoader.load(TEX, (tex) => {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  mapPlane = new THREE.Mesh(new THREE.PlaneGeometry(PW, PD), mat);
  mapPlane.rotation.x = -Math.PI / 2;     // лечь в плоскость XZ, лицом вверх
  scene.add(mapPlane);
  // a darker base under the map for the fade-from-dark intro
  boot();
});

// ----------------------------------------------------------------- sprites (markers as glowing lights)
function spriteCanvas(draw, size = 128) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d"); draw(g, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function glowDot(colorHex, withStar) {
  return spriteCanvas((g, s) => {
    const cx = s / 2;
    const grd = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
    grd.addColorStop(0, colorHex); grd.addColorStop(0.25, colorHex);
    grd.addColorStop(0.6, hexA(colorHex, 0.35)); grd.addColorStop(1, hexA(colorHex, 0));
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    g.beginPath(); g.arc(cx, cx, s * 0.16, 0, 7); g.fillStyle = colorHex; g.fill();
    if (withStar) drawStar(g, cx, cx, 5, s * 0.13, s * 0.055, hex(COL.red));
  });
}
function hexA(h, a) { // "#rrggbb" → rgba
  const v = h.replace("#", "");
  return `rgba(${parseInt(v.slice(0,2),16)},${parseInt(v.slice(2,4),16)},${parseInt(v.slice(4,6),16)},${a})`;
}
function drawStar(g, cx, cy, spikes, outer, inner, fill) {
  let rot = -Math.PI / 2, step = Math.PI / spikes;
  g.beginPath(); g.moveTo(cx, cy - outer);
  for (let i = 0; i < spikes; i++) {
    g.lineTo(cx + Math.cos(rot) * outer, cy + Math.sin(rot) * outer); rot += step;
    g.lineTo(cx + Math.cos(rot) * inner, cy + Math.sin(rot) * inner); rot += step;
  }
  g.closePath(); g.fillStyle = fill; g.fill();
}
const TEX_VRK = glowDot(hex(COL.vrk), true);
const TEX_PG  = glowDot("#20262b", false);
const TEX_RED = glowDot(hex(COL.redLight), false);
function markerTex(force, state) {
  if (state === "red") return TEX_RED;
  return force === "vrk" ? TEX_VRK : TEX_PG;
}

// ----------------------------------------------------------------- markers manager
const markersGroup = new THREE.Group(); scene.add(markersGroup);
let markers = [];   // {key, sprite, force, baseState, becomes, at, pulse, baseScale}

const HERO = ["smolny", "winter", "fortress", "mariinsky", "tauride"];
function addForcePad(w, force, size) {
  // плашка-подсветка в цвете силы под 3D-моделью (читаемость принадлежности + пульс)
  const col = force === "vrk" ? COL.vrk : COL.graphite;
  const mat = new THREE.MeshStandardMaterial({
    color: col, emissive: col, emissiveIntensity: force === "vrk" ? 0.6 : 0.18,
    roughness: 0.6, metalness: 0.0, transparent: true, opacity: 0.5,
  });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.6, size * 0.6, 0.4, 28), mat);
  pad.position.set(w.x, 0.2, w.z);
  markersGroup.add(pad);
  return pad;
}
function buildMarkers(shot) {
  markersGroup.clear(); markers = [];
  for (const p of (shot.points || [])) {
    const L = loc(p.key); if (!L || L.u == null) continue;
    const force = p.force || L.force || "pg";
    const w = uvToWorld(L.u, L.v, 0);

    // ориентир с 3D-моделью → ставим модель + плашку силы (боксы для остального)
    if (modelCache[p.key]) {
      const model = modelCache[p.key].clone(true);
      if (p.becomes === "red") model.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
      model.position.set(w.x, 0, w.z);
      markersGroup.add(model);
      const pad = addForcePad(w, force, MODEL_CFG[p.key].size);
      markers.push({ ...p, mesh: model, pad, force, isModel: true, redApplied: false });
      continue;
    }

    const isBridge = /_br$/.test(p.key);
    const hero = HERO.includes(p.key);
    const fw = isBridge ? 2.0 : (hero ? 3.6 : 2.6);   // след (ширина/глубина), world units
    const fh = isBridge ? 1.2 : (hero ? 7.0 : 4.2);   // высота объёма
    const col = force === "vrk" ? COL.vrk : COL.pg;
    const mat = new THREE.MeshStandardMaterial({
      color: col, emissive: col, emissiveIntensity: force === "vrk" ? 0.35 : 0.06,
      roughness: 0.55, metalness: 0.15,
    });
    const box = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, fw), mat);
    box.position.set(w.x, fh / 2, w.z);
    markersGroup.add(box);
    // тонкая «крыша»-кромка для читаемости
    markers.push({ ...p, mesh: box, force, baseH: fh, redApplied: false });
  }
}
function tintRed(obj) {
  if (obj.material) {
    obj.material.color.setHex(COL.redLight);
    obj.material.emissive.setHex(COL.redLight);
    obj.material.emissiveIntensity = 0.5;
  } else {  // 3D-модель: подсветить меши «захваченным» красным
    obj.traverse((o) => { if (o.isMesh) { o.material.emissive.setHex(COL.redLight); o.material.emissiveIntensity = 0.45; } });
  }
}
function updateMarkers(lp, time) {
  for (const m of markers) {
    if (m.becomes === "red" && !m.redApplied && lp >= (m.at ?? 0)) {
      tintRed(m.mesh);
      if (m.pad) { m.pad.material.color.setHex(COL.redLight); m.pad.material.emissive.setHex(COL.redLight); m.pad.material.emissiveIntensity = 0.6; }
      m.redApplied = true;
    }
    if (m.pulse) {
      const fast = m.pulse === "fast";
      const e = 0.3 + 0.6 * Math.abs(Math.sin(time * (fast ? 7 : 3.2)));
      if (m.mesh.material) m.mesh.material.emissiveIntensity = e;             // боксы
      else if (m.pad && !m.redApplied) m.pad.material.emissiveIntensity = e;  // плашка под моделью
    }
  }
}

// ----------------------------------------------------------------- routes manager
const routesGroup = new THREE.Group(); scene.add(routesGroup);
let routes = [];   // {curve, tube, headSprite, at, dur}
const headTex = glowDot(hex(COL.redLight), false);

function buildRoutes(shot) {
  routesGroup.clear(); routes = [];
  for (const r of (shot.routes || [])) {
    const wp = LOC.routes[r.key]; if (!wp || wp.length < 2) continue;
    const pts = wp.map(p => {
      const u = Array.isArray(p) ? p[0] : p.u, v = Array.isArray(p) ? p[1] : p.v;
      return uvToWorld(u, v, 0.6);
    });
    const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.4);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 120, 0.35, 8, false),
      new THREE.MeshBasicMaterial({ color: r.force === "vrk" ? COL.vrk : COL.red, transparent: true, opacity: 0.28, depthTest: false })
    );
    tube.renderOrder = 8; routesGroup.add(tube);
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: headTex, transparent: true, depthTest: false }));
    head.scale.set(6, 6, 1); head.renderOrder = 11; routesGroup.add(head);
    routes.push({ curve, tube, head, at: r.at ?? 0, dur: r.dur ?? 0.8, geo: tube.geometry });
  }
}
function updateRoutes(lp) {
  for (const r of routes) {
    const p = Math.min(1, Math.max(0, (lp - r.at) / r.dur));
    r.head.visible = p > 0 && p < 1.001;
    if (p > 0) r.head.position.copy(r.curve.getPoint(p));
    // reveal tube progressively
    const total = r.geo.index ? r.geo.index.count : r.geo.attributes.position.count;
    r.geo.setDrawRange(0, Math.floor(total * p));
  }
}

// ----------------------------------------------------------------- camera rig
const FRAMING = {
  wide:  { R: 168, pitch: 50 },
  tight: { R: 92,  pitch: 53 },
  route: { R: 150, pitch: 47 },
};
const camTarget = new THREE.Vector3(0, 0, 0);     // eased lookAt
const camGoalPos = new THREE.Vector3();
const camGoalLook = new THREE.Vector3();

function focusCentroid(shot) {
  const keys = shot.focus && shot.focus.length ? shot.focus : Object.keys(LOC.points).slice(0, 1);
  let u = 0, v = 0, n = 0;
  for (const k of keys) { const L = loc(k); if (L) { u += L.u; v += L.v; n++; } }
  if (!n) { u = 0.5; v = 0.4; n = 1; }
  return { u: u / n, v: v / n };
}
function setFraming(shot) {
  const c = focusCentroid(shot);
  const f = FRAMING[shot.framing] || FRAMING.wide;
  camGoalLook.copy(uvToWorld(c.u, c.v, 0));
  const p = f.pitch * Math.PI / 180;
  camGoalPos.set(camGoalLook.x, f.R * Math.sin(p), camGoalLook.z + f.R * Math.cos(p));
}

// ----------------------------------------------------------------- HUD
const el = (id) => document.getElementById(id);
const hud = {
  nar: el("narration"), date: el("n-date"), title: el("n-title"), lede: el("n-lede"),
  quote: el("quote"), qtext: el("q-text"), qcite: el("q-cite"),
  ill: el("ill"), illImg: el("ill-img"), illCap: el("ill-cap"),
  fill: el("trackFill"), clock: el("clock"), track: el("track"), play: el("btnPlay"),
  evTime: el("ev-time"), evDate: el("ev-date"), voFull: el("vo-full"),
};
function fmt(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
// ВРЕМЯ СОБЫТИЯ: минуты от 24 окт 00:00 → дата/время
const pad2 = (n) => String(n).padStart(2, "0");
function storyDT(m) {
  m = Math.floor(m);
  const day = Math.floor(m / 1440), mm = ((m % 1440) + 1440) % 1440;
  return { time: pad2(Math.floor(mm / 60)) + ":" + pad2(mm % 60),
           date: (24 + day) + " октября 1917", short: (24 + day) + " окт" };
}

let ticks = [];
function buildTicks() {
  SCN.shots.forEach((s) => {
    const d = document.createElement("div"); d.className = "tick";
    d.style.left = (s.t0 / SCN.duration * 100) + "%";
    const lbl = document.createElement("span"); lbl.className = "lbl";
    lbl.textContent = (s.s0 != null) ? storyDT(s.s0).short + " · " + storyDT(s.s0).time : "";
    d.appendChild(lbl);
    hud.track.appendChild(d); ticks.push(d);
  });
}
function applyShot(i) {
  const s = SCN.shots[i];
  hud.nar.classList.add("swap");
  setTimeout(() => {
    hud.date.textContent = s.date || "";
    hud.title.textContent = s.title || "";
    hud.lede.textContent = s.narration || "";
    hud.nar.classList.remove("swap");
  }, 240);
  if (s.quote) { hud.qtext.textContent = s.quote; hud.qcite.textContent = s.cite || ""; hud.quote.classList.add("show"); }
  else hud.quote.classList.remove("show");
  if (s.illustration) {
    hud.illImg.src = `./assets/ill/${s.illustration}.jpg`;
    hud.illImg.onerror = () => { hud.illImg.onerror = null; hud.illImg.src = `./assets/ill/${s.illustration}.gif`; };
    hud.illCap.textContent = s.illCaption || ""; hud.ill.classList.add("show");
  } else hud.ill.classList.remove("show");
  hud.voFull.textContent = s.voFull || s.narration || "";   // полный диктор-текст (тех. зона)
  ticks.forEach((tk, k) => { tk.classList.toggle("active", k === i); tk.classList.toggle("done", k < i); });
  setFraming(s);
  buildMarkers(s); buildRoutes(s);
}

// ----------------------------------------------------------------- clock / loop
let t = 0, playing = true, curIdx = -1, prev = 0, animT = 0;
function shotIndexAt(tt) { let i = 0; SCN.shots.forEach((s, k) => { if (tt >= s.t0) i = k; }); return i; }

function frame(now) {
  const dt = prev ? Math.min(0.05, (now - prev) / 1000) : 0; prev = now; animT += dt;
  if (playing) { t += dt; if (t >= SCN.duration) t = 0; }
  const i = shotIndexAt(t);
  if (i !== curIdx) { curIdx = i; applyShot(i); }
  const s = SCN.shots[i];
  const lp = Math.min(1, Math.max(0, (t - s.t0) / Math.max(0.001, s.t1 - s.t0)));

  // ease camera
  const k = 1 - Math.pow(0.0016, dt);
  camera.position.lerp(camGoalPos, k);
  camTarget.lerp(camGoalLook, k);
  camera.lookAt(camTarget);

  updateMarkers(lp, animT);
  updateRoutes(lp);

  // часы/календарь по ВРЕМЕНИ СОБЫТИЯ (а не по минутам видео)
  if (s.s0 != null && s.s1 != null) {
    const sm = s.s0 + (s.s1 - s.s0) * lp, dt = storyDT(sm);
    hud.evTime.textContent = dt.time;
    hud.evDate.textContent = dt.date;
    hud.clock.innerHTML = "<b>" + dt.short + " · " + dt.time + "</b>";
  }
  hud.fill.style.width = (t / SCN.duration * 100) + "%";

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ----------------------------------------------------------------- controls
hud.play.addEventListener("click", () => { playing = !playing; hud.play.textContent = playing ? "❚❚" : "►"; });
hud.track.addEventListener("click", (e) => {
  const r = hud.track.getBoundingClientRect();
  t = Math.min(SCN.duration - 0.01, Math.max(0, (e.clientX - r.left) / r.width * SCN.duration));
  curIdx = -1;
});
window.addEventListener("keydown", (e) => {
  if (e.code === "Space") { e.preventDefault(); hud.play.click(); }
  else if (e.code === "ArrowRight") { const i = Math.min(SCN.shots.length - 1, shotIndexAt(t) + 1); t = SCN.shots[i].t0; curIdx = -1; }
  else if (e.code === "ArrowLeft") { const i = Math.max(0, shotIndexAt(t) - 1); t = SCN.shots[i].t0; curIdx = -1; }
});

// ----------------------------------------------------------------- working screen (размер ТЗ)
const WORK_ASPECT = 679 / 592;     // ≈1.147 — bbox точной формы экрана (in/размер 24.PNG)
const TRANSPORT_H = 48;            // нижняя полоса таймлайна, px
function resize() {
  // ГЗК (полный диктор-текст) — правая панель; таймлайн — снизу. Рабочий экран — слева.
  const techW = Math.max(280, Math.min(460, window.innerWidth * 0.28));
  document.documentElement.style.setProperty("--techW", techW + "px");
  document.documentElement.style.setProperty("--transportH", TRANSPORT_H + "px");
  const availW = window.innerWidth - techW, availH = window.innerHeight - TRANSPORT_H;
  const wH = Math.min(availH, availW / WORK_ASPECT);
  const wW = wH * WORK_ASPECT;
  const work = document.getElementById("work");
  work.style.width = wW + "px"; work.style.height = wH + "px";
  work.style.left = ((availW - wW) / 2) + "px";
  work.style.top = Math.max(0, (availH - wH) / 2) + "px";
  renderer.setSize(wW, wH, false);
  camera.aspect = wW / wH; camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

// ----------------------------------------------------------------- boot
function boot() {
  resize(); buildTicks();
  const s0 = SCN.shots[0]; setFraming(s0);
  camera.position.copy(camGoalPos); camTarget.copy(camGoalLook); camera.lookAt(camTarget);
  // боксы-заглушки показываются сразу; когда .glb догрузятся — перестраиваем текущий кадр
  preloadModels().then(() => {
    const i = curIdx >= 0 ? curIdx : shotIndexAt(t);
    if (SCN.shots[i]) buildMarkers(SCN.shots[i]);
  });
  requestAnimationFrame(frame);
}
