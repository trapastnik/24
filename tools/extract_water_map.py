#!/usr/bin/env python3
"""
МТК-24 — вода ИЗ САМОЙ антикварной карты (а не из OSM).
OSM (современная карта) по построению НЕ ложится на нарисованное от руки русло 1917 г.
Поэтому воду берём прямо с «Плана Петрограда»: берега нарисованы тушью (сильные линии),
а вода внутри — гладкая светло-серая заливка. Алгоритм:
  1) сильные градиенты (линии берегов/кварталов) = БАРЬЕРЫ;
  2) заливка (flood) от засева в Неве по «свободным» (негранич.) водо-тоновым пикселям —
     берега удерживают разлив, в поля/бумагу не утекает;
  3) морфочистка штриховки → контуры (внешние + острова-дыры) прямо в [u,v] карты.
Контуры в [u,v] ложатся ПИКСЕЛЬ-В-ПИКСЕЛЬ на нарисованную реку (uvToWorld в scene.js).

Выход: data/petrograd_water_map.json  { space:"uv", water:[{rings:[outer,...holes]}] }.
Превью: /tmp/water_map_overlay.png + /tmp/water_map_center.png.

Usage:  python3 tools/extract_water_map.py
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage
import cv2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "map", "petrograd_2048.png")

EDGE_THR = 90          # порог Собеля: что считаем линией-берегом (барьер)
EDGE_DIL = 1           # утолщение барьеров
BR_LO, BR_HI = 120, 200  # тоновое окно воды (отсечь тушь и яркую бумагу)
CLOSE = 3              # свести штриховку внутри воды
OPEN = 1              # убрать крап
OUTER_MIN = 0.0004     # мин. площадь внешнего полигона (доля кадра)
HOLE_MIN = 0.00020     # мин. площадь дыры-острова (доля кадра)
DP_EPS_PX = 1.5        # упрощение контура (px)
# засев на воде (u,v): Нева, рукава дельты, залив, рукав на юго-восток
SEEDS_UV = [
    (0.52, 0.37), (0.58, 0.34), (0.46, 0.40), (0.41, 0.35), (0.35, 0.32),
    (0.30, 0.30), (0.26, 0.28), (0.62, 0.40), (0.70, 0.47), (0.77, 0.53),
    (0.49, 0.43), (0.55, 0.45), (0.44, 0.30), (0.50, 0.31), (0.66, 0.44),
    (0.73, 0.50), (0.20, 0.30), (0.83, 0.60),
]


def main():
    im = Image.open(SRC).convert("L")
    W, H = im.size
    g = np.asarray(im, dtype=np.float32)
    print(f"  карта {W}x{H}", file=sys.stderr)

    grad = np.hypot(ndimage.sobel(g, axis=1), ndimage.sobel(g, axis=0))
    barrier = ndimage.binary_dilation(grad > EDGE_THR, iterations=EDGE_DIL)
    free = (~barrier) & (g > BR_LO) & (g < BR_HI)

    lab, n = ndimage.label(free)
    keep = set()
    for (u, v) in SEEDS_UV:
        x, y = int(u * W), int(v * H)
        if 0 <= x < W and 0 <= y < H and lab[y, x]:
            keep.add(int(lab[y, x]))
    print(f"  свободных компонент: {n}; засеяно: {len(keep)}", file=sys.stderr)
    water = np.isin(lab, list(keep))
    water = ndimage.binary_closing(water, iterations=CLOSE)
    water = ndimage.binary_opening(water, iterations=OPEN)
    water = water.astype(np.uint8)

    cnts, hier = cv2.findContours(water * 255, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    hier = hier[0] if hier is not None else []
    outer_min, hole_min = OUTER_MIN * W * H, HOLE_MIN * W * H
    polys = []
    for i, c in enumerate(cnts):
        if hier[i][3] != -1:
            continue                                  # дыра — берётся у родителя
        if cv2.contourArea(c) < outer_min:
            continue
        op = cv2.approxPolyDP(c, DP_EPS_PX, True).reshape(-1, 2)
        if len(op) < 3:
            continue
        rings = [[[round(float(x) / W, 5), round(float(y) / H, 5)] for x, y in op]]
        ch = hier[i][2]
        while ch != -1:
            if cv2.contourArea(cnts[ch]) >= hole_min:
                hp = cv2.approxPolyDP(cnts[ch], DP_EPS_PX, True).reshape(-1, 2)
                if len(hp) >= 3:
                    rings.append([[round(float(x) / W, 5), round(float(y) / H, 5)] for x, y in hp])
            ch = hier[ch][0]
        polys.append({"rings": rings, "_a": float(cv2.contourArea(c))})

    polys.sort(key=lambda p: -p["_a"])
    for p in polys:
        del p["_a"]
    out = {"source": "antique map segmentation (edge-bounded seed flood)", "space": "uv",
           "count": len(polys), "water": polys}
    path = os.path.join(ROOT, "data", "petrograd_water_map.json")
    open(path, "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    tot = sum(len(p["rings"][0]) for p in polys)
    holes = sum(len(p["rings"]) - 1 for p in polys)
    print(f"  полигонов: {len(polys)}; точек(внеш.): {tot}; дыр-островов: {holes}; "
          f"доля воды: {water.mean()*100:.1f}%; {os.path.getsize(path)}b → data/petrograd_water_map.json", file=sys.stderr)

    # --- превью ---
    rgb = np.array(Image.open(SRC).convert("RGB"))
    ov = rgb.copy(); m = water.astype(bool)
    ov[m] = (0.40 * ov[m] + np.array([0, 130, 220]) * 0.60).astype(np.uint8)
    Image.fromarray(ov).resize((W // 2, H // 2)).save("/tmp/water_map_overlay.png")
    bx = (int(0.36 * W), int(0.26 * H), int(0.74 * W), int(0.58 * H))
    Image.fromarray(ov).crop(bx).save("/tmp/water_map_center.png")
    print("  превью → /tmp/water_map_overlay.png  /tmp/water_map_center.png", file=sys.stderr)


if __name__ == "__main__":
    main()
