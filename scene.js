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

// ----------------------------------------------------------------- three core
const canvas = document.getElementById("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(COL.ink);
scene.fog = new THREE.Fog(COL.ink, 220, 480);

const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 3000);

// lighting (for future 3D models; map itself is unlit/basic)
scene.add(new THREE.AmbientLight(0xffffff, 0.9));
const key = new THREE.DirectionalLight(0xfff1d6, 1.1);
key.position.set(-60, 120, 40); scene.add(key);

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

function buildMarkers(shot) {
  markersGroup.clear(); markers = [];
  for (const p of (shot.points || [])) {
    const L = loc(p.key); if (!L) continue;
    const force = p.force || L.force || "pg";
    const m = new THREE.SpriteMaterial({ map: markerTex(force, null), transparent: true, depthTest: false });
    const sp = new THREE.Sprite(m);
    const base = (p.pulse || force === "vrk") ? 7.5 : 6;
    sp.scale.set(base, base, 1);
    sp.position.copy(uvToWorld(L.u, L.v, 0.4));
    sp.renderOrder = 10;
    markersGroup.add(sp);
    markers.push({ ...p, sprite: sp, force, baseScale: base, redApplied: false });
  }
}
function updateMarkers(lp, time) {
  for (const m of markers) {
    // state change: becomes red at fraction `at`
    if (m.becomes === "red" && !m.redApplied && lp >= (m.at ?? 0)) {
      m.sprite.material.map = TEX_RED; m.sprite.material.needsUpdate = true; m.redApplied = true;
    }
    const fast = m.pulse === "fast";
    const pulse = (m.pulse) ? 1 + (fast ? 0.28 : 0.16) * Math.sin(time * (fast ? 7 : 3.4)) : 1;
    const s = m.baseScale * pulse;
    m.sprite.scale.set(s, s, 1);
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
    const pts = wp.map(([u, v]) => uvToWorld(u, v, 0.6));
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
};
function fmt(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

let ticks = [];
function buildTicks() {
  SCN.shots.forEach((s) => {
    const d = document.createElement("div"); d.className = "tick";
    d.style.left = (s.t0 / SCN.duration * 100) + "%";
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

  hud.fill.style.width = (t / SCN.duration * 100) + "%";
  hud.clock.innerHTML = "<b>" + fmt(t) + "</b> / " + fmt(SCN.duration);

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

// ----------------------------------------------------------------- resize
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

// ----------------------------------------------------------------- boot
function boot() {
  resize(); buildTicks();
  const s0 = SCN.shots[0]; setFraming(s0);
  camera.position.copy(camGoalPos); camTarget.copy(camGoalLook); camera.lookAt(camTarget);
  requestAnimationFrame(frame);
}
