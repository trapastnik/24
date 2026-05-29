#!/usr/bin/env python3
"""
Локальный сервер для редактора точек МТК-24.
Отдаёт статику проекта И принимает POST /api/save-locations, который
записывает присланный текст в data/locations.js (с резервной копией).

Запуск:   python3 tools/edit_server.py            # порт 8125
          python3 tools/edit_server.py 8130       # свой порт
Открыть:  http://localhost:8125/tools/authoring.html  → правишь → «💾 сохранить»
"""
import http.server, os, sys, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, "data", "locations.js")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8125


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_POST(self):
        if self.path != "/api/save-locations":
            self.send_response(404); self._cors(); self.end_headers(); return
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n).decode("utf-8")
        # минимальная валидация, чтобы случайно не записать мусор
        if n > 4_000_000 or "MTK24_LOCATIONS" not in body or "points" not in body:
            self.send_response(400); self._cors(); self.end_headers()
            self.wfile.write(b"rejected: not a valid locations.js"); return
        if os.path.exists(TARGET):
            shutil.copyfile(TARGET, TARGET + ".bak")   # резервная копия
        with open(TARGET, "w", encoding="utf-8") as f:
            f.write(body)
        self.send_response(200); self._cors(); self.end_headers()
        self.wfile.write(b"ok")
        print(f"[saved] data/locations.js ({n} bytes)")


if __name__ == "__main__":
    os.chdir(ROOT)
    print(f"МТК-24 edit server → http://localhost:{PORT}/tools/authoring.html")
    print(f"  POST /api/save-locations → {TARGET}")
    http.server.ThreadingHTTPServer(("", PORT), Handler).serve_forever()
