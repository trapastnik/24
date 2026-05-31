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
// статус загрузки каждой модели (для окна статуса в техзоне)
const modelStatus = {};        // key → { state:'wait'|'load'|'ok'|'err', file, pct }
function renderLoadStatus() {
  const box = document.getElementById("ls-list"); if (!box) return;
  const keys = Object.keys(MODEL_CFG);
  box.innerHTML = keys.map((k) => {
    const s = modelStatus[k] || { state: "wait" };
    let icon = "·", cls = "wait";
    if (s.state === "ok") { icon = "✓"; cls = "ok"; }
    else if (s.state === "err") { icon = "✗"; cls = "err"; }
    else if (s.state === "load") { icon = s.pct != null ? s.pct + "%" : "…"; cls = "load"; }
    return `<div class="ls-row ${cls}"><span class="ls-i">${icon}</span><span class="ls-k">${k}</span><span class="ls-f">${s.file || MODEL_CFG[k].file}</span></div>`;
  }).join("");
  const ok = keys.filter((k) => modelStatus[k] && modelStatus[k].state === "ok").length;
  const err = keys.filter((k) => modelStatus[k] && modelStatus[k].state === "err").length;
  const lbl = document.getElementById("ls-label");
  if (lbl) lbl.textContent = `статус моделей · ${ok}/${keys.length}` + (err ? ` · ошибок: ${err}` : "");
}
function preloadModels() {
  const loader = new GLTFLoader();
  const jobs = Object.entries(MODEL_CFG).map(([key, cfg]) => new Promise((res) => {
    modelStatus[key] = { state: "load", file: cfg.file, pct: null };
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
      modelStatus[key].state = "ok"; renderLoadStatus(); res();
    }, (ev) => { if (ev && ev.lengthComputable) { modelStatus[key].pct = Math.round(ev.loaded / ev.total * 100); renderLoadStatus(); } },
       (err) => { console.warn("МТК24: модель не загрузилась", cfg.file, err); modelStatus[key].state = "err"; renderLoadStatus(); res(); });
  }));
  renderLoadStatus();
  return Promise.all(jobs).then(() => { modelsReady = true; });
}

// ----------------------------------------------------------------- three core
const canvas = document.getElementById("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;                 // фаза 2: тени от зданий (вкл из техзоны)
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(COL.ink);
scene.fog = new THREE.Fog(COL.ink, 220, 480);

const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 3000);

// lighting (for 3D models; map itself is unlit/basic — её яркость ведём тинтом)
const amb = new THREE.AmbientLight(0xffffff, 0.6); scene.add(amb);
const sun = new THREE.DirectionalLight(0xfff1d6, 1.1);     // = Солнце (позиция по астрономии)
sun.position.set(-60, 120, 40); scene.add(sun);
// мягкое IBL, чтобы латунь (шпиль/купола) читалась как золото без скайбокса
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

// ----------------------------------------------------------------- динамическое освещение (день/ночь по времени события)
// Солнце над Петроградом (59.94°N) по ВРЕМЕНИ СОБЫТИЯ. В конце октября оно едва
// встаёт (макс. ~17° в полдень), поэтому почти весь ролик — золотой час / сумерки / ночь.
const PG_LAT = 59.9375;
function sunPos(min) {                       // → { altDeg, az(рад от севера по часовой) }
  const day = Math.floor(min / 1440), mm = ((min % 1440) + 1440) % 1440;
  const doy = 297 + day, hh = mm / 60;       // 24 окт 1917 = 297-й день года
  const R = Math.PI / 180;
  const decl = -23.44 * Math.cos(R * (360 / 365 * (doy + 10)));
  const B = R * (360 / 365 * (doy - 81));
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const H = R * 15 * (hh + eot / 60 - 12);
  const la = R * PG_LAT, de = R * decl;
  const altDeg = Math.asin(Math.sin(la) * Math.sin(de) + Math.cos(la) * Math.cos(de) * Math.cos(H)) / R;
  let az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(la) - Math.tan(de) * Math.cos(la)) + Math.PI;
  return { altDeg, az };
}
// ключевые «стопы» неба по высоте Солнца (цвета лерпятся между ними)
const C = (h) => new THREE.Color(h);
const SKY = [
  { a: -18, sunC: C(0x9ab0e6), sunI: 0.18, ambC: C(0x2a3a5c), ambI: 0.40, mapC: C(0x2c3858), bgC: C(0x05080f), fogC: C(0x05080f), fogN: 150, fogF: 430, env: 0.30 }, // глубокая ночь
  { a:  -6, sunC: C(0x7a86b8), sunI: 0.35, ambC: C(0x3b4668), ambI: 0.50, mapC: C(0x515877), bgC: C(0x141d33), fogC: C(0x141d33), fogN: 170, fogF: 450, env: 0.38 }, // сумерки
  { a:   0, sunC: C(0xe08a52), sunI: 0.95, ambC: C(0x5f6486), ambI: 0.55, mapC: C(0xa08376), bgC: C(0x3a3550), fogC: C(0x3a3550), fogN: 190, fogF: 460, env: 0.46 }, // у горизонта
  { a:   6, sunC: C(0xffb368), sunI: 1.25, ambC: C(0x8fa0bd), ambI: 0.56, mapC: C(0xe9cfa8), bgC: C(0x6d6f84), fogC: C(0x6d6f84), fogN: 200, fogF: 470, env: 0.50 }, // золотой час
  { a:  16, sunC: C(0xffe9c6), sunI: 1.45, ambC: C(0xaec2d6), ambI: 0.60, mapC: C(0xfbf3e2), bgC: C(0x9fb2c6), fogC: C(0x9fb2c6), fogN: 220, fogF: 490, env: 0.55 }, // низкий день
];
function gradeAt(altDeg) {
  let lo = SKY[0], hi = SKY[SKY.length - 1];
  if (altDeg <= lo.a) hi = lo;
  else if (altDeg >= hi.a) lo = hi;
  else for (let i = 0; i < SKY.length - 1; i++) if (altDeg >= SKY[i].a && altDeg <= SKY[i + 1].a) { lo = SKY[i]; hi = SKY[i + 1]; break; }
  const t = hi.a === lo.a ? 0 : (altDeg - lo.a) / (hi.a - lo.a), L = (x, y) => x + (y - x) * t;
  return {
    sunC: new THREE.Color().lerpColors(lo.sunC, hi.sunC, t), sunI: L(lo.sunI, hi.sunI),
    ambC: new THREE.Color().lerpColors(lo.ambC, hi.ambC, t), ambI: L(lo.ambI, hi.ambI),
    mapC: new THREE.Color().lerpColors(lo.mapC, hi.mapC, t),
    bgC: new THREE.Color().lerpColors(lo.bgC, hi.bgC, t),
    fogC: new THREE.Color().lerpColors(lo.fogC, hi.fogC, t), fogN: L(lo.fogN, hi.fogN), fogF: L(lo.fogF, hi.fogF),
    env: L(lo.env, hi.env),
  };
}
// базовый (ровный) свет — к нему сводимся при выключенном эффекте / contrast=0
const BASE = { sunC: C(0xfff1d6), sunI: 1.1, ambC: C(0xffffff), ambI: 0.6, mapC: C(0xffffff),
  bgC: C(COL.ink), fogC: C(COL.ink), fogN: 220, fogF: 480, env: 0.55 };
const BASE_POS = new THREE.Vector3(-60, 120, 40);
const sunGoalPos = new THREE.Vector3().copy(BASE_POS);
// настройки из техзоны (живая правка слайдерами/тумблерами)
const FX_SET = { light: true, sunFloor: 28, contrast: 1.0, shadows: true, shadowStr: 0.45, pads: false };

function updateLighting(sm, dt, snap) {
  const { altDeg, az } = sunPos(sm), g = gradeAt(altDeg);
  const w = FX_SET.light ? FX_SET.contrast : 0;     // 0 = базовый свет, 1 = полный день/ночь
  // позиция Солнца: высота не ниже «пола» (реальные ~17° в полдень слишком низки)
  const ap = Math.max(altDeg, FX_SET.sunFloor) * Math.PI / 180;
  const astro = new THREE.Vector3(Math.cos(ap) * Math.sin(az), Math.sin(ap), -Math.cos(ap) * Math.cos(az)).multiplyScalar(220);
  sunGoalPos.copy(BASE_POS).lerp(astro, w);
  const mixC = (a, b) => a.clone().lerp(b, w), mixN = (a, b) => a + (b - a) * w;
  const k = snap ? 1 : 1 - Math.pow(0.05, dt);
  sun.position.lerp(sunGoalPos, k);
  sun.color.lerp(mixC(BASE.sunC, g.sunC), k); sun.intensity += (mixN(BASE.sunI, g.sunI) - sun.intensity) * k;
  amb.color.lerp(mixC(BASE.ambC, g.ambC), k); amb.intensity += (mixN(BASE.ambI, g.ambI) - amb.intensity) * k;
  if (mapPlane) mapPlane.material.color.lerp(mixC(BASE.mapC, g.mapC), k);
  if (scene.background) scene.background.lerp(mixC(BASE.bgC, g.bgC), k);
  if (scene.fog) { scene.fog.color.lerp(mixC(BASE.fogC, g.fogC), k);
    scene.fog.near += (mixN(BASE.fogN, g.fogN) - scene.fog.near) * k; scene.fog.far += (mixN(BASE.fogF, g.fogF) - scene.fog.far) * k; }
  scene.environmentIntensity += (mixN(BASE.env, g.env) - scene.environmentIntensity) * k;
  // тени гаснут ночью: сила по РЕАЛЬНОЙ высоте Солнца (видны лишь когда оно над горизонтом)
  if (FX_SET.shadows && shadowPlane) {
    const dayF = Math.min(1, Math.max(0, (altDeg + 2) / 8));     // 0 при ≤−2°, 1 при ≥+6°
    shadowPlane.material.opacity += (FX_SET.shadowStr * dayF - shadowPlane.material.opacity) * k;
    sun.castShadow = dayF > 0.02;                                // ночью shadow-pass не считаем
  }
}

// ----- фаза 2: тени от зданий (карта MeshBasic тени не принимает → плоскость-приёмник ShadowMaterial)
let shadowPlane;
function ensureShadowRig() {
  if (shadowPlane) return;
  const cam = sun.shadow.camera;
  cam.left = -70; cam.right = 70; cam.top = 70; cam.bottom = -70; cam.near = 100; cam.far = 420;
  cam.updateProjectionMatrix();
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(PW, PD),
    new THREE.ShadowMaterial({ opacity: FX_SET.shadowStr, depthWrite: false }));
  shadowPlane.rotation.x = -Math.PI / 2; shadowPlane.position.y = 0.06;
  shadowPlane.receiveShadow = true; shadowPlane.renderOrder = 2; scene.add(shadowPlane);
  applyShadowSettings();
}
function applyShadowSettings() {
  sun.castShadow = FX_SET.shadows;
  if (shadowPlane) { shadowPlane.visible = FX_SET.shadows; shadowPlane.material.opacity = FX_SET.shadowStr; }
}

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

// ----------------------------------------------------------------- objects (ПОСТОЯННЫЕ 3D-ориентиры/объёмы)
// Все объекты сценария строятся ОДИН раз и живут весь ролик. Когда про объект не идёт
// речь — он полупрозрачный (приглушён); когда он в фокусе кадра — полная яркость, цвет
// силы и пульс. «Захват» (becomes:"red") монотонен по кадрам: раз красный — остаётся
// красным до конца (корректно и при перемотке).
const objGroup = new THREE.Group(); scene.add(objGroup);
let objects = {};        // key → { mesh, isModel, pad, baseForce, captureShot, at, isActive, force, pulse }

const HERO = ["smolny", "winter", "fortress", "mariinsky", "tauride"];
const DIM_OP = 0.22, DIM_MODEL_OP = 0.3;     // прозрачность «не в фокусе»

function addForcePad(w, size) {
  // плашка-подсветка в цвете силы под 3D-моделью (видимость — тумблер FX_SET.pads)
  const mat = new THREE.MeshStandardMaterial({
    color: COL.vrk, emissive: COL.vrk, emissiveIntensity: 0.3,
    roughness: 0.6, metalness: 0.0, transparent: true, opacity: 0.4 });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.6, size * 0.6, 0.4, 28), mat);
  pad.position.set(w.x, 0.2, w.z); pad.visible = FX_SET.pads; objGroup.add(pad); return pad;
}
// индекс всех объектов сценария: какая сила, каким кадром (и при каком lp) захвачен
function objectIndex() {
  const idx = {};
  SCN.shots.forEach((s, si) => (s.points || []).forEach((p) => {
    const o = idx[p.key] || (idx[p.key] = { vrk: false, captureShot: Infinity, at: 0 });
    if (p.force === "vrk") o.vrk = true;
    if (p.becomes === "red" && si < o.captureShot) { o.captureShot = si; o.at = p.at ?? 0; }
  }));
  return idx;
}
function buildObjects() {
  objGroup.clear(); objects = {};
  const idx = objectIndex();
  // ориентиры с 3D-моделью (data/models.js) присутствуют ВСЕГДА как постоянные фоновые
  // объекты, даже если не заданы ни в одном кадре сценария (напр. Таврический). Сила —
  // из locations.js; «в фокусе» они не бывают, значит всегда приглушены.
  for (const key in MODEL_CFG) if (!idx[key]) {
    const L = loc(key);
    idx[key] = { vrk: !!(L && L.force === "vrk"), captureShot: Infinity, at: 0 };
  }
  for (const key in idx) {
    const L = loc(key); if (!L || L.u == null) continue;
    const meta = idx[key], w = uvToWorld(L.u, L.v, 0), baseForce = meta.vrk ? "vrk" : "pg";
    const rec = { key, baseForce, captureShot: meta.captureShot, at: meta.at,
                  isActive: false, force: baseForce, pulse: null };
    if (modelCache[key]) {
      const model = modelCache[key].clone(true);
      model.traverse((c) => { if (c.isMesh) {
        c.material = c.material.clone(); c.material.transparent = true; c.castShadow = true;
        c.userData.emHex = c.material.emissive ? c.material.emissive.getHex() : 0;
        c.userData.emInt = c.material.emissiveIntensity ?? 1;
        c.userData.objKey = key;                    // для клика-выбора (3D-вьюер)
      }});
      model.position.set(w.x, 0, w.z); objGroup.add(model);
      rec.mesh = model; rec.isModel = true; rec.pad = addForcePad(w, MODEL_CFG[key].size);
    } else {
      const isBridge = /_br$/.test(key), hero = HERO.includes(key);
      const fw = isBridge ? 2.0 : (hero ? 3.6 : 2.6), fh = isBridge ? 1.2 : (hero ? 7.0 : 4.2);
      const box = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, fw),
        new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.15, transparent: true }));
      box.castShadow = true; box.userData.objKey = key; box.position.set(w.x, fh / 2, w.z); objGroup.add(box);
      rec.mesh = box; rec.isModel = false;
    }
    objects[key] = rec;
  }
}
// статичные факты кадра: что в фокусе, какая сила, пульс (вызывается на смене кадра)
function applyShotToObjects(idx) {
  const shot = SCN.shots[idx]; if (!shot) return;
  const active = {};
  for (const p of (shot.points || [])) active[p.key] = p;     // последний выигрывает
  for (const key in objects) {
    const o = objects[key], p = active[key];
    o.isActive = !!p;
    o.pulse = p ? p.pulse : null;
    o.force = (p && p.force) ? p.force : o.baseForce;
  }
}
function isCaptured(o, idx, lp) {
  if (o.captureShot === Infinity) return false;
  if (idx > o.captureShot) return true;
  return idx === o.captureShot && lp >= (o.at || 0);
}
function setOpacity(m, op) { m.opacity = op; m.transparent = op < 1; m.depthWrite = op >= 1; }
// покадрово: прозрачность/цвет/пульс по фокусу и захвату
function updateObjects(lp, time) {
  for (const key in objects) {
    const o = objects[key], red = isCaptured(o, curIdx, lp), act = o.isActive, force = o.force;
    let pulseE = null;
    if (act && o.pulse) { const fast = o.pulse === "fast"; pulseE = 0.3 + 0.6 * Math.abs(Math.sin(time * (fast ? 7 : 3.2))); }
    if (o.isModel) {
      const op = act ? 1.0 : DIM_MODEL_OP, pads = FX_SET.pads;
      // c кругами: модель — только красная при захвате; без кругов: подсветка принадлежности эмиссией
      o.mesh.traverse((c) => { if (!c.isMesh) return; const m = c.material; setOpacity(m, op);
        if (m.emissive) {
          if (red) { m.emissive.setHex(COL.redLight); m.emissiveIntensity = pulseE != null ? pulseE : (act ? 0.5 : 0.22); }
          else if (!pads && act) { m.emissive.setHex(force === "vrk" ? COL.vrk : COL.pg); m.emissiveIntensity = pulseE != null ? pulseE : 0.28; }
          else { m.emissive.setHex(c.userData.emHex); m.emissiveIntensity = c.userData.emInt; }
        }});
      if (o.pad) {
        o.pad.visible = pads;
        if (pads) { const pm = o.pad.material, col = red ? COL.redLight : (force === "vrk" ? COL.vrk : COL.graphite);
          pm.color.setHex(col); pm.emissive.setHex(col);
          pm.emissiveIntensity = pulseE != null ? pulseE : (act ? (red ? 0.6 : force === "vrk" ? 0.6 : 0.25) : (red ? 0.3 : 0.12));
          pm.opacity = act ? 0.5 : 0.18;
        }
      }
    } else {
      const m = o.mesh.material, col = red ? COL.redLight : (force === "vrk" ? COL.vrk : COL.pg);
      m.color.setHex(col); m.emissive.setHex(col);
      m.emissiveIntensity = pulseE != null ? pulseE : (act ? (red ? 0.5 : force === "vrk" ? 0.4 : 0.16) : (red ? 0.18 : 0.05));
      setOpacity(m, act ? 1.0 : DIM_OP);
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

// ----------------------------------------------------------------- FX (спецэффекты кадров)
// fx[] из сценария рисуются ЗДЕСЬ: пунктир телеграмм, волна от Смольного, кольцо
// вокруг Зимнего, выстрел «Авроры», заливка красным, лучи Смольного + полноэкранная
// вспышка (HUD-оверлей #fx-flash). Каждый эффект знает свой `at` (локальный прогресс
// кадра 0..1) и считает собственную фазу fp = (lp − at)/(1 − at).
const FX_Y = 1.6;                                   // эффекты чуть над картой
const fxGroup = new THREE.Group(); scene.add(fxGroup);
let fxItems = [];        // [{ update(lp, time) }]
let fxFlashes = [];      // [{ lp, fired, color }]  — одноразовые полноэкранные вспышки
let flashEnergy = 0;     // затухающая «яркость» оверлея

const easeOut = (t) => 1 - (1 - t) * (1 - t);
const seg = (x, a, b) => Math.min(1, Math.max(0, (x - a) / (b - a)));
const tri = (x, c, w) => Math.max(0, 1 - Math.abs(x - c) / w);     // треугольный импульс 0..1
const fpOf = (lp, at) => (at >= 1 ? (lp >= 1 ? 1 : 0) : Math.max(0, (lp - at) / (1 - at)));

const TEX_GLOW = spriteCanvas((g, s) => {
  const cx = s / 2, grd = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.35, "rgba(255,240,205,0.7)");
  grd.addColorStop(1, "rgba(255,240,205,0)");
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
});
function fxPoint(key) { const L = loc(key); return L && L.u != null ? uvToWorld(L.u, L.v, FX_Y) : null; }
function glowSprite(color, scale = 6) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: TEX_GLOW, color, transparent: true, opacity: 0, depthTest: false, blending: THREE.AdditiveBlending }));
  sp.scale.set(scale, scale, 1); sp.renderOrder = 21; fxGroup.add(sp); return sp;
}
function flatRing(color, additive = true) {       // тонкое кольцо единичного радиуса, лежит в XZ
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.0, 72),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide,
      depthTest: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 20; fxGroup.add(m); return m;
}
function triggerFlash(color) { flashEnergy = 1; if (hud.flash) hud.flash.style.background = color; }

const FX_BUILD = {
  // пунктир телеграмм: бегущие огоньки от источника к направлениям (флоту)
  telegrams(f) {
    const a = fxPoint(f.from); if (!a) return; const at = f.at ?? 0;
    const segs = [];
    for (const key of (f.to || [])) {
      const b = fxPoint(key); if (!b) continue;
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.LineCurve3(a.clone(), b.clone()), 1, 0.16, 6, false),
        new THREE.MeshBasicMaterial({ color: COL.vrk, transparent: true, opacity: 0, depthTest: false }));
      tube.renderOrder = 18; fxGroup.add(tube);
      const dots = []; for (let i = 0; i < 4; i++) dots.push(glowSprite(COL.vrk, 3));
      segs.push({ a: a.clone(), b: b.clone(), tube, dots });
    }
    fxItems.push({ update(lp, time) {
      const fp = fpOf(lp, at);
      for (const s of segs) {
        s.tube.material.opacity = 0.22 * fp;
        s.dots.forEach((d, i) => {
          const ph = (time * 0.5 + i / s.dots.length) % 1, env = Math.sin(ph * Math.PI);
          d.position.lerpVectors(s.a, s.b, ph);
          d.material.opacity = fp * (0.25 + 0.75 * env);
          const sc = 2.2 + 1.8 * env; d.scale.set(sc, sc, 1);
        });
      }
    } });
  },
  // волна: концентрические кольца, расходящиеся от точки (вести разлетаются по городу)
  wave(f) {
    const c = fxPoint(f.from); if (!c) return; const at = f.at ?? 0;
    const rings = [0, 1, 2].map(() => { const r = flatRing(COL.vrk); r.position.copy(c); return r; });
    const core = glowSprite(COL.vrk, 7); core.position.copy(c);
    fxItems.push({ update(lp, time) {
      const fp = fpOf(lp, at);
      core.material.opacity = 0.6 * Math.min(1, fp * 3);
      const cs = 6 + Math.sin(time * 3) * 1.2; core.scale.set(cs, cs, 1);
      rings.forEach((r, i) => {
        const ph = (time * 0.32 + i / rings.length) % 1, rad = 3 + ph * 40;
        r.scale.set(rad, rad, 1); r.material.opacity = (1 - ph) * 0.55 * Math.min(1, fp * 2);
      });
    } });
  },
  // полноэкранная вспышка — одноразовый HUD-оверлей
  flash(f) { fxFlashes.push({ lp: f.at ?? 0.5, fired: false, color: "rgba(247,249,239,0.95)" }); },
  // кольцо: «прицельное» кольцо вокруг объекта, медленно сжимается за кадр
  ring(f) {
    const c = fxPoint(f.around); if (!c) return; const at = f.at ?? 0;
    const ring = flatRing(COL.redLight, false), echo = flatRing(COL.redLight);
    ring.position.copy(c); echo.position.copy(c);
    fxItems.push({ update(lp, time) {
      const fp = fpOf(lp, at), big = 17, small = 7;
      const rad = big - (big - small) * easeOut(fp), pulse = 1 + 0.03 * Math.sin(time * 4.5);
      ring.scale.set(rad * pulse, rad * pulse, 1); ring.material.opacity = 0.9 * Math.min(1, fp * 3);
      echo.scale.set(rad * 1.07, rad * 1.07, 1);
      echo.material.opacity = (0.22 + 0.18 * Math.sin(time * 4.5)) * Math.min(1, fp * 3);
    } });
  },
  // выстрел «Авроры»: сигнал с крепости → дульная вспышка + ударная волна → снаряд → удар
  shot(f) {
    const aur = fxPoint(f.from), fort = fxPoint(f.signalFrom), win = fxPoint(f.to);
    if (!aur || !win) return; const at = f.at ?? 0;
    const signal = glowSprite(COL.vrk, 5); if (fort) signal.position.copy(fort);
    const muzzle = glowSprite(0xffe6b0, 5); muzzle.position.copy(aur);
    const shock = flatRing(0xffe6b0); shock.position.copy(aur);
    const ball = glowSprite(0xfff0c0, 4);
    const impact = glowSprite(COL.redLight, 5); impact.position.copy(win);
    fxFlashes.push({ lp: at + 0.68 * (1 - at), fired: false, color: "rgba(226,65,43,0.6)" });
    fxItems.push({ update(lp, time) {
      const fp = fpOf(lp, at);
      let o = tri(fp, 0.10, 0.12); signal.material.opacity = o; signal.scale.setScalar(4 + 6 * o);
      o = tri(fp, 0.33, 0.10); muzzle.material.opacity = 1.2 * o; muzzle.scale.setScalar(4 + 12 * o);
      const sp = seg(fp, 0.30, 0.62), sr = 2 + sp * 26;
      shock.scale.set(sr, sr, 1); shock.material.opacity = (1 - sp) * 0.7;
      const bp = seg(fp, 0.34, 0.64);
      ball.visible = bp > 0 && bp < 1; ball.position.lerpVectors(aur, win, bp);
      ball.material.opacity = ball.visible ? 1 : 0; ball.scale.setScalar(3 + 2 * Math.sin(bp * Math.PI));
      o = tri(fp, 0.68, 0.16); impact.material.opacity = 1.3 * o; impact.scale.setScalar(5 + 16 * o);
    } });
  },
  // заливка красным «как чернила»: растущий диск + кромка от точки (объект взят)
  flood(f) {
    const c = fxPoint(f.from); if (!c) return; const at = f.at ?? 0;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 72),
      new THREE.MeshBasicMaterial({ color: COL.red, transparent: true, opacity: 0, depthTest: false }));
    disc.rotation.x = -Math.PI / 2; disc.position.copy(c); disc.position.y = 0.5;
    disc.renderOrder = 16; fxGroup.add(disc);
    const edge = flatRing(COL.redLight); edge.position.copy(c); edge.position.y = 0.6;
    fxItems.push({ update(lp) {
      const fp = fpOf(lp, at), rad = 2 + 30 * easeOut(fp);
      disc.scale.set(rad, rad, 1); disc.material.opacity = 0.45 * Math.min(1, fp * 2.5);
      edge.scale.set(rad, rad, 1); edge.material.opacity = (1 - fp) * 0.6;
    } });
  },
  // лучи Смольного: веер вращающихся лучей + ядро (финальное сияние штаба)
  rays(f) {
    const c = fxPoint(f.from); if (!c) return; const at = f.at ?? 0;
    const grp = new THREE.Group(); grp.position.copy(c); grp.position.y = 1.0; fxGroup.add(grp);
    const N = 16, len = 42, hw = 1.7, beams = [];
    for (let i = 0; i < N; i++) {
      const verts = new Float32Array([0, 0, 0, len, 0, -hw, len, 0, hw]);
      const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
      const mat = new THREE.MeshBasicMaterial({ color: COL.vrk, transparent: true, opacity: 0,
        depthTest: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      const m = new THREE.Mesh(geo, mat); m.rotation.y = (i / N) * Math.PI * 2; m.renderOrder = 17;
      grp.add(m); beams.push(m);
    }
    const core = glowSprite(0xfff0c0, 9); core.position.copy(c); core.position.y = 2;
    fxItems.push({ update(lp, time) {
      const fp = fpOf(lp, at), on = Math.min(1, fp * 1.5);
      grp.rotation.y = time * 0.12;
      beams.forEach((m, i) => { m.material.opacity = (0.12 + 0.07 * Math.sin(time * 1.8 + i)) * on; });
      core.material.opacity = 0.95 * Math.min(1, fp * 2.5);
      const cs = 8 + Math.sin(time * 2.5) * 1.5; core.scale.set(cs, cs, 1);
    } });
  },
};
function buildFx(shot) {
  fxGroup.clear(); fxItems = []; fxFlashes = [];
  for (const f of (shot.fx || [])) { const b = FX_BUILD[f.type]; if (b) b(f); }
}
function updateFx(lp, time) {
  for (const it of fxItems) it.update(lp, time);
  for (const fl of fxFlashes) if (!fl.fired && lp >= fl.lp) { fl.fired = true; triggerFlash(fl.color); }
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
  evTime: el("ev-time"), evDate: el("ev-date"), voFull: el("vo-full"), flash: el("fx-flash"),
  modelView: el("model-view"), tvCap: el("tv-cap"),
  techScene: el("tech-scene"), techTitle: el("tech-title"), techMeta: el("tech-meta"),
};
// номер кадра как в плане (Вступление / Кадр N / Финал)
function sceneLabel(i) {
  const s = SCN.shots[i];
  if (s.id === "intro") return "ВСТУПЛЕНИЕ";
  if (s.id === "finale") return "ФИНАЛ";
  return "КАДР " + i;                 // typography=1 → Кадр 1 … winter_taken=9
}
const FX_RU = { telegrams: "пунктир телеграмм", wave: "волна от Смольного", flash: "вспышка",
  ring: "сжимающееся кольцо", shot: "выстрел «Авроры»", flood: "заливка красным", rays: "лучи Смольного" };
function shotEffects(s) {
  const e = [];
  (s.fx || []).forEach((f) => e.push(FX_RU[f.type] || f.type));
  if (s.routes && s.routes.length) e.push("движение по карте");
  if (s.sfx) e.push("звук: " + s.sfx);
  return e.join(" · ");
}
function shotObjects(s) {
  return [...new Set((s.points || []).map((p) => p.key))].join(", ");
}
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
  // технический заголовок: номер кадра + метаданные
  hud.techScene.textContent = sceneLabel(i) + "  ·  " + (i + 1) + "/" + SCN.shots.length;
  hud.techTitle.textContent = s.title || "";
  const dur = Math.round(s.t1 - s.t0);
  const meta = [
    ["событие", s.s0 != null ? storyDT(s.s0).date.replace(" 1917", "") + ", " + storyDT(s.s0).time + "–" + storyDT(s.s1).time : (s.date || "")],
    ["видео", fmt(s.t0) + "–" + fmt(s.t1) + " (" + dur + " с)"],
    ["эффект", shotEffects(s) || "—"],
    ["объекты", shotObjects(s) || "—"],
  ];
  if (s.illustration) meta.push(["иллюстр.", s.illCaption || s.illustration]);
  hud.techMeta.innerHTML = meta.map(([k, v]) =>
    `<dt>${k}</dt><dd class="${k === "эффект" ? "fx" : ""}">${v}</dd>`).join("");
  ticks.forEach((tk, k) => { tk.classList.toggle("active", k === i); tk.classList.toggle("done", k < i); });
  setFraming(s);
  applyShotToObjects(i); buildRoutes(s); buildFx(s);
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

  updateObjects(lp, animT);
  updateRoutes(lp);
  updateFx(lp, animT);
  if (flashEnergy > 0) flashEnergy = Math.max(0, flashEnergy - dt * 2.4);
  if (hud.flash) hud.flash.style.opacity = flashEnergy * flashEnergy;

  // часы/календарь по ВРЕМЕНИ СОБЫТИЯ (а не по минутам видео)
  if (s.s0 != null && s.s1 != null) {
    const sm = s.s0 + (s.s1 - s.s0) * lp, sdt = storyDT(sm);
    hud.evTime.textContent = sdt.time;
    hud.evDate.textContent = sdt.date;
    hud.clock.innerHTML = "<b>" + sdt.short + " · " + sdt.time + "</b>";
    updateLighting(sm, dt, false);              // свет/цвет по времени суток (Солнце)
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

// ----------------------------------------------------------------- 3D-вьюер объекта (клик по карте → _qa.html)
const picker = new THREE.Raycaster();
function pickKeyAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  picker.setFromCamera(ndc, camera);
  for (const h of picker.intersectObjects(objGroup.children, true)) {
    let o = h.object;
    while (o && o.userData.objKey == null) o = o.parent;
    if (o && o.userData.objKey != null) return o.userData.objKey;
  }
  return null;
}
function showModel(key) {                            // переключаем модель в _qa.html без перезагрузки
  if (!hud.modelView || !MODEL_CFG[key]) return;
  const cw = hud.modelView.contentWindow;
  if (cw) cw.postMessage({ mtk24Model: key }, "*");
  const L = loc(key);
  if (hud.tvCap) hud.tvCap.textContent = (L && L.name) ? L.name : key;
}
canvas.addEventListener("click", (e) => {
  const key = pickKeyAt(e.clientX, e.clientY);
  if (key && MODEL_CFG[key]) showModel(key);
});
canvas.addEventListener("mousemove", (e) => {
  const key = pickKeyAt(e.clientX, e.clientY);
  canvas.style.cursor = key && MODEL_CFG[key] ? "pointer" : "default";
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

// ----------------------------------------------------------------- controls panel (техзона)
function bindControls() {
  const $ = (id) => document.getElementById(id);
  const light = $("cx-light"), sunh = $("cx-sunh"), sunhV = $("cx-sunh-v"),
        contrast = $("cx-contrast"), contrastV = $("cx-contrast-v"),
        shadow = $("cx-shadow"), shp = $("cx-shadowp"), shpV = $("cx-shadowp-v"), pads = $("cx-pads");
  if (!light) return;
  light.checked = FX_SET.light;
  sunh.value = FX_SET.sunFloor; sunhV.textContent = FX_SET.sunFloor + "°";
  contrast.value = Math.round(FX_SET.contrast * 100); contrastV.textContent = contrast.value + "%";
  shadow.checked = FX_SET.shadows;
  shp.value = Math.round(FX_SET.shadowStr * 100); shpV.textContent = shp.value + "%";
  if (pads) pads.checked = FX_SET.pads;
  light.addEventListener("change", () => { FX_SET.light = light.checked; });
  sunh.addEventListener("input", () => { FX_SET.sunFloor = +sunh.value; sunhV.textContent = sunh.value + "°"; });
  contrast.addEventListener("input", () => { FX_SET.contrast = +contrast.value / 100; contrastV.textContent = contrast.value + "%"; });
  shadow.addEventListener("change", () => { FX_SET.shadows = shadow.checked; applyShadowSettings(); });
  shp.addEventListener("input", () => { FX_SET.shadowStr = +shp.value / 100; shpV.textContent = shp.value + "%"; applyShadowSettings(); });
  if (pads) pads.addEventListener("change", () => { FX_SET.pads = pads.checked; });
}

// ----------------------------------------------------------------- boot
function boot() {
  resize(); buildTicks(); bindControls();
  const s0 = SCN.shots[0]; setFraming(s0);
  camera.position.copy(camGoalPos); camTarget.copy(camGoalLook); camera.lookAt(camTarget);
  buildObjects();                                   // боксы-заглушки показываются сразу
  applyShotToObjects(shotIndexAt(t));
  ensureShadowRig();                                // shadow-плоскость + камера теней
  updateLighting(s0.s0 ?? 720, 0, true);            // сразу выставить свет под 1-й кадр
  // когда .glb догрузятся — пересобираем объекты (модели вместо боксов)
  preloadModels().then(() => {
    buildObjects();
    applyShotToObjects(curIdx >= 0 ? curIdx : shotIndexAt(t));
  });
  requestAnimationFrame(frame);
}
