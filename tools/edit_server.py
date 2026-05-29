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
TARGETS = {
    "/api/save-locations": (os.path.join(ROOT, "data", "locations.js"), "MTK24_LOCATIONS"),
    "/api/save-streets":   (os.path.join(ROOT, "data", "streets.js"),   "MTK24_STREETS"),
}
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
        tgt = TARGETS.get(self.path)
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
    http.server.ThreadingHTTPServer(("", PORT), Handler).serve_forever()
