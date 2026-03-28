"""
Background Removal Sidecar Server
==================================
Exposes a simple HTTP API that accepts raw image bytes and returns
a PNG with the background removed using the rembg library.

Uses u2net_cloth_seg — a model specifically trained on clothing,
which outperforms the generic u2net model for fashion images.

Install:
    pip install rembg[gpu] flask pillow
    # Without GPU:
    pip install rembg flask pillow

Run:
    python scripts/rembg_server.py
    python scripts/rembg_server.py --port 7788 --model u2net_cloth_seg
    python scripts/rembg_server.py --model u2net  # generic (less accurate for fashion)

The reindex script connects to this at REMBG_SERVICE_URL (default: http://127.0.0.1:7788)
"""

import argparse
import io
import logging
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [rembg] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── Import rembg ──────────────────────────────────────────────────────────────
try:
    from rembg import remove, new_session
    from PIL import Image
    log.info("rembg and PIL imported successfully")
except ImportError as e:
    log.error(f"Missing dependency: {e}")
    log.error("Install with: pip install rembg[gpu] flask pillow")
    sys.exit(1)


# ── Global session (loaded once at startup) ────────────────────────────────────
SESSION = None
MODEL_NAME = "u2net_cloth_seg"

def load_model(model_name: str):
    global SESSION, MODEL_NAME
    MODEL_NAME = model_name
    log.info(f"Loading rembg model: {model_name} ...")
    t0 = time.time()
    SESSION = new_session(model_name)
    log.info(f"Model ready in {time.time() - t0:.1f}s")


# ── Request handler ────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Suppress per-request access log clutter; use our own logging
        pass

    def send_json_error(self, code: int, message: str):
        body = f'{{"error": "{message}"}}'.encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            body = f'{{"status": "ok", "model": "{MODEL_NAME}"}}'.encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_json_error(404, "not found")

    def do_POST(self):
        if self.path != "/remove-bg":
            self.send_json_error(404, "not found")
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            if length == 0:
                self.send_json_error(400, "empty body")
                return
            if length > 20 * 1024 * 1024:  # 20 MB cap
                self.send_json_error(413, "image too large (max 20MB)")
                return

            raw = self.rfile.read(length)
            t0 = time.time()

            # Run background removal
            result_png = remove(raw, session=SESSION)

            elapsed_ms = int((time.time() - t0) * 1000)
            log.info(f"Removed background in {elapsed_ms}ms ({length // 1024}KB in → {len(result_png) // 1024}KB out)")

            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(result_png)))
            self.send_header("X-Processing-Ms", str(elapsed_ms))
            self.end_headers()
            self.wfile.write(result_png)

        except Exception as e:
            log.error(f"Processing error: {e}", exc_info=True)
            self.send_json_error(500, str(e))


# ── Entry point ────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="rembg background removal HTTP sidecar")
    parser.add_argument("--port",  type=int, default=7788,              help="Port to listen on (default: 7788)")
    parser.add_argument("--host",  type=str, default="127.0.0.1",       help="Host to bind (default: 127.0.0.1)")
    parser.add_argument("--model", type=str, default="u2net_cloth_seg", help="rembg model name")
    args = parser.parse_args()

    load_model(args.model)

    server = HTTPServer((args.host, args.port), Handler)
    log.info(f"Listening on http://{args.host}:{args.port}")
    log.info(f"Endpoints: GET /health   POST /remove-bg")
    log.info("Ready. Waiting for requests...")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down.")
        server.server_close()


if __name__ == "__main__":
    main()