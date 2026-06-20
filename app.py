"""
app.py — GlobeWeather Render entry point
Serves all 16 API endpoints + static frontend.
"""
from __future__ import annotations
import os, sys
from pathlib import Path

# ── Ensure python-server modules are importable ───────────────────────────────
_server = Path(__file__).parent / "weather-app" / "python-server"
if str(_server) not in sys.path:
    sys.path.insert(0, str(_server))

# ── Load .env for local dev (Render uses dashboard env vars) ─────────────────
try:
    from dotenv import load_dotenv
    _env = Path(__file__).parent / "weather-app" / ".env"
    if _env.exists():
        load_dotenv(_env)
except Exception:
    pass

# ── Import the FastAPI app from python-server/main.py ────────────────────────
# main.py already wires up all routes + static file serving
from main import app  # noqa: F401 — re-exported for uvicorn

__all__ = ["app"]
