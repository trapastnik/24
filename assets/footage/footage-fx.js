/* МТК-24 · footage-fx — встройка медиа-врезок в ОСНОВНУЮ СЦЕНУ.
 * Строители (buildWalls/buildNeva) + контроллер FootageFX, рассчитанные на ХОСТ-сцену
 * (получает её scene/camera/renderer/dom один раз через init). Те же примитивы, что в
 * scene.js: three, масштаб мира PW/PD/uvToWorld, риппл-вода (WATER) и русло Невы.
 *
 * Подключение в сцене (зона рабочего чата, ~4 строки):
 *   import { FootageFX } from "./assets/footage/footage-fx.js";
 *   FootageFX.init({ scene, camera, renderer, dom: overlayEl, dir:"assets/footage/",
 *                    world:{ PW, PD, uvToWorld }, waterData });   // world/waterData — из scene.js
 *   ["neva","walls","insert","background"].forEach(t => FX_BUILD[t] = f => FootageFX[t](f));
 *   // applyShot(i): FootageFX.beginShot();   frame(): FootageFX.update(animT);
 *
 * Эффект в сценарии = запись в fx кадра:
 *   { type:"neva", clip:"aurora_neva", tint:"vrkRed", invert?:bool, opacity?, at? }
 *   { type:"walls", sides:3, clips?:[ids], tint:"vrkRed" }
 *   { type:"insert", clip:"bridge_raising", style:"corner|lightbox", tint, at? }
 *   { type:"background", clip:"storm_smoke", mode:"texture|intro", tint, opacity? }
 */
import * as THREE from 'three';

// масштаб мира по умолчанию (как scene.js: PD=100, PW=PD*aspect карты). Хост может переопределить.
const DEF_WORLD = { PD: 100, ASPECT: 1720 / 2048,
  get PW(){ return this.PD * this.ASPECT; },
  uvToWorld(u, v, y = 0){ return new THREE.Vector3((u - 0.5) * this.PW, y, (v - 0.5) * this.PD); } };
const WATER_URL = '../../data/petrograd_water_map.json';
const VIDEO_ASPECT = 634 / 480, H = 46;
const DEF_WALL_POOL = ['storm_smoke','night_square','winter_roofline','smolny_congress','bridge_raising','gate_eagle','staircase_storm'];
const hex = c => new THREE.Color(c);

const VERT = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const FRAG = `uniform sampler2D map; uniform vec3 uShadow,uHi; uniform float uStrength,uBright,uContrast; uniform vec2 uCover; varying vec2 vUv;
  void main(){ vec2 uv=(vUv-0.5)*uCover+0.5; vec3 c=texture2D(map,uv).rgb;
    float l=dot(c,vec3(0.299,0.587,0.114)); l=clamp((l-0.5)*uContrast+0.5,0.0,1.0)*uBright;
    gl_FragColor=vec4(clamp(mix(vec3(l),mix(uShadow,uHi,clamp(l,0.0,1.0)),uStrength),0.0,1.0),1.0); }`;
const NEVA_VERT = `varying vec3 vW; varying vec2 vUv; void main(){ vUv=uv; vec4 wp=modelMatrix*vec4(position,1.0); vW=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp; }`;
const NEVA_FRAG = `uniform sampler2D tex; uniform float time,uStrength,uBright,uContrast,fresBias,ripple,opacity,sheen,spec; uniform vec3 camPos,uShadow,uHi,sky,sunDir; varying vec3 vW; varying vec2 vUv;
  void main(){ float nx=sin(vW.x*0.25+time*0.6)+sin((vW.x+vW.z)*0.17+time*0.8)*0.7; float nz=sin(vW.z*0.31-time*0.5)+sin((vW.x-vW.z)*0.21-time*0.7)*0.7;
    vec2 duv=clamp(vUv+vec2(nx,nz)*0.010,0.001,0.999); vec3 c=texture2D(tex,duv).rgb;
    float l=dot(c,vec3(0.299,0.587,0.114)); l=clamp((l-0.5)*uContrast+0.5,0.0,1.0)*uBright;
    vec3 col=mix(vec3(l),mix(uShadow,uHi,clamp(l,0.0,1.0)),uStrength);
    vec3 nrm=normalize(vec3(nx*ripple,1.0,nz*ripple)); vec3 view=normalize(camPos-vW);
    float fres=pow(1.0-max(dot(nrm,view),0.0),3.0); col=mix(col,sky,clamp(fres+fresBias,0.0,1.0)*sheen);
    vec3 sd=normalize(sunDir); col+=vec3(1.0,0.94,0.82)*pow(max(dot(reflect(-sd,nrm),view),0.0),90.0)*spec;
    gl_FragColor=vec4(col,opacity); }`;

const coverFor = (pw, ph) => { const pa = pw/ph; return (pa < VIDEO_ASPECT) ? new THREE.Vector2(pa/VIDEO_ASPECT, 1) : new THREE.Vector2(1, VIDEO_ASPECT/pa); };
function makeVideo(file){ const v = document.createElement('video');
  v.src = file; v.muted = v.loop = v.autoplay = v.playsInline = true; v.setAttribute('muted',''); v.setAttribute('playsinline',''); v.play().catch(()=>{});
  const tex = new THREE.VideoTexture(v); tex.colorSpace = THREE.SRGBColorSpace; return { v, tex }; }
const setTintU = (mats, T) => mats.forEach(m => { const u = m.uniforms; if (!u || !u.uShadow) return;
  u.uShadow.value.set(T.shadow); u.uHi.value.set(T.highlight); u.uStrength.value = T.strength; u.uBright.value = T.brightness; u.uContrast.value = T.contrast; });

function makeHandle(group, mats, vids){
  return { object3d: group, mats, vids,
    update(time, camPos){ mats.forEach(m => { const u = m.uniforms; if (u && u.time) u.time.value = time; if (u && u.camPos && camPos) u.camPos.value.copy(camPos); }); },
    setTint(T){ setTintU(mats, T); },
    dispose(){ vids.forEach(v => { try { v.pause(); v.removeAttribute('src'); v.load(); } catch(e){} });
      group.traverse(o => { if (o.geometry) o.geometry.dispose();
        const m = o.material; if (m){ if (m.uniforms) for (const k in m.uniforms){ const val = m.uniforms[k].value; if (val && val.isTexture) val.dispose(); } m.dispose(); } });   // m.dispose() общую текстуру карты не трогает
      if (group.parent) group.parent.remove(group); } };
}

// ── ВИДЕО-СТЕНЫ по дальним граням ─────────────────────────────────────
export function buildWalls(scene, { sides = 3, files, tint, world = DEF_WORLD }){
  const PW = world.PW, PD = world.PD, group = new THREE.Group(); scene.add(group);
  const mats = [], vids = [];
  const panel = (file, pw, ph) => { const { v, tex } = makeVideo(file);
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, uniforms: {
      map:{value:tex}, uShadow:{value:hex(tint.shadow)}, uHi:{value:hex(tint.highlight)},
      uStrength:{value:tint.strength}, uBright:{value:tint.brightness}, uContrast:{value:tint.contrast}, uCover:{value:coverFor(pw,ph)} } });
    mats.push(mat); vids.push(v); return new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat); };
  const wall = (arr, axis, len, x0, z0, rotY) => { const n = Math.max(1, Math.round(len/H)), pw = len/n;
    for (let i = 0; i < n; i++){ const off = -len/2 + pw*(i+0.5); const m = panel(arr[i%arr.length], pw*0.985, H);
      if (axis === 'x') m.position.set(x0+off, H/2, z0); else m.position.set(x0, H/2, z0+off); m.rotation.y = rotY; group.add(m); } };
  wall(files, 'x', PW, 0, -PD/2, 0);
  wall(files.slice(3).length ? files.slice(3) : files, 'z', PD, -PW/2, 0, Math.PI/2);
  if (sides >= 3) wall(files.slice(5).concat(files), 'z', PD, PW/2, 0, -Math.PI/2);
  return makeHandle(group, mats, vids);
}

// ── ВОДА НЕВЫ из проекта (invert=false) ИЛИ СУША (invert=true) + видео ──
// Вода: видео рябит на русле. Инверсия: видео на СПЛОШНОМ прямоугольнике суши (без дырок,
// без пробелов), а РЕКУ (из нашего слоя воды) показываем поверх — картой; РАМКА = край карты
// (видео с отступом frame, по краю проступает пол с гравированной рамкой). mapTexture — текстура
// карты пола (для реки в инверсии); без неё река заливается нейтральным серым.
export async function buildNeva(scene, { clipFile, tint, invert = false, frame = 0.05, world = DEF_WORLD, waterData = null, waterUrl = WATER_URL, mapTexture = null }){
  const wd = waterData || await (await fetch(waterUrl)).json();
  const PW = world.PW, PD = world.PD;
  const toV = c => { const p = world.uvToWorld(c[0], c[1], 0); return new THREE.Vector2(p.x, -p.z); };
  // геометрия русла Невы (полигоны с островами-дырами) — для воды и для оверлея-реки в инверсии
  const waterGeoms = [];
  for (const w of (wd.water || [])){
    const o = (w.rings && w.rings[0]) || w.ring; if (!o || o.length < 4) continue;
    const shape = new THREE.Shape(o.map(toV));
    for (let h = 1; w.rings && h < w.rings.length; h++){ const hp = w.rings[h].map(toV); if (hp.length >= 3) shape.holes.push(new THREE.Path(hp)); }
    const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI/2); waterGeoms.push(g);
  }
  const group = new THREE.Group(); scene.add(group);
  const { v, tex } = makeVideo(clipFile); const mats = [], vids = [v];

  // на чём ВИДЕО: инверсия → сплошной прямоугольник суши (отступ frame под рамку); вода → само русло
  let videoGeoms;
  if (invert){ const rx = PW*(0.5-frame), rz = PD*(0.5-frame); const g = new THREE.PlaneGeometry(rx*2, rz*2); g.rotateX(-Math.PI/2); videoGeoms = [g]; }
  else videoGeoms = waterGeoms;
  if (!videoGeoms.length) return makeHandle(group, [], []);
  const bb = new THREE.Box3(); videoGeoms.forEach(g => { g.computeBoundingBox(); bb.union(g.boundingBox); });
  const sx = (bb.max.x-bb.min.x)||1, sz = (bb.max.z-bb.min.z)||1;
  const W = !invert;
  const vmat = new THREE.ShaderMaterial({ transparent: W, depthWrite: !W, side:THREE.DoubleSide, vertexShader:NEVA_VERT, fragmentShader:NEVA_FRAG, uniforms:{
    tex:{value:tex}, time:{value:0}, camPos:{value:new THREE.Vector3()},
    uShadow:{value:hex(tint.shadow)}, uHi:{value:hex(tint.highlight)}, uStrength:{value:tint.strength}, uBright:{value:tint.brightness}, uContrast:{value:tint.contrast},
    sky:{value:hex(0x33506e)}, fresBias:{value:0.16}, ripple:{value: W?0.06:0.015}, opacity:{value: W?0.96:1.0}, sheen:{value: W?0.38:0.0}, spec:{value: W?1.1:0.0}, sunDir:{value:new THREE.Vector3(0.4,0.7,0.3).normalize()} } });
  for (const g of videoGeoms){ const pos = g.attributes.position, uv = new Float32Array(pos.count*2);
    for (let i = 0; i < pos.count; i++){ uv[i*2] = (pos.getX(i)-bb.min.x)/sx; uv[i*2+1] = 1.0 - (pos.getZ(i)-bb.min.z)/sz; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const m = new THREE.Mesh(g, vmat); m.position.y = W?0.08:0.05; m.renderOrder = 1; group.add(m); }
  mats.push(vmat);

  // ИНВЕРСИЯ: поверх видео — РЕКА из слоя воды, картой (UV как у пола). Рамка остаётся полом по краю.
  if (invert && waterGeoms.length){
    const wmat = mapTexture
      ? new THREE.MeshBasicMaterial({ map: mapTexture, color: 0xb6b6bc, side: THREE.DoubleSide })
      : new THREE.MeshBasicMaterial({ color: 0x8a8f99, side: THREE.DoubleSide });
    for (const g of waterGeoms){
      if (mapTexture){ const pos = g.attributes.position, uv = new Float32Array(pos.count*2);
        for (let i = 0; i < pos.count; i++){ uv[i*2] = pos.getX(i)/PW + 0.5; uv[i*2+1] = -pos.getZ(i)/PD + 0.5; }   // UV карты, как у пола
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); }
      const m = new THREE.Mesh(g, wmat); m.position.y = 0.11; m.renderOrder = 2; group.add(m);
    }
  }
  return makeHandle(group, mats, vids);
}

// ── DOM-врезки/фон (поверх канваса; стили инжектятся один раз) ─────────
let cssDone = false;
function ensureCss(){ if (cssDone) return; cssDone = true; const s = document.createElement('style'); s.textContent = `
  .ff-foot{position:relative;isolation:isolate;overflow:hidden;background:#000}
  .ff-foot video{display:block;width:100%;height:100%;object-fit:cover;filter:grayscale(1) brightness(var(--f-bright,1)) contrast(var(--f-contrast,1))}
  .ff-foot::before,.ff-foot::after{content:'';position:absolute;inset:0;pointer-events:none;opacity:var(--tint-strength,0)}
  .ff-foot::before{background:var(--tint-shadow);mix-blend-mode:multiply} .ff-foot::after{background:var(--tint-highlight);mix-blend-mode:screen}
  .ff-corner{position:absolute;right:3%;top:6%;width:30%;z-index:30;border:2px solid #d9b25a;border-radius:4px;box-shadow:0 10px 34px #000a}
  .ff-corner .ff-foot{aspect-ratio:634/480}
  .ff-lightbox{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;background:#0008}
  .ff-lightbox .ff-foot{width:54%;aspect-ratio:634/480;border:3px solid #fff2;box-shadow:0 24px 80px #000c;animation:ffbloom .6s ease both}
  .ff-bg{position:absolute;inset:0;z-index:5} .ff-bg.texture{mix-blend-mode:screen;opacity:.22}
  @keyframes ffbloom{from{transform:scale(.86);opacity:0}to{transform:scale(1);opacity:1}}`; document.head.appendChild(s); }
function domFoot(src, tint){ const box = document.createElement('div'); box.className = 'ff-foot';
  const v = document.createElement('video'); v.src = src; v.muted = v.loop = v.autoplay = v.playsInline = true; v.setAttribute('muted',''); v.setAttribute('playsinline','');
  box.appendChild(v); box.style.setProperty('--tint-shadow', tint.shadow); box.style.setProperty('--tint-highlight', tint.highlight);
  box.style.setProperty('--tint-strength', tint.strength); box.style.setProperty('--f-bright', tint.brightness); box.style.setProperty('--f-contrast', tint.contrast);
  return { box, v }; }

// ── Контроллер для сцены ───────────────────────────────────────────────
export const FootageFX = {
  host: null, cfg: null, _water: null, active: [],
  init(host){ ensureCss(); this.host = Object.assign({ dir: 'assets/footage/', world: DEF_WORLD, dom: null }, host); this.cfg = window.MTK24_FOOTAGE; return this; },
  _src(idOrFile){ if (!idOrFile) return null; const dir = this.host.dir;
    if (/\.(webm|mp4)$/.test(idOrFile)) return idOrFile.startsWith(dir) ? idOrFile : dir + idOrFile;
    const c = this.cfg.clips.find(x => x.id === idOrFile); return c ? dir + c.file : null; },
  _tint(t){ const P = this.cfg.tint.presets; if (!t) return P[this.cfg.tint.default]; return (typeof t === 'string') ? (P[t] || P[this.cfg.tint.default]) : t; },
  async _waterData(){ if (this.host.waterData) return this.host.waterData; if (this._water) return this._water; this._water = await (await fetch(this.host.waterUrl || WATER_URL)).json(); return this._water; },

  beginShot(){ this.clear(); },                          // вызывать при смене кадра
  clear(){ this.active.forEach(h => { try { h.dispose && h.dispose(); } catch(e){} }); this.active = []; if (this.host && this.host.dom) this.host.dom.innerHTML = ''; },
  update(time){ const cp = this.host && this.host.camera && this.host.camera.position; this.active.forEach(h => h.update && h.update(time, cp)); },
  setTint(t){ const T = this._tint(t); this.active.forEach(h => h.setTint && h.setTint(T)); },

  async neva(f){ const h = await buildNeva(this.host.scene, { clipFile: this._src(f.clip), tint: this._tint(f.tint), invert: !!f.invert, frame: (f.frame != null ? f.frame : 0.05), world: this.host.world, waterData: await this._waterData(), mapTexture: this.host.mapTexture || null });
    if (f.opacity != null && h.mats[0]) h.mats[0].uniforms.opacity.value = f.opacity; this.active.push(h); return h; },
  walls(f){ const files = (f.clips || DEF_WALL_POOL).map(x => this._src(x)).filter(Boolean);
    const h = buildWalls(this.host.scene, { sides: f.sides || 3, files, tint: this._tint(f.tint), world: this.host.world }); this.active.push(h); return h; },
  insert(f){ if (!this.host.dom) return null; const T = this._tint(f.tint); const { box, v } = domFoot(this._src(f.clip), T);
    const wrap = document.createElement('div'); wrap.className = (f.style === 'lightbox') ? 'ff-lightbox' : 'ff-corner'; wrap.appendChild(box); this.host.dom.appendChild(wrap);
    const h = { setTint(t){ box.style.setProperty('--tint-shadow', t.shadow); box.style.setProperty('--tint-highlight', t.highlight); box.style.setProperty('--tint-strength', t.strength); }, dispose(){ try { v.pause(); v.removeAttribute('src'); v.load(); } catch(e){} wrap.remove(); } }; this.active.push(h); return h; },
  background(f){ if (!this.host.dom) return null; const T = this._tint(f.tint); const { box, v } = domFoot(this._src(f.clip), T);
    box.classList.add('ff-bg'); if ((f.mode || 'texture') === 'texture') box.classList.add('texture'); if (f.opacity != null) box.style.opacity = f.opacity; this.host.dom.appendChild(box);
    const h = { setTint(t){ box.style.setProperty('--tint-shadow', t.shadow); box.style.setProperty('--tint-highlight', t.highlight); box.style.setProperty('--tint-strength', t.strength); }, dispose(){ try { v.pause(); v.removeAttribute('src'); v.load(); } catch(e){} box.remove(); } }; this.active.push(h); return h; },
};
if (typeof window !== 'undefined') window.FootageFX = FootageFX;
