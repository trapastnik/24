#!/usr/bin/env python3
"""Детект оранжевых пин-меток на размеченной карте → их остриё → clean_uv (через H)."""
import cv2, numpy as np, json

M = cv2.imread('/tmp/marked_r24-1.png')
H = np.load('/tmp/H_marked_to_cleanDS.npy')
sc, dsW, dsH, fullW, fullH = np.load('/tmp/clean_ds_scale.npy')

hsv = cv2.cvtColor(M, cv2.COLOR_BGR2HSV)
orange = cv2.inRange(hsv, (7, 90, 150), (26, 190, 230))
orange = cv2.morphologyEx(orange, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
n, lab, stats, cent = cv2.connectedComponentsWithStats(orange, 8)

pins = []
for i in range(1, n):
    x, y, w, h, area = stats[i]
    if area < 150 or area > 4000:
        continue
    if h < 10 or w < 6:
        continue
    # tip = bottom-most point of the blob (teardrop points down)
    ys, xs = np.where(lab == i)
    tipy = ys.max()
    tipx = int(np.round(xs[ys == tipy].mean()))
    pins.append((tipx, int(tipy), int(area)))

print("orange pins detected:", len(pins))

def to_uv(px, py):
    q = cv2.perspectiveTransform(np.array([[[px, py]]], np.float32), H)[0][0]
    return q[0] / dsW, q[1] / dsH

out = []
for (px, py, area) in sorted(pins, key=lambda p: (p[1], p[0])):
    u, v = to_uv(px, py)
    out.append({"u": round(float(u), 4), "v": round(float(v), 4), "area": area})

# visualise numbered on clean map
C = cv2.imread('in/map_tone_gray.png')
vis = cv2.resize(C, (1600, int(fullH * 1600 / fullW)))
VH = vis.shape[0]
for idx, o in enumerate(out):
    x, y = int(o["u"] * 1600), int(o["v"] * VH)
    cv2.circle(vis, (x, y), 8, (40, 40, 230), -1)
    cv2.circle(vis, (x, y), 8, (255, 255, 255), 1)
    cv2.putText(vis, str(idx), (x + 8, y - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 4)
    cv2.putText(vis, str(idx), (x + 8, y - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (40, 255, 255), 1)
cv2.imwrite('/tmp/pins_on_clean.png', vis)
json.dump(out, open('/tmp/pins.json', 'w'), ensure_ascii=False)
print("wrote /tmp/pins_on_clean.png and /tmp/pins.json (n=%d)" % len(out))
