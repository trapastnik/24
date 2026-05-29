#!/usr/bin/env python3
"""Все метки на размеченной карте, ПЕРЕНЕСЁННЫЕ в пространство чистой карты.
Варпим marked→clean (H), детектим оранжевые пины + красные звёзды, нумеруем
поверх видимых подписей — чтобы привязать номер→название по соседству."""
import cv2, numpy as np, json

M = cv2.imread('/tmp/marked_r24-1.png')
C = cv2.imread('in/map_tone_gray.png')
H = np.load('/tmp/H_marked_to_cleanDS.npy')
sc, dsW, dsH, fullW, fullH = np.load('/tmp/clean_ds_scale.npy')
dsW, dsH = int(dsW), int(dsH)

W = cv2.warpPerspective(M, H, (dsW, dsH))      # marked в координатах clean(DS)
hsv = cv2.cvtColor(W, cv2.COLOR_BGR2HSV)

# orange pins
orange = cv2.inRange(hsv, (6, 70, 110), (28, 210, 240))
orange = cv2.morphologyEx(orange, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
# red stars (compact), not elongated label boxes
red = cv2.bitwise_or(cv2.inRange(hsv, (0, 110, 110), (10, 255, 255)),
                     cv2.inRange(hsv, (170, 110, 110), (180, 255, 255)))

markers = []   # (px, py) in clean-DS
def take(mask, kind):
    n, lab, st, cen = cv2.connectedComponentsWithStats(mask, 8)
    for i in range(1, n):
        x, y, w, h, area = st[i]
        if area < 90 or area > 5000:
            continue
        ar = w / max(1, h)
        if kind == 'red':
            if ar > 2.2 or ar < 0.45:        # отсечь вытянутые плашки
                continue
            fill = area / max(1, w * h)
            if fill > 0.82 and w * h > 900:  # сплошная плашка
                continue
        # location = bottom tip for orange pin, centroid for red star
        if kind == 'orange':
            ys, xs = np.where(lab == i); ty = ys.max(); tx = int(xs[ys == ty].mean())
            markers.append((tx, ty))
        else:
            markers.append((int(cen[i][0]), int(cen[i][1])))
take(orange, 'orange')
take(red, 'red')

# dedupe markers within 22 px
uniq = []
for m in markers:
    if all((m[0]-u[0])**2 + (m[1]-u[1])**2 > 22*22 for u in uniq):
        uniq.append(m)
print("markers:", len(uniq))

out = [{"u": round(px/dsW, 4), "v": round(py/dsH, 4)} for px, py in uniq]
out.sort(key=lambda o: (o["v"], o["u"]))
json.dump(out, open('/tmp/allmarkers.json', 'w'))

# numbered overlay on clean+warp blend (labels visible)
blend = cv2.addWeighted(cv2.resize(C,(dsW,dsH)), 0.5, W, 0.5, 0)
vis = cv2.resize(blend, (1700, int(dsH*1700/dsW)))
VW, VH = vis.shape[1], vis.shape[0]
for idx, o in enumerate(out):
    x, y = int(o["u"]*VW), int(o["v"]*VH)
    cv2.circle(vis,(x,y),10,(0,0,255),2)
    cv2.putText(vis,str(idx),(x-6,y+5),cv2.FONT_HERSHEY_SIMPLEX,0.5,(255,255,255),3)
    cv2.putText(vis,str(idx),(x-6,y+5),cv2.FONT_HERSHEY_SIMPLEX,0.5,(0,0,255),1)
cv2.imwrite('/tmp/allmarkers_vis.png', vis)
print("wrote /tmp/allmarkers_vis.png n=", len(out))
