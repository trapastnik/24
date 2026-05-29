#!/usr/bin/env python3
"""
Извлечение названий улиц/рек/районов из ВЕКТОРНОГО текста PDF с позициями
и углом написания (для плашек «вдоль улицы»). Переводим в систему чистой карты
через H. Метки-ориентиры (Зимний, вокзалы, мосты…) пропускаем — они уже в точках.
Вывод: data/streets.js  (window.MTK24_STREETS).
"""
import fitz, cv2, numpy as np, json, re, math

PDF = "in/Карты и Иллюстрации/КАРТА общая пробная_не вектор.pdf"
H = np.load('/tmp/H_marked_to_cleanDS.npy')
sc, dsW, dsH, fW, fH = np.load('/tmp/clean_ds_scale.npy')

def pdf_to_uv(x, y):
    q = cv2.perspectiveTransform(np.array([[[x/3.0, y/3.0]]], np.float64), H)[0][0]
    return round(float(q[0]/dsW), 4), round(float(q[1]/dsH), 4)

def norm(t):
    t = t.upper().replace("І","И").replace("Ѣ","Е").replace("Ѳ","Ф").replace("Ѵ","И").replace("Ї","И")
    for a, b in {"A":"А","B":"В","C":"С","E":"Е","H":"Н","I":"И","K":"К","M":"М","O":"О","P":"Р","T":"Т","X":"Х","Y":"У"}.items():
        t = t.replace(a, b)
    return re.sub(r"[^А-Я]", "", t)

# имена-ориентиры/мосты — это точки, не улицы
SKIP = ["ФЕОФАНОВ","ВОКЗАЛ","ДВОРЕЦ","КРЕПОСТЬ","СМОЛЬНЫЙ","АДМИРАЛТЕЙСТВО",
        "ТЕЛЕГРАФ","ПОЧТАМТ","ТИПОГРАФИЯ","МОСТ"]
def category(n):
    if any(s in n for s in SKIP): return None
    if "РАЙОН" in n: return None     # районы — отдельная подпись «РАЙОНЪ», пропускаем
    if any(s in n for s in ["НЕВА","НЕВКА","КАНАЛ","ФОНТАНКА","МОЙКА","ПРЯЖКА","ЗАЛИВ","РЕКА"]): return "river"
    if any(s in n for s in ["УЛИЦА","ПРОСПЕКТ","НАБЕРЕЖНАЯ","ПЕРЕУЛОК","ШОССЕ","ПЛОЩАДЬ","БУЛЬВАР","ЛИНИЯ"]): return "street"
    return None     # прочий текст пропускаем

def clean_name(t):
    toks = t.split()
    if toks and sum(len(x) for x in toks) / len(toks) <= 1.6:
        return "".join(toks)              # «Н Е В А» → «НЕВА»
    return t

doc = fitz.open(PDF); pg = doc[0]
out = []
for b in pg.get_text("dict")["blocks"]:
    for l in b.get("lines", []):
        t = "".join(s["text"] for s in l["spans"]).strip()
        if not t: continue
        cat = category(norm(t))
        if not cat: continue
        bb = l["bbox"]; cx, cy = (bb[0]+bb[2])/2, (bb[1]+bb[3])/2
        u, v = pdf_to_uv(cx, cy)
        d = l.get("dir", (1, 0))
        ang = round(math.degrees(math.atan2(d[1], d[0])), 1)
        if ang > 90: ang -= 180
        if ang < -90: ang += 180          # держим текст читаемым
        out.append({"name": clean_name(t), "u": u, "v": v, "angle": ang, "cat": cat})

# --- важные улицы, которых НЕТ в PDF: по двум точкам lon/lat (поза + угол) ---
CTRL=[(0.542,0.121,30.3447,59.9863),(0.391,0.193,30.2980,59.9840),(0.662,0.384,30.3556,59.9558),
      (0.704,0.577,30.3625,59.9290),(0.560,0.651,30.3294,59.9197),(0.428,0.711,30.2997,59.9078),
      (0.451,0.711,30.3010,59.9148),(0.485,0.498,30.3140,59.9410)]
Hg,_=cv2.findHomography(np.array([[c[2],c[3]] for c in CTRL]).reshape(-1,1,2),
                        np.array([[c[0],c[1]] for c in CTRL]).reshape(-1,1,2),0)
def geo(lon,lat):
    q=cv2.perspectiveTransform(np.array([[[lon,lat]]],np.float64),Hg)[0][0];return float(q[0]),float(q[1])
ADD=[  # name, lon1,lat1, lon2,lat2  (две точки вдоль улицы)
 ("Б. Сампсониевскій пр.",30.339,59.965, 30.345,59.980),
 ("Лѣсной пр.",          30.346,59.975, 30.349,59.992),
 ("Боткинская ул.",      30.351,59.955, 30.357,59.959),
 ("Кирочная ул.",        30.350,59.944, 30.366,59.945),
 ("Кавалергардская ул.", 30.380,59.946, 30.388,59.952),
 ("Суворовскій пр.",     30.366,59.940, 30.388,59.948),
 ("Литейный пр.",        30.348,59.938, 30.349,59.948),
 ("Загородный пр.",      30.330,59.926, 30.346,59.929),
 ("Лиговскій пр.",       30.357,59.922, 30.361,59.930),
]
for nm,lo1,la1,lo2,la2 in ADD:
    u1,v1=geo(lo1,la1); u2,v2=geo(lo2,la2)
    ang=math.degrees(math.atan2(v2-v1,u2-u1))
    if ang>90: ang-=180
    if ang<-90: ang+=180
    out.append({"name":nm,"u":round((u1+u2)/2,4),"v":round((v1+v2)/2,4),"angle":round(ang,1),"cat":"street"})

# дедуп близких одинаковых
out.sort(key=lambda s: (s["cat"], s["name"]))
js = "window.MTK24_STREETS = [\n" + "\n".join(
    f'  {{ name: {json.dumps(s["name"],ensure_ascii=False)}, u: {s["u"]}, v: {s["v"]}, angle: {s["angle"]}, cat: "{s["cat"]}" }},'
    for s in out) + "\n];\n"
open("data/streets.js", "w", encoding="utf-8").write(js)
print(f"streets.js: {len(out)} меток")
from collections import Counter
print(Counter(s["cat"] for s in out))
for s in out: print(f'  {s["cat"]:8s} {s["angle"]:6.1f}°  {s["name"]}')
