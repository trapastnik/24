/* МТК №24 — генератор лёгких low-poly моделей ориентиров (→ assets/models/*.glb).
 *
 * Готовых бесплатных лёгких GLB по этим зданиям Петрограда нет, поэтому модели
 * собираются процедурно из примитивов в едином стиле и брендовой палитре
 * (paper / brass / red / graphite). Каждая — единицы тысяч треугольников.
 *
 * Зависимостей нет: glTF (.glb) пишется руками. Запуск:  node tools/build_models.mjs
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets", "models");
mkdirSync(OUT, { recursive: true });

// ----------------------------------------------------------------- палитра / материалы
// Плоские материалы — sRGB hex + PBR. Текстурные фасады (tex:true) — tint множит
// процедурную PBR-текстуру (base/normal/roughness/emissive-окна). baseColorFactor линейный.
const MAT = {
  paper:    { hex: 0xEDE6CF, metallic: 0.0, roughness: 0.85 },  // карнизы/колонны/детали
  stone:    { hex: 0xD8CBA8, metallic: 0.0, roughness: 0.8 },   // камень-детали
  brass:    { hex: 0xCBA85C, metallic: 0.9, roughness: 0.35 },  // золото: шпили, купола
  red:      { hex: 0xA02128, metallic: 0.0, roughness: 0.55 },  // акценты, ватерлиния
  graphite: { hex: 0x3C474F, metallic: 0.15, roughness: 0.7 },  // кровли, корпус
  dark:     { hex: 0x222A30, metallic: 0.2, roughness: 0.6 },   // корпус корабля
  steel:    { hex: 0x707A82, metallic: 0.4, roughness: 0.5 },   // палуба, надстройки
  // текстурированные фасады (окна + рельеф + ночное свечение):
  facadePale:  { tint: 0xF0E9D6, metallic: 0.0, roughness: 1.0, tex: true },  // бело-палевый (Зимний, Смольный)
  facadeStone: { tint: 0xDCCFAD, metallic: 0.0, roughness: 1.0, tex: true },  // тёплый камень (дворцы)
  facadeRed:   { tint: 0xC08A78, metallic: 0.0, roughness: 1.0, tex: true },  // охра/терракота
  // РЕАЛЬНЫЕ PBR-карты (Poly Haven CC0, assets/models/ref/apartments/textures) — diff/normal/arm:
  realPlaster: { real: true, base: "plaster_diff_1k.jpg",  nor: "plaster_nor_gl_1k.jpg",  arm: "plaster_arm_1k.jpg" },   // стены
  realTrim:    { real: true, base: "trim_01_diff_1k.jpg",  nor: "trim_01_nor_gl_1k.jpg",  arm: "trim_01_arm_1k.jpg" },   // камень/трим (цоколь, карниз, пилястры)
  // стекло окон (тёмное, глянцевое, светится ночью) и тёмная рама:
  glass:       { hex: 0x0A0E16, metallic: 0.1, roughness: 0.18, emit: 0xFFB060, emitStr: 2.2 },
  frame:       { hex: 0x2A2622, metallic: 0.0, roughness: 0.6 },
};
const PHX = "modular_urban_apartments_facade_";                       // префикс файлов Poly Haven
const TEXDIR = join(OUT, "ref", "apartments", "textures");
const realFile = (name) => join(TEXDIR, PHX + name);
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function linearRGBA(hex) {
  return [srgbToLinear(((hex >> 16) & 255) / 255), srgbToLinear(((hex >> 8) & 255) / 255), srgbToLinear((hex & 255) / 255), 1];
}

// ----------------------------------------------------------------- процедурные PBR-текстуры фасада
// Тайл-ячейка с одним окном (бесшовная по краям-стене). 4 карты: base / normal / mr / emissive.
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return (c ^ 0xFFFFFFFF) >>> 0; }
function pngChunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const body = Buffer.concat([Buffer.from(type, "ascii"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0); return Buffer.concat([len, body, crc]); }
function encodePNG(w, h, rgba) {  // RGBA8 → PNG (color type 6, фильтр 0)
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = w * 4, raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; for (let x = 0; x < stride; x++) raw[y * (stride + 1) + 1 + x] = rgba[y * stride + x]; }
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw, { level: 9 })), pngChunk("IEND", Buffer.alloc(0))]);
}
function facadeTextures(S = 128) {
  const base = new Uint8Array(S * S * 4), emit = new Uint8Array(S * S * 4), mr = new Uint8Array(S * S * 4), norm = new Uint8Array(S * S * 4);
  const height = new Float32Array(S * S);
  const wx0 = (S * 0.30) | 0, wx1 = (S * 0.70) | 0, wy0 = (S * 0.16) | 0, wy1 = (S * 0.84) | 0;
  const fr = Math.max(2, (S * 0.028) | 0);                       // рамка окна
  const wall = [206, 200, 187], frame = [54, 50, 45], glass = [38, 47, 60], sill = [150, 144, 130];
  const set = (a, i, r, g, b) => { a[i] = r; a[i + 1] = g; a[i + 2] = b; a[i + 3] = 255; };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const inW = x >= wx0 && x < wx1 && y >= wy0 && y < wy1;
    const onFr = inW && (x < wx0 + fr || x >= wx1 - fr || y < wy0 + fr || y >= wy1 - fr);
    const mull = inW && (Math.abs(x - (wx0 + wx1) / 2) < 1.2 || Math.abs(y - (wy0 + wy1) / 2) < 1.2);
    const onSill = x >= wx0 - fr && x < wx1 + fr && y >= wy1 && y < wy1 + fr;
    let col = wall, h = 0.55, rough = 240, metal = 0, em = [0, 0, 0];
    if (onSill) { col = sill; h = 0.9; rough = 215; }
    else if (onFr || mull) { col = frame; h = 0.72; rough = 170; }
    else if (inW) { col = glass; h = 0.18; rough = 40; metal = 12; em = [255, 178, 96]; }     // стекло: глянец + тёплое свечение
    else { const n = ((x * 5 + y * 11) % 13) - 6; col = [wall[0] + n, wall[1] + n, wall[2] + n]; if (y % ((S / 3) | 0) === 0) { col = [wall[0] - 16, wall[1] - 16, wall[2] - 16]; h = 0.48; } } // штукатурка + межэтажные тяги
    set(base, i, col[0], col[1], col[2]); set(emit, i, em[0], em[1], em[2]); set(mr, i, 255, rough, metal);
    height[y * S + x] = h;
  }
  const hAt = (x, y) => height[((y % S) + S) % S * S + (((x % S) + S) % S)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4, st = 2.4;
    let nx = -(hAt(x + 1, y) - hAt(x - 1, y)) * st, ny = (hAt(x, y + 1) - hAt(x, y - 1)) * st, nz = 1;
    const L = Math.hypot(nx, ny, nz);
    set(norm, i, ((nx / L * 0.5 + 0.5) * 255) | 0, ((ny / L * 0.5 + 0.5) * 255) | 0, ((nz / L * 0.5 + 0.5) * 255) | 0);
  }
  return { base: encodePNG(S, S, base), norm: encodePNG(S, S, norm), mr: encodePNG(S, S, mr), emit: encodePNG(S, S, emit) };
}
let _facadeTex = null;
const facadeTex = () => _facadeTex || (_facadeTex = facadeTextures(128));
const TILE = 2.3;   // мировых единиц на повтор фасадной ячейки (≈ шаг окон)

// ----------------------------------------------------------------- примитивы
// каждый возвращает { pos:[x,y,z...], nrm:[...], idx:[...] } в локальных координатах
function box(w, h, d) {
  const x = w / 2, y = h / 2, z = d / 2, T = TILE, pos = [], nrm = [], idx = [], uv = [];
  // 6 граней с плоскими нормалями + планарная UV (масштаб TILE, чтобы окна повторялись)
  const faces = [
    { n: [0, 0, 1],  v: [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]],     uv: [[-x/T, -y/T], [x/T, -y/T], [x/T, y/T], [-x/T, y/T]] }, // +Z
    { n: [0, 0, -1], v: [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]], uv: [[-x/T, -y/T], [x/T, -y/T], [x/T, y/T], [-x/T, y/T]] }, // -Z
    { n: [1, 0, 0],  v: [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]],     uv: [[-z/T, -y/T], [z/T, -y/T], [z/T, y/T], [-z/T, y/T]] }, // +X
    { n: [-1, 0, 0], v: [[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]], uv: [[-z/T, -y/T], [z/T, -y/T], [z/T, y/T], [-z/T, y/T]] }, // -X
    { n: [0, 1, 0],  v: [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]],     uv: [[-x/T, -z/T], [x/T, -z/T], [x/T, z/T], [-x/T, z/T]] }, // +Y
    { n: [0, -1, 0], v: [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]], uv: [[-x/T, -z/T], [x/T, -z/T], [x/T, z/T], [-x/T, z/T]] }, // -Y
  ];
  for (const f of faces) {
    const b = pos.length / 3;
    for (let k = 0; k < 4; k++) { pos.push(...f.v[k]); nrm.push(...f.n); uv.push(...f.uv[k]); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { pos, nrm, idx, uv };
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

// фронтон/гейбл: треугольное сечение в XY (основание w, вершина h), выдавлено по Z на d
function gable(w, h, d) {
  const x = w / 2, z = d / 2, pos = [], nrm = [], idx = [];
  const A = [-x, 0, z], B = [x, 0, z], P = [0, h, z];        // фронт (+Z)
  const A2 = [-x, 0, -z], B2 = [x, 0, -z], P2 = [0, h, -z];  // тыл (−Z)
  const tri = (a, b, c, n) => { const b0 = pos.length / 3; for (const v of [a, b, c]) { pos.push(...v); nrm.push(...n); } idx.push(b0, b0 + 1, b0 + 2); };
  const quad = (a, b, c, dd, n) => { const b0 = pos.length / 3; for (const v of [a, b, c, dd]) { pos.push(...v); nrm.push(...n); } idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3); };
  tri(A, B, P, [0, 0, 1]);
  tri(B2, A2, P2, [0, 0, -1]);
  quad(A2, B2, B, A, [0, -1, 0]);        // низ
  quad(A2, A, P, P2, [-0.7, 0.7, 0]);    // левый скат
  quad(B, B2, P2, P, [0.7, 0.7, 0]);     // правый скат
  return { pos, nrm, idx };
}

// ----------------------------------------------------------------- сборка модели
class Model {
  constructor(name) { this.name = name; this.parts = new Map(); }
  add(geo, { mat, pos = [0, 0, 0], scale = [1, 1, 1], ry = 0 } = {}) {
    const [sx, sy, sz] = Array.isArray(scale) ? scale : [scale, scale, scale];
    const [tx, ty, tz] = pos, ca = Math.cos(ry), sa = Math.sin(ry);
    const key = mat;
    if (!this.parts.has(key)) this.parts.set(key, { pos: [], nrm: [], idx: [], uv: [], mat });
    const part = this.parts.get(key), off = part.pos.length / 3, nV = geo.pos.length / 3;
    for (let i = 0; i < geo.pos.length; i += 3) {
      let x = geo.pos[i] * sx, y = geo.pos[i + 1] * sy, z = geo.pos[i + 2] * sz;
      const rx = x * ca + z * sa, rz = -x * sa + z * ca;
      part.pos.push(rx + tx, y + ty, rz + tz);
      let nx = geo.nrm[i], ny = geo.nrm[i + 1], nz = geo.nrm[i + 2];
      const rnx = nx * ca + nz * sa, rnz = -nx * sa + nz * ca, L = Math.hypot(rnx, ny, rnz) || 1;
      part.nrm.push(rnx / L, ny / L, rnz / L);
    }
    // UV: без трансформации; для примитивов без uv — нули (текстура к ним всё равно не привязана)
    if (geo.uv) for (const u of geo.uv) part.uv.push(u);
    else for (let i = 0; i < nV * 2; i++) part.uv.push(0);
    for (const id of geo.idx) part.idx.push(id + off);
    return this;
  }
}

// ----------------------------------------------------------------- ориентиры
// единицы условные; во вьюере модель нормируется по высоте. база ≈ y=0.

// классицистический рельеф: выступающий цоколь + ритмический ряд пилястр по фасадам (+Z/−Z)
function relief(m, { w, d, h, y0 = 0, pil = "realTrim", base = "realTrim", plinth = true, step = 2.4 }) {
  const fz = d / 2 + 0.1;
  if (plinth) m.add(box(w + 0.5, 0.7, d + 0.5), { mat: base, pos: [0, y0 + 0.35, 0] });
  const n = Math.max(2, Math.round(w / step));
  for (let i = 0; i <= n; i++) {
    const x = -w / 2 + (w * i) / n;
    for (const z of [fz, -fz]) m.add(box(0.45, h - 0.5, 0.3), { mat: pil, pos: [x, y0 + (h - 0.5) / 2 + 0.35, z] });
  }
}

// сетка окон (рама + светящееся стекло) по всем 4 фасадам блока с центром (cx,cz)
function windows(m, { w, d, h, y0 = 0, cx = 0, cz = 0, floorH = 2.3, colStep = 2.6, inset = 0.06 }) {
  const rows = Math.max(1, Math.floor(h / floorH));
  const grid = (faceLen, axis, sign, half) => {
    const cols = Math.max(1, Math.floor(faceLen / colStep));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const u = -faceLen / 2 + faceLen * (c + 0.5) / cols, y = y0 + h * (r + 0.45) / rows;
      if (axis === "z") {
        const z = cz + sign * (half + inset);
        m.add(box(1.2, 1.7, 0.2), { mat: "frame", pos: [cx + u, y, z] });
        m.add(box(0.95, 1.45, 0.06), { mat: "glass", pos: [cx + u, y, z + sign * 0.12] });
      } else {
        const x = cx + sign * (half + inset);
        m.add(box(0.2, 1.7, 1.2), { mat: "frame", pos: [x, y, cz + u] });
        m.add(box(0.06, 1.45, 0.95), { mat: "glass", pos: [x + sign * 0.12, y, cz + u] });
      }
    }
  };
  grid(w, "z", 1, d / 2); grid(w, "z", -1, d / 2);
  grid(d, "x", 1, w / 2); grid(d, "x", -1, w / 2);
}

function smolny() {
  // Смольный институт (Институт благородных девиц, арх. Кваренги) — ШТАБ восстания,
  // НЕ собор. Длинный классицистический корпус + центральный 8-колонный портик с
  // фронтоном + торцевые ризалиты. Куполов нет. Стена — камень, колонны/карниз — белые.
  const m = new Model("smolny");
  const L = 24, H = 5, D = 6, base = 0.8;
  m.add(box(L, base, D + 0.4), { mat: "graphite", pos: [0, base / 2, 0] });        // цоколь
  m.add(box(L, H, D), { mat: "facadePale", pos: [0, base + H / 2, 0] });            // главный корпус (3 этажа, окна)
  relief(m, { w: L, d: D, h: H, y0: base, plinth: false });                          // пилястры по фасаду
  m.add(box(L + 0.5, 0.6, D + 0.4), { mat: "paper", pos: [0, base + H, 0] });       // венчающий карниз
  m.add(box(L, 0.5, D), { mat: "graphite", pos: [0, base + H + 0.35, 0] });         // кровля
  // торцевые ризалиты
  for (const sx of [-1, 1]) {
    m.add(box(2.6, H + 0.4, D + 0.5), { mat: "facadePale", pos: [sx * 10.7, base + (H + 0.4) / 2, 0] });
    m.add(box(2.9, 0.5, D + 0.7), { mat: "graphite", pos: [sx * 10.7, base + H + 0.55, 0] });
  }
  // центральный портик (выступает вперёд +Z)
  const fz = D / 2;
  m.add(box(9, H + 0.6, 1.2), { mat: "facadePale", pos: [0, base + (H + 0.6) / 2, fz - 0.2] }); // ризалит за колоннами
  for (let i = -3.5; i <= 3.5; i += 1)                                              // 8 колонн
    m.add(cyl(0.32, 0.34, H + 0.2, 8), { mat: "paper", pos: [i, base, fz + 1.4] });
  m.add(box(8.6, 0.9, 1.6), { mat: "paper", pos: [0, base + H + 0.3, fz + 1.4] });  // антаблемент
  m.add(gable(8.8, 1.7, 1.6), { mat: "paper", pos: [0, base + H + 0.75, fz + 1.4] }); // фронтон
  m.add(box(2.4, H - 0.4, 0.3), { mat: "graphite", pos: [0, base, fz + 0.95] });    // парадный портал (тёмный проём)
  return m;
}

function winter() {
  // Зимний дворец: длинный низкий барочный блок, чуть выше центр, парапет + статуи
  const m = new Model("winter");
  m.add(box(20, 5, 6), { mat: "realPlaster", pos: [0, 2.5, 0] });       // главный корпус
  relief(m, { w: 20, d: 6, h: 5 });                                     // цоколь + пилястры (камень)
  windows(m, { w: 20, d: 6, h: 5 });                                    // окна
  m.add(box(7, 6.2, 6.4), { mat: "realPlaster", pos: [0, 3.1, 0] });    // центральный ризалит
  windows(m, { w: 7, d: 6.4, h: 6.2 });
  m.add(box(20.6, 0.7, 6.6), { mat: "brass", pos: [0, 5.2, 0] });       // карниз (золочёный)
  m.add(box(7.4, 0.7, 6.8), { mat: "brass", pos: [0, 6.6, 0] });        // карниз центра
  m.add(box(20.6, 0.5, 6.6), { mat: "graphite", pos: [0, 5.7, 0] });    // кровля-парапет
  // ряд кровельных статуй (намёк)
  for (let i = -9; i <= 9; i += 1.8) m.add(box(0.3, 0.9, 0.3), { mat: "realTrim", pos: [i, 6.4, 2.9] });
  // фланговые акценты
  m.add(box(2, 5.6, 6.2), { mat: "realPlaster", pos: [-9.2, 2.8, 0] });
  m.add(box(2, 5.6, 6.2), { mat: "realPlaster", pos: [9.2, 2.8, 0] });
  return m;
}

function fortress() {
  // Петропавловский собор — узнаваемый золотой шпиль (визитка крепости)
  const m = new Model("fortress");
  m.add(box(5, 3, 8), { mat: "realPlaster", pos: [0, 1.5, 2] });        // тело собора
  windows(m, { w: 5, d: 8, h: 3, cz: 2 });                              // окна по бокам
  m.add(box(5.4, 0.6, 8.4), { mat: "realTrim", pos: [0, 3.1, 2] });     // карниз
  // ступенчатая колокольня
  m.add(box(3.4, 4, 3.4), { mat: "realPlaster", pos: [0, 2, -2.2] });
  m.add(box(2.8, 3, 2.8), { mat: "realPlaster", pos: [0, 5.5, -2.2] });
  m.add(box(2.2, 2.5, 2.2), { mat: "realTrim", pos: [0, 8.2, -2.2] });
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
  m.add(box(14, 5.5, 6), { mat: "realPlaster", pos: [0, 2.75, 0] });    // корпус
  relief(m, { w: 14, d: 6, h: 5.5 });                                   // цоколь + пилястры (камень)
  windows(m, { w: 14, d: 6, h: 5.5 });                                  // окна
  m.add(box(14.4, 0.6, 6.4), { mat: "realTrim", pos: [0, 5.6, 0] });    // карниз
  m.add(box(14, 0.5, 6.2), { mat: "graphite", pos: [0, 6.1, 0] });      // кровля
  m.add(box(6.5, 4.6, 1.2), { mat: "realPlaster", pos: [0, 2.3, 3.2] }); // ризалит-портик
  // колонны портика
  for (let i = -2.4; i <= 2.4; i += 1.2) m.add(cyl(0.32, 0.32, 4, 8), { mat: "paper", pos: [i, 0, 3.9] });
  m.add(box(6.8, 1, 1.6), { mat: "paper", pos: [0, 4.6, 3.4] });        // антаблемент
  m.add(box(5.5, 1.6, 1.2), { mat: "realTrim", pos: [0, 6.4, 0] });     // аттик
  return m;
}

function tauride() {
  // Таврический дворец: центральный купол + 6-колонный портик + низкие крылья
  const m = new Model("tauride");
  m.add(box(8, 5, 6), { mat: "realPlaster", pos: [0, 2.5, 0] });        // центр
  relief(m, { w: 8, d: 6, h: 5 });                                      // цоколь + пилястры (камень)
  windows(m, { w: 8, d: 6, h: 5 });
  m.add(box(6, 4, 5), { mat: "realPlaster", pos: [-9, 2, 0] });         // левое крыло
  m.add(box(6, 4, 5), { mat: "realPlaster", pos: [9, 2, 0] });          // правое крыло
  windows(m, { w: 6, d: 5, h: 4, cx: -9 }); windows(m, { w: 6, d: 5, h: 4, cx: 9 });
  m.add(box(4, 4, 4.5), { mat: "realPlaster", pos: [-5.5, 2, 0] });     // галерея
  m.add(box(4, 4, 4.5), { mat: "realPlaster", pos: [5.5, 2, 0] });
  m.add(box(8.4, 0.6, 6.4), { mat: "realTrim", pos: [0, 5.3, 0] });     // карниз
  // портик
  for (let i = -2.5; i <= 2.5; i += 1) m.add(cyl(0.3, 0.3, 4.2, 8), { mat: "paper", pos: [i, 0, 3.3] });
  m.add(box(6.5, 1, 1.4), { mat: "paper", pos: [0, 4.2, 3.1] });
  // купол на барабане
  m.add(cyl(2, 2.2, 1.6, 14), { mat: "realTrim", pos: [0, 5.6, 0] });
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
  const images = [], textures = [], samplers = [];
  const chunks = []; let byteLen = 0;
  const matIndex = new Map();
  const pushView = (typed, target) => {
    while (byteLen % 4 !== 0) { chunks.push(Buffer.from([0])); byteLen += 1; }
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const view = { buffer: 0, byteOffset: byteLen, byteLength: buf.length };
    if (target !== undefined) view.target = target;
    chunks.push(buf); byteLen += buf.length; bufferViews.push(view); return bufferViews.length - 1;
  };
  // --- реестр текстур: процедурный фасад (PNG) + реальные карты Poly Haven (JPG), каждая встраивается один раз ---
  let usesEmitStrength = false;
  const texCache = new Map();
  const embed = (key, buf, mime) => {
    if (texCache.has(key)) return texCache.get(key);
    if (!samplers.length) samplers.push({ wrapS: 10497, wrapT: 10497, magFilter: 9729, minFilter: 9987 }); // REPEAT + трилинейная
    const bv = pushView(buf, undefined);
    images.push({ bufferView: bv, mimeType: mime });
    textures.push({ source: images.length - 1, sampler: 0 });
    const idx = textures.length - 1; texCache.set(key, idx); return idx;
  };
  const facadeIdx = () => { const f = facadeTex(); return { base: embed("f_base", f.base, "image/png"), norm: embed("f_norm", f.norm, "image/png"), mr: embed("f_mr", f.mr, "image/png"), emit: embed("f_emit", f.emit, "image/png") }; };
  const realIdx = (d) => ({ base: embed(d.base, readFileSync(realFile(d.base)), "image/jpeg"), norm: embed(d.nor, readFileSync(realFile(d.nor)), "image/jpeg"), arm: embed(d.arm, readFileSync(realFile(d.arm)), "image/jpeg") });

  for (const part of model.parts.values()) {
    const nVerts = part.pos.length / 3;
    const positions = Float32Array.from(part.pos), normals = Float32Array.from(part.nrm);
    const indices = Uint16Array.from(part.idx);
    const def = MAT[part.mat], needUV = !!(def && (def.tex || def.real));
    // min/max для POSITION (требование glTF)
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]); max[k] = Math.max(max[k], positions[i + k]);
    }
    const posView = pushView(positions, 34962);
    accessors.push({ bufferView: posView, componentType: 5126, count: nVerts, type: "VEC3", min, max });
    const attrs = { POSITION: accessors.length - 1 };
    const nrmView = pushView(normals, 34962);
    accessors.push({ bufferView: nrmView, componentType: 5126, count: nVerts, type: "VEC3" });
    attrs.NORMAL = accessors.length - 1;
    if (needUV) {                                           // UV для текстурных материалов (фасад/реальные)
      const uvView = pushView(Float32Array.from(part.uv), 34962);
      accessors.push({ bufferView: uvView, componentType: 5126, count: nVerts, type: "VEC2" });
      attrs.TEXCOORD_0 = accessors.length - 1;
    }
    const idxView = pushView(indices, 34963);
    accessors.push({ bufferView: idxView, componentType: 5123, count: indices.length, type: "SCALAR" });
    const idxAcc = accessors.length - 1;
    // материал (по имени — переиспользуем)
    if (!matIndex.has(part.mat)) {
      let mat;
      if (def && def.tex) {                                 // процедурный фасад с окнами
        const T = facadeIdx(); usesEmitStrength = true;
        mat = { name: part.mat, doubleSided: true,
          pbrMetallicRoughness: { baseColorFactor: linearRGBA(def.tint), metallicFactor: 1, roughnessFactor: 1, baseColorTexture: { index: T.base }, metallicRoughnessTexture: { index: T.mr } },
          normalTexture: { index: T.norm, scale: 1.2 }, emissiveTexture: { index: T.emit }, emissiveFactor: [1, 1, 1],
          extensions: { KHR_materials_emissive_strength: { emissiveStrength: 2.4 } } };
      } else if (def && def.real) {                         // реальные PBR-карты (diff/normal/arm)
        const T = realIdx(def);
        mat = { name: part.mat, doubleSided: true,
          pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 1, roughnessFactor: 1, baseColorTexture: { index: T.base }, metallicRoughnessTexture: { index: T.arm } },
          normalTexture: { index: T.norm }, occlusionTexture: { index: T.arm } };
      } else {                                              // плоский (опц. emissive — стекло)
        mat = { name: part.mat, doubleSided: true, pbrMetallicRoughness: { baseColorFactor: linearRGBA(def.hex), metallicFactor: def.metallic, roughnessFactor: def.roughness } };
        if (def.emit != null) { mat.emissiveFactor = linearRGBA(def.emit).slice(0, 3); if (def.emitStr) { mat.extensions = { KHR_materials_emissive_strength: { emissiveStrength: def.emitStr } }; usesEmitStrength = true; } }
      }
      materials.push(mat); matIndex.set(part.mat, materials.length - 1);
    }
    primitives.push({ attributes: attrs, indices: idxAcc, material: matIndex.get(part.mat) });
  }
  const gltf = {
    asset: { version: "2.0", generator: "MTK24 build_models.mjs" },
    scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: model.name, mesh: 0 }],
    meshes: [{ name: model.name, primitives }],
    materials, accessors, bufferViews, buffers: [{ byteLength: byteLen }],
  };
  if (images.length) { gltf.images = images; gltf.textures = textures; gltf.samplers = samplers; }
  if (usesEmitStrength) gltf.extensionsUsed = ["KHR_materials_emissive_strength"];
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

// ----------------------------------------------------------------- тест-здание (реальные текстуры Poly Haven на моей геометрии)
// палаццо-блок: реальная штукатурка (стены) + каменный трим (цоколь/карниз/пилястры)
// + геометрические окна (тёмная рама + светящееся стекло). `node build_models.mjs test`
function testBuilding() {
  const m = new Model("test_building");
  const W = 22, H = 7, D = 8, base = 1.0;
  m.add(box(W + 0.4, base, D + 0.4), { mat: "realTrim", pos: [0, base / 2, 0] });          // цоколь (камень)
  m.add(box(W, H, D), { mat: "realPlaster", pos: [0, base + H / 2, 0] });                   // стены (штукатурка)
  m.add(box(W + 0.6, 0.8, D + 0.6), { mat: "realTrim", pos: [0, base + H + 0.1, 0] });      // карниз
  m.add(box(W, 0.6, D), { mat: "graphite", pos: [0, base + H + 0.7, 0] });                  // кровля
  // пилястры (камень) по фасадам +Z / −Z
  const pn = 9;
  for (let i = 0; i <= pn; i++) { const x = -W / 2 + W * i / pn; for (const z of [D / 2 + 0.12, -(D / 2 + 0.12)]) m.add(box(0.5, H - 0.4, 0.3), { mat: "realTrim", pos: [x, base + (H - 0.4) / 2 + 0.2, z] }); }
  // окна: сетка на обоих фасадах (рама + светящееся стекло, слегка выступают)
  const cols = 7, rows = 2;
  for (const sz of [1, -1]) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = -W / 2 + W * (c + 0.5) / cols, y = base + H * (r + 0.45) / rows;
    m.add(box(1.3, 1.9, 0.22), { mat: "frame", pos: [x, y, sz * (D / 2 + 0.06)] });
    m.add(box(1.02, 1.6, 0.06), { mat: "glass", pos: [x, y, sz * (D / 2 + 0.2)] });
  }
  return m;
}

// ----------------------------------------------------------------- простые типовые модели (вместо кубов-плейсхолдеров)
// Лёгкие процедурные «болванки» с процедурными окнами. Один файл — много точек
// (size/yaw подбираются на точку в data/models.js). `node build_models.mjs extra`.
function civic() {                       // присутственное место: министерства, банк, почта, телеграф, типография
  const m = new Model("civic");
  const W = 10, H = 5, D = 7, b = 0.6;
  m.add(box(W, b, D), { mat: "graphite", pos: [0, b / 2, 0] });                 // цоколь
  m.add(box(W, H, D), { mat: "facadeStone", pos: [0, b + H / 2, 0] });          // корпус (окна)
  m.add(box(W + 0.4, 0.5, D + 0.4), { mat: "paper", pos: [0, b + H, 0] });      // карниз
  m.add(box(W, 0.4, D), { mat: "graphite", pos: [0, b + H + 0.25, 0] });        // кровля
  m.add(box(3.6, H + 0.5, 0.9), { mat: "facadeStone", pos: [0, b + (H + 0.5) / 2, D / 2] }); // центральный ризалит
  m.add(box(2.6, H - 1, 0.3), { mat: "graphite", pos: [0, b, D / 2 + 0.5] });   // портал
  return m;
}
function station() {                     // вокзал: длинный зал + угловая башня + вход
  const m = new Model("station");
  const W = 14, H = 4.6, D = 7, b = 0.6;
  m.add(box(W, b, D), { mat: "graphite", pos: [0, b / 2, 0] });
  m.add(box(W, H, D), { mat: "facadePale", pos: [0, b + H / 2, 0] });           // зал (окна)
  m.add(box(W + 0.4, 0.5, D + 0.4), { mat: "paper", pos: [0, b + H, 0] });
  m.add(box(W, 0.45, D), { mat: "graphite", pos: [0, b + H + 0.25, 0] });
  const tx = -W / 2 + 1.6;
  m.add(box(3.2, H + 3, 3.2), { mat: "facadePale", pos: [tx, b + (H + 3) / 2, 0] }); // часовая башня
  m.add(box(3.4, 0.5, 3.4), { mat: "brass", pos: [tx, b + H + 3, 0] });
  m.add(box(0.5, 1.6, 0.5), { mat: "brass", pos: [tx, b + H + 3.3, 0] });       // флагшток-намёк
  m.add(box(3.5, H - 1.4, 0.3), { mat: "graphite", pos: [2, b, D / 2] });       // арочный вход (тёмный)
  return m;
}
function house() {                       // жилой дом / казармы: блок + двускатная крыша
  const m = new Model("house");
  const W = 6, H = 5, D = 5, b = 0.5;
  m.add(box(W, b, D), { mat: "graphite", pos: [0, b / 2, 0] });
  m.add(box(W, H, D), { mat: "facadePale", pos: [0, b + H / 2, 0] });           // корпус (окна)
  m.add(box(W + 0.3, 0.4, D + 0.3), { mat: "paper", pos: [0, b + H, 0] });      // карниз
  m.add(gable(W + 0.3, 1.7, D + 0.3), { mat: "graphite", pos: [0, b + H + 0.2, 0] }); // крыша (конёк по Z)
  return m;
}
function works() {                       // промздание (электростанция): корпус + высокая труба
  const m = new Model("works");
  const W = 8, H = 5, D = 7, b = 0.5;
  m.add(box(W, b, D), { mat: "graphite", pos: [0, b / 2, 0] });
  m.add(box(W, H, D), { mat: "facadeStone", pos: [0, b + H / 2, 0] });          // корпус (окна)
  m.add(box(W + 0.3, 0.4, D + 0.3), { mat: "graphite", pos: [0, b + H, 0] });   // плоская кровля
  m.add(cyl(0.55, 0.7, 9, 10), { mat: "red", pos: [W / 2 - 1.2, b + H, -D / 4] }); // труба
  m.add(cyl(0.75, 0.75, 0.4, 10), { mat: "graphite", pos: [W / 2 - 1.2, b + H + 9, -D / 4] });
  return m;
}

// ----------------------------------------------------------------- main
const MODE = process.argv[2];
const builders = MODE === "test" ? [testBuilding]
  : MODE === "extra" ? [civic, station, house, works]
  : [smolny, winter, fortress, mariinsky, tauride, aurora];
console.log("Генерация low-poly моделей → assets/models/\n");
let totalTris = 0, totalKb = 0;
for (const b of builders) {
  const r = writeGLB(b());
  totalTris += r.tris; totalKb += parseFloat(r.kb);
  console.log(`  ${r.name.padEnd(11)} ${String(r.tris).padStart(5)} трис  ${r.kb.padStart(6)} KB  (${r.parts} мат.)`);
}
console.log(`\n  итого: ${totalTris} трис, ${totalKb.toFixed(1)} KB в ${builders.length} файлах`);
