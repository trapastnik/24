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
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

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

// гео-регистрация OSM(lon,lat)→[u,v]→мир (Ф0, data/geo_register.js) — для массинга/дорог
const GEOREG = window.MTK24_GEOREG || null;
function geoToUv(lon, lat) {                    // OSM(lon,lat) → [u,v] карты
  if (!GEOREG) return null;
  let u, v;
  if (GEOREG.type === "tps") {                 // thin-plate spline — точно через все опорные точки
    const X = (lon - GEOREG.mx) * GEOREG.sc, Y = (lat - GEOREG.my) * GEOREG.sc, cx = GEOREG.cx, cy = GEOREG.cy;
    u = GEOREG.au[0] + GEOREG.au[1] * X + GEOREG.au[2] * Y;
    v = GEOREG.av[0] + GEOREG.av[1] * X + GEOREG.av[2] * Y;
    for (let i = 0; i < cx.length; i++) {
      const dx = X - cx[i], dy = Y - cy[i], r2 = dx * dx + dy * dy;
      if (r2 > 1e-12) { const ph = 0.5 * r2 * Math.log(r2); u += GEOREG.wu[i] * ph; v += GEOREG.wv[i] * ph; }
    }
  } else if (GEOREG.H) {                        // гомография (fallback)
    const H = GEOREG.H, w = H[6] * lon + H[7] * lat + H[8];
    u = (H[0] * lon + H[1] * lat + H[2]) / w; v = (H[3] * lon + H[4] * lat + H[5]) / w;
  } else {                                      // аффин (fallback)
    u = GEOREG.U[0] * lon + GEOREG.U[1] * lat + GEOREG.U[2];
    v = GEOREG.V[0] * lon + GEOREG.V[1] * lat + GEOREG.V[2];
  }
  return [u, v];
}
function geoToWorld(lon, lat, y = 0) {
  const uv = geoToUv(lon, lat);
  return uv ? uvToWorld(uv[0], uv[1], y) : null;
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

// OrbitControls — ручной осмотр карты (зум/поворот/панорама); тумблер «Свободная камера».
// Выключены по умолчанию: при выкл сценой управляет покадровая камера (см. frame).
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 15; controls.maxDistance = 480; controls.maxPolarAngle = 1.45;
controls.enabled = false;
function setFreeCam(on) {
  if (on) controls.target.copy(camTarget);          // взять текущую точку взгляда
  else camTarget.copy(controls.target);             // вернуть её покадровой камере (без рывка)
  FX_SET.freeCam = on; controls.enabled = on; if (on) controls.update();
}

// lighting (for 3D models; map itself is unlit/basic — её яркость ведём тинтом)
const amb = new THREE.AmbientLight(0xffffff, 0.6); scene.add(amb);
const sun = new THREE.DirectionalLight(0xfff1d6, 1.1);     // = Солнце (позиция по астрономии)
sun.position.set(-60, 120, 40); scene.add(sun);
// мягкое IBL, чтобы латунь (шпиль/купола) читалась как золото без скайбокса
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

// ----------------------------------------------------------------- постпроцессинг (самодостаточный мини-композер)
// «Киношный» проход без аддонов three.js: сцена рендерится в ЛИНЕЙНЫЙ HDR-таргет
// (toneMapping выключен), отдельно считается bloom (свечение огней/вспышек/латуни),
// финальный шейдер тонмапит (ACES) и вручную кодирует в sRGB — надёжно к версии three.
// Поверх грейда: виньетка, плёночное зерно, лёгкая хроматическая аберрация к краям.
// Тумблер — клавиша P (для сравнения «до/после»). HUD/титры (DOM) проход не трогает.
const post = (() => {
  const HF = THREE.HalfFloatType, LIN = THREE.LinearSRGBColorSpace;
  const lit = (opts) => { const rt = new THREE.WebGLRenderTarget(1, 1, Object.assign(
    { type: HF, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter }, opts));
    rt.texture.colorSpace = LIN; return rt; };
  const rtScene = lit();                                   // линейный HDR-кадр (с depth)
  const rtBrite = lit({ depthBuffer: false });             // яркие области (1/2 разрешения)
  const rtA = lit({ depthBuffer: false }), rtB = lit({ depthBuffer: false });

  const fsScene = new THREE.Scene(), fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null); fsScene.add(fsQuad);
  const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  const blit = (mat, target) => { fsQuad.material = mat; renderer.setRenderTarget(target || null); renderer.render(fsScene, fsCam); };

  const briteMat = new THREE.ShaderMaterial({ vertexShader: VERT,
    uniforms: { tDiffuse: { value: null }, threshold: { value: 1.0 } },
    fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse; uniform float threshold;
      void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; float l = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c * max(0.0, l - threshold) / max(l, 1e-4), 1.0); }` });

  const blurMat = new THREE.ShaderMaterial({ vertexShader: VERT,
    uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } },
    fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 dir;
      void main(){ vec3 s = texture2D(tDiffuse, vUv).rgb * 0.227027;
        s += texture2D(tDiffuse, vUv + dir * 1.3846).rgb * 0.316216;
        s += texture2D(tDiffuse, vUv - dir * 1.3846).rgb * 0.316216;
        s += texture2D(tDiffuse, vUv + dir * 3.2308).rgb * 0.070270;
        s += texture2D(tDiffuse, vUv - dir * 3.2308).rgb * 0.070270;
        gl_FragColor = vec4(s, 1.0); }` });

  const gradeMat = new THREE.ShaderMaterial({ vertexShader: VERT,
    uniforms: { tScene: { value: null }, tBloom: { value: null }, bloomStr: { value: 0.85 },
      exposure: { value: 1.06 }, grain: { value: 0.035 }, vignette: { value: 1.2 },
      aberration: { value: 0.0016 }, time: { value: 0 } },
    fragmentShader: `varying vec2 vUv;
      uniform sampler2D tScene, tBloom; uniform float bloomStr, exposure, grain, vignette, aberration, time;
      vec3 ACES(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
      vec3 lin2srgb(vec3 c){ return mix(1.055*pow(max(c,0.0), vec3(0.4166667))-0.055, c*12.92, step(c, vec3(0.0031308))); }
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){ vec2 d = vUv - 0.5; float r2 = dot(d, d);
        vec3 col;                                          // хром. аберрация растёт к краям (r2)
        col.r = texture2D(tScene, vUv + d * aberration * r2 * 4.0).r;
        col.g = texture2D(tScene, vUv).g;
        col.b = texture2D(tScene, vUv - d * aberration * r2 * 4.0).b;
        col += texture2D(tBloom, vUv).rgb * bloomStr;
        col *= exposure; col = ACES(col);
        col *= mix(1.0, smoothstep(0.95, 0.18, r2 * vignette), 0.6);    // виньетка
        float luma = dot(col, vec3(0.299, 0.587, 0.114));               // зерно: слабее в тенях
        col += (hash(vUv + fract(time)) - 0.5) * grain * (0.35 + 0.65 * luma);
        gl_FragColor = vec4(lin2srgb(col), 1.0); }` });

  return {
    enabled: true,
    setSize(w, h) {
      w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
      rtScene.setSize(w, h);
      const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
      rtBrite.setSize(hw, hh); rtA.setSize(hw, hh); rtB.setSize(hw, hh);
    },
    render(time) {
      if (!this.enabled) { renderer.toneMapping = THREE.NoToneMapping; renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
      renderer.toneMapping = THREE.NoToneMapping;                       // тонмаппинг делаем сами в грейде
      renderer.setRenderTarget(rtScene); renderer.render(scene, camera);
      briteMat.uniforms.tDiffuse.value = rtScene.texture; blit(briteMat, rtBrite);
      let src = rtBrite;                                                // разделимый блюр H/V ×2
      for (let i = 0; i < 2; i++) {
        blurMat.uniforms.tDiffuse.value = src.texture; blurMat.uniforms.dir.value.set(1.4 / rtBrite.width, 0); blit(blurMat, rtA);
        blurMat.uniforms.tDiffuse.value = rtA.texture; blurMat.uniforms.dir.value.set(0, 1.4 / rtBrite.height); blit(blurMat, rtB);
        src = rtB;
      }
      gradeMat.uniforms.tScene.value = rtScene.texture;
      gradeMat.uniforms.tBloom.value = rtB.texture;
      gradeMat.uniforms.time.value = time;
      blit(gradeMat, null);
    },
  };
})();

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
const FX_SET = { light: true, sunFloor: 28, contrast: 1.0, shadows: true, shadowStr: 0.45, nightLights: true, cityCut: 1.4, pads: false, city: true, editObjects: false, freeCam: false };
let nightF = 0;     // 0 день … 1 ночь — обновляется в updateLighting, читается водой/прочими

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
  const nf = Math.min(1, Math.max(0, (6 - altDeg) / 12));   // Ф2: 0 день(+6°)…1 ночь(−6°)
  nightF = nf;                                              // → вода (отражение неба/луны)
  if (window.MTK24_AUDIO) window.MTK24_AUDIO.setNight(nf);   // звук: ветер гуще ночью
  const nightDim = 1 - 0.6 * nf;                            // ночью топим базовый свет — драма от локальных источников
  sun.color.lerp(mixC(BASE.sunC, g.sunC), k); sun.intensity += (mixN(BASE.sunI, g.sunI) * nightDim - sun.intensity) * k;
  amb.color.lerp(mixC(BASE.ambC, g.ambC), k);
  amb.intensity += (mixN(BASE.ambI, g.ambI) * (1 - 0.55 * nf) - amb.intensity) * k;   // ночью гасим плоский ambient
  if (mapPlane) mapPlane.material.color.lerp(mixC(BASE.mapC, g.mapC), k);
  if (scene.background) scene.background.lerp(mixC(BASE.bgC, g.bgC), k);
  if (scene.fog) { scene.fog.color.lerp(mixC(BASE.fogC, g.fogC), k);
    scene.fog.near += (mixN(BASE.fogN, g.fogN) - scene.fog.near) * k; scene.fog.far += (mixN(BASE.fogF, g.fogF) - scene.fog.far) * k; }
  scene.environmentIntensity += (mixN(BASE.env, g.env) * (1 - 0.5 * nf) - scene.environmentIntensity) * k;
  // Ф1: карта сама принимает тени; sun держится над горизонтом (sunFloor) как «ключевой»
  // свет → длинные тени читаются и ночью. Включение теней — постоянное (FX_SET.shadows).
}

// ----- Ф2: ночной свет как драматургия (мотивированные локальные источники поверх астро) -----
// Пул точечных источников назначается активным/захваченным объектам кадра (их единицы):
// тёплый = взято ВРК / в фокусе ВРК, холодный = противник. Сила растёт ночью (nightFactor).
// Дульная вспышка «Авроры» — отдельный импульсный источник (см. FX_BUILD.shot).
const NIGHT_POOL = [];
let muzzleLight = null;
function ensureNightRig() {
  if (NIGHT_POOL.length) return;
  for (let i = 0; i < 8; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 38, 2); l.castShadow = false;
    scene.add(l); NIGHT_POOL.push(l);
  }
  muzzleLight = new THREE.PointLight(0xffe6b0, 0, 170, 2); muzzleLight.castShadow = false; scene.add(muzzleLight);
}
function updateNightLights(sm, lp, time, snap) {
  if (!NIGHT_POOL.length) return;
  const { altDeg } = sunPos(sm);
  const on = FX_SET.nightLights ? Math.min(1, Math.max(0, (6 - altDeg) / 12)) : 0;
  const cand = [];
  for (const key in objects) {
    const o = objects[key], red = isCaptured(o, curIdx, lp);
    if (!(o.isActive || red)) continue;
    const L = loc(key); if (!L || L.u == null) continue;
    cand.push({ w: uvToWorld(L.u, L.v, 0), warm: red || o.force === "vrk", active: o.isActive });
  }
  cand.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
  const k = snap ? 1 : 0.15;
  NIGHT_POOL.forEach((l, i) => {
    const c = cand[i];
    if (!c) { l.intensity += (0 - l.intensity) * k; return; }
    l.position.set(c.w.x, 7, c.w.z);
    l.color.setHex(c.warm ? 0xffb464 : 0x5e78c0);
    const pulse = 0.85 + 0.15 * Math.sin(time * 3 + i);
    l.intensity += (on * (c.active ? 30 : 16) * pulse - l.intensity) * k;
  });
}

// ----- Ф1: карта теперь MeshStandard и САМА принимает тени — отдельная
// ShadowMaterial-плоскость не нужна. sun = «ключевой» свет, отбрасывающий тени зданий.
function setupSunShadow() {
  const cam = sun.shadow.camera;
  cam.left = -70; cam.right = 70; cam.top = 70; cam.bottom = -70; cam.near = 80; cam.far = 480;
  cam.updateProjectionMatrix();
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.8;
  applyShadowSettings();
}
function applyShadowSettings() {
  sun.castShadow = FX_SET.shadows;
  if ("intensity" in sun.shadow) sun.shadow.intensity = Math.min(1, 0.5 + FX_SET.shadowStr);
}

// ----------------------------------------------------------------- map plane
let mapPlane;
const texLoader = new THREE.TextureLoader();
texLoader.load(TEX, (tex) => {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // Ф1: карта — освещаемая матовая поверхность (принимает свет/тени), не unlit-картинка.
  // Тинт день/ночь по-прежнему через material.color (updateLighting). roughness 1, без бликов.
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.68, metalness: 0.0, envMapIntensity: 0.5 });
  mapPlane = new THREE.Mesh(new THREE.PlaneGeometry(PW, PD), mat);
  mapPlane.rotation.x = -Math.PI / 2;     // лечь в плоскость XZ, лицом вверх
  mapPlane.receiveShadow = true;
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
const labelsGroup = new THREE.Group(); scene.add(labelsGroup);   // подписи-маркеры над мостами
let objects = {};        // key → { mesh, isModel, pad, baseForce, captureShot, at, isActive, force, pulse, label }
const LABEL_Y = 4.5;     // высота подписи над объектом (world units)
function makeLabel(text) {
  const fs = 60, pad = 10;
  const m = document.createElement("canvas").getContext("2d");
  m.font = `600 ${fs}px "20 Kopeek", Arial, sans-serif`;
  const tw = Math.ceil(m.measureText(text).width);
  const cv = document.createElement("canvas");
  cv.width = tw + pad * 2; cv.height = fs + pad * 2;
  const g = cv.getContext("2d");
  g.font = `600 ${fs}px "20 Kopeek", Arial, sans-serif`;
  g.textBaseline = "middle"; g.textAlign = "center";
  g.lineWidth = 7; g.lineJoin = "round"; g.strokeStyle = "rgba(6,8,9,0.92)";
  g.strokeText(text, cv.width / 2, cv.height / 2);
  g.fillStyle = "#F2DCA6"; g.fillText(text, cv.width / 2, cv.height / 2);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, opacity: 0.95 }));
  const h = 1.0; sp.scale.set(h * cv.width / cv.height, h, 1); sp.renderOrder = 30;
  return sp;
}

const HERO = ["smolny", "winter", "fortress", "mariinsky", "tauride"];
const DIM_OP = 0.22, DIM_MODEL_OP = 0.3;     // прозрачность «не в фокусе»

// мост — единый процедурный силуэт на все мосты (настил + перила + опоры). Цвет/прозрачность
// задаёт updateObjects через общий материал. Размещение: yaw (поворот), len/wide (размер) — на тюнинг.
const BRIDGE_DEFAULT = { yaw: 0, len: 11, wide: 2.6 };
const BRIDGE_CFG = {         // выставлено вживую через «Правку объектов» (yaw в радианах)
  grenadersky_br:   { yaw: 0.13962634015954634, len: 3, wide: 1.2 },
  sampsonievsky_br: { yaw: 0.20943951023931956, len: 4, wide: 1.4 },
  liteyny_br:       { yaw: 1.6755160819145571,  len: 3, wide: 1.6 },
  troitsky_br:      { yaw: 1.9547687622336503,  len: 5, wide: 1.2 },
  dvortsovy_br:     { yaw: 2.0943951023931966,  len: 2, wide: 0.6 },
  nikolaevsky_br:   { yaw: 2.16420827247297,    len: 2, wide: 1 },
};
function bridgeCfg(key) { return { ...BRIDGE_DEFAULT, ...(BRIDGE_CFG[key] || {}) }; }
// ручные сдвиги позиций объектов (перетаскивание в режиме правки) → потом в data/locations.js
const POS = {};              // key → { u, v }
function objUV(key) { return POS[key] || loc(key); }
// scene-side оверрайд поворота для зданий/боксов (мосты — в BRIDGE_CFG; модели по умолч. — MODEL_CFG.yaw)
const YAW = {                // key → радианы (повороты зданий, выставлено в редакторе)
  smolny: -1.6057029118347839, fortress: 1.884955592153877,
  winter: 0.5585053606381855, aurora: 0.48869219055841223,
};
function objYaw(key) { return YAW[key] != null ? YAW[key] : (MODEL_CFG[key] ? (MODEL_CFG[key].yaw || 0) : 0); }
// scene-side оверрайд равномерного масштаба зданий/боксов (множитель к базовому размеру)
const SCALE = {              // key → множитель размера (выставлено в редакторе)
  smolny: 0.22, fortress: 0.436, winter: 0.614, aurora: 0.481, mariinsky: 0.711,
  telegraph_central: 0.436, telegraph_agency: 0.481, war_ministry: 0.376, telephone_central: 0.481,
  post_main: 0.436, power_station: 0.436, gosbank: 0.376, nik_station: 0.376,
  balt_station: 0.358, warsaw_station: 0.358, tsarskoselsky: 0.376, finland_station: 0.395,
  primorsky: 0.557, typography_trud: 0.458, barracks_litovsky: 0.295, admiralty: 0.295, fofanova: 0.677,
};
function objScale(key) { return SCALE[key] || 1; }
function applyScale(key) {   // живое применение масштаба к объекту
  const o = objects[key]; if (!o) return;
  const sc = objScale(key);
  o.mesh.scale.setScalar((o.baseScale || 1) * sc);
  if (!o.isModel && o.fh) o.mesh.position.y = o.fh * sc / 2;   // бокс: база на земле
}
function makeBridge(mat, len, wide) {
  const g = new THREE.Group(), deckY = 1.3;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 0.45, wide), mat);
  deck.position.y = deckY; g.add(deck);
  for (const sgn of [-1, 1]) {                       // перила по краям настила
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, 0.18), mat);
    rail.position.set(0, deckY + 0.35, sgn * (wide / 2 - 0.09)); g.add(rail);
  }
  for (let i = 0, nP = 3; i < nP; i++) {             // опоры (быки) до воды
    const pier = new THREE.Mesh(new THREE.BoxGeometry(0.7, deckY, wide * 0.8), mat);
    pier.position.set(-len / 2 + (len / (nP - 1)) * i, deckY / 2, 0); g.add(pier);
  }
  return g;
}

function addForcePad(w, size) {
  // Ф6: мягкая «лужа» цвета силы под объектом. NormalBlending (НЕ аддитив) — не засвечивает
  // соседние здания массинга; радиус ограничен, чтобы у крупных моделей («Аврора», size 12)
  // плашка не разрасталась на полгорода. Принадлежность в основном несёт ночной свет (Ф2).
  const r = Math.min(size, 4.5) * 1.3;
  const mat = new THREE.MeshBasicMaterial({ map: TEX_GLOW, color: COL.vrk, transparent: true,
    opacity: 0, depthWrite: false });
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(r, r), mat);
  pad.rotation.x = -Math.PI / 2; pad.position.set(w.x, 0.1, w.z); pad.renderOrder = 1;
  pad.visible = FX_SET.pads;                          // тумблер «Круги под моделями» (cx-pads)
  objGroup.add(pad); return pad;
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
  objGroup.clear(); labelsGroup.clear(); objects = {};
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
    const meta = idx[key], uv = POS[key] || L, w = uvToWorld(uv.u, uv.v, 0), baseForce = meta.vrk ? "vrk" : "pg";
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
      model.position.set(w.x, 0, w.z);
      if (YAW[key] != null) model.rotation.y = YAW[key];   // оверрайд поворота из редактора
      rec.baseScale = model.scale.x; model.scale.setScalar(rec.baseScale * objScale(key));   // оверрайд масштаба
      objGroup.add(model);
      rec.mesh = model; rec.isModel = true; rec.pad = addForcePad(w, MODEL_CFG[key].size);
    } else if (/_br$/.test(key)) {                  // МОСТ — процедурный силуэт
      const bc = bridgeCfg(key);
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1, transparent: true });
      const grp = makeBridge(mat, bc.len, bc.wide);
      grp.position.set(w.x, 0, w.z); grp.rotation.y = bc.yaw;
      grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.objKey = key; } });
      objGroup.add(grp);
      rec.mesh = grp; rec.isModel = false; rec.isBridge = true; rec.bridgeMat = mat;
      const lbl = makeLabel((L && L.name) || key);   // подпись-маркер над мостом
      lbl.position.set(w.x, LABEL_Y, w.z); labelsGroup.add(lbl); rec.label = lbl;
    } else {                                          // прочие объекты без .glb — объём-бокс
      const hero = HERO.includes(key);
      const fw = hero ? 3.6 : 2.6, fh = hero ? 7.0 : 4.2;
      const box = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, fw),
        new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.15, transparent: true }));
      const sc = objScale(key);
      box.castShadow = true; box.userData.objKey = key; box.scale.setScalar(sc);
      box.position.set(w.x, fh * sc / 2, w.z); box.rotation.y = YAW[key] || 0; objGroup.add(box);
      rec.mesh = box; rec.isModel = false; rec.baseScale = 1; rec.fh = fh;
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
function setOpacity(m, op) { m.opacity = op; m.transparent = op < 1; m.depthWrite = true; }  // depthWrite всегда — приглушённый объект перекрывает тень под/за собой (не просвечивает)
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
      if (o.pad) { o.pad.visible = FX_SET.pads; const pm = o.pad.material, col = red ? COL.redLight : (force === "vrk" ? COL.vrk : COL.graphite);
        pm.color.setHex(col);
        const base = act ? (red ? 0.20 : force === "vrk" ? 0.18 : 0.10) : (red ? 0.08 : 0.035);
        pm.opacity = pulseE != null ? 0.09 + 0.26 * pulseE : base;
      }
    } else {                                          // бокс ИЛИ мост — единый материал
      const m = o.bridgeMat || o.mesh.material, col = red ? COL.redLight : (force === "vrk" ? COL.vrk : COL.pg);
      m.color.setHex(col); m.emissive.setHex(col);
      m.emissiveIntensity = pulseE != null ? pulseE : (act ? (red ? 0.5 : force === "vrk" ? 0.4 : 0.16) : (red ? 0.18 : 0.05));
      setOpacity(m, act ? 1.0 : DIM_OP);
      if (o.label) o.label.visible = act || FX_SET.editObjects;   // подпись — в фокусе/в правке
    }
  }
}

// ----------------------------------------------------------------- routes manager
const routesGroup = new THREE.Group(); scene.add(routesGroup);
let routes = [];   // {curve, tube, headSprite, at, dur}
const headTex = glowDot(hex(COL.redLight), false);

function buildRoutes(shot) {
  routesGroup.clear(); routes = [];
  if (window.MTK24_AUDIO) window.MTK24_AUDIO.stepsOff();   // стоп шагов при смене кадра
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
    routes.push({ key: r.key, curve, tube, head, at: r.at ?? 0, dur: r.dur ?? 0.8, geo: tube.geometry });
  }
}
function updateRoutes(lp) {
  let leninWalking = false;
  for (const r of routes) {
    const p = Math.min(1, Math.max(0, (lp - r.at) / r.dur));
    r.head.visible = p > 0 && p < 1.001;
    if (p > 0) r.head.position.copy(r.curve.getPoint(p));
    if (r.key === "lenin_route" && p > 0 && p < 0.999) leninWalking = true;   // шаги — пока маршрут Ленина в движении
    // reveal tube progressively
    const total = r.geo.index ? r.geo.index.count : r.geo.attributes.position.count;
    r.geo.setDrawRange(0, Math.floor(total * p));
  }
  if (window.MTK24_AUDIO) (leninWalking ? window.MTK24_AUDIO.stepsOn() : window.MTK24_AUDIO.stepsOff());
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
      if (window.MTK24_AUDIO) (fp > 0.02 && fp < 0.96 ? window.MTK24_AUDIO.radioOn() : window.MTK24_AUDIO.radioOff());   // радио — ВСЮ трансляцию петлёй, без наложения
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
  flash(f) { fxFlashes.push({ lp: f.at ?? 0.5, fired: false, color: "rgba(247,249,239,0.95)", sound: "flash" }); },
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
    let boomed = false;
    fxItems.push({ update(lp, time) {
      const fp = fpOf(lp, at);
      if (!boomed && fp >= 0.33) { boomed = true; if (window.MTK24_AUDIO) MTK24_AUDIO.fx("shot"); }   // бум на дульной вспышке
      let o = tri(fp, 0.10, 0.12); signal.material.opacity = o; signal.scale.setScalar(4 + 6 * o);
      o = tri(fp, 0.33, 0.10); muzzle.material.opacity = 1.2 * o; muzzle.scale.setScalar(4 + 12 * o);
      if (muzzleLight) { muzzleLight.position.set(aur.x, 10, aur.z); muzzleLight.intensity = 700 * o; }   // Ф2: вспышка = реальный свет
      if (!boomed && fp >= 0.33) { boomed = true; if (window.MTK24_AUDIO) window.MTK24_AUDIO.fx("shot"); }   // звук выстрела — НА дульной вспышке, не на попадании
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
  if (muzzleLight) muzzleLight.intensity = 0;          // Ф2: гасим вспышку при смене кадра
  if (window.MTK24_AUDIO) window.MTK24_AUDIO.radioOff();   // стоп радио при смене кадра (нет «хвоста»)
  for (const f of (shot.fx || [])) { const b = FX_BUILD[f.type]; if (b) b(f); }
}
function updateFx(lp, time) {
  for (const it of fxItems) it.update(lp, time);
  for (const fl of fxFlashes) if (!fl.fired && lp >= fl.lp) { fl.fired = true; triggerFlash(fl.color);
    if (fl.sound && window.MTK24_AUDIO) window.MTK24_AUDIO.fx(fl.sound); }
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
  mdlView: el("model-view"), tvCap: el("tv-cap"),
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
// шкала видео-времени: метки каждые 30 с с таймкодом (ориентир)
function buildTimeMarks() {
  for (let ts = 30; ts < SCN.duration; ts += 30) {
    const m = document.createElement("div"); m.className = "tmark";
    m.style.left = (ts / SCN.duration * 100) + "%";
    const l = document.createElement("span"); l.className = "tmark-lbl"; l.textContent = fmt(ts);
    m.appendChild(l); hud.track.appendChild(m);
  }
}
// маркеры замечаний на дорожке (клик — переход к замечанию)
function renderNoteMarks() {
  const track = hud.track; if (!track) return;
  track.querySelectorAll(".nmark").forEach((m) => m.remove());
  notes.forEach((n) => {
    const m = document.createElement("div"); m.className = "nmark";
    m.style.left = (n.t / SCN.duration * 100) + "%";
    m.title = fmt(n.t) + " · " + n.text;
    m.onclick = (e) => { e.stopPropagation(); t = n.t; curIdx = -1; };
    track.appendChild(m);
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
  if (window.MTK24_AUDIO) window.MTK24_AUDIO.shot(i, s);   // звук кадра (гул/щелчки/акцент)
  // 3D-вьюер в техзоне: авто-показ модели ориентира текущего кадра (iframe _qa.html через postMessage).
  // Клик по зданию (showModel/pickKeyAt) — отдельный триггер того же вьюера (см. ниже).
  if (hud.mdlView && hud.mdlView.contentWindow) {
    const keys = (s.focus || []).concat((s.points || []).map((p) => p.key));
    const mk = keys.find((k) => MODEL_CFG[k]);
    if (mk) {
      hud.mdlView.contentWindow.postMessage({ mtk24Model: mk }, "*");
      if (hud.tvCap) hud.tvCap.textContent = (loc(mk) && loc(mk).name) || mk;
    }
  }
}

// ----------------------------------------------------------------- clock / loop
let t = 0, playing = true, curIdx = -1, prev = 0, animT = 0, rendering = false;
function shotIndexAt(tt) { let i = 0; SCN.shots.forEach((s, k) => { if (tt >= s.t0) i = k; }); return i; }

// один кадр при текущем t: применить состояние и отрисовать. snap=true — мгновенно
// поставить камеру/свет (без плавной интерполяции; нужно для 1-го кадра рендера/перемотки).
function tick(dt, snap) {
  const i = shotIndexAt(t);
  if (i !== curIdx) { curIdx = i; applyShot(i); }
  const s = SCN.shots[i];
  const lp = Math.min(1, Math.max(0, (t - s.t0) / Math.max(0.001, s.t1 - s.t0)));

  // камера: свободный осмотр (OrbitControls) ИЛИ покадровый наезд по сценарию.
  // Точные аудио-хуки (шаги/радио) — НЕ здесь: шаги по движению lenin_route (updateRoutes),
  // радио по окну fp телеграфа (FX) — см. ниже. Здесь только камера.
  if (FX_SET.freeCam) {
    controls.update();
  } else {
    const k = snap ? 1 : 1 - Math.pow(0.0016, dt);    // ease camera (snap=мгновенно — инвариант)
    camera.position.lerp(camGoalPos, k);
    camTarget.lerp(camGoalLook, k);
    camera.lookAt(camTarget);
  }

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
    updateLighting(sm, dt, snap);               // свет/цвет по времени суток (Солнце)
    updateNightLights(sm, lp, animT, snap);     // Ф2: локальные источники (свет «живёт» в зданиях)
  }
  if (waterMesh) { const u = waterMat.uniforms; u.time.value = animT;   // Ф9: рябь/блик/луна воды
    u.sunDir.value.copy(sun.position).normalize(); u.camPos.value.copy(camera.position); u.nightF.value = nightF; }
  hud.fill.style.width = (t / SCN.duration * 100) + "%";
  post.render(animT);
}

function frame(now) {
  const dt = prev ? Math.min(0.05, (now - prev) / 1000) : 0; prev = now;
  if (rendering) { requestAnimationFrame(frame); return; }   // оффлайн-рендер ведёт кадры сам — живой цикл простаивает
  animT += dt;
  if (playing) { t += dt; if (t >= SCN.duration) t = 0; }
  tick(dt, false);
  requestAnimationFrame(frame);
}

// ----------------------------------------------------------------- controls
hud.play.addEventListener("click", () => { playing = !playing; hud.play.textContent = playing ? "❚❚" : "►"; if (window.MTK24_AUDIO) window.MTK24_AUDIO.setPlaying(playing); });
hud.track.addEventListener("click", (e) => {
  const r = hud.track.getBoundingClientRect();
  t = Math.min(SCN.duration - 0.01, Math.max(0, (e.clientX - r.left) / r.width * SCN.duration));
  curIdx = -1;
});
window.addEventListener("keydown", (e) => {
  if (/^(INPUT|TEXTAREA)$/.test(e.target && e.target.tagName)) return;   // печатаем в поле — не дёргаем шорткаты
  if (FX_SET.editObjects && sel && editKey(e)) return;   // правка объекта перехватывает стрелки
  if (e.code === "Space") { e.preventDefault(); hud.play.click(); }
  else if (e.code === "ArrowRight") { const i = Math.min(SCN.shots.length - 1, shotIndexAt(t) + 1); t = SCN.shots[i].t0; curIdx = -1; }
  else if (e.code === "ArrowLeft") { const i = Math.max(0, shotIndexAt(t) - 1); t = SCN.shots[i].t0; curIdx = -1; }
  else if (e.code === "KeyP") { post.enabled = !post.enabled; syncPostUI(); }   // постпроцессинг вкл/выкл (статус — в техзоне)
});

// ----------------------------------------------------------------- оффлайн-рендер сегмента (макс. качество)
// Покадровый ДЕТЕРМИНИРОВАННЫЙ рендер [t0,t1] в супер-разрешении: сцена шагает фиксированным
// dt = 1/fps, каждый кадр снимается с канваса в PNG и отправляется на локальный сервер
// (edit_server.py → render/<run>/frame_XXXXX.png). Сборка в mp4 — ffmpeg (команда в консоли).
// Захватывается ТОЛЬКО 3D-канвас с постпроцессингом; DOM-титры/панель в кадр не идут —
// их запечёт будущий Puppeteer-проход (см. VIDEO-PLAN.md). Качество ведём высотой кадра.
//   MTK24_render(t0, t1, { fps, height })   — напр. MTK24_render(187, 217, { height: 2160 })
//   клавиша R — отрендерить ТЕКУЩИЙ кадр сценария в макс. качестве
const canvasBlob = (mime, q) => new Promise((res) => canvas.toBlob(res, mime, q));
async function MTK24_render(t0, t1, opt = {}) {
  if (rendering) { console.warn("МТК24 · рендер уже идёт"); return; }
  const fps = opt.fps || SCN.fps || 30;
  const even = (n) => { n = Math.round(n); return n - (n % 2); };   // H.264/yuv420p требует чётные размеры
  const H = even(opt.height || 2160);                              // высота кадра (супер-сэмплинг)
  // формат кадра: jpeg q0.95 по умолчанию (в 4K PNG ~13 МБ/кадр — зерно не сжимается; jpeg ~2 МБ
  // и для видео-пайплайна визуально неотличим). PNG-lossless — через { format: "png" }.
  const fmt = (opt.format || "jpeg").toLowerCase() === "png" ? "png" : "jpeg";
  const ext = fmt === "png" ? "png" : "jpg", mime = fmt === "png" ? "image/png" : "image/jpeg", q = opt.quality ?? 0.95;
  t0 = Math.max(0, +t0 || 0); t1 = Math.min(SCN.duration, +t1 || SCN.duration);
  if (t1 <= t0) { console.warn("МТК24 · пустой диапазон"); return; }
  const N = Math.max(1, Math.round((t1 - t0) * fps));
  const run = (opt.name || "seg") + "_" + Math.round(t0) + "-" + Math.round(t1) + "_" + Date.now();
  const W = even(H * camera.aspect);
  console.log(`%cМТК24 · рендер ${t0.toFixed(1)}–${t1.toFixed(1)} с · ${fps} fps · ${N} кадров · ${W}×${H} · ${fmt}`,
    "color:#E8C24A;font-weight:bold");

  rendering = true;                                              // живой цикл встаёт на паузу
  const wasPlaying = playing, savedT = t, savedAnimT = animT, savedDPR = renderer.getPixelRatio();
  const postWas = post.enabled; post.enabled = true;            // рендерим всегда с постпроцессингом
  renderer.setPixelRatio(1); renderer.setSize(W, H, false); post.setSize(W, H);
  curIdx = -1; animT = t0;                                       // фаза анимации = время сегмента
  const dt = 1 / fps; let ok = 0, fail = 0;
  for (let i = 0; i < N; i++) {
    t = t0 + i * dt;
    tick(dt, i === 0);                                          // 1-й кадр — снап камеры/света
    const blob = await canvasBlob(mime, q);
    const name = "frame_" + String(i + 1).padStart(5, "0") + "." + ext;
    try {
      const r = await fetch(`/api/render-frame?run=${encodeURIComponent(run)}&name=${name}`, { method: "POST", body: blob });
      r.ok ? ok++ : fail++;
    } catch (e) { fail++; }
    if ((i + 1) % fps === 0 || i === N - 1)
      console.log(`  ${i + 1}/${N} (${Math.round((i + 1) / N * 100)}%) · ок:${ok}${fail ? " · ошибок:" + fail : ""}`);
  }
  // вернуть живой режим
  post.enabled = postWas; renderer.setPixelRatio(savedDPR); resize();
  t = savedT; animT = savedAnimT; curIdx = -1; playing = wasPlaying; rendering = false;
  console.log(`%cМТК24 · готово: ${ok} кадров → render/${run}/`, "color:#7ccb7c;font-weight:bold");
  console.log(`%cСборка: %ctools/render_mp4.sh ${run}%c   (или: ffmpeg -framerate ${fps} -i render/${run}/frame_%05d.${ext} -c:v libx264 -crf 12 -pix_fmt yuv420p ${run}.mp4)`,
    "color:#9fb2c6", "color:#fff", "color:#9fb2c6");
  if (fail) console.warn(`МТК24 · ${fail} кадров не сохранились — сервер запущен с поддержкой /api/render-frame?`);
  return { run, frames: ok, fps, W, H };
}
window.MTK24_render = MTK24_render;
const R_KEY_HEIGHT = 1600;                                       // высота для клавиши R (консоль может больше: {height:2160})
window.addEventListener("keydown", (e) => {                      // R — рендер ТЕКУЩЕГО кадра сценария в файл
  if (e.code === "KeyR" && !e.repeat && !rendering) {
    const s = SCN.shots[shotIndexAt(t)];
    MTK24_render(s.t0, s.t1, { height: R_KEY_HEIGHT });
  }
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
// ----- выбор/перетаскивание объектов + детект драга (поворот камеры не должен «кликать») -----
let downXY = null, didDrag = false, dragObj = null, sel = null;
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);     // плоскость карты (y=0)
function worldFromPointer(cx, cy) {
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  picker.setFromCamera(ndc, camera);
  const pt = new THREE.Vector3();
  return picker.ray.intersectPlane(GROUND, pt) ? pt : null;
}
canvas.addEventListener("pointerdown", (e) => {
  downXY = [e.clientX, e.clientY]; didDrag = false;
  if (FX_SET.editObjects) {
    const key = pickKeyAt(e.clientX, e.clientY);
    if (key) { sel = key; dragObj = key; controls.enabled = false; renderEditor(); }   // взять для перетаскивания
  }
});
canvas.addEventListener("pointermove", (e) => {
  if (downXY && Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 5) didDrag = true;
  if (dragObj && didDrag) {                           // перемещение объекта по карте
    const pt = worldFromPointer(e.clientX, e.clientY);
    if (pt) {
      POS[dragObj] = { u: +(pt.x / PW + 0.5).toFixed(4), v: +(pt.z / PD + 0.5).toFixed(4) };
      const o = objects[dragObj]; if (o) { o.mesh.position.x = pt.x; o.mesh.position.z = pt.z;
        if (o.label) { o.label.position.x = pt.x; o.label.position.z = pt.z; } }
      renderEditor();
    }
    return;
  }
  if (FX_SET.freeCam || FX_SET.editObjects) { canvas.style.cursor = "grab"; return; }
  const key = pickKeyAt(e.clientX, e.clientY);
  canvas.style.cursor = key && MODEL_CFG[key] ? "pointer" : "default";
});
canvas.addEventListener("pointerup", () => { downXY = null; if (dragObj) { dragObj = null; if (FX_SET.freeCam) controls.enabled = true; } });
canvas.addEventListener("click", (e) => {
  if (didDrag) { didDrag = false; return; }          // это был драг (камера/перемещение), не клик
  const key = pickKeyAt(e.clientX, e.clientY);
  if (!key) return;
  if (FX_SET.editObjects) { sel = key; renderEditor(); return; }  // режим правки — выбрать объект
  if (MODEL_CFG[key]) showModel(key);                             // иначе — 3D-вьюер
});

// ----------------------------------------------------------------- редактор объектов (двигать; мост — форма/поворот)
function rebuildBridge(key) {                        // пересобрать мост под текущий BRIDGE_CFG/позицию
  const o = objects[key]; if (!o || !o.isBridge) return;
  const uv = objUV(key), w = uvToWorld(uv.u, uv.v, 0), bc = bridgeCfg(key);
  objGroup.remove(o.mesh);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1, transparent: true });
  const grp = makeBridge(mat, bc.len, bc.wide);
  grp.position.set(w.x, 0, w.z); grp.rotation.y = bc.yaw;
  grp.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.userData.objKey = key; } });
  objGroup.add(grp); o.mesh = grp; o.bridgeMat = mat;
}
function renderEditor() {
  const box = document.getElementById("bt-readout"); if (!box) return;
  if (!FX_SET.editObjects) { box.innerHTML = ""; return; }
  if (!sel) { box.textContent = "тащи мышью · ←/→ поворот · ↑/↓ масштаб (мост — длина) · , / . ширина моста"; return; }
  const uv = objUV(sel) || { u: 0, v: 0 }, isBr = /_br$/.test(sel);
  let s = `<b>${sel}</b> · u ${(+uv.u).toFixed(3)} v ${(+uv.v).toFixed(3)}`;
  if (isBr) { const c = bridgeCfg(sel); s += ` · ${Math.round(c.yaw * 180 / Math.PI)}° дл ${c.len.toFixed(0)} шир ${c.wide.toFixed(1)}`; }
  else { s += ` · ${Math.round(objYaw(sel) * 180 / Math.PI)}° · ×${objScale(sel).toFixed(2)}`; }
  box.innerHTML = s + ` · <span class="bt-copy" id="bt-copy">⧉ конфиг</span>`;
  const cp = document.getElementById("bt-copy");
  if (cp) cp.onclick = () => {
    const t = "POS = " + JSON.stringify(POS) + ";\nYAW = " + JSON.stringify(YAW) + ";\nSCALE = " + JSON.stringify(SCALE) + ";\nBRIDGE_CFG = " + JSON.stringify(BRIDGE_CFG) + ";";
    if (navigator.clipboard) navigator.clipboard.writeText(t); console.log(t); cp.textContent = "✓ скопировано";
  };
}
function editKey(e) {                                 // ←/→ поворот (все); ↑/↓ , . форма (только мост)
  let hit = true;
  if (/_br$/.test(sel)) {                            // МОСТ — поворот + форма
    const c = BRIDGE_CFG[sel] || (BRIDGE_CFG[sel] = { ...bridgeCfg(sel) });
    let rebuild = false;
    if (e.code === "ArrowLeft") c.yaw -= Math.PI / 45;
    else if (e.code === "ArrowRight") c.yaw += Math.PI / 45;
    else if (e.code === "ArrowUp") { c.len += 1; rebuild = true; }
    else if (e.code === "ArrowDown") { c.len = Math.max(2, c.len - 1); rebuild = true; }
    else if (e.code === "Comma") { c.wide = Math.max(0.6, +(c.wide - 0.2).toFixed(2)); rebuild = true; }
    else if (e.code === "Period") { c.wide = +(c.wide + 0.2).toFixed(2); rebuild = true; }
    else hit = false;
    if (hit) { e.preventDefault(); if (rebuild) rebuildBridge(sel); else objects[sel].mesh.rotation.y = c.yaw; renderEditor(); }
  } else {                                           // здание/бокс — поворот (←/→) + масштаб (↑/↓)
    if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
      const y = objYaw(sel) + (e.code === "ArrowRight" ? 1 : -1) * Math.PI / 45;
      YAW[sel] = y; if (objects[sel]) objects[sel].mesh.rotation.y = y;
    } else if (e.code === "ArrowUp" || e.code === "ArrowDown") {
      SCALE[sel] = +(objScale(sel) * (e.code === "ArrowUp" ? 1.05 : 1 / 1.05)).toFixed(3);
      applyScale(sel);
    } else hit = false;
    if (hit) { e.preventDefault(); renderEditor(); }
  }
  return hit;
}

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
  const db = renderer.getDrawingBufferSize(new THREE.Vector2());
  post.setSize(db.x, db.y);
  camera.aspect = wW / wH; camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

// ----------------------------------------------------------------- controls panel (техзона)
// статус постпроцессинга в техзоне (синхрон с клавишей P и тумблером)
function syncPostUI() {
  const cx = document.getElementById("cx-post"), v = document.getElementById("cx-post-v");
  if (cx) cx.checked = post.enabled;
  if (v) { v.textContent = post.enabled ? "ВКЛ" : "ВЫКЛ"; v.style.color = post.enabled ? "#7ccb7c" : "#d27b6b"; }
}
function bindControls() {
  const $ = (id) => document.getElementById(id);
  const light = $("cx-light"), sunh = $("cx-sunh"), sunhV = $("cx-sunh-v"),
        contrast = $("cx-contrast"), contrastV = $("cx-contrast-v"),
        shadow = $("cx-shadow"), shp = $("cx-shadowp"), shpV = $("cx-shadowp-v");
  if (!light) return;
  light.checked = FX_SET.light;
  sunh.value = FX_SET.sunFloor; sunhV.textContent = FX_SET.sunFloor + "°";
  contrast.value = Math.round(FX_SET.contrast * 100); contrastV.textContent = contrast.value + "%";
  shadow.checked = FX_SET.shadows;
  shp.value = Math.round(FX_SET.shadowStr * 100); shpV.textContent = shp.value + "%";
  light.addEventListener("change", () => { FX_SET.light = light.checked; });
  sunh.addEventListener("input", () => { FX_SET.sunFloor = +sunh.value; sunhV.textContent = sunh.value + "°"; });
  contrast.addEventListener("input", () => { FX_SET.contrast = +contrast.value / 100; contrastV.textContent = contrast.value + "%"; });
  shadow.addEventListener("change", () => { FX_SET.shadows = shadow.checked; applyShadowSettings(); });
  shp.addEventListener("input", () => { FX_SET.shadowStr = +shp.value / 100; shpV.textContent = shp.value + "%"; applyShadowSettings(); });
  const citycut = $("cx-citycut"), citycutV = $("cx-citycut-v");
  if (citycut) {
    citycut.value = Math.round(FX_SET.cityCut * 100);
    citycutV.textContent = Math.round(FX_SET.cityCut * 200) + " м";
    citycut.addEventListener("input", () => { FX_SET.cityCut = +citycut.value / 100; citycutV.textContent = Math.round(FX_SET.cityCut * 200) + " м"; });
    citycut.addEventListener("change", () => { rebuildCityMassing(); });   // перестроить массинг на отпускании ползунка
  }
  const pads = $("cx-pads");
  if (pads) { pads.checked = FX_SET.pads; pads.addEventListener("change", () => { FX_SET.pads = pads.checked; }); }
  const city = $("cx-city");
  if (city) { city.checked = FX_SET.city; city.addEventListener("change", () => { FX_SET.city = city.checked; if (cityMassing) cityMassing.visible = FX_SET.city; }); }
  const postCx = $("cx-post");
  if (postCx) postCx.addEventListener("change", () => { post.enabled = postCx.checked; syncPostUI(); });
  const edit = $("cx-edit");
  if (edit) { edit.checked = FX_SET.editObjects;
    edit.addEventListener("change", () => { FX_SET.editObjects = edit.checked; if (!edit.checked) sel = null; renderEditor(); }); }
  const freecam = $("cx-freecam");
  if (freecam) { freecam.checked = FX_SET.freeCam;
    freecam.addEventListener("change", () => setFreeCam(freecam.checked)); }
  renderEditor();
  syncPostUI();
}

// ----------------------------------------------------------------- Ф7: массинг города (OSM-контуры)
// Из data/petrograd_buildings.json (12k контуров) строим единую экструдированную геометрию —
// «город», сквозь который летит камера. Высота преувеличена (реальные дома ~0.1 ед на этой карте).
// Вырезаем массинг вокруг hero-объектов (там стоят детальные GLB). Лениво, один раз, после 1-го кадра.
const CITY_H_SCALE = 0.085;      // мировых единиц на метр высоты (с преувеличением; ~150 м/ед × ~13×)
const CITY_EDGE = 0.30;          // доля bbox у края, на которой высота массинга плавно сходит в плоскость (шире = мягче)
let cityMassing = null, cityData = null, cityWater = null;   // массинг + кэш данных для живой перестройки
function pointInRing(x, y, r) {  // ray-casting: точка (lon,lat) внутри кольца
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    if (((r[i][1] > y) !== (r[j][1] > y)) &&
        (x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1] + 1e-18) + r[i][0])) inside = !inside;
  return inside;
}
async function loadCityData() {            // фетч контуров + полигонов воды, один раз, в кэш
  if (cityData) return true;
  try { cityData = await (await fetch("./data/petrograd_buildings.json")).json(); }
  catch (e) { console.warn("МТК24: контуры зданий не загрузились", e); return false; }
  cityWater = [];
  try {                                              // вода ИЗ АНТИКВАРНОЙ КАРТЫ в [u,v] — extract_water_map.py
    const wd = await (await fetch("./data/petrograd_water_map.json")).json();   // {space:"uv", water:[{rings:[outer,...holes]}]}
    for (const f of (wd.water || [])) {
      const o = f.rings && f.rings[0]; if (!o || o.length < 4) continue;
      let a = 1e9, b2 = 1e9, c2 = -1e9, d = -1e9;
      for (const p of o) { if (p[0] < a) a = p[0]; if (p[0] > c2) c2 = p[0]; if (p[1] < b2) b2 = p[1]; if (p[1] > d) d = p[1]; }
      cityWater.push({ rings: f.rings, ring: o, bb: [a, b2, c2, d] });   // координаты [u,v]: ring=маска, rings=с дырами
    }
  } catch (e) { /* без воды */ }
  return true;
}
// строит/ПЕРЕСТРАИВАЕТ массинг по кэшу. Вырез вокруг hero — из FX_SET.cityCut (слайдер в техзоне).
function rebuildCityMassing() {
  if (!cityData || !GEOREG) return;
  if (cityMassing) { scene.remove(cityMassing); cityMassing.geometry.dispose(); cityMassing.material.dispose(); cityMassing = null; }
  const data = cityData;
  const inWater = (lon, lat) => {     // вода в [u,v] карты → переводим центр здания lon/lat в uv
    const uv = geoToUv(lon, lat); if (!uv) return false; const [u, v] = uv;
    return cityWater.some(w => u >= w.bb[0] && u <= w.bb[2] && v >= w.bb[1] && v <= w.bb[3] && pointInRing(u, v, w.ring));
  };
  const bb = data.bbox, dW = bb.east - bb.west, dS = bb.north - bb.south;
  const ss = (x) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
  const sEdge = (t) => Math.min(ss(t / CITY_EDGE), ss((1 - t) / CITY_EDGE));   // 0 у края bbox, 1 в центре
  const cut2 = FX_SET.cityCut * FX_SET.cityCut;          // радиус² выреза вокруг hero (из слайдера)
  const heroes = [];
  for (const key in MODEL_CFG) { const L = loc(key); if (L && L.u != null) {
    const w = uvToWorld(L.u, L.v, 0); heroes.push({ x: w.x, z: w.z }); } }
  const geoms = []; let skipWater = 0;
  for (const b of data.buildings) {
    let clon = 0, clat = 0; for (const c of b.line) { clon += c[0]; clat += c[1]; }
    clon /= b.line.length; clat /= b.line.length;
    if (inWater(clon, clat)) { skipWater++; continue; }                        // не строим на воде
    const h = b.h * CITY_H_SCALE * sEdge((clon - bb.west) / dW) * sEdge((clat - bb.south) / dS);   // высота тает к краю
    if (h < 0.22) continue;
    const pts = []; let cx = 0, cz = 0;
    for (const c of b.line) { const w = geoToWorld(c[0], c[1], 0); if (!w) continue; pts.push(new THREE.Vector2(w.x, -w.z)); cx += w.x; cz += w.z; }
    if (pts.length < 3) continue;
    cx /= pts.length; cz /= pts.length;
    if (cut2 > 0 && heroes.some(hh => (hh.x - cx) ** 2 + (hh.z - cz) ** 2 < cut2)) continue;   // вырез под hero-моделью
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: h, bevelEnabled: false });
    g.rotateX(-Math.PI / 2); g.deleteAttribute("uv");
    geoms.push(g);
  }
  if (!geoms.length) return;
  const merged = mergeGeometries(geoms, false);
  geoms.forEach(g => g.dispose());
  const mat = new THREE.MeshStandardMaterial({ color: 0x2f343d, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide });
  cityMassing = new THREE.Mesh(merged, mat);
  cityMassing.castShadow = true; cityMassing.receiveShadow = true; cityMassing.renderOrder = 0;
  cityMassing.visible = FX_SET.city;                  // тумблер «3D-город» в техзоне
  scene.add(cityMassing);
  console.log(`%cМТК24 · массинг: ${geoms.length} зданий · вырез ${FX_SET.cityCut.toFixed(1)} ед (на воде −${skipWater})`, "color:#9fb2c6");
}
// ----------------------------------------------------------------- Ф9: вода Невы (полигоны OSM)
// Кастомный шейдер: тёмная база + Fresnel (светлее к краю обзора) + рябь (детерминир. по animT)
// + бегущий солнечный блик. Привязка — та же TPS (geoToWorld), что и массинг.
// Параметры воды вынесены в WATER (под настройщик; applyWaterSettings обновит uniforms после правки).
const WATER = {
  base: 0x0a1622, sky: 0x33506e, sunCol: 0xfff0d0,           // глубина / отражение неба / цвет блика
  specStr: 1.6, fresnelBias: 0.16, rippleAmp: 0.06, nightGlow: 0.8, opacity: 0.9,
};
const waterMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: {
    time: { value: 0 }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, camPos: { value: new THREE.Vector3() },
    nightF: { value: 0 },
    base: { value: new THREE.Color(WATER.base) }, sky: { value: new THREE.Color(WATER.sky) }, sunCol: { value: new THREE.Color(WATER.sunCol) },
    specStr: { value: WATER.specStr }, fresBias: { value: WATER.fresnelBias }, ripple: { value: WATER.rippleAmp },
    nightGlow: { value: WATER.nightGlow }, opacity: { value: WATER.opacity },
  },
  vertexShader: `varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
  fragmentShader: `varying vec3 vW; uniform float time, nightF, specStr, fresBias, ripple, nightGlow, opacity; uniform vec3 sunDir, camPos, base, sky, sunCol;
    void main(){
      float nx = sin(vW.x*0.25 + time*0.6) + sin((vW.x+vW.z)*0.17 + time*0.8)*0.7;
      float nz = sin(vW.z*0.31 - time*0.5) + sin((vW.x-vW.z)*0.21 - time*0.7)*0.7;
      vec3 nrm = normalize(vec3(nx*ripple, 1.0, nz*ripple));
      vec3 view = normalize(camPos - vW);
      float fres = pow(1.0 - max(dot(nrm, view), 0.0), 3.0);
      float day = 1.0 - nightF;
      // днём — тёмная вода + отражение неба (Френель); ночью отражение гаснет
      vec3 col = mix(base, sky, clamp((fres + fresBias) * day, 0.0, 1.0));
      // дневной солнечный блик
      vec3 sd = normalize(sunDir);
      float spec = pow(max(dot(reflect(-sd, nrm), view), 0.0), 90.0) * max(sd.y, 0.0);
      col += sunCol * spec * specStr;
      // ночь: вода просто слегка светится — без бликов/дорожки/расцветки
      col += base * (nightGlow * nightF);
      gl_FragColor = vec4(col, opacity); }`,
});
function applyWaterSettings() {          // дёрнуть после правки WATER (для будущего настройщика)
  const u = waterMat.uniforms;
  u.base.value.set(WATER.base); u.sky.value.set(WATER.sky); u.sunCol.value.set(WATER.sunCol);
  u.specStr.value = WATER.specStr; u.fresBias.value = WATER.fresnelBias; u.ripple.value = WATER.rippleAmp;
  u.nightGlow.value = WATER.nightGlow; u.opacity.value = WATER.opacity;
}
let waterMesh = null;
function buildWater() {
  if (waterMesh || !cityWater || !cityWater.length) return;
  // вода задана в [u,v] карты (extract_water_map.py) → uvToWorld ложит ПИКСЕЛЬ-В-ПИКСЕЛЬ
  // на нарисованное русло; ни TPS, ни клип не нужны (данные уже в пределах карты).
  const toV = (c) => { const p = uvToWorld(c[0], c[1], 0); return new THREE.Vector2(p.x, -p.z); };
  const geoms = [];
  for (const w of cityWater) {
    const outer = (w.rings && w.rings[0]) || w.ring; if (!outer || outer.length < 4) continue;
    const pts = outer.map(toV); if (pts.length < 3) continue;
    const shape = new THREE.Shape(pts);
    for (let h = 1; w.rings && h < w.rings.length; h++) {        // острова-дыры (Заячий и т.д.)
      const hp = w.rings[h].map(toV);
      if (hp.length >= 3) shape.holes.push(new THREE.Path(hp));
    }
    const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2); g.deleteAttribute("uv");
    geoms.push(g);
  }
  if (!geoms.length) return;
  const merged = mergeGeometries(geoms, false); geoms.forEach((g) => g.dispose());
  waterMesh = new THREE.Mesh(merged, waterMat); waterMesh.position.y = 0.05;
  // вода — самый НИЖНИЙ слой: depthWrite=false + renderOrder=-1, поэтому непрозрачные
  // объекты (массинг/модели) перекрывают её по глубине, а спрайты/маркеры/пады рисуются поверх.
  waterMesh.renderOrder = -1;
  scene.add(waterMesh);
  console.log(`%cМТК24 · вода Невы: ${geoms.length} полигонов (из антикварной карты, uv)`, "color:#6db4d8");
}
async function buildCityMassing() {
  if (cityMassing) return;
  if (await loadCityData()) { rebuildCityMassing(); buildWater(); }
}

// ----------------------------------------------------------------- замечания (заметки с привязкой к таймингу; localStorage)
let notes = [];
const NOTES_KEY = "mtk24_notes";
const esc = (s) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
function loadNotes() { try { notes = JSON.parse(localStorage.getItem(NOTES_KEY) || "[]"); } catch (e) { notes = []; } }
function saveNotes() { try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch (e) {} }
function addNote(text) {
  text = (text || "").trim(); if (!text) return;
  const i = shotIndexAt(t), s = SCN.shots[i];
  notes.push({ t: +t.toFixed(2), text, shot: sceneLabel(i) + (s.title ? " «" + s.title + "»" : "") });
  notes.sort((a, b) => a.t - b.t); saveNotes(); renderNotes();
}
function renderNotes() {
  const box = document.getElementById("nt-list"); if (!box) return;
  box.innerHTML = notes.map((n, k) =>
    `<div class="nt-row"><span class="nt-t" data-k="${k}">${fmt(n.t)}</span>` +
    `<span class="nt-txt"><span class="nt-shot">${esc(n.shot)}</span> ${esc(n.text)}</span>` +
    `<span class="nt-x" data-k="${k}">✕</span></div>`).join("");
  const cnt = document.getElementById("nt-count"); if (cnt) cnt.textContent = notes.length;
  box.querySelectorAll(".nt-t").forEach((el) => el.onclick = () => { t = notes[+el.dataset.k].t; curIdx = -1; });
  box.querySelectorAll(".nt-x").forEach((el) => el.onclick = () => { notes.splice(+el.dataset.k, 1); saveNotes(); renderNotes(); });
  renderNoteMarks();
}
function bindNotes() {
  loadNotes(); renderNotes();
  const inp = document.getElementById("nt-input"), add = document.getElementById("nt-add");
  const exp = document.getElementById("nt-export"), clr = document.getElementById("nt-clear");
  const commit = () => { addNote(inp.value); inp.value = ""; inp.focus(); };
  if (add) add.onclick = commit;
  if (inp) inp.addEventListener("keydown", (e) => { if (e.code === "Enter") { e.preventDefault(); commit(); } });
  if (exp) exp.onclick = () => {
    const txt = notes.map((n) => fmt(n.t) + " · " + n.shot + " — " + n.text).join("\n");
    if (navigator.clipboard) navigator.clipboard.writeText(txt); console.log(txt);
    exp.textContent = "✓ скопировано"; setTimeout(() => exp.textContent = "⧉ экспорт", 1300);
  };
  if (clr) clr.onclick = () => { if (notes.length && confirm("Удалить все замечания?")) { notes = []; saveNotes(); renderNotes(); } };
}

// ----------------------------------------------------------------- boot
function boot() {
  resize(); buildTicks(); buildTimeMarks(); bindControls(); bindNotes();
  const s0 = SCN.shots[0]; setFraming(s0);
  camera.position.copy(camGoalPos); camTarget.copy(camGoalLook); camera.lookAt(camTarget);
  buildObjects();                                   // боксы-заглушки показываются сразу
  applyShotToObjects(shotIndexAt(t));
  setupSunShadow();                                 // камера теней (карта сама принимает тени)
  ensureNightRig();                                 // Ф2: пул ночных источников + дульная вспышка
  updateLighting(s0.s0 ?? 720, 0, true);            // сразу выставить свет под 1-й кадр
  // когда .glb догрузятся — пересобираем объекты (модели вместо боксов)
  preloadModels().then(() => {
    buildObjects();
    applyShotToObjects(curIdx >= 0 ? curIdx : shotIndexAt(t));
  });
  requestAnimationFrame(frame);
  buildCityMassing();                               // Ф7: массинг города (async, после 1-го кадра)
}
