"""
app.py — Render entry point (repo root level)
"""
import sys
from pathlib import Path

# Add weather-app/python-server/ to sys.path
sys.path.insert(0, str(Path(__file__).parent / "weather-app" / "python-server"))

# Load .env if present
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / "weather-app" / ".env")
except Exception:
    pass

# Re-export FastAPI app for uvicorn
from main import app  # noqa: F401

__all__ = ["app"]
