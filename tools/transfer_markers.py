#!/usr/bin/env python3
"""
Перенос позиций ориентиров с РАЗМЕЧЕННОЙ карты (PDF с красными метками) на ЧИСТУЮ
карту (map_tone_gray.png) через гомографию H (SIFT-регистрация, см. reg-вывод).

1) Детектируем красные ★/точки на размеченной карте (фильтр по площади/форме,
   чтобы отсечь крупные красные плашки-подписи).
2) Переводим их пиксели marked → clean (через H) → нормированные [u,v].
3) Рисуем пронумерованные точки на чистой карте для ручной привязки названий.
"""
import cv2, numpy as np, json

M = cv2.imread('/tmp/marked_hi-1.png')
C = cv2.imread('in/map_tone_gray.png')
H = np.load('/tmp/H_marked_to_cleanDS.npy')
sc, dsW, dsH, fullW, fullH = np.load('/tmp/clean_ds_scale.npy')

# --- detect red marker icons on the marked map ---------------------------
hsv = cv2.cvtColor(M, cv2.COLOR_BGR2HSV)
# red wraps around hue 0/180
m1 = cv2.inRange(hsv, (0, 90, 90), (10, 255, 255))
m2 = cv2.inRange(hsv, (170, 90, 90), (180, 255, 255))
red = cv2.bitwise_or(m1, m2)
red = cv2.morphologyEx(red, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))

n, lab, stats, cent = cv2.connectedComponentsWithStats(red, 8)
cand = []
for i in range(1, n):
    x, y, w, h, area = stats[i]
    if area < 60 or area > 4000:        # отсечь шум и крупные плашки-подписи
        continue
    ar = w / max(1, h)
    if ar > 3.2 or ar < 0.31:           # отсечь вытянутые плашки
        continue
    fill = area / max(1, w * h)
    # звезда/точка — компактная, плашка-подпись — прямоугольная и заполненная >0.8 и крупная
    if w * h > 1500 and fill > 0.78:
        continue
    cand.append((float(cent[i][0]), float(cent[i][1]), int(area)))

print(f"detected {len(cand)} red marker candidates")

# --- transform marked px -> clean uv -------------------------------------
def to_clean_uv(px, py):
    p = np.array([[[px, py]]], dtype=np.float32)
    q = cv2.perspectiveTransform(p, H)[0][0]   # clean-DS px
    return float(q[0] / dsW), float(q[1] / dsH)  # uv (0..1)

out = []
for (px, py, area) in cand:
    u, v = to_clean_uv(px, py)
    if -0.02 <= u <= 1.02 and -0.02 <= v <= 1.02:
        out.append({"u": round(u, 4), "v": round(v, 4), "area": area, "mx": px, "my": py})

print(f"{len(out)} markers inside clean map bounds")

# --- visualise on the clean map (numbered) -------------------------------
vis = cv2.resize(C, (1400, int(C.shape[0] * 1400 / C.shape[1])))
sx, sy = 1400 / fullW, (vis.shape[0]) / fullH
for idx, o in enumerate(out):
    cx, cy = int(o["u"] * 1400), int(o["v"] * vis.shape[0])
    cv2.circle(vis, (cx, cy), 9, (40, 40, 230), 2)
    cv2.putText(vis, str(idx), (cx + 8, cy - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
cv2.imwrite('/tmp/markers_on_clean.png', vis)
json.dump(out, open('/tmp/markers.json', 'w'), ensure_ascii=False, indent=0)
print("wrote /tmp/markers_on_clean.png and /tmp/markers.json")
