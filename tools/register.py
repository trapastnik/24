#!/usr/bin/env python3
"""SIFT-регистрация размеченной карты → чистой карты (одна и та же гравюра).
Маскируем красные наложения, чтобы сопоставлялись только общие линии плана."""
import cv2, numpy as np, sys

M = cv2.imread('/tmp/marked_r24-1.png')         # marked (labels+stars), 2835x2363
C = cv2.imread('in/map_tone_gray.png')          # clean full res 6545x7792
fullW, fullH = C.shape[1], C.shape[0]
sc = 2835 / fullW
Cs = cv2.resize(C, (int(fullW * sc), int(fullH * sc)))
print('marked', M.shape, 'cleanDS', Cs.shape, flush=True)

# mask red overlays in marked → neutral, so SIFT ignores them
hsv = cv2.cvtColor(M, cv2.COLOR_BGR2HSV)
red = cv2.bitwise_or(cv2.inRange(hsv, (0, 80, 80), (12, 255, 255)),
                     cv2.inRange(hsv, (168, 80, 80), (180, 255, 255)))
red = cv2.dilate(red, np.ones((9, 9), np.uint8))
gM = cv2.cvtColor(M, cv2.COLOR_BGR2GRAY)
gC = cv2.cvtColor(Cs, cv2.COLOR_BGR2GRAY)
gM[red > 0] = int(np.median(gM))                # blank out red regions

# normalize contrast (renders differ in tone)
gM = cv2.createCLAHE(2.0, (8, 8)).apply(gM)
gC = cv2.createCLAHE(2.0, (8, 8)).apply(gC)

sift = cv2.SIFT_create(nfeatures=0, contrastThreshold=0.012, edgeThreshold=12)
kM, dM = sift.detectAndCompute(gM, None)
kC, dC = sift.detectAndCompute(gC, None)
print('kp marked', len(kM), 'clean', len(kC), flush=True)

flann = cv2.FlannBasedMatcher(dict(algorithm=1, trees=5), dict(checks=64))
knn = flann.knnMatch(dM, dC, k=2)
good = [m for m, n in knn if m.distance < 0.75 * n.distance]
print('good matches', len(good), flush=True)

src = np.float32([kM[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
dst = np.float32([kC[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 4.0)
inl = int(mask.sum())
print('inliers', inl, '/', len(good), flush=True)

np.save('/tmp/H_marked_to_cleanDS.npy', H)
np.save('/tmp/clean_ds_scale.npy', np.array([sc, Cs.shape[1], Cs.shape[0], fullW, fullH]))

warp = cv2.warpPerspective(M, H, (Cs.shape[1], Cs.shape[0]))
blend = cv2.addWeighted(Cs, 0.55, warp, 0.45, 0)
cv2.imwrite('/tmp/reg_overlay.png', blend)
print('H=\n', H, flush=True)
print('DONE', flush=True)
