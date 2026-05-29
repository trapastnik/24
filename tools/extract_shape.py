#!/usr/bin/env python3
"""Извлекает ТОЧНУЮ форму рабочего экрана из ТЗ (in/размер 24.PNG):
чёрный контур (трапеция с дугами) → CSS clip-path polygon в % + аспект bbox."""
import cv2, numpy as np

im = cv2.imread("in/размер 24.PNG")
H, W = im.shape[:2]
b, g, r = im[:, :, 0].astype(int), im[:, :, 1].astype(int), im[:, :, 2].astype(int)
gray = (r + g + b) / 3
# чёрный контур: тёмные, НЕ зелёные (зелёные — размерные линии/числа)
green = (g > r + 25) & (g > b + 25)
dark = ((gray < 150) & ~green).astype(np.uint8) * 255
# закрыть разрывы контура (где его пересекали зелёные стрелки)
dark = cv2.dilate(dark, np.ones((9, 9), np.uint8), iterations=4)
# залить ВНЕШНЮЮ область от угла, интерьер = то, что не залилось
filled = dark.copy()
ffm = np.zeros((H + 2, W + 2), np.uint8)
cv2.floodFill(filled, ffm, (0, 0), 255)
interior = cv2.bitwise_not(filled)            # форма = замкнутый интерьер
interior = cv2.dilate(interior, np.ones((9, 9), np.uint8), iterations=4)  # вернуть размер
cnts, _ = cv2.findContours(interior, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
c = max(cnts, key=cv2.contourArea)
approx = cv2.approxPolyDP(c, 1.4, True).reshape(-1, 2)   # мелкий epsilon — сохранить дуги
print("contour points:", len(c), "→ approx:", len(approx))

x, y, w, h = cv2.boundingRect(c)
pts = [((px - x) / w, (py - y) / h) for px, py in approx]
# ensure clockwise from top-left для аккуратного polygon (не обязательно, clip-path всё равно работает)
poly = ", ".join(f"{u*100:.2f}% {v*100:.2f}%" for u, v in pts)
print("aspect (w/h):", round(w / h, 4), f"  bbox {w}x{h}")
open("/tmp/shape.txt", "w").write(f"ASPECT {w/h:.4f}\nclip-path: polygon({poly});\n")
print("\nclip-path: polygon(" + poly + ");")

# визуализация: залить форму на прозрачном для проверки
vis = im.copy(); cv2.drawContours(vis, [approx.reshape(-1,1,2)], -1, (0,0,255), 3)
cv2.imwrite("/tmp/shape_vis.png", vis)
