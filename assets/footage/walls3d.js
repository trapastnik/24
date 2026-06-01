/* МТК-24 · 3D-вьюер медиа-врезок со свободной орбитой (three.js + OrbitControls).
 * three / OrbitControls подключены ТЕМ ЖЕ способом, что и основной проект
 * (importmap: "three" / "three/addons/"); параметры камеры/орбиты — из scene.js.
 * Два режима:
 *   mount(canvas, sides, tint)        — видео-стены по дальним граням сцены (П/Г);
 *   mountWater(canvas, tint, clip)    — вода Невы ИЗ ПРОЕКТА (русло + риппл-шейдер),
 *                                       на поверхности рябит видео.
 * Карта Петрограда — горизонтальный «пол» (как в scene.js). Тонировка — дуотон,
 * читает пресеты из footage.js (setTint). */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// масштаб мира как в scene.js: PD=100, PW=PD*aspect(карты). petrograd_2048.png = 1720×2048.
const PD = 100, ASPECT = 1720 / 2048, PW = PD * ASPECT;
const MAP_URL = '../map/petrograd_2048.png';
const WATER_URL = '../../data/petrograd_water_map.json';
const VIDEO_ASPECT = 634 / 480;
const H = 46;                                  // высота стен ≈ ширине панели (квадрат)
const uvToWorld = (u, v, y = 0) => new THREE.Vector3((u - 0.5) * PW, y, (v - 0.5) * PD);
const hex = c => new THREE.Color(c);

// ── дуотон-панель (стены) ─────────────────────────────────────────────
const VERT = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const FRAG = `
  uniform sampler2D map; uniform vec3 uShadow, uHi; uniform float uStrength, uBright, uContrast; uniform vec2 uCover;
  varying vec2 vUv;
  void main(){
    vec2 uv = (vUv - 0.5) * uCover + 0.5;
    vec3 c = texture2D(map, uv).rgb;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    l = clamp((l - 0.5) * uContrast + 0.5, 0.0, 1.0) * uBright;
    vec3 duo = mix(uShadow, uHi, clamp(l, 0.0, 1.0));
    gl_FragColor = vec4(clamp(mix(vec3(l), duo, uStrength), 0.0, 1.0), 1.0);
  }`;

// ── вода: видео + риппл/Френель/блик (логика воды из scene.js) ─────────
const NEVA_VERT = `varying vec3 vW; varying vec2 vUv;
  void main(){ vUv=uv; vec4 wp=modelMatrix*vec4(position,1.0); vW=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp; }`;
const NEVA_FRAG = `
  uniform sampler2D tex; uniform float time,uStrength,uBright,uContrast,fresBias,ripple,opacity,sheen,spec;
  uniform vec3 camPos,uShadow,uHi,sky,sunDir; varying vec3 vW; varying vec2 vUv;
  void main(){
    float nx = sin(vW.x*0.25 + time*0.6) + sin((vW.x+vW.z)*0.17 + time*0.8)*0.7;   // рябь как в scene.js
    float nz = sin(vW.z*0.31 - time*0.5) + sin((vW.x-vW.z)*0.21 - time*0.7)*0.7;
    vec2 duv = clamp(vUv + vec2(nx, nz)*0.010, 0.001, 0.999);                       // видео «плывёт» по ряби
    vec3 c = texture2D(tex, duv).rgb;
    float l = dot(c, vec3(0.299,0.587,0.114));
    l = clamp((l-0.5)*uContrast+0.5, 0.0, 1.0) * uBright;
    vec3 col = mix(vec3(l), mix(uShadow, uHi, clamp(l,0.0,1.0)), uStrength);        // дуотон
    vec3 nrm = normalize(vec3(nx*ripple, 1.0, nz*ripple));
    vec3 view = normalize(camPos - vW);
    float fres = pow(1.0 - max(dot(nrm, view), 0.0), 3.0);
    col = mix(col, sky, clamp(fres + fresBias, 0.0, 1.0) * sheen);                  // отблеск неба (Френель)
    vec3 sd = normalize(sunDir);
    col += vec3(1.0,0.94,0.82) * pow(max(dot(reflect(-sd, nrm), view), 0.0), 90.0) * spec;  // солнечный блик
    gl_FragColor = vec4(col, opacity);
  }`;

let R = null;

function coverFor(pw, ph){ const pa = pw/ph, va = VIDEO_ASPECT;
  return (pa < va) ? new THREE.Vector2(pa/va, 1) : new THREE.Vector2(1, va/pa); }

function makeVideo(file){ const v = document.createElement('video');
  v.src = file; v.muted = v.loop = v.autoplay = v.playsInline = true;
  v.setAttribute('muted',''); v.setAttribute('playsinline',''); v.play().catch(()=>{});
  const tex = new THREE.VideoTexture(v); tex.colorSpace = THREE.SRGBColorSpace; return { v, tex }; }

function panel(file, pw, ph, tint){
  const { v, tex } = makeVideo(file);
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, uniforms: {
    map:{value:tex}, uShadow:{value:hex(tint.shadow)}, uHi:{value:hex(tint.highlight)},
    uStrength:{value:tint.strength}, uBright:{value:tint.brightness}, uContrast:{value:tint.contrast},
    uCover:{value:coverFor(pw, ph)} } });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat);
  mesh.userData = { video:v, mat }; return mesh;
}

function buildWall(group, files, axis, len, x0, z0, rotY, tint, mats, vids){
  const n = Math.max(1, Math.round(len / H)), pw = len / n;
  for (let i = 0; i < n; i++){
    const off = -len/2 + pw*(i + 0.5);
    const m = panel(files[i % files.length], pw*0.985, H, tint);
    if (axis === 'x') m.position.set(x0 + off, H/2, z0); else m.position.set(x0, H/2, z0 + off);
    m.rotation.y = rotY; group.add(m); mats.push(m.userData.mat); vids.push(m.userData.video);
  }
}

async function buildNeva(scene, clipFile, tint, mats, vids){
  const wd = await (await fetch(WATER_URL)).json();        // {space:"uv", water:[{rings:[outer,...holes]}]}
  const toV = c => { const p = uvToWorld(c[0], c[1], 0); return new THREE.Vector2(p.x, -p.z); };
  const geoms = [];
  for (const w of (wd.water || [])){
    const outer = (w.rings && w.rings[0]) || w.ring; if (!outer || outer.length < 4) continue;
    const pts = outer.map(toV); if (pts.length < 3) continue;
    const shape = new THREE.Shape(pts);
    for (let h = 1; w.rings && h < w.rings.length; h++){ const hp = w.rings[h].map(toV); if (hp.length >= 3) shape.holes.push(new THREE.Path(hp)); }
    const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI/2); geoms.push(g);
  }
  if (!geoms.length) return null;
  const bb = new THREE.Box3(); geoms.forEach(g => { g.computeBoundingBox(); bb.union(g.boundingBox); });
  const sx = (bb.max.x - bb.min.x) || 1, sz = (bb.max.z - bb.min.z) || 1;
  const { v, tex } = makeVideo(clipFile);
  const mat = new THREE.ShaderMaterial({ transparent:true, depthWrite:false, side:THREE.DoubleSide,
    vertexShader: NEVA_VERT, fragmentShader: NEVA_FRAG, uniforms: {
      tex:{value:tex}, time:{value:0}, camPos:{value:new THREE.Vector3()},
      uShadow:{value:hex(tint.shadow)}, uHi:{value:hex(tint.highlight)},
      uStrength:{value:tint.strength}, uBright:{value:tint.brightness}, uContrast:{value:tint.contrast},
      sky:{value:hex(0x33506e)}, fresBias:{value:0.16}, ripple:{value:0.06}, opacity:{value:0.96},
      sheen:{value:0.38}, spec:{value:1.1}, sunDir:{value:new THREE.Vector3(0.4,0.7,0.3).normalize()} } });
  for (const g of geoms){                                  // планарные UV по общему bbox русла
    const pos = g.attributes.position, uv = new Float32Array(pos.count*2);
    for (let i = 0; i < pos.count; i++){ uv[i*2] = (pos.getX(i)-bb.min.x)/sx; uv[i*2+1] = (pos.getZ(i)-bb.min.z)/sz; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const m = new THREE.Mesh(g, mat); m.position.y = 0.08; m.renderOrder = 1; scene.add(m);
  }
  mats.push(mat); vids.push(v); return mat;
}

// общий каркас сцены: рендерер, камера(fov 34), OrbitControls(параметры scene.js), карта-«пол»
function setupStage(canvas){
  const w = canvas.clientWidth || 1000, h = canvas.clientHeight || 700;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(w, h, false);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x05060a);
  const camera = new THREE.PerspectiveCamera(34, w/h, 0.1, 3000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 15; controls.maxDistance = 480; controls.maxPolarAngle = 1.45;
  const mapTex = new THREE.TextureLoader().load(MAP_URL);
  mapTex.colorSpace = THREE.SRGBColorSpace; mapTex.center.set(0.5, 0.5); mapTex.rotation = Math.PI;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(PW, PD),
    new THREE.MeshBasicMaterial({ map: mapTex, color: 0xb6b6bc, side: THREE.DoubleSide }));
  floor.rotation.x = -Math.PI/2; scene.add(floor);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(PW, PD)),
    new THREE.LineBasicMaterial({ color: 0x2a2e38 })); edges.rotation.x = -Math.PI/2; scene.add(edges);
  return { renderer, scene, camera, controls, mapTex, floor, mats: [], vids: [] };
}

// кадрируем (как в проекте: pitch≈50°, почти фронтально → карта горизонтальна) и запускаем цикл
function run(S, canvas, focusObjs){
  const bb = new THREE.Box3(); focusObjs.forEach(o => bb.union(new THREE.Box3().setFromObject(o)));
  const sph = bb.getBoundingSphere(new THREE.Sphere());
  const fit = sph.radius / Math.sin(THREE.MathUtils.degToRad(34)/2) * 1.08;
  const el = THREE.MathUtils.degToRad(50), az = THREE.MathUtils.degToRad(8);
  S.camera.position.set(
    sph.center.x + fit*Math.cos(el)*Math.sin(az),
    sph.center.y + fit*Math.sin(el),
    sph.center.z + fit*Math.cos(el)*Math.cos(az));
  S.controls.target.copy(sph.center); S.controls.update();
  const ro = new ResizeObserver(() => { const W = canvas.clientWidth, Hh = canvas.clientHeight; if (!W || !Hh) return;
    S.camera.aspect = W/Hh; S.camera.updateProjectionMatrix(); S.renderer.setSize(W, Hh, false); });
  ro.observe(canvas);
  const t0 = performance.now(); let raf = 0;
  const tick = () => { raf = requestAnimationFrame(tick); const tt = (performance.now() - t0) / 1000;
    S.mats.forEach(m => { const u = m.uniforms; if (u && u.time) u.time.value = tt; if (u && u.camPos) u.camPos.value.copy(S.camera.position); });
    S.controls.update(); S.renderer.render(S.scene, S.camera); };
  tick();
  R = Object.assign({}, S, { ro, raf });
}

window.MTK24Walls = {
  mount(canvas, sides, tint){                              // видео-стены по дальним граням
    this.unmount();
    const F = window.MTK24_FOOTAGE, file = id => (F.clips.find(c => c.id === id) || {}).file;
    const pool = ['storm_smoke','night_square','winter_roofline','smolny_congress','bridge_raising','gate_eagle','staircase_storm']
      .map(file).filter(Boolean);
    const S = setupStage(canvas);
    const g = new THREE.Group(); S.scene.add(g);
    buildWall(g, pool,                  'x', PW, 0,     -PD/2, 0,            tint, S.mats, S.vids); // задняя
    buildWall(g, pool.slice(3),         'z', PD, -PW/2, 0,     Math.PI/2,    tint, S.mats, S.vids); // левая
    if (sides >= 3)
      buildWall(g, pool.slice(5).concat(pool), 'z', PD, PW/2, 0, -Math.PI/2, tint, S.mats, S.vids); // правая
    run(S, canvas, [g, S.floor]);
  },

  async mountWater(canvas, tint, clipFile){                // вода Невы из проекта + видео на ней
    this.unmount();
    const S = setupStage(canvas);
    await buildNeva(S.scene, clipFile, tint, S.mats, S.vids);
    if (!R) run(S, canvas, [S.floor]);                      // если не отменили во время fetch
    else { S.renderer.dispose(); }
  },

  setTint(tint){
    if (!R) return;
    R.mats.forEach(m => { const u = m.uniforms;
      u.uShadow.value.set(tint.shadow); u.uHi.value.set(tint.highlight);
      u.uStrength.value = tint.strength; u.uBright.value = tint.brightness; u.uContrast.value = tint.contrast; });
  },

  active(){ return !!R; },

  unmount(){
    if (!R) return;
    cancelAnimationFrame(R.raf); R.ro.disconnect();
    R.vids.forEach(v => { v.pause(); v.removeAttribute('src'); v.load(); });
    R.scene.traverse(o => { if (o.geometry) o.geometry.dispose();
      const m = o.material; if (m){ if (m.uniforms) for (const k in m.uniforms){ const val = m.uniforms[k].value; if (val && val.isTexture) val.dispose(); }
        if (m.map) m.map.dispose(); m.dispose(); } });
    R.mapTex.dispose(); R.renderer.dispose(); R = null;
  }
};
