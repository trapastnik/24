/* МТК-24 · ДЕМО-каркас 3D-вариантов для usage.html (свободная орбита).
 * Сам рендерер/камера/орбита — здесь; КОНТЕНТ (стены, вода Невы, суша) строится
 * теми же функциями buildWalls/buildNeva из footage-fx.js, что пойдут и в сцену.
 * three / OrbitControls — как в основном проекте (importmap), параметры из scene.js. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildWalls, buildNeva } from './footage-fx.js';

const PD = 100, ASPECT = 1720 / 2048, PW = PD * ASPECT;
const WORLD = { PD, ASPECT, PW, uvToWorld: (u, v, y = 0) => new THREE.Vector3((u - 0.5) * PW, y, (v - 0.5) * PD) };
const MAP_URL = '../map/petrograd_2048.png';
let R = null;

function setupStage(canvas){
  const w = canvas.clientWidth || 1000, h = canvas.clientHeight || 700;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(w, h, false);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x05060a);
  const camera = new THREE.PerspectiveCamera(34, w/h, 0.1, 3000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 15; controls.maxDistance = 480; controls.maxPolarAngle = 1.45;
  const mapTex = new THREE.TextureLoader().load(MAP_URL); mapTex.colorSpace = THREE.SRGBColorSpace; mapTex.center.set(0.5, 0.5); mapTex.rotation = Math.PI;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(PW, PD), new THREE.MeshBasicMaterial({ map: mapTex, color: 0xb6b6bc, side: THREE.DoubleSide }));
  floor.rotation.x = -Math.PI/2; scene.add(floor);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(PW, PD)), new THREE.LineBasicMaterial({ color: 0x2a2e38 })); edges.rotation.x = -Math.PI/2; scene.add(edges);
  return { renderer, scene, camera, controls, mapTex, floor };
}

function run(S, canvas, focusObjs, handles){            // кадрируем как проект (pitch≈50°, почти фронтально) + цикл
  const bb = new THREE.Box3(); focusObjs.forEach(o => bb.union(new THREE.Box3().setFromObject(o)));
  const sph = bb.getBoundingSphere(new THREE.Sphere());
  const fit = sph.radius / Math.sin(THREE.MathUtils.degToRad(34)/2) * 1.08;
  const el = THREE.MathUtils.degToRad(50), az = THREE.MathUtils.degToRad(8);
  S.camera.position.set(sph.center.x + fit*Math.cos(el)*Math.sin(az), sph.center.y + fit*Math.sin(el), sph.center.z + fit*Math.cos(el)*Math.cos(az));
  S.controls.target.copy(sph.center); S.controls.update();
  const ro = new ResizeObserver(() => { const W = canvas.clientWidth, Hh = canvas.clientHeight; if (!W || !Hh) return; S.camera.aspect = W/Hh; S.camera.updateProjectionMatrix(); S.renderer.setSize(W, Hh, false); });
  ro.observe(canvas);
  const t0 = performance.now(); let raf = 0;
  const tick = () => { raf = requestAnimationFrame(tick); const tt = (performance.now() - t0) / 1000;
    handles.forEach(h => h.update && h.update(tt, S.camera.position)); S.controls.update(); S.renderer.render(S.scene, S.camera); };
  tick();
  R = Object.assign({}, S, { ro, raf, handles });
}

window.MTK24Walls = {
  mount(canvas, sides, tint){                            // видео-стены по дальним граням
    this.unmount();
    const F = window.MTK24_FOOTAGE, file = id => (F.clips.find(c => c.id === id) || {}).file;
    const pool = ['storm_smoke','night_square','winter_roofline','smolny_congress','bridge_raising','gate_eagle','staircase_storm'].map(file).filter(Boolean);
    const S = setupStage(canvas);
    const h = buildWalls(S.scene, { sides, files: pool, tint, world: WORLD });
    run(S, canvas, [h.object3d, S.floor], [h]);
  },
  async mountWater(canvas, tint, clipFile){              // вода Невы из проекта + видео
    this.unmount();
    const S = setupStage(canvas);
    const h = await buildNeva(S.scene, { clipFile, tint, invert: false, world: WORLD });
    if (!R) run(S, canvas, [S.floor], [h]); else { h.dispose(); S.renderer.dispose(); }
  },
  async mountLand(canvas, tint, clipFile){               // инверсия — видео на суше
    this.unmount();
    const S = setupStage(canvas);
    const h = await buildNeva(S.scene, { clipFile, tint, invert: true, world: WORLD });
    if (!R) run(S, canvas, [S.floor], [h]); else { h.dispose(); S.renderer.dispose(); }
  },
  setTint(tint){ if (!R) return; R.handles.forEach(h => h.setTint && h.setTint(tint)); },
  active(){ return !!R; },
  unmount(){
    if (!R) return;
    cancelAnimationFrame(R.raf); R.ro.disconnect();
    R.handles.forEach(h => { try { h.dispose && h.dispose(); } catch(e){} });
    R.floor.geometry.dispose(); R.floor.material.dispose(); R.mapTex.dispose(); R.renderer.dispose(); R = null;
  }
};
