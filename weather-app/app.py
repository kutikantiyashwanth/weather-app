"""
app.py — Render/Railway entry point
Adds python-server/ to sys.path so imports resolve correctly
when uvicorn is started from the repo root.
"""
import sys
import os
from pathlib import Path

# Make sure python-server/ modules are importable
sys.path.insert(0, str(Path(__file__).parent / "python-server"))

# Load .env from repo root
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

# Import the FastAPI app
from main import app  # noqa: F401 — re-exported for uvicorn

__all__ = ["app"]
