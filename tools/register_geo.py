#!/usr/bin/env python3
"""
МТК-24 — гео-регистрация OSM(lon,lat) → нормированные [u,v] антикварной карты
«ПЛАНЪ ПЕТРОГРАДА», чтобы накладывать OSM-геометрию (контуры зданий, вода).

Модель — THIN-PLATE SPLINE (TPS): проходит через ВСЕ опорные точки ТОЧНО и плавно
интерполирует между ними. Это стандарт привязки рисованных/исторических карт к
контрольным точкам — ловит неравномерные искажения, которые аффин/гомография не берут
(особенно у Невы и на краях). Подгонка по ориентирам с известными lat/lon
(petrograd_osm.json → landmarks) и [u,v] (locations.js).

Выход: data/geo_register.js → window.MTK24_GEOREG = { type:'tps', mx,my,sc, cx,cy, au,wu, av,wv }
  X=(lon-mx)*sc; Y=(lat-my)*sc
  u = au0+au1*X+au2*Y + Σ wu[i]*phi(|(X,Y)-(cx[i],cy[i])|);  phi(r)=r²·ln(r)=0.5·r²·ln(r²)

Usage:  python3 tools/register_geo.py
"""
import json, re, sys, math, os
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UV_TO_M = 6700.0

KEYMAP = {
    "smolny": "smolny", "winter": "winter", "fortress": "fortress",
    "mariinsky": "mariinsky", "tauride": "tauride", "post": "post_main",
    "telephone": "telephone_central", "bank": "gosbank",
    "nik_station": "nik_station", "balt_station": "balt_station",
    "finland": "finland_station", "fofanova": "fofanova",
    "aurora": "aurora", "powerplant": "power_station",
}


def load_osm_landmarks():
    d = json.load(open(os.path.join(ROOT, "data", "petrograd_osm.json"), encoding="utf-8"))
    return {l["key"]: (l["lon"], l["lat"]) for l in d.get("landmarks", []) if "lon" in l}


def load_loc_uv():
    txt = open(os.path.join(ROOT, "data", "locations.js"), encoding="utf-8").read()
    uv = {}
    for m in re.finditer(r'(\w+):\s*\{\s*u:\s*([-\d.]+),\s*v:\s*([-\d.]+)', txt):
        uv[m.group(1)] = (float(m.group(2)), float(m.group(3)))
    return uv


def phi_mat(P):                       # K[i,j] = phi(|Pi-Pj|), phi(r)=r²ln(r)
    n = len(P); K = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            r2 = ((P[i] - P[j]) ** 2).sum()
            K[i, j] = 0.5 * r2 * math.log(r2) if r2 > 1e-12 else 0.0
    return K


def tps_solve(P, vals):               # → (w[n], a[3])  для одной выходной координаты
    n = len(P)
    K = phi_mat(P)
    Pm = np.hstack([np.ones((n, 1)), P])
    A = np.zeros((n + 3, n + 3))
    A[:n, :n] = K; A[:n, n:] = Pm; A[n:, :n] = Pm.T
    b = np.concatenate([vals, np.zeros(3)])
    sol = np.linalg.solve(A, b)
    return sol[:n], sol[n:]


def main():
    osm, uv = load_osm_landmarks(), load_loc_uv()
    src, dst, used = [], [], []
    for ok, lk in KEYMAP.items():
        if ok in osm and lk in uv:
            src.append(osm[ok]); dst.append(uv[lk]); used.append(ok)
    if len(src) < 4:
        raise SystemExit(f"мало соответствий: {len(src)}")
    src = np.asarray(src, float); dst = np.asarray(dst, float)

    # нормировка для устойчивости TPS
    mx, my = src[:, 0].mean(), src[:, 1].mean()
    sc = 1.0 / np.sqrt(((src - [mx, my]) ** 2).sum(1)).mean()
    P = (src - [mx, my]) * sc

    wu, au = tps_solve(P, dst[:, 0])
    wv, av = tps_solve(P, dst[:, 1])

    def evalP(lon, lat):
        X = (lon - mx) * sc; Y = (lat - my) * sc
        u = au[0] + au[1] * X + au[2] * Y
        v = av[0] + av[1] * X + av[2] * Y
        for i in range(len(P)):
            r2 = (X - P[i, 0]) ** 2 + (Y - P[i, 1]) ** 2
            if r2 > 1e-12:
                ph = 0.5 * r2 * math.log(r2)
                u += wu[i] * ph; v += wv[i] * ph
        return u, v

    se = 0.0; worst = []
    for (lon, lat), (u, v), k in zip(src, dst, used):
        pu, pv = evalP(lon, lat); e = math.hypot(pu - u, pv - v)
        se += e * e; worst.append((e, k))
    rms = math.sqrt(se / len(src)); worst.sort(reverse=True)
    print(f"n={len(src)}  TPS RMS={rms:.5f} uv (~{rms*UV_TO_M:.1f} м, в опорных ≈0 — интерполяция точная)",
          file=sys.stderr)
    for e, k in worst[:4]:
        print(f"   {k:13s} остаток {e:.5f} uv", file=sys.stderr)

    out = (
        "/* МТК-24 — гео-регистрация OSM(lon,lat)→[u,v]. Сгенерировано tools/register_geo.py.\n"
        f"   THIN-PLATE SPLINE по {len(src)} ориентирам (точно через все). \n"
        "   X=(lon-mx)*sc; Y=(lat-my)*sc;  u=au·[1,X,Y]+Σ wu·phi;  phi(r)=0.5·r²·ln(r²). */\n"
        "window.MTK24_GEOREG = " + json.dumps({
            "type": "tps", "n": len(src),
            "mx": mx, "my": my, "sc": sc,
            "cx": [round(x, 8) for x in P[:, 0].tolist()],
            "cy": [round(x, 8) for x in P[:, 1].tolist()],
            "au": [round(x, 8) for x in au.tolist()], "wu": [round(x, 8) for x in wu.tolist()],
            "av": [round(x, 8) for x in av.tolist()], "wv": [round(x, 8) for x in wv.tolist()],
        }, ensure_ascii=False) + ";\n"
    )
    open(os.path.join(ROOT, "data", "geo_register.js"), "w", encoding="utf-8").write(out)
    print("wrote data/geo_register.js", file=sys.stderr)


if __name__ == "__main__":
    main()
