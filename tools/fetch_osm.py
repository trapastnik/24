#!/usr/bin/env python3
"""
Fetch vector geometry of the historic core of Petrograd from OpenStreetMap
(Overpass API) for МТК №24 «Ленин в октябре».

The historic centre of St. Petersburg — the Neva, the islands, the canals,
Nevsky pr. and the footprints of Smolny / the Winter Palace / the Peter & Paul
Fortress — is essentially unchanged since 1917, so OSM gives an accurate,
editable vector base. Output is plain GeoJSON-ish JSON consumed by the renderer.

Layers:
  water      natural=water + waterway=riverbank  (the Neva + canals — the hero)
  roads      major streets + embankments + bridges over the Neva
  landmarks  building footprints around the known 1917 sites (one small query each)

Usage:  python3 tools/fetch_osm.py
Output: data/petrograd_osm.json
"""

import json, time, sys, urllib.request, urllib.parse, os

# --- Area: historic centre, wide enough for every October-1917 site ----------
# south, west, north, east
BBOX = (59.905, 30.275, 59.965, 30.400)
BBOX_STR = f"{BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]}"

# --- The 1917 sites. lat, lon are hand-set from known addresses; we fetch the
#     building footprint that sits under each point (small radius). -----------
LANDMARKS = [
    # key, name, lat, lon, role
    ("smolny",     "Смольный",                     59.9479, 30.3961, "штаб"),
    ("winter",     "Зимний дворец",                59.9408, 30.3140, "цель"),
    ("fortress",   "Петропавловская крепость",     59.9500, 30.3166, "сигнал"),
    ("mariinsky",  "Мариинский дворец",            59.9322, 30.3088, "предпарламент"),
    ("tauride",    "Таврический дворец",           59.9476, 30.3756, "совет"),
    ("post",       "Главпочтамт",                  59.9316, 30.3056, "объект"),
    ("telephone",  "Центральная телефонная ст.",   59.9347, 30.3169, "объект"),
    ("bank",       "Государственный банк",         59.9290, 30.3268, "объект"),
    ("nik_station","Николаевский вокзал",          59.9290, 30.3625, "объект"),
    ("balt_station","Балтийский вокзал",           59.9078, 30.2997, "объект"),
    ("finland",    "Финляндский вокзал",           59.9558, 30.3556, "опорная точка"),
]

# Points without a useful footprint — kept as markers only (no OSM fetch).
POINT_MARKERS = [
    ("fofanova",   "Квартира М.В. Фофановой",      59.9863, 30.3447, "подполье"),
    ("aurora",     "Крейсер «Аврора» (позиция 1917)", 59.9327, 30.2925, "сигнал"),
    ("powerplant", "Центральная электростанция",   59.9275, 30.3445, "объект"),
]

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

UA = "BMK-MTK24-map/1.0 (dimitri@dvn.spb.ru)"


def overpass(query):
    """POST an Overpass QL query, trying each mirror until one answers."""
    data = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for url in ENDPOINTS:
        try:
            req = urllib.request.Request(url, data=data, headers={
                "User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=120) as r:
                raw = r.read().decode("utf-8")
                print(f"  ok via {url.split('/')[2]}  ({len(raw)} bytes)", file=sys.stderr)
                return json.loads(raw)
        except Exception as e:  # noqa
            last = e
            print(f"  fail via {url.split('/')[2]}: {e}", file=sys.stderr)
            time.sleep(2)
    raise SystemExit(f"all Overpass mirrors failed: {last}")


def geom_of(el):
    """Extract coordinate ring(s) from an Overpass element with `out geom`."""
    if el.get("type") == "way" and "geometry" in el:
        return [[[p["lon"], p["lat"]] for p in el["geometry"]]]
    if el.get("type") == "relation" and "members" in el:
        rings = []
        for m in el["members"]:
            if m.get("geometry"):
                rings.append([[p["lon"], p["lat"]] for p in m["geometry"]])
        return rings
    return []


def fetch_water():
    print("water…", file=sys.stderr)
    q = f"""[out:json][timeout:90];
(
  way["natural"="water"]({BBOX_STR});
  relation["natural"="water"]({BBOX_STR});
  way["waterway"="riverbank"]({BBOX_STR});
  way["water"="river"]({BBOX_STR});
);
out geom;"""
    js = overpass(q)
    feats = []
    for el in js["elements"]:
        rings = geom_of(el)
        if not rings:
            continue
        feats.append({
            "type": el["type"], "id": el["id"],
            "name": el.get("tags", {}).get("name", ""),
            "rings": rings,
        })
    return feats


def fetch_roads():
    print("roads…", file=sys.stderr)
    q = f"""[out:json][timeout:90];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]({BBOX_STR});
  way["man_made"="bridge"]({BBOX_STR});
);
out geom;"""
    js = overpass(q)
    feats = []
    for el in js["elements"]:
        rings = geom_of(el)
        if not rings:
            continue
        t = el.get("tags", {})
        feats.append({
            "id": el["id"],
            "name": t.get("name", ""),
            "highway": t.get("highway", t.get("man_made", "")),
            "bridge": t.get("bridge") == "yes" or t.get("man_made") == "bridge",
            "line": rings[0],
        })
    return feats


def _centroid(ring):
    xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
    return sum(xs) / len(xs), sum(ys) / len(ys)


def _area(ring):  # shoelace in lon/lat — relative magnitude only
    a = 0.0
    for i in range(len(ring) - 1):
        a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return abs(a) / 2.0


def _contains(ring, lon, lat):  # ray-casting point-in-polygon
    inside = False
    n = len(ring); j = n - 1
    for i in range(n):
        xi, yi = ring[i]; xj, yj = ring[j]
        if ((yi > lat) != (yj > lat)) and \
           (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-18) + xi):
            inside = not inside
        j = i
    return inside


def fetch_landmarks():
    print("landmarks…", file=sys.stderr)
    out = []
    # One small, LOCAL query per site — no cross-contamination between sites.
    # `nwr` so multipolygon building relations (Winter Palace etc.) are caught.
    for key, name, lat, lon, role in LANDMARKS:
        q = (f"[out:json][timeout:40];"
             f'(nwr(around:150,{lat},{lon})["building"];);out geom;')
        try:
            js = overpass(q)
        except SystemExit:
            js = {"elements": []}
        cands = [geom_of(e)[0] for e in js["elements"] if geom_of(e)]
        # prefer the LARGEST polygon that contains the point; else the nearest
        containing = [r for r in cands if _contains(r, lon, lat)]
        if containing:
            ring = max(containing, key=_area)
            tag = "PIP"
        elif cands:
            ring = min(cands, key=lambda r: (_centroid(r)[0] - lon) ** 2
                       + (_centroid(r)[1] - lat) ** 2)
            tag = "near"
        else:
            ring, tag = None, "NONE"
        out.append({"key": key, "name": name, "role": role,
                    "lat": lat, "lon": lon, "footprint": ring, "osm_id": None})
        print(f"    {key:13s} {tag:5s} pts={len(ring) if ring else 0}", file=sys.stderr)
        time.sleep(1)
    # point-only markers (no useful footprint)
    for key, name, lat, lon, role in POINT_MARKERS:
        out.append({"key": key, "name": name, "role": role,
                    "lat": lat, "lon": lon, "footprint": None, "osm_id": None})
    return out


def main():
    os.makedirs("data", exist_ok=True)
    result = {
        "bbox": {"south": BBOX[0], "west": BBOX[1], "north": BBOX[2], "east": BBOX[3]},
        "source": "OpenStreetMap (ODbL) via Overpass API",
        "water": fetch_water(),
        "roads": fetch_roads(),
        "landmarks": fetch_landmarks(),
    }
    with open("data/petrograd_osm.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\nwater={len(result['water'])} roads={len(result['roads'])} "
          f"landmarks={len(result['landmarks'])}", file=sys.stderr)
    print(f"wrote data/petrograd_osm.json "
          f"({os.path.getsize('data/petrograd_osm.json')} bytes)", file=sys.stderr)


if __name__ == "__main__":
    main()
