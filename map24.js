/* МТК №24 «Ленин в октябре» — динамическая объёмная карта Петрограда.
 *
 * Vanilla JS + canvas 2D. Геометрия центра — из OpenStreetMap (ODbL), события
 * октября 1917 — из ТЗ. Карта рендерится как наклонная объёмная модель
 * («объёмная карта» + маппинг-проекция): наклонённая плита города, вырезанная
 * Невой и каналами, с экструдированными зданиями-ориентирами и анимацией
 * восстания по хронологии.
 */
(function () {
  "use strict";

  // ------------------------------------------------------------------ palette
  const C = {
    paper: "#F7F9EF", brass: "#D2B773", red: "#A02128",
    graphite: "#435059", window: "#9DA3A6", ink: "#0C1012",
  };
  function rgba(hex, a) {
    const v = hex.replace("#", "");
    return `rgba(${parseInt(v.slice(0,2),16)},${parseInt(v.slice(2,4),16)},${parseInt(v.slice(4,6),16)},${a})`;
  }

  // ------------------------------------------------------------------ tunables
  const YAW = -9 * Math.PI / 180;   // поворот плана для горизонтальной панорамы
  const TILT = 0.60;                // сжатие глубины (наклон «камеры»)
  const HRISE = 2.4;                // экструзия высоты (стилизованный рельеф)
  const ANCHOR_Y = 0.60;            // горизонт чуть выше центра
  const SLAB = 140;                 // толщина плиты-основания, м

  // высота зданий по роли, м (стилизованно завышено)
  const ROLE_H = { "штаб": 34, "цель": 30, "сигнал": 22, "объект": 18,
                   "предпарламент": 22, "совет": 24, "опорная точка": 16, "подполье": 14 };
  function roleColor(role) {
    if (role === "штаб") return C.brass;
    if (role === "цель") return C.red;
    if (role === "сигнал") return C.red;
    if (role === "подполье") return C.graphite;
    return C.paper;
  }

  // ------------------------------------------------------------------ canvas
  const canvas = document.getElementById("map");
  const ctx = canvas.getContext("2d");
  const off = document.createElement("canvas");
  const octx = off.getContext("2d");
  let W = 0, H = 0, dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    for (const cv of [canvas, off]) { cv.width = W * dpr; cv.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    staticDirty = true;
    if (geo) computeFit();
  }
  window.addEventListener("resize", resize);

  // ------------------------------------------------------------------ geometry
  let osm = null;           // raw data
  let geo = null;           // projected/rotated geometry in metres
  let lat0, lon0, cosLat;
  let bounds = null;        // {minX,maxX,minY,maxY} in rotated metres
  let fitScale = 1;
  const cam = { x: 0, y: 0, scale: 1 };       // current (rotated-world units)
  const target = { x: 0, y: 0, scale: 1 };    // eased toward

  const D2R = Math.PI / 180, R = 111320;
  function toWorld(lon, lat) {
    return { X: (lon - lon0) * R * cosLat, Y: (lat - lat0) * R };
  }
  const cy_ = Math.cos(YAW), sy_ = Math.sin(YAW);
  function rot(p) { return { x: p.X * cy_ - p.Y * sy_, y: p.X * sy_ + p.Y * cy_ }; }
  function geoToRot(lon, lat) { return rot(toWorld(lon, lat)); }

  // convex hull (Andrew monotone chain) → clean architectural massing from
  // messy OSM building rings; returns a CLOSED ring (last point == first)
  function hull(points) {
    const pts = points.map(p => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length < 3) return points.slice();
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [];
    for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    const up = [];
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    lo.pop(); up.pop();
    const h = lo.concat(up);
    h.push(h[0]);                 // close the ring so wall faces wrap fully
    return h;
  }

  function prepGeo() {
    lat0 = (osm.bbox.south + osm.bbox.north) / 2;
    lon0 = (osm.bbox.west + osm.bbox.east) / 2;
    cosLat = Math.cos(lat0 * D2R);

    const conv = (ring) => ring.map(([lon, lat]) => { const r = geoToRot(lon, lat); return [r.x, r.y]; });
    geo = {
      water: (osm.water || []).map(w => ({ name: w.name, rings: w.rings.map(conv) })),
      roads: (osm.roads || []).map(r => ({ bridge: !!r.bridge, hw: r.highway, line: conv(r.line) })),
      land: null,
      landmarks: (osm.landmarks || []).map(l => ({
        key: l.key, name: l.name, role: l.role,
        c: geoToRot(l.lon, l.lat),
        foot: l.footprint ? hull(conv(l.footprint)) : null,
      })),
    };
    // ground slab = bbox rectangle, finely subdivided so the tilt looks right
    const W_ = osm.bbox.west, E_ = osm.bbox.east, S_ = osm.bbox.south, N_ = osm.bbox.north;
    const ring = [];
    const n = 24;
    for (let i = 0; i <= n; i++) ring.push([W_ + (E_ - W_) * i / n, N_]);
    for (let i = 0; i <= n; i++) ring.push([E_, N_ - (N_ - S_) * i / n]);
    for (let i = 0; i <= n; i++) ring.push([E_ - (E_ - W_) * i / n, S_]);
    for (let i = 0; i <= n; i++) ring.push([W_, S_ + (N_ - S_) * i / n]);
    geo.land = conv(ring);

    // bounds over land ring
    bounds = { minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9 };
    for (const [x, y] of geo.land) {
      bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
    }
    // landmark lookup
    geo.byKey = {};
    for (const l of geo.landmarks) geo.byKey[l.key] = l;
  }

  function computeFit() {
    const wW = bounds.maxX - bounds.minX, wH = bounds.maxY - bounds.minY;
    fitScale = Math.min(W * 0.92 / wW, H * 0.70 / (wH * TILT));
  }

  // ------------------------------------------------------------------ project
  function project(x, y, h) {
    h = h || 0;
    const sx = (x - cam.x) * cam.scale + W * 0.5;
    const sy = (-(y - cam.y) * TILT - h * HRISE) * cam.scale + H * ANCHOR_Y;
    return { x: sx, y: sy };
  }

  // resolve a chapter reference to rotated-world point
  function resolve(ref) {
    if (typeof ref === "string") {
      if (geo.byKey[ref]) return geo.byKey[ref].c;
      const p = (TL.places || {})[ref];
      if (p) return geoToRot(p.lon, p.lat);
      return null;
    }
    if (ref && typeof ref.lat === "number") return geoToRot(ref.lon, ref.lat);
    return null;
  }

  // ------------------------------------------------------------------ timeline
  const TL = window.MTK24_TIMELINE || { chapters: [], places: {} };
  let chapters = TL.chapters;
  let starts = [], TOTAL = 0;
  function buildClock() {
    let raw = chapters.reduce((s, c) => s + (c.dur || 12), 0);
    const scale = TL.total ? TL.total / raw : 1;
    starts = []; let acc = 0;
    for (const c of chapters) { starts.push(acc); c._dur = (c.dur || 12) * scale; acc += c._dur; }
    TOTAL = acc;
  }
  let t = 0, playing = true, curIdx = -1;

  function chapterAt(tt) {
    let i = 0;
    for (let k = 0; k < chapters.length; k++) if (starts[k] <= tt) i = k;
    return i;
  }
  function localProgress(tt, i) { return Math.min(1, Math.max(0, (tt - starts[i]) / chapters[i]._dur)); }

  // ------------------------------------------------------------------ DOM sync
  const el = {
    nar: document.getElementById("narration"),
    date: document.getElementById("n-date"),
    title: document.getElementById("n-title"),
    lede: document.getElementById("n-lede"),
    quote: document.getElementById("quote"),
    qtext: document.getElementById("q-text"),
    qcite: document.getElementById("q-cite"),
    fill: document.getElementById("trackFill"),
    clock: document.getElementById("clock"),
    track: document.getElementById("track"),
    play: document.getElementById("btnPlay"),
  };
  let ticks = [];
  function buildTicks() {
    el.track.querySelectorAll(".tick").forEach(n => n.remove());
    ticks = chapters.map((c, i) => {
      const d = document.createElement("div");
      d.className = "tick"; d.style.left = (starts[i] / TOTAL * 100) + "%";
      const lbl = document.createElement("span"); lbl.className = "lbl"; lbl.textContent = c.date;
      d.appendChild(lbl); el.track.appendChild(d); return d;
    });
  }
  function fmt(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

  function applyChapter(i) {
    const c = chapters[i];
    el.nar.classList.add("swap");
    setTimeout(() => {
      el.date.textContent = c.date;
      el.title.textContent = c.title;
      el.lede.textContent = c.lede || "";
      el.nar.classList.remove("swap");
    }, 260);
    if (c.quote) {
      el.qtext.textContent = c.quote; el.qcite.textContent = c.cite || "";
      el.quote.classList.add("show");
    } else el.quote.classList.remove("show");
    // camera target
    const f = resolve(c.focus) || { x: 0, y: 0 };
    target.x = f.x; target.y = f.y;
    target.scale = fitScale * (c.zoom || 1);
    // ticks
    ticks.forEach((tk, k) => {
      tk.classList.toggle("active", k === i);
      tk.classList.toggle("done", k < i);
    });
  }

  // ------------------------------------------------------------------ static layers (slab/water/roads) → offscreen
  let staticDirty = true, lastKey = "";
  function camKey() { return Math.round(cam.x) + "_" + Math.round(cam.y) + "_" + cam.scale.toFixed(3); }

  function fillPath(c, pts, h) {
    c.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = project(pts[i][0], pts[i][1], h);
      if (i === 0) c.moveTo(p.x, p.y); else c.lineTo(p.x, p.y);
    }
    c.closePath();
  }

  function renderStatic() {
    const c = octx;
    c.clearRect(0, 0, W, H);

    // --- slab side walls (extrude land ring downward) for the 3D-model base
    const land = geo.land;
    // far/back is high on screen; we render side faces from the silhouette
    c.lineWidth = 1;
    for (let i = 0; i < land.length - 1; i++) {
      const a = land[i], b = land[i + 1];
      const at = project(a[0], a[1], 0), bt = project(b[0], b[1], 0);
      const ab = project(a[0], a[1], -SLAB), bb = project(b[0], b[1], -SLAB);
      // only draw faces whose top edge faces the viewer (lower part of slab)
      if ((at.y + bt.y) / 2 < H * ANCHOR_Y - 2) continue;
      c.beginPath();
      c.moveTo(at.x, at.y); c.lineTo(bt.x, bt.y); c.lineTo(bb.x, bb.y); c.lineTo(ab.x, ab.y); c.closePath();
      const g = c.createLinearGradient(0, at.y, 0, ab.y);
      g.addColorStop(0, rgba(C.graphite, 0.95)); g.addColorStop(1, rgba(C.ink, 0.98));
      c.fillStyle = g; c.fill();
    }

    // --- ground top face (illuminated relief plate)
    fillPath(c, land, 0);
    const top = project((bounds.minX + bounds.maxX) / 2, bounds.maxY, 0);
    const bot = project((bounds.minX + bounds.maxX) / 2, bounds.minY, 0);
    const gg = c.createLinearGradient(0, top.y, 0, bot.y);
    gg.addColorStop(0, "#2b343a");                  // дальняя кромка — холоднее
    gg.addColorStop(0.55, "#586169");
    gg.addColorStop(1, "#6d7680");                  // ближняя — светлее
    c.fillStyle = gg; c.fill();
    // faint paper sheen
    c.save(); c.clip(); c.fillStyle = rgba(C.paper, 0.05);
    fillPath(c, land, 0); c.fill(); c.restore();

    // --- water (Neva + canals) carved darker into the plate
    c.save();
    fillPath(c, land, 0); c.clip();              // keep water within the slab top
    for (const w of geo.water) {
      for (const ring of w.rings) {
        if (ring.length < 3) continue;
        fillPath(c, ring, 0);
        const isNeva = /нев/i.test(w.name || "");
        c.fillStyle = isNeva ? "#1d2b33" : "#243138";
        c.fill();
        // northern rim highlight = far waterline catches light
        c.lineWidth = 1.2; c.strokeStyle = rgba(C.window, isNeva ? 0.28 : 0.16); c.stroke();
      }
    }
    c.restore();

    // --- roads (thin paper lines)
    c.save(); fillPath(c, land, 0); c.clip();
    c.lineCap = "round"; c.lineJoin = "round";
    for (const r of geo.roads) {
      if (r.line.length < 2) continue;
      c.beginPath();
      for (let i = 0; i < r.line.length; i++) {
        const p = project(r.line[i][0], r.line[i][1], r.bridge ? 4 : 0);
        if (i === 0) c.moveTo(p.x, p.y); else c.lineTo(p.x, p.y);
      }
      if (r.bridge) { c.lineWidth = 2.2; c.strokeStyle = rgba(C.brass, 0.55); }
      else { c.lineWidth = 0.7; c.strokeStyle = rgba(C.paper, 0.14); }
      c.stroke();
    }
    c.restore();
  }

  // ------------------------------------------------------------------ dynamic: buildings, markers, arcs, fx
  function drawBlock(l, glow) {
    const role = l.role, col = roleColor(role), h = ROLE_H[role] || 16;
    if (l.foot && l.foot.length >= 3) {
      const pts = l.foot;
      // side walls
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const at = project(a[0], a[1], h), bt = project(b[0], b[1], h);
        const ab = project(a[0], a[1], 0), bb = project(b[0], b[1], 0);
        ctx.beginPath(); ctx.moveTo(at.x, at.y); ctx.lineTo(bt.x, bt.y);
        ctx.lineTo(bb.x, bb.y); ctx.lineTo(ab.x, ab.y); ctx.closePath();
        // shade by facing: compare screen-x direction
        const facing = (bt.x - at.x) >= 0 ? 0.5 : 0.78;
        ctx.fillStyle = rgba(C.ink, facing); ctx.fill();
        ctx.strokeStyle = rgba(C.ink, 0.9); ctx.lineWidth = 0.6; ctx.stroke();
      }
      // roof
      fillPath(ctx, pts, h);
      ctx.fillStyle = glow > 0 ? mix(col, "#ffffff", 0.25 * glow) : col;
      ctx.globalAlpha = 0.92; ctx.fill(); ctx.globalAlpha = 1;
      ctx.lineWidth = 1.1; ctx.strokeStyle = rgba("#ffffff", 0.35 + 0.5 * glow); ctx.stroke();
      if (glow > 0) {
        ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 22 * glow;
        ctx.lineWidth = 1.6; ctx.strokeStyle = rgba(col, 0.9); ctx.stroke(); ctx.restore();
      }
    } else {
      // point marker: pylon + base ring
      drawPylon(l.c, h, col, glow);
    }
  }

  function drawPylon(p, h, col, glow) {
    const base = project(p.x, p.y, 0), tip = project(p.x, p.y, h);
    ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(tip.x, tip.y);
    ctx.lineWidth = 2.4; ctx.strokeStyle = rgba(col, 0.85); ctx.stroke();
    ctx.beginPath(); ctx.arc(tip.x, tip.y, 4 + 3 * glow, 0, 7); ctx.fillStyle = col;
    ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 14 + 18 * glow; ctx.fill(); ctx.restore();
    // ground ring
    ctx.beginPath(); ctx.ellipse(base.x, base.y, 9 * cam.scale / fitScale * 0.4 + 6, (9 * cam.scale / fitScale * 0.4 + 6) * TILT, 0, 0, 7);
    ctx.strokeStyle = rgba(col, 0.5); ctx.lineWidth = 1.2; ctx.stroke();
  }

  // draw a label at an explicit y (de-collided by the caller)
  function labelAt(l, strong, tipX, tipY, ly) {
    ctx.font = `${strong ? 600 : 400} ${strong ? 16 : 13}px "20 Kopeek", monospace`;
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const tw = ctx.measureText(l.name).width;
    ctx.beginPath(); ctx.moveTo(tipX, tipY - 2); ctx.lineTo(tipX, ly + 3);
    ctx.strokeStyle = rgba(C.paper, strong ? 0.7 : 0.3); ctx.lineWidth = 1; ctx.stroke();
    if (strong) { ctx.fillStyle = rgba(C.ink, 0.6); ctx.fillRect(tipX + 4, ly - 13, tw + 10, 18); }
    ctx.fillStyle = strong ? C.paper : rgba(C.paper, 0.5);
    ctx.fillText(l.name, tipX + 9, ly);
  }

  // place labels for a set of markers, nudging overlaps downward
  function placeLabels(items) {
    const rows = items.map(it => {
      const h = ROLE_H[it.l.role] || 16;
      const tip = project(it.l.c.x, it.l.c.y, h);
      return { l: it.l, strong: it.strong, tipX: tip.x, tipY: tip.y, ly: tip.y - 14 };
    }).sort((a, b) => a.ly - b.ly);
    let lastY = -1e9;
    for (const r of rows) {
      if (r.ly - lastY < 19) r.ly = lastY + 19;   // de-collide vertically
      lastY = r.ly;
      labelAt(r.l, r.strong, r.tipX, r.tipY, r.ly);
    }
  }

  // arcs (movement) — bezier that lifts off the ground; comet head by progress
  function drawArc(a, b, prog, col) {
    if (!a || !b) return;
    const lift = 60 + 0.35 * Math.hypot(b.x - a.x, b.y - a.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const steps = 48;
    let last = null;
    ctx.lineWidth = 2.4; ctx.strokeStyle = rgba(col, 0.85);
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const u = i / steps; if (u > prog) break;
      const h = lift * 4 * u * (1 - u);                 // parabola in height
      const wx = (1 - u) * a.x + u * b.x, wy = (1 - u) * a.y + u * b.y;
      const p = project(wx, wy, h);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      last = p;
    }
    ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.stroke(); ctx.restore();
    if (last) { ctx.beginPath(); ctx.arc(last.x, last.y, 4.5, 0, 7); ctx.fillStyle = "#fff";
      ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 16; ctx.fill(); ctx.restore(); }
  }

  function ring(p, r, col, a, lw) {
    ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * TILT, 0, 0, 7);
    ctx.strokeStyle = rgba(col, a); ctx.lineWidth = lw || 2; ctx.stroke();
  }

  function mix(h1, h2, t) {
    const a = h1.replace("#", ""), b = h2.replace("#", "");
    const r = Math.round(parseInt(a.slice(0,2),16)*(1-t)+parseInt(b.slice(0,2),16)*t);
    const g = Math.round(parseInt(a.slice(2,4),16)*(1-t)+parseInt(b.slice(2,4),16)*t);
    const bl = Math.round(parseInt(a.slice(4,6),16)*(1-t)+parseInt(b.slice(4,6),16)*t);
    return `rgb(${r},${g},${bl})`;
  }

  // ------------------------------------------------------------------ frame
  let prev = 0, animClock = 0;
  function frame(now) {
    const dt = prev ? Math.min(0.05, (now - prev) / 1000) : 0;
    prev = now; animClock += dt;
    if (playing) { t += dt; if (t >= TOTAL) t -= TOTAL; }

    const i = chapterAt(t);
    if (i !== curIdx) { curIdx = i; applyChapter(i); }
    const c = chapters[i], lp = localProgress(t, i);

    // ease camera
    const k = 1 - Math.pow(0.0025, dt);     // ~ time-constant easing
    cam.x += (target.x - cam.x) * k;
    cam.y += (target.y - cam.y) * k;
    cam.scale += (target.scale - cam.scale) * k;

    // static layers (rebuild only when camera moved)
    const key = camKey();
    if (staticDirty || key !== lastKey) { renderStatic(); lastKey = key; staticDirty = false; }

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(off, 0, 0, W, H);

    // subtle Neva shimmer (cheap, animated)
    drawShimmer();

    // landmark blocks — far (north, larger y) first
    const order = geo.landmarks.slice().sort((p, q) => q.c.y - p.c.y);
    const activeKeys = new Set(c.markers || []);
    for (const l of order) {
      const isActive = activeKeys.has(l.key);
      const glow = isActive ? 0.5 + 0.5 * Math.sin(animClock * 3.2) : 0;
      drawBlock(l, glow > 0 ? glow : 0);
    }

    // arcs for this chapter
    if (c.arcs && c.arcs.length) {
      const ap = Math.min(1, Math.max(0, (lp - 0.12) / 0.6));
      for (const arc of c.arcs) drawArc(resolve(arc.from), resolve(arc.to), ap, C.red);
    }

    // fx
    if (c.fx) drawFx(c.fx, lp, c);

    // labels — active markers strong, heroes faint always (de-collided)
    const heroes = new Set(["smolny", "winter", "fortress"]);
    const labelItems = [];
    for (const l of order) {
      if (activeKeys.has(l.key)) labelItems.push({ l, strong: true });
      else if (heroes.has(l.key)) labelItems.push({ l, strong: false });
    }
    placeLabels(labelItems);

    // transport
    el.fill.style.width = (t / TOTAL * 100) + "%";
    el.clock.innerHTML = "<b>" + fmt(t) + "</b> / " + fmt(TOTAL);

    requestAnimationFrame(frame);
  }

  function drawShimmer() {
    const neva = geo.water.find(w => /большая нева|нева$/i.test(w.name || "")) ||
                 geo.water.find(w => /нев/i.test(w.name || ""));
    if (!neva) return;
    ctx.save();
    fillPath(ctx, geo.land, 0); ctx.clip();
    for (const rg of neva.rings) {
      if (rg.length < 4) continue;
      ctx.beginPath();
      for (let i = 0; i < rg.length; i++) { const p = project(rg[i][0], rg[i][1], 0); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
      ctx.closePath(); ctx.clip();
      for (let s = 0; s < 3; s++) {
        const ph = (animClock * 0.06 + s / 3) % 1;
        const yb = bounds.minY + (bounds.maxY - bounds.minY) * ph;
        const p1 = project(bounds.minX, yb, 0), p2 = project(bounds.maxX, yb, 0);
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = rgba(C.window, 0.05); ctx.lineWidth = 8; ctx.stroke();
      }
      break;
    }
    ctx.restore();
  }

  function drawFx(kind, lp, c) {
    if (kind === "rings") {
      const w = geo.byKey["winter"]; if (!w) return;
      const p = project(w.c.x, w.c.y, 0);
      for (let s = 0; s < 4; s++) {
        const ph = (animClock * 0.5 + s / 4) % 1;
        ring(p, (1 - ph) * 120 + 14, C.red, 0.5 * (1 - ph), 2.5);
      }
    } else if (kind === "shot") {
      const a = geo.byKey["aurora"], w = geo.byKey["winter"]; if (!a || !w) return;
      const pa = project(a.c.x, a.c.y, 10), pw = project(w.c.x, w.c.y, 0);
      const FIRE = 0.42;                                   // момент выстрела
      const fire = Math.max(0, (lp - FIRE) / 0.5);         // 0→1 после выстрела
      const burst = Math.max(0, 1 - Math.abs(lp - FIRE) * 9); // резкая вспышка
      // tracer toward the Winter Palace
      if (fire > 0) {
        const fx2 = Math.min(1, fire * 1.6);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pa.x + (pw.x - pa.x) * fx2, pa.y + (pw.y - pa.y) * fx2);
        ctx.strokeStyle = rgba(C.brass, 0.85 * (1 - fire)); ctx.lineWidth = 3.5;
        ctx.save(); ctx.shadowColor = C.brass; ctx.shadowBlur = 16; ctx.stroke(); ctx.restore();
      }
      // expanding shockwave rings from the cruiser
      for (let s = 0; s < 4; s++) {
        const ph = (fire + s / 4) % 1;
        if (fire > 0) ring(pa, ph * 320, C.brass, 0.55 * (1 - ph), 2.4);
      }
      // muzzle flash
      const flash = 8 + 40 * burst;
      ctx.beginPath(); ctx.arc(pa.x, pa.y, flash, 0, 7);
      ctx.fillStyle = rgba("#fff", 0.5 + 0.45 * burst);
      ctx.save(); ctx.shadowColor = C.brass; ctx.shadowBlur = 24 + 40 * burst; ctx.fill(); ctx.restore();
      // signal flash reaching the Winter Palace
      if (fire > 0.7) {
        ring(pw, 14 + 10 * Math.sin(animClock * 6), C.red, 0.7, 3);
      }
    } else if (kind === "ships") {
      // ships steaming up the Neva toward centre
      const neva = geo.water.find(w => /большая нева/i.test(w.name || "")) || geo.water.find(w => /нев/i.test(w.name || ""));
      const aim = geo.byKey["winter"] ? geo.byKey["winter"].c : { x: 0, y: 0 };
      for (let s = 0; s < 4; s++) {
        const ph = (lp * 0.9 + s * 0.22) % 1;
        const sx = bounds.minX + (aim.x - bounds.minX) * ph;
        const sy = aim.y - 200 + s * 90;
        const p = project(sx, sy, 6);
        ctx.beginPath(); ctx.ellipse(p.x, p.y, 9, 3.4, 0, 0, 7);
        ctx.fillStyle = rgba(C.graphite, 0.95); ctx.fill();
        ctx.strokeStyle = rgba(C.paper, 0.6); ctx.lineWidth = 1; ctx.stroke();
        // wake
        ctx.beginPath(); ctx.moveTo(p.x - 9, p.y); ctx.lineTo(p.x - 34, p.y);
        ctx.strokeStyle = rgba(C.window, 0.3); ctx.lineWidth = 2; ctx.stroke();
      }
    } else if (kind === "storm") {
      const w = geo.byKey["winter"]; if (!w) return;
      const pw = project(w.c.x, w.c.y, 0);
      const n = 7;
      for (let s = 0; s < n; s++) {
        const ang = (s / n) * Math.PI * 2 + animClock * 0.2;
        const rr = 150 * (1 - ((animClock * 0.6 + s / n) % 1));
        const px = pw.x + Math.cos(ang) * rr, py = pw.y + Math.sin(ang) * rr * TILT;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(pw.x, pw.y);
        ctx.strokeStyle = rgba(C.red, 0.4); ctx.lineWidth = 2; ctx.stroke();
      }
      ring(pw, 18 + 6 * Math.sin(animClock * 6), C.red, 0.8, 3);
    } else if (kind === "proclaim") {
      const f = resolve(c.focus) || { x: 0, y: 0 };
      const p = project(f.x, f.y, 0);
      for (let s = 0; s < 5; s++) {
        const ph = (animClock * 0.35 + s / 5) % 1;
        ring(p, ph * Math.max(W, H) * 0.6, C.brass, 0.28 * (1 - ph), 2);
      }
    }
  }

  // ------------------------------------------------------------------ controls
  el.play.addEventListener("click", () => {
    playing = !playing; el.play.textContent = playing ? "❚❚" : "►";
  });
  el.track.addEventListener("click", (e) => {
    const r = el.track.getBoundingClientRect();
    t = Math.min(TOTAL - 0.01, Math.max(0, (e.clientX - r.left) / r.width * TOTAL));
    curIdx = -1; // force chapter re-apply
  });
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") { e.preventDefault(); el.play.click(); }
    else if (e.code === "ArrowRight") { const i = Math.min(chapters.length - 1, chapterAt(t) + 1); t = starts[i]; curIdx = -1; }
    else if (e.code === "ArrowLeft") { const i = Math.max(0, chapterAt(t) - 1); t = starts[i]; curIdx = -1; }
  });

  // ------------------------------------------------------------------ boot
  function start() {
    prepGeo(); resize(); buildClock(); buildTicks();
    // place camera at first focus immediately (no fly-in from origin)
    const f0 = resolve(chapters[0].focus) || { x: 0, y: 0 };
    cam.x = target.x = f0.x; cam.y = target.y = f0.y;
    cam.scale = target.scale = fitScale * (chapters[0].zoom || 1);
    requestAnimationFrame(frame);
  }

  function boot() {
    if (window.MTK24_OSM) { osm = window.MTK24_OSM; start(); return; }
    fetch("./data/petrograd_osm.json").then(r => r.json()).then(d => { osm = d; start(); })
      .catch(err => {
        document.getElementById("n-lede").textContent =
          "Не удалось загрузить геоданные (data/petrograd_osm.js). Запустите через HTTP-сервер или сгенерируйте .js-обёртку.";
        console.error(err);
      });
  }
  boot();
})();
