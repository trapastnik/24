#!/usr/bin/env python3
"""Гомография (lon,lat)→clean_uv по ТОЧНО детектированным, однозначным меткам.
Затем размещаем все локации сценария по координатам."""
import cv2, numpy as np, json

sc, dsW, dsH, fW, fH = np.load('/tmp/clean_ds_scale.npy')

# контрольные точки: однозначно опознаны по крайнему положению (детект — точный)
# (clean_u, clean_v, lon, lat)
CTRL = [
    (0.542, 0.121, 30.3447, 59.9863),   # Феофанова (самая северная)
    (0.391, 0.193, 30.2980, 59.9840),   # Приморский вокзал (СЗ)
    (0.662, 0.384, 30.3556, 59.9558),   # Финляндский вокзал (СВ)
    (0.704, 0.577, 30.3625, 59.9290),   # Николаевский вокзал (ЮВ)
    (0.560, 0.651, 30.3294, 59.9197),   # Царскосельский вокзал (центр-Ю)
    (0.428, 0.711, 30.2997, 59.9078),   # Балтийский вокзал (ЮЗ)
    (0.451, 0.711, 30.3010, 59.9148),   # Варшавский вокзал (Ю)
    (0.485, 0.498, 30.3140, 59.9410),   # Зимний дворец (центр)
]
src = np.array([[c[2], c[3]] for c in CTRL], np.float64)   # lon,lat
dst = np.array([[c[0], c[1]] for c in CTRL], np.float64)   # uv
Hgeo, mask = cv2.findHomography(src.reshape(-1,1,2), dst.reshape(-1,1,2), 0)

def geo_uv(lon, lat):
    q = cv2.perspectiveTransform(np.array([[[lon, lat]]], np.float64), Hgeo)[0][0]
    return float(q[0]), float(q[1])

# residuals on control points
res = [np.hypot(*(np.array(geo_uv(c[2], c[3])) - [c[0], c[1]])) for c in CTRL]
print("homography residuals:", [round(r,4) for r in res], "max", round(max(res),4))

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
    "tsarskoselsky": (30.3294, 59.9197),
}
placed = {}
for k,(lon,lat) in GEO.items():
    u,v = geo_uv(lon,lat); placed[k] = {"u": round(u,4), "v": round(v,4)}
json.dump(placed, open('/tmp/placed.json','w'), ensure_ascii=False)

# --- emit data/locations.js -------------------------------------------------
NAME = {
 "smolny":"Смольный","winter":"Зимний дворец","mariinsky":"Мариинский дворец",
 "fortress":"Петропавловская крепость","tauride":"Таврический дворец",
 "admiralty":"Адмиралтейство","war_ministry":"Военное министерство",
 "typography_trud":"Типография «Труд»","barracks_litovsky":"Казармы Литовского полка",
 "dvortsovy_br":"Дворцовый мост","troitsky_br":"Троицкий мост","liteyny_br":"Литейный мост",
 "nikolaevsky_br":"Николаевский мост","grenadersky_br":"Гренадерский мост",
 "sampsonievsky_br":"Сампсониевский мост","telegraph_central":"Центральный телеграф",
 "telegraph_agency":"Петроградское телеграфное агентство","nik_station":"Николаевский вокзал",
 "balt_station":"Балтийский вокзал","warsaw_station":"Варшавский вокзал",
 "finland_station":"Финляндский вокзал","post_main":"Главпочтамт",
 "power_station":"Центральная электростанция","gosbank":"Государственный банк",
 "telephone_central":"Центральная телефонная станция","fofanova":"Кв. М.В. Фофановой",
 "aurora":"Крейсер «Аврора»","tsarskoselsky":"Царскосельский вокзал",
}
VRK = {"smolny","fortress","tauride","fofanova","barracks_litovsky",
       "grenadersky_br","sampsonievsky_br","aurora"}
# маршруты по улицам — ломаные lon/lat вдоль реальных проспектов
ROUTES_GEO = {
 "lenin_route": [(30.3447,59.9863),(30.3432,59.9790),(30.3455,59.9690),
   (30.3489,59.9560),(30.3489,59.9527),(30.3645,59.9496),(30.3800,59.9486),(30.3961,59.9479)],
 "litovsky_to_trud": [(30.3637,59.9447),(30.3760,59.9462),(30.3855,59.9487)],
 "winter_to_fortress": [(30.3140,59.9410),(30.3158,59.9458),(30.3166,59.9500)],
}
DIRS = {"kronstadt_dir":(30.20,59.93),"helsingfors_dir":(30.30,59.99)}

def fnum(x): return round(x,4)
lines = ["/* АВТОГЕНЕРАЦИЯ tools/refit_place.py — гомография (lon,lat)→clean_uv по",
 "   крайним детектированным меткам. Координаты — нормированные по карте [u,v].",
 "   Точки можно править вручную после ревью. */",
 "window.MTK24_LOCATIONS = {", "  georef: true,", "  points: {"]
for k,(lon,lat) in GEO.items():
    if k=="tsarskoselsky" and "tsarskoselsky" not in NAME: continue
    p=placed[k]; nm=NAME.get(k,k); fr="vrk" if k in VRK else "pg"
    lines.append(f'    {k}: {{ u: {p["u"]}, v: {p["v"]}, name: "{nm}", force: "{fr}" }},')
lines.append("  },")
lines.append("  directions: {")
for k,(lon,lat) in DIRS.items():
    u,v=geo_uv(lon,lat); lines.append(f'    {k}: {{ u: {fnum(u)}, v: {fnum(v)} }},')
lines.append("  },")
lines.append("  routes: {")
for rk,wps in ROUTES_GEO.items():
    pts=[[fnum(a) for a in geo_uv(lo,la)] for lo,la in wps]
    lines.append(f"    {rk}: {json.dumps(pts)},")
lines.append("  },")
lines.append("};")
open('data/locations.js','w').write("\n".join(lines)+"\n")
print("wrote data/locations.js")

C = cv2.imread('in/map_tone_gray.png')
vis = cv2.resize(C, (1600, int(fH*1600/fW))); VH=vis.shape[0]
for k,p in placed.items():
    x,y=int(p["u"]*1600),int(p["v"]*VH)
    cv2.circle(vis,(x,y),7,(40,40,230),-1); cv2.circle(vis,(x,y),7,(255,255,255),1)
    cv2.putText(vis,k,(x+7,y-4),cv2.FONT_HERSHEY_SIMPLEX,0.42,(0,0,0),3)
    cv2.putText(vis,k,(x+7,y-4),cv2.FONT_HERSHEY_SIMPLEX,0.42,(60,255,255),1)
cv2.imwrite('/tmp/placed_on_clean.png', vis)
print("placed", len(placed), "-> /tmp/placed_on_clean.png")
