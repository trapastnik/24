#!/usr/bin/env python3
"""Параметры ТОЧНОЙ формы экрана из ТЗ (in/размер 24.PNG): 4 угла + прогиб дуг
верх/низ. Без тяжёлой морфологии (чтобы сохранить кривизну дуг).
Вывод — доли bbox, чтобы строить clip-path: path() с настоящими кривыми."""
import cv2, numpy as np, json

im = cv2.imread("in/размер 24.PNG")
H, W = im.shape[:2]
b, g, r = im[:, :, 0].astype(int), im[:, :, 1].astype(int), im[:, :, 2].astype(int)
gray = (r + g + b) / 3
green = (g > r + 25) & (g > b + 25)
dark = (gray < 150) & ~green                       # только чёрный контур
ys, xs = np.where(dark)
minx, maxx, miny, maxy = xs.min(), xs.max(), ys.min(), ys.max()
w, h = maxx - minx, maxy - miny
print("bbox", w, "x", h, "aspect", round(w / h, 4))

pts = np.stack([xs, ys], 1).astype(float)
def corner(score):  # вернуть точку, минимизирующую score
    return pts[np.argmin(score)]
tl = corner(pts[:, 0] + pts[:, 1])
br = corner(-(pts[:, 0] + pts[:, 1]))
bl = corner(pts[:, 0] - pts[:, 1])
tr = corner(-(pts[:, 0] - pts[:, 1]))

# прогиб верхней дуги: самый верхний контурный пиксель у центра X
cx = (tl[0] + tr[0]) / 2
band = lambda c, win: dark[:, int(c - win):int(c + win)]
def edge_y(c, top=True, win=8):
    col_xs = np.where((xs > c - win) & (xs < c + win))[0]
    yy = ys[col_xs]
    return yy.min() if top else yy.max()
topMidY = edge_y(cx, True)
bx = (bl[0] + br[0]) / 2
botMidY = edge_y(bx, False)

def fx(px): return (px - minx) / w
def fy(py): return (py - miny) / h
shape = {
    "aspect": round(w / h, 4),
    "tl": [round(fx(tl[0]), 4), round(fy(tl[1]), 4)],
    "tr": [round(fx(tr[0]), 4), round(fy(tr[1]), 4)],
    "br": [round(fx(br[0]), 4), round(fy(br[1]), 4)],
    "bl": [round(fx(bl[0]), 4), round(fy(bl[1]), 4)],
    "topMid": [round(fx(cx), 4), round(fy(topMidY), 4)],
    "botMid": [round(fx(bx), 4), round(fy(botMidY), 4)],
}
print(json.dumps(shape, ensure_ascii=False))
open("/tmp/shape.json", "w").write(json.dumps(shape))

# визуализация
vis = im.copy()
for nm, p in [("tl", tl), ("tr", tr), ("br", br), ("bl", bl)]:
    cv2.circle(vis, (int(p[0]), int(p[1])), 7, (0, 0, 255), -1)
cv2.circle(vis, (int(cx), int(topMidY)), 7, (255, 0, 0), -1)
cv2.circle(vis, (int(bx), int(botMidY)), 7, (255, 0, 0), -1)
cv2.imwrite("/tmp/shape_pts.png", vis)
print("top bow:", round((fy(topMidY) - (fy(tl[1]) + fy(tr[1])) / 2) * 100, 1), "% | bottom bow:",
      round((fy(botMidY) - (fy(bl[1]) + fy(br[1])) / 2) * 100, 1), "%")
