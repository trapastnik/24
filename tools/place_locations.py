#!/usr/bin/env python3
"""
Расстановка всех точек сценария на ЧИСТОЙ карте.

Идея: размеченная карта = тот же чертёж, что и чистая (H: marked→cleanDS уже
найдена SIFT-регистрацией). По нескольким хорошо опознаваемым меткам строим
аффинное преобразование (lon,lat)→clean_uv, затем размещаем ВСЕ локации
(в т.ч. те, которых нет на размеченной карте) по их координатам lon/lat.
Выводит uv и визуализацию для ревью.
"""
import cv2, numpy as np, json

H = np.load('/tmp/H_marked_to_cleanDS.npy')
sc, dsW, dsH, fullW, fullH = np.load('/tmp/clean_ds_scale.npy')
MW, MH = 2835.0, 2363.0   # marked_r24 dims

def marked_uv_to_clean_uv(u, v):
    p = np.array([[[u * MW, v * MH]]], np.float32)
    q = cv2.perspectiveTransform(p, H)[0][0]
    return q[0] / dsW, q[1] / dsH

# --- контрольные точки: (marked_u, marked_v, lon, lat) — считаны с размеченной карты
CTRL = [
    ("smolny",   0.80, 0.45, 30.3961, 59.9479),
    ("finland",  0.60, 0.36, 30.3556, 59.9558),
    ("fortress", 0.348, 0.485, 30.3166, 59.9500),
    ("nik_st",   0.76, 0.70, 30.3625, 59.9290),
    ("balt_st",  0.36, 0.90, 30.2997, 59.9078),
    ("winter",   0.476, 0.585, 30.3140, 59.9410),
    ("vitebsk",  0.57, 0.82, 30.3294, 59.9197),
]
src = []  # lon,lat
dstuv = []  # clean uv
for name, mu, mv, lon, lat in CTRL:
    cu, cv = marked_uv_to_clean_uv(mu, mv)
    src.append([lon, lat]); dstuv.append([cu, cv])
src = np.array(src); dstuv = np.array(dstuv)

# fit affine (u,v) = A·(lon,lat,1)  — 6 params, least squares
Aug = np.hstack([src, np.ones((len(src), 1))])
Au, *_ = np.linalg.lstsq(Aug, dstuv[:, 0], rcond=None)
Av, *_ = np.linalg.lstsq(Aug, dstuv[:, 1], rcond=None)
def geo_to_uv(lon, lat):
    return float(Au @ [lon, lat, 1]), float(Av @ [lon, lat, 1])
# residuals
res = [np.hypot(*(np.array(geo_to_uv(lon, lat)) - dstuv[i]))
       for i, (n, mu, mv, lon, lat) in enumerate(CTRL)]
print("affine residuals (uv):", [round(r, 4) for r in res], "max", round(max(res), 4))

# --- все локации сценария: lon, lat ---
GEO = {
    "smolny": (30.3961, 59.9479), "winter": (30.3140, 59.9410),
    "mariinsky": (30.3089, 59.9329), "fortress": (30.3166, 59.9500),
    "tauride": (30.3743, 59.9477), "admiralty": (30.3084, 59.9375),
    "war_ministry": (30.3072, 59.9337),
    "typography_trud": (30.3855, 59.9487), "barracks_litovsky": (30.3637, 59.9447),
    "dvortsovy_br": (30.3083, 59.9410), "troitsky_br": (30.3268, 59.9467),
    "liteyny_br": (30.3489, 59.9527), "nikolaevsky_br": (30.2940, 59.9335),
    "grenadersky_br": (30.3360, 59.9648), "sampsonievsky_br": (30.3389, 59.9579),
    "telegraph_central": (30.3035, 59.9332), "telegraph_agency": (30.3050, 59.9322),
    "nik_station": (30.3625, 59.9290), "balt_station": (30.2997, 59.9078),
    "warsaw_station": (30.3010, 59.9148), "finland_station": (30.3556, 59.9558),
    "post_main": (30.3056, 59.9316), "power_station": (30.3445, 59.9275),
    "gosbank": (30.3268, 59.9290), "telephone_central": (30.3169, 59.9347),
    "fofanova": (30.3447, 59.9863), "aurora": (30.2950, 59.9340),
}
placed = {k: {"u": round(geo_to_uv(lon, lat)[0], 4), "v": round(geo_to_uv(lon, lat)[1], 4)}
          for k, (lon, lat) in GEO.items()}
json.dump(placed, open('/tmp/placed.json', 'w'), ensure_ascii=False, indent=0)

# --- visualise on clean map for review ---
C = cv2.imread('in/map_tone_gray.png')
vis = cv2.resize(C, (1500, int(fullH * 1500 / fullW)))
VH = vis.shape[0]
for k, p in placed.items():
    x, y = int(p["u"] * 1500), int(p["v"] * VH)
    cv2.circle(vis, (x, y), 7, (40, 40, 230), -1)
    cv2.circle(vis, (x, y), 7, (255, 255, 255), 1)
    cv2.putText(vis, k, (x + 7, y - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 0, 0), 3)
    cv2.putText(vis, k, (x + 7, y - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (60, 255, 255), 1)
cv2.imwrite('/tmp/placed_on_clean.png', vis)
print("placed", len(placed), "locations -> /tmp/placed_on_clean.png")
