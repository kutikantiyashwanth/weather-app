"""
app.py — Render/Railway entry point at REPO ROOT level
Adds weather-app/python-server/ to sys.path so imports resolve correctly.
"""
import sys
import os
from pathlib import Path

# Repo root is the working directory on Render
REPO_ROOT = Path(__file__).parent

# Add python-server/ to path so 'import main', 'import database' etc. work
sys.path.insert(0, str(REPO_ROOT / "weather-app" / "python-server"))

# Load .env if present (local dev only — Render uses env vars directly)
try:
    from dotenv import load_dotenv
    _env = REPO_ROOT / "weather-app" / ".env"
    if _env.exists():
        load_dotenv(_env)
except ImportError:
    pass

# Import the FastAPI app — re-exported for uvicorn
from main import app  # noqa: F401

__all__ = ["app"]
