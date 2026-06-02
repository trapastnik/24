#!/usr/bin/env python3
"""
Локальный сервер для редактора точек МТК-24.
Отдаёт статику проекта И принимает POST /api/save-locations, который
записывает присланный текст в data/locations.js (с резервной копией).

Запуск:   python3 tools/edit_server.py            # порт 8125
          python3 tools/edit_server.py 8130       # свой порт
Открыть:  http://localhost:8125/tools/authoring.html  → правишь → «💾 сохранить»
"""
import http.server, os, sys, shutil, re, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGETS = {
    "/api/save-locations": (os.path.join(ROOT, "data", "locations.js"), "MTK24_LOCATIONS"),
    "/api/save-streets":   (os.path.join(ROOT, "data", "streets.js"),   "MTK24_STREETS"),
    "/api/save-water":     (os.path.join(ROOT, "data", "petrograd_water_map.json"), "\"water\""),  # обводка воды (tools/water_trace.html)
    "/api/save-scenario":  (os.path.join(ROOT, "data", "scenario.js"),  "MTK24_SCENARIO"),  # сценарий (tools/scenario-editor.html)
}
RENDER_DIR = os.path.join(ROOT, "render")          # сюда кладём PNG-кадры оффлайн-рендера
SAFE = re.compile(r"^[A-Za-z0-9._-]+$")            # безопасные имена (без path traversal)
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8125


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")   # dev: всегда свежий scene.js/css (без залипания кэша)
        super().end_headers()

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def _save_frame(self, query):
        q = urllib.parse.parse_qs(query)
        run = q.get("run", ["seg"])[0]; name = q.get("name", [""])[0]
        n = int(self.headers.get("Content-Length", 0))
        if not (SAFE.match(run) and SAFE.match(name) and name.lower().endswith((".png", ".jpg", ".jpeg"))) or not (0 < n <= 64_000_000):
            self.send_response(400); self._cors(); self.end_headers(); self.wfile.write(b"rejected"); return
        data = self.rfile.read(n)
        d = os.path.join(RENDER_DIR, run); os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, name), "wb") as f:
            f.write(data)
        self.send_response(200); self._cors(); self.end_headers(); self.wfile.write(b"ok")
        num = re.sub(r"\D", "", name)
        if num in ("00001", "") or int(num) % 30 == 0:
            print(f"[frame] {run}/{name} ({n} bytes)")

    def do_POST(self):
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == "/api/render-frame":
            return self._save_frame(parsed.query)
        tgt = TARGETS.get(parsed.path)
        if not tgt:
            self.send_response(404); self._cors(); self.end_headers(); return
        path, marker = tgt
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n).decode("utf-8")
        if n > 4_000_000 or marker not in body:           # минимальная валидация
            self.send_response(400); self._cors(); self.end_headers()
            self.wfile.write(b"rejected"); return
        if os.path.exists(path):
            shutil.copyfile(path, path + ".bak")           # резервная копия
        with open(path, "w", encoding="utf-8") as f:
            f.write(body)
        self.send_response(200); self._cors(); self.end_headers()
        self.wfile.write(b"ok")
        print(f"[saved] {os.path.relpath(path, ROOT)} ({n} bytes)")


if __name__ == "__main__":
    os.chdir(ROOT)
    print(f"МТК-24 edit server → http://localhost:{PORT}/tools/authoring.html")
    for ep, (p, _) in TARGETS.items():
        print(f"  POST {ep} → {os.path.relpath(p, ROOT)}")
    print(f"  POST /api/render-frame → {os.path.relpath(RENDER_DIR, ROOT)}/<run>/frame_*.png  (оффлайн-рендер)")
    http.server.ThreadingHTTPServer(("", PORT), Handler).serve_forever()
