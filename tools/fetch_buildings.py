#!/usr/bin/env python3
"""
Fetch ALL building footprints in the МТК-24 bbox from OpenStreetMap (Overpass)
для массинга города (Фаза 7). Отдельно от fetch_osm.py, чтобы не перевыкачивать
воду/дороги/landmarks.

Выход: data/petrograd_buildings.json
  { bbox, count, buildings:[ { line:[[lon,lat]...], h }, ... ] }
  h — высота в метрах (из height / building:levels*3, дефолт ~14 м).

Фильтр: отбрасываем крошечные контуры (площадь < MIN_AREA_M2) и упрощаем полигоны
(Douglas–Peucker), чтобы файл и массинг оставались лёгкими.

Usage:  python3 tools/fetch_buildings.py
"""
import json, time, sys, math, urllib.request, urllib.parse, os

BBOX = (59.905, 30.275, 59.965, 30.400)            # как в fetch_osm.py
BBOX_STR = f"{BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]}"
MIN_AREA_M2 = 90.0                                 # отбрасывать мелочь (сараи/киоски)
SIMPLIFY_M  = 1.5                                  # эпсилон упрощения, метры
LAT0 = (BBOX[0] + BBOX[2]) / 2
M_PER_DEG_LAT = 111320.0
M_PER_DEG_LON = 111320.0 * math.cos(math.radians(LAT0))

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
UA = "BMK-MTK24-map/1.0 (dimitri@dvn.spb.ru)"


def overpass(query):
    data = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for url in ENDPOINTS:
        try:
            req = urllib.request.Request(url, data=data, headers={
                "User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=300) as r:
                raw = r.read().decode("utf-8")
                print(f"  ok via {url.split('/')[2]} ({len(raw)} bytes)", file=sys.stderr)
                return json.loads(raw)
        except Exception as e:
            last = e
            print(f"  fail via {url.split('/')[2]}: {e}", file=sys.stderr)
            time.sleep(3)
    raise SystemExit(f"all Overpass mirrors failed: {last}")


def to_m(ring):
    return [((p[0] - BBOX[1]) * M_PER_DEG_LON, (p[1] - BBOX[0]) * M_PER_DEG_LAT) for p in ring]


def area_m2(ring):
    m = to_m(ring); a = 0.0
    for i in range(len(m) - 1):
        a += m[i][0] * m[i + 1][1] - m[i + 1][0] * m[i][1]
    return abs(a) / 2.0


def _dp(points, eps):                              # Douglas–Peucker (в метрах)
    if len(points) < 3:
        return points
    dmax, idx = 0.0, 0
    a, b = points[0], points[-1]
    for i in range(1, len(points) - 1):
        d = _perp(points[i], a, b)
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        left = _dp(points[:idx + 1], eps)
        right = _dp(points[idx:], eps)
        return left[:-1] + right
    return [a, b]


def _perp(p, a, b):
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplify(ring):
    m = to_m(ring)
    sm = _dp(m, SIMPLIFY_M)
    # обратно в lon/lat
    out = [[BBOX[1] + x / M_PER_DEG_LON, BBOX[0] + y / M_PER_DEG_LAT] for (x, y) in sm]
    return out


def height_of(tags):
    h = tags.get("height")
    if h:
        try:
            return float(str(h).split()[0].replace(",", "."))
        except ValueError:
            pass
    lv = tags.get("building:levels") or tags.get("levels")
    if lv:
        try:
            return float(str(lv).split(";")[0]) * 3.2
        except ValueError:
            pass
    return 14.0                                    # дефолт: ~4-5 этажей петербургского центра


def ring_of(el):
    if el.get("type") == "way" and el.get("geometry"):
        return [[p["lon"], p["lat"]] for p in el["geometry"]]
    if el.get("type") == "relation" and el.get("members"):     # внешнее кольцо мультиполигона
        for m in el["members"]:
            if m.get("role") == "outer" and m.get("geometry"):
                return [[p["lon"], p["lat"]] for p in m["geometry"]]
    return None


def main():
    os.makedirs("data", exist_ok=True)
    print("buildings… (это может занять минуту-две)", file=sys.stderr)
    q = f"""[out:json][timeout:240];
(
  way["building"]({BBOX_STR});
  relation["building"]["type"="multipolygon"]({BBOX_STR});
);
out geom;"""
    js = overpass(q)
    raw = js.get("elements", [])
    print(f"  получено элементов: {len(raw)}", file=sys.stderr)
    buildings, dropped = [], 0
    for el in raw:
        ring = ring_of(el)
        if not ring or len(ring) < 4:
            dropped += 1; continue
        if area_m2(ring) < MIN_AREA_M2:
            dropped += 1; continue
        line = simplify(ring)
        if len(line) < 4:
            dropped += 1; continue
        buildings.append({"line": line, "h": round(height_of(el.get("tags", {})), 1)})
    out = {
        "bbox": {"south": BBOX[0], "west": BBOX[1], "north": BBOX[2], "east": BBOX[3]},
        "source": "OpenStreetMap (ODbL) via Overpass API",
        "count": len(buildings),
        "buildings": buildings,
    }
    path = "data/petrograd_buildings.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\nзданий: {len(buildings)} (отброшено {dropped}); "
          f"{os.path.getsize(path)} bytes → {path}", file=sys.stderr)


if __name__ == "__main__":
    main()
