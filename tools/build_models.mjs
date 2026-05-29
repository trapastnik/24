/* МТК №24 — генератор лёгких low-poly моделей ориентиров (→ assets/models/*.glb).
 *
 * Готовых бесплатных лёгких GLB по этим зданиям Петрограда нет, поэтому модели
 * собираются процедурно из примитивов в едином стиле и брендовой палитре
 * (paper / brass / red / graphite). Каждая — единицы тысяч треугольников.
 *
 * Зависимостей нет: glTF (.glb) пишется руками. Запуск:  node tools/build_models.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets", "models");
mkdirSync(OUT, { recursive: true });

// ----------------------------------------------------------------- палитра
// sRGB hex + PBR-параметры. baseColorFactor в glTF линейный — конвертируем.
const MAT = {
  paper:    { hex: 0xEDE6CF, metallic: 0.0, roughness: 0.85 },  // стены/камень
  stone:    { hex: 0xD8CBA8, metallic: 0.0, roughness: 0.8 },   // тёплый камень
  brass:    { hex: 0xCBA85C, metallic: 0.9, roughness: 0.35 },  // золото: шпили, купола
  red:      { hex: 0xA02128, metallic: 0.0, roughness: 0.55 },  // акценты, ватерлиния
  graphite: { hex: 0x3C474F, metallic: 0.15, roughness: 0.7 },  // кровли, корпус
  dark:     { hex: 0x222A30, metallic: 0.2, roughness: 0.6 },   // корпус корабля
  steel:    { hex: 0x707A82, metallic: 0.4, roughness: 0.5 },   // палуба, надстройки
};
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function linearRGBA(hex) {
  return [srgbToLinear(((hex >> 16) & 255) / 255), srgbToLinear(((hex >> 8) & 255) / 255), srgbToLinear((hex & 255) / 255), 1];
}

// ----------------------------------------------------------------- примитивы
// каждый возвращает { pos:[x,y,z...], nrm:[...], idx:[...] } в локальных координатах
function box(w, h, d) {
  const x = w / 2, y = h / 2, z = d / 2, pos = [], nrm = [], idx = [];
  // 6 граней с плоскими нормалями
  const faces = [
    { n: [0, 0, 1],  v: [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]] },     // +Z
    { n: [0, 0, -1], v: [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]] }, // -Z
    { n: [1, 0, 0],  v: [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]] },     // +X
    { n: [-1, 0, 0], v: [[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]] }, // -X
    { n: [0, 1, 0],  v: [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]] },     // +Y
    { n: [0, -1, 0], v: [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]] }, // -Y
  ];
  for (const f of faces) {
    const b = pos.length / 3;
    for (const v of f.v) { pos.push(...v); nrm.push(...f.n); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { pos, nrm, idx };
}

// усечённый конус / цилиндр вертикально (база y=0 .. верх y=h)
function cyl(rTop, rBot, h, seg = 12, capTop = true, capBot = true) {
  const pos = [], nrm = [], idx = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const nx = Math.cos(am), nz = Math.sin(am), b = pos.length / 3;
    pos.push(rBot * c0, 0, rBot * s0,  rBot * c1, 0, rBot * s1,  rTop * c1, h, rTop * s1,  rTop * c0, h, rTop * s0);
    for (let k = 0; k < 4; k++) nrm.push(nx, 0, nz);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  if (capTop && rTop > 1e-4) capFan(pos, nrm, idx, rTop, h, seg, 1);
  if (capBot && rBot > 1e-4) capFan(pos, nrm, idx, rBot, 0, seg, -1);
  return { pos, nrm, idx };
}
function capFan(pos, nrm, idx, r, y, seg, dir) {
  const c = pos.length / 3; pos.push(0, y, 0); nrm.push(0, dir, 0);
  for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; pos.push(r * Math.cos(a), y, r * Math.sin(a)); nrm.push(0, dir, 0); }
  for (let i = 0; i < seg; i++) { if (dir > 0) idx.push(c, c + 1 + i, c + 2 + i); else idx.push(c, c + 2 + i, c + 1 + i); }
}

// купол: полу-сфероид (база y=0, радиус r → верх y=h)
function dome(r, h, seg = 12, rings = 5) {
  const pos = [], nrm = [], idx = [];
  const ring = (t) => { const ph = (t * Math.PI) / 2; return { rr: r * Math.cos(ph), yy: h * Math.sin(ph) }; };
  for (let s = 0; s < rings; s++) {
    const a = ring(s / rings), b = ring((s + 1) / rings);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p = (rr, yy, ang) => [rr * Math.cos(ang), yy, rr * Math.sin(ang)];
      const v0 = p(a.rr, a.yy, a0), v1 = p(a.rr, a.yy, a1), v2 = p(b.rr, b.yy, a1), v3 = p(b.rr, b.yy, a0);
      const base = pos.length / 3;
      for (const v of [v0, v1, v2, v3]) { pos.push(...v); const L = Math.hypot(v[0], v[1] + 0.001, v[2]) || 1; nrm.push(v[0] / L, (v[1] + 0.001) / L, v[2] / L); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { pos, nrm, idx };
}

// треугольная призма-нос (для корабля): длина по X, высота по Y, ширина по Z, остриё на +X
function bowPrism(len, h, w) {
  const x = len, y = h / 2, z = w / 2, pos = [], nrm = [], idx = [];
  const tip = [x, -y, 0], tipT = [x, y, 0], bl = [0, -y, -z], br = [0, -y, z], tl = [0, y, -z], tr = [0, y, z];
  const quad = (a, b, c, d, n) => { const base = pos.length / 3; for (const v of [a, b, c, d]) { pos.push(...v); nrm.push(...n); } idx.push(base, base + 1, base + 2, base, base + 2, base + 3); };
  const tri = (a, b, c, n) => { const base = pos.length / 3; for (const v of [a, b, c]) { pos.push(...v); nrm.push(...n); } idx.push(base, base + 1, base + 2); };
  quad(br, tip, tipT, tr, [0.7, 0, 0.7]);  // правый борт к носу
  quad(tip, bl, tl, tipT, [0.7, 0, -0.7]); // левый борт к носу
  quad(bl, br, tr, tl, [-1, 0, 0]);        // корма призмы (стык с корпусом)
  tri(bl, tip, br, [0, -1, 0]);            // дно
  tri(tl, tr, tipT, [0, 1, 0]);            // палуба
  return { pos, nrm, idx };
}

// ----------------------------------------------------------------- сборка модели
class Model {
  constructor(name) { this.name = name; this.parts = new Map(); }
  add(geo, { mat, pos = [0, 0, 0], scale = [1, 1, 1], ry = 0 } = {}) {
    const [sx, sy, sz] = Array.isArray(scale) ? scale : [scale, scale, scale];
    const [tx, ty, tz] = pos, ca = Math.cos(ry), sa = Math.sin(ry);
    const key = mat;
    if (!this.parts.has(key)) this.parts.set(key, { pos: [], nrm: [], idx: [], mat });
    const part = this.parts.get(key), off = part.pos.length / 3;
    for (let i = 0; i < geo.pos.length; i += 3) {
      let x = geo.pos[i] * sx, y = geo.pos[i + 1] * sy, z = geo.pos[i + 2] * sz;
      const rx = x * ca + z * sa, rz = -x * sa + z * ca;
      part.pos.push(rx + tx, y + ty, rz + tz);
      let nx = geo.nrm[i], ny = geo.nrm[i + 1], nz = geo.nrm[i + 2];
      const rnx = nx * ca + nz * sa, rnz = -nx * sa + nz * ca, L = Math.hypot(rnx, ny, rnz) || 1;
      part.nrm.push(rnx / L, ny / L, rnz / L);
    }
    for (const id of geo.idx) part.idx.push(id + off);
    return this;
  }
}

// ----------------------------------------------------------------- ориентиры
// единицы условные; во вьюере модель нормируется по высоте. база ≈ y=0.

function smolny() {
  // Смольный собор: квадратный объём + центральный купол на барабане + 4 угловые главки
  const m = new Model("smolny");
  m.add(box(7, 5, 7), { mat: "paper", pos: [0, 2.5, 0] });
  m.add(box(7.6, 1, 7.6), { mat: "graphite", pos: [0, 5.2, 0] });      // карниз/кровля
  // центральная глава
  m.add(cyl(2, 2.2, 3, 12), { mat: "paper", pos: [0, 5.7, 0] });        // барабан
  m.add(dome(2.2, 3.2, 14, 6), { mat: "brass", pos: [0, 8.7, 0] });     // купол
  m.add(cyl(0.25, 0.4, 1.2, 8), { mat: "brass", pos: [0, 11.9, 0] });   // фонарик
  m.add(cyl(0, 0.12, 1.4, 6), { mat: "brass", pos: [0, 13.1, 0] });     // главка
  // 4 угловые башенки
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const px = sx * 2.6, pz = sz * 2.6;
    m.add(cyl(0.8, 0.9, 2, 10), { mat: "paper", pos: [px, 5.7, pz] });
    m.add(dome(0.95, 1.4, 10, 5), { mat: "brass", pos: [px, 7.7, pz] });
    m.add(cyl(0, 0.07, 0.8, 6), { mat: "brass", pos: [px, 9.1, pz] });
  }
  return m;
}

function winter() {
  // Зимний дворец: длинный низкий барочный блок, чуть выше центр, парапет + статуи
  const m = new Model("winter");
  m.add(box(20, 5, 6), { mat: "paper", pos: [0, 2.5, 0] });             // главный корпус
  m.add(box(7, 6.2, 6.4), { mat: "paper", pos: [0, 3.1, 0] });          // центральный ризалит
  m.add(box(20.6, 0.7, 6.6), { mat: "brass", pos: [0, 5.2, 0] });       // карниз
  m.add(box(7.4, 0.7, 6.8), { mat: "brass", pos: [0, 6.6, 0] });        // карниз центра
  m.add(box(20.6, 0.5, 6.6), { mat: "graphite", pos: [0, 5.7, 0] });    // кровля-парапет
  // ряд кровельных статуй (намёк)
  for (let i = -9; i <= 9; i += 1.8) m.add(box(0.3, 0.9, 0.3), { mat: "stone", pos: [i, 6.4, 2.9] });
  // фланговые акценты
  m.add(box(2, 5.6, 6.2), { mat: "paper", pos: [-9.2, 2.8, 0] });
  m.add(box(2, 5.6, 6.2), { mat: "paper", pos: [9.2, 2.8, 0] });
  return m;
}

function fortress() {
  // Петропавловский собор — узнаваемый золотой шпиль (визитка крепости)
  const m = new Model("fortress");
  m.add(box(5, 3, 8), { mat: "paper", pos: [0, 1.5, 2] });              // тело собора
  m.add(box(5.4, 0.6, 8.4), { mat: "graphite", pos: [0, 3.1, 2] });     // кровля
  // ступенчатая колокольня
  m.add(box(3.4, 4, 3.4), { mat: "paper", pos: [0, 2, -2.2] });
  m.add(box(2.8, 3, 2.8), { mat: "paper", pos: [0, 5.5, -2.2] });
  m.add(box(2.2, 2.5, 2.2), { mat: "stone", pos: [0, 8.2, -2.2] });
  m.add(cyl(1.2, 1.6, 2, 8), { mat: "brass", pos: [0, 9.4, -2.2] });    // золотой барабан
  // шпиль: очень высокий тонкий конус + игла + крест-намёк
  m.add(cyl(0.18, 1.1, 12, 8), { mat: "brass", pos: [0, 11.4, -2.2] }); // шпиль
  m.add(cyl(0, 0.16, 2.4, 6), { mat: "brass", pos: [0, 23.4, -2.2] });  // игла
  m.add(box(0.7, 0.12, 0.12), { mat: "brass", pos: [0, 25.4, -2.2] });  // перекладина креста
  return m;
}

function mariinsky() {
  // Мариинский дворец: классицистический блок + центральный портик с колоннами + аттик
  const m = new Model("mariinsky");
  m.add(box(14, 5.5, 6), { mat: "stone", pos: [0, 2.75, 0] });
  m.add(box(14.4, 0.6, 6.4), { mat: "paper", pos: [0, 5.6, 0] });       // карниз
  m.add(box(14, 0.5, 6.2), { mat: "graphite", pos: [0, 6.1, 0] });      // кровля
  m.add(box(6.5, 4.6, 1.2), { mat: "stone", pos: [0, 2.3, 3.2] });      // ризалит-портик
  // колонны портика
  for (let i = -2.4; i <= 2.4; i += 1.2) m.add(cyl(0.32, 0.32, 4, 8), { mat: "paper", pos: [i, 0, 3.9] });
  m.add(box(6.8, 1, 1.6), { mat: "paper", pos: [0, 4.6, 3.4] });        // антаблемент
  m.add(box(5.5, 1.6, 1.2), { mat: "stone", pos: [0, 6.4, 0] });        // аттик
  return m;
}

function tauride() {
  // Таврический дворец: центральный купол + 6-колонный портик + низкие крылья
  const m = new Model("tauride");
  m.add(box(8, 5, 6), { mat: "stone", pos: [0, 2.5, 0] });              // центр
  m.add(box(6, 4, 5), { mat: "stone", pos: [-9, 2, 0] });               // левое крыло
  m.add(box(6, 4, 5), { mat: "stone", pos: [9, 2, 0] });                // правое крыло
  m.add(box(4, 4, 4.5), { mat: "stone", pos: [-5.5, 2, 0] });           // галерея
  m.add(box(4, 4, 4.5), { mat: "stone", pos: [5.5, 2, 0] });
  m.add(box(8.4, 0.6, 6.4), { mat: "paper", pos: [0, 5.3, 0] });        // карниз
  // портик
  for (let i = -2.5; i <= 2.5; i += 1) m.add(cyl(0.3, 0.3, 4.2, 8), { mat: "paper", pos: [i, 0, 3.3] });
  m.add(box(6.5, 1, 1.4), { mat: "paper", pos: [0, 4.2, 3.1] });
  // купол на барабане
  m.add(cyl(2, 2.2, 1.6, 14), { mat: "stone", pos: [0, 5.6, 0] });
  m.add(dome(2.2, 2.6, 16, 6), { mat: "graphite", pos: [0, 7.2, 0] });
  m.add(cyl(0, 0.1, 0.8, 6), { mat: "brass", pos: [0, 9.8, 0] });
  return m;
}

function aurora() {
  // Крейсер «Аврора»: длинный тёмный корпус + нос + 3 трубы + 2 мачты + орудия
  const m = new Model("aurora");
  const HULL = 24, BEAM = 4.2;
  m.add(box(HULL, 2.6, BEAM), { mat: "dark", pos: [0, 1.3, 0] });        // корпус
  m.add(bowPrism(4.5, 2.6, BEAM), { mat: "dark", pos: [HULL / 2, 1.3, 0] }); // нос
  m.add(box(HULL, 0.4, BEAM + 0.1), { mat: "red", pos: [0, 0.4, 0] });   // ватерлиния
  m.add(box(HULL - 2, 0.4, BEAM - 0.4), { mat: "steel", pos: [0, 2.7, 0] }); // палуба
  // надстройки
  m.add(box(5, 1.6, 3), { mat: "steel", pos: [-1, 3.5, 0] });
  m.add(box(2.4, 2, 2.2), { mat: "steel", pos: [3, 3.9, 0] });           // мостик
  // 3 трубы
  for (const x of [3.5, -1, -5.5]) {
    m.add(cyl(0.7, 0.8, 3.6, 12), { mat: "graphite", pos: [x, 2.9, 0] });
    m.add(cyl(0.85, 0.85, 0.3, 12), { mat: "brass", pos: [x, 6.5, 0] }); // ободок
  }
  // 2 мачты
  m.add(cyl(0.12, 0.18, 8, 6), { mat: "brass", pos: [5, 3, 0] });
  m.add(cyl(0.12, 0.18, 7, 6), { mat: "brass", pos: [-7, 3, 0] });
  // носовое орудие (символ выстрела)
  m.add(box(1.6, 1, 1.8), { mat: "steel", pos: [8.5, 3.2, 0] });
  m.add(cyl(0.18, 0.22, 2.6, 8), { mat: "graphite", pos: [8.5, 3.6, 0], ry: 0, scale: [1, 1, 1] });
  // ствол вперёд (наклон через короткий бокс)
  m.add(box(2.6, 0.32, 0.32), { mat: "graphite", pos: [10, 3.7, 0] });
  return m;
}

// ----------------------------------------------------------------- запись GLB
function writeGLB(model) {
  const accessors = [], bufferViews = [], materials = [], primitives = [];
  const chunks = []; let byteLen = 0;
  const matIndex = new Map();
  const pushView = (typed, target) => {
    while (byteLen % 4 !== 0) { chunks.push(Buffer.from([0])); byteLen += 1; }
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const view = { buffer: 0, byteOffset: byteLen, byteLength: buf.length, target };
    chunks.push(buf); byteLen += buf.length; bufferViews.push(view); return bufferViews.length - 1;
  };
  for (const part of model.parts.values()) {
    const nVerts = part.pos.length / 3;
    const positions = Float32Array.from(part.pos), normals = Float32Array.from(part.nrm);
    const indices = Uint16Array.from(part.idx);
    // min/max для POSITION (требование glTF)
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]); max[k] = Math.max(max[k], positions[i + k]);
    }
    const posView = pushView(positions, 34962);
    accessors.push({ bufferView: posView, componentType: 5126, count: nVerts, type: "VEC3", min, max });
    const posAcc = accessors.length - 1;
    const nrmView = pushView(normals, 34962);
    accessors.push({ bufferView: nrmView, componentType: 5126, count: nVerts, type: "VEC3" });
    const nrmAcc = accessors.length - 1;
    const idxView = pushView(indices, 34963);
    accessors.push({ bufferView: idxView, componentType: 5123, count: indices.length, type: "SCALAR" });
    const idxAcc = accessors.length - 1;
    // материал (по имени — переиспользуем)
    if (!matIndex.has(part.mat)) {
      const def = MAT[part.mat];
      materials.push({ name: part.mat, doubleSided: true, pbrMetallicRoughness: { baseColorFactor: linearRGBA(def.hex), metallicFactor: def.metallic, roughnessFactor: def.roughness } });
      matIndex.set(part.mat, materials.length - 1);
    }
    primitives.push({ attributes: { POSITION: posAcc, NORMAL: nrmAcc }, indices: idxAcc, material: matIndex.get(part.mat) });
  }
  const gltf = {
    asset: { version: "2.0", generator: "MTK24 build_models.mjs" },
    scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: model.name, mesh: 0 }],
    meshes: [{ name: model.name, primitives }],
    materials, accessors, bufferViews, buffers: [{ byteLength: byteLen }],
  };
  // упаковка GLB
  const bin = Buffer.concat(chunks);
  let json = Buffer.from(JSON.stringify(gltf), "utf8");
  while (json.length % 4 !== 0) json = Buffer.concat([json, Buffer.from(" ")]);
  let binPad = bin; while (binPad.length % 4 !== 0) binPad = Buffer.concat([binPad, Buffer.from([0])]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + binPad.length, 8);
  const jsonHead = Buffer.alloc(8); jsonHead.writeUInt32LE(json.length, 0); jsonHead.writeUInt32LE(0x4e4f534a, 4);
  const binHead = Buffer.alloc(8); binHead.writeUInt32LE(binPad.length, 0); binHead.writeUInt32LE(0x004e4942, 4);
  const glb = Buffer.concat([header, jsonHead, json, binHead, binPad]);

  let tris = 0; for (const p of model.parts.values()) tris += p.idx.length / 3;
  const file = join(OUT, model.name + ".glb");
  writeFileSync(file, glb);
  return { name: model.name, tris, kb: (glb.length / 1024).toFixed(1), parts: model.parts.size };
}

// ----------------------------------------------------------------- main
const builders = [smolny, winter, fortress, mariinsky, tauride, aurora];
console.log("Генерация low-poly моделей → assets/models/\n");
let totalTris = 0, totalKb = 0;
for (const b of builders) {
  const r = writeGLB(b());
  totalTris += r.tris; totalKb += parseFloat(r.kb);
  console.log(`  ${r.name.padEnd(11)} ${String(r.tris).padStart(5)} трис  ${r.kb.padStart(6)} KB  (${r.parts} мат.)`);
}
console.log(`\n  итого: ${totalTris} трис, ${totalKb.toFixed(1)} KB в ${builders.length} файлах`);
