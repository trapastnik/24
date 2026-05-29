#!/usr/bin/env python3
"""
Расстановка точек по ВЕКТОРНЫМ данным PDF (точно):
 • 16 оранжевых пин-меток → их остриё (tip) = точная позиция;
 • подписи (векторный текст) → идентификация (имя→ключ);
 • мосты (подпись без пина) → по центру подписи;
 • остальные точки сценария (нет на карте) → гео-гомография как раньше.
Координаты PDF (pt) → marked_r24 px (÷3) → clean (H) → нормированные uv.
"""
import fitz, cv2, numpy as np, json, re

PDF = "in/Карты и Иллюстрации/КАРТА общая пробная_не вектор.pdf"
H = np.load('/tmp/H_marked_to_cleanDS.npy')
sc, dsW, dsH, fW, fH = np.load('/tmp/clean_ds_scale.npy')

def pdf_to_uv(x, y):
    px, py = x/3.0, y/3.0                       # -r 24 render = pt * 24/72
    q = cv2.perspectiveTransform(np.array([[[px, py]]], np.float64), H)[0][0]
    return float(q[0]/dsW), float(q[1]/dsH)

doc = fitz.open(PDF); pg = doc[0]
def spaced(t):
    toks = t.split(); return len(toks) > 3 and all(len(x) <= 2 for x in toks)
labels = []
for b in pg.get_text("dict")["blocks"]:
    for l in b.get("lines", []):
        t = "".join(s["text"] for s in l["spans"]).strip()
        if t and not spaced(t):
            bb = l["bbox"]; labels.append((t, (bb[0]+bb[2])/2, (bb[1]+bb[3])/2))

def norm(t):
    t = t.upper().replace("І","И").replace("Ѣ","Е").replace("Ѳ","Ф").replace("Ѵ","И").replace("Ї","И")
    lat = {"A":"А","B":"В","C":"С","E":"Е","H":"Н","I":"И","K":"К","M":"М",
           "O":"О","P":"Р","T":"Т","X":"Х","Y":"У"}
    for a, b in lat.items(): t = t.replace(a, b)
    return re.sub(r"[^А-Я]", "", t)
KEYMAP = [
    ("ФЕОФАНОВ","fofanova"),("ПРИМОРСКИЙВОКЗАЛ","primorsky"),("ФИНСКИЙВОКЗАЛ","finland_station"),
    ("ТИПОГРАФИЯ","typography_trud"),("СМОЛЬНЫЙ","smolny"),("ТАВРИЧЕСКИЙ","tauride"),
    ("ПЕТРОПАВЛОВСКАЯ","fortress"),("ЗИМНИЙ","winter"),("АДМИРАЛТЕЙСТВО","admiralty"),
    ("ТЕЛЕГРАФ","telegraph_central"),("ПОЧТАМТ","post_main"),("МАРИИНСКИЙ","mariinsky"),
    ("НИКОЛАЕВСКИЙВОКЗАЛ","nik_station"),("БАЛТИЙСКИЙ","balt_station"),
    ("ЦАРСКОСЕЛЬСКИЙ","tsarskoselsky"),("ВАРШАВСКИЙ","warsaw_station"),
    ("ТРОИЦКИЙМОСТ","troitsky_br"),("ЛИТЕЙНЫЙМОСТ","liteyny_br"),("ДВОРЦОВЫЙМОСТ","dvortsovy_br"),
]
def label_key(t):
    n = norm(t)
    for sub, k in KEYMAP:
        if sub in n: return k
    return None
keyed_labels = [(label_key(t), cx, cy, t) for t, cx, cy in labels]
keyed_labels = [x for x in keyed_labels if x[0]]

from scipy.optimize import linear_sum_assignment
# vector graphics: orange pins (tip+bbox), red label BOXES (large), stars (small)
pins, boxes = [], []
for dr in pg.get_drawings():
    f = dr.get("fill"); r = dr["rect"]
    if not f: continue
    if all(abs(a-b) < 0.04 for a, b in zip(f, (0.82, 0.72, 0.45))):
        pins.append({"tip": ((r.x0+r.x1)/2, r.y1),
                     "head": ((r.x0+r.x1)/2, r.y0 + r.height*0.38),
                     "rect": (r.x0, r.y0, r.x1, r.y1)})
    elif all(abs(a-b) < 0.04 for a, b in zip(f, (0.63, 0.13, 0.16))) and r.width*r.height > 50000:
        boxes.append((r.x0, r.y0, r.x1, r.y1))
print("pins:", len(pins), "boxes:", len(boxes), "keyed labels:", len(keyed_labels))

def inside(cx, cy, b): return b[0] <= cx <= b[2] and b[1] <= cy <= b[3]
def box_label(b):
    # text line whose center is inside the box; else nearest center
    bc = ((b[0]+b[2])/2, (b[1]+b[3])/2)
    inb = [(k,cx,cy,t) for k,cx,cy,t in keyed_labels if inside(cx,cy,b)]
    pool = inb or keyed_labels
    return min(pool, key=lambda x:(x[1]-bc[0])**2+(x[2]-bc[1])**2)
def pt_to_rect(p, b):
    dx = max(b[0]-p[0], 0, p[0]-b[2]); dy = max(b[1]-p[1], 0, p[1]-b[3])
    return (dx*dx+dy*dy) ** 0.5

# Hungarian assignment pins <-> boxes by pin-head→box distance
cost = np.array([[pt_to_rect(p["head"], b) for b in boxes] for p in pins])
ri, ci = linear_sum_assignment(cost)
placed = {}
for pi, bi in zip(ri, ci):
    k, cx, cy, t = box_label(boxes[bi])
    placed[k] = pdf_to_uv(*pins[pi]["tip"])
    print(f"  pin→box {k:18s} ({t})  d={cost[pi,bi]:.0f}")

# labels without a box (bridges etc.) → label center
for k, cx, cy, t in keyed_labels:
    if k not in placed:
        placed[k] = pdf_to_uv(cx, cy)
        print(f"  lbl→ {k:18s} ({t})  [no box, label center]")

# --- fallback geo-homography for scenario points not on the map ---
CTRL = [(0.542,0.121,30.3447,59.9863),(0.391,0.193,30.2980,59.9840),(0.662,0.384,30.3556,59.9558),
        (0.704,0.577,30.3625,59.9290),(0.560,0.651,30.3294,59.9197),(0.428,0.711,30.2997,59.9078),
        (0.451,0.711,30.3010,59.9148),(0.485,0.498,30.3140,59.9410)]
src=np.array([[c[2],c[3]] for c in CTRL]); dst=np.array([[c[0],c[1]] for c in CTRL])
Hg,_=cv2.findHomography(src.reshape(-1,1,2),dst.reshape(-1,1,2),0)
def geo(lon,lat):
    q=cv2.perspectiveTransform(np.array([[[lon,lat]]],np.float64),Hg)[0][0]; return float(q[0]),float(q[1])
GEO_EXTRA={"mariinsky":(30.3089,59.9329),"war_ministry":(30.3072,59.9337),
 "barracks_litovsky":(30.3637,59.9447),"nikolaevsky_br":(30.2940,59.9335),
 "grenadersky_br":(30.3360,59.9648),"sampsonievsky_br":(30.3389,59.9579),
 "telegraph_agency":(30.3050,59.9322),"power_station":(30.3445,59.9275),
 "gosbank":(30.3268,59.9290),"telephone_central":(30.3169,59.9347),"aurora":(30.2950,59.9340)}
for k,(lon,lat) in GEO_EXTRA.items():
    if k not in placed: placed[k]=geo(lon,lat)

# --- names/forces ---
NAME={"smolny":"Смольный","winter":"Зимний дворец","mariinsky":"Мариинский дворец",
 "fortress":"Петропавловская крепость","tauride":"Таврический дворец","admiralty":"Адмиралтейство",
 "war_ministry":"Военное министерство","typography_trud":"Типография «Труд»",
 "barracks_litovsky":"Казармы Литовского полка","dvortsovy_br":"Дворцовый мост",
 "troitsky_br":"Троицкий мост","liteyny_br":"Литейный мост","nikolaevsky_br":"Николаевский мост",
 "grenadersky_br":"Гренадерский мост","sampsonievsky_br":"Сампсониевский мост",
 "telegraph_central":"Центральный телеграф","telegraph_agency":"Петроградское телеграфное агентство",
 "nik_station":"Николаевский вокзал","balt_station":"Балтийский вокзал",
 "warsaw_station":"Варшавский вокзал","finland_station":"Финляндский вокзал",
 "post_main":"Главпочтамт","power_station":"Центральная электростанция","gosbank":"Государственный банк",
 "telephone_central":"Центральная телефонная станция","fofanova":"Кв. М.В. Фофановой",
 "aurora":"Крейсер «Аврора»","tsarskoselsky":"Царскосельский вокзал","primorsky":"Приморский вокзал"}
VRK={"smolny","fortress","tauride","fofanova","barracks_litovsky","grenadersky_br","sampsonievsky_br","aurora"}

# routes from existing data (re-fit via geo for consistency)
ROUTES_GEO={"lenin_route":[(30.3447,59.9863),(30.3432,59.9790),(30.3455,59.9690),(30.3489,59.9560),
   (30.3489,59.9527),(30.3645,59.9496),(30.3800,59.9486),(30.3961,59.9479)],
 "litovsky_to_trud":[(30.3637,59.9447),(30.3760,59.9462),(30.3855,59.9487)],
 "winter_to_fortress":[(30.3140,59.9410),(30.3158,59.9458),(30.3166,59.9500)]}
DIRS={"kronstadt_dir":(30.20,59.93),"helsingfors_dir":(30.30,59.99)}

def r4(x): return round(x,4)
out=["/* АВТОГЕНЕРАЦИЯ tools/place_from_pdf.py — позиции из ВЕКТОРНОГО PDF",
 "   (16 пинов по остриям + подписи мостов; прочее — гео-гомография).",
 "   Нормированные [u,v]. Правится вручную в tools/authoring.html. */",
 "window.MTK24_LOCATIONS = {","  fromPdf: true,","  points: {"]
order=list(NAME.keys())
for k in order:
    if k not in placed: continue
    u,v=placed[k]; out.append(f'    {k}: {{ u: {r4(u)}, v: {r4(v)}, name: {json.dumps(NAME[k],ensure_ascii=False)}, force: {json.dumps("vrk" if k in VRK else "pg")} }},')
out.append("  },")
out.append("  directions: {")
for k,(lo,la) in DIRS.items(): u,v=geo(lo,la); out.append(f'    {k}: {{ u: {r4(u)}, v: {r4(v)} }},')
out.append("  },")
out.append("  routes: {")
for rk,wps in ROUTES_GEO.items():
    pts=[[r4(a) for a in geo(lo,la)] for lo,la in wps]; out.append(f"    {rk}: {json.dumps(pts)},")
out.append("  },"); out.append("};")
open('data/locations.js','w').write("\n".join(out)+"\n")
print("wrote data/locations.js with", len([k for k in order if k in placed]), "points")

# visualize
C=cv2.imread('in/map_tone_gray.png'); vis=cv2.resize(C,(1600,int(fH*1600/fW))); VH=vis.shape[0]
for k in order:
    if k not in placed: continue
    u,v=placed[k]; x,y=int(u*1600),int(v*VH)
    cl=(40,200,240) if k in VRK else (40,40,230)
    cv2.circle(vis,(x,y),6,cl,-1); cv2.circle(vis,(x,y),6,(255,255,255),1)
    cv2.putText(vis,k,(x+6,y-4),cv2.FONT_HERSHEY_SIMPLEX,0.4,(0,0,0),3)
    cv2.putText(vis,k,(x+6,y-4),cv2.FONT_HERSHEY_SIMPLEX,0.4,(60,255,255),1)
cv2.imwrite('/tmp/pdf_placed.png',vis); print("viz /tmp/pdf_placed.png")
