"""
main.py — GlobeWeather FastAPI Application
All 16+ API routes in a single file.

Run:
    cd weather-app/python-server
    python -m uvicorn main:app --host 0.0.0.0 --port 3000 --reload

API docs:  http://localhost:3000/api/docs
Health:    http://localhost:3000/api/health
App:       http://localhost:3000
"""

from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Literal, Optional

import httpx
import urllib3
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator

import database as db
import weather_service as ws
import export_service as ex

# ── Suppress SSL warnings (same as Node rejectUnauthorized:false) ─────────────
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ── Load .env ─────────────────────────────────────────────────────────────────
load_dotenv(Path(__file__).parent.parent / ".env")

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="GlobeWeather API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ════════════════════════════════════════════════════════════════
#  PYDANTIC MODELS
# ════════════════════════════════════════════════════════════════

class LocationCreate(BaseModel):
    name:    str   = Field(..., max_length=60)
    city:    str
    country: str   = Field(..., min_length=2, max_length=2)
    lat:     float = Field(..., ge=-90,  le=90)
    lon:     float = Field(..., ge=-180, le=180)


class LocationUpdate(BaseModel):
    name: str = Field(..., max_length=60)


class RangeCreate(BaseModel):
    location:  str           = Field(..., min_length=1, max_length=120)
    date_from: str
    date_to:   str
    label:     Optional[str] = Field(None, max_length=80)
    notes:     Optional[str] = Field(None, max_length=500)

    @model_validator(mode="after")
    def validate_dates(self):
        fmt = "%Y-%m-%d"
        try:
            d_from = datetime.strptime(self.date_from, fmt)
            d_to   = datetime.strptime(self.date_to,   fmt)
        except ValueError:
            raise ValueError("Dates must be in YYYY-MM-DD format")
        if d_to < d_from:
            raise ValueError("date_to must be on or after date_from")
        if (d_to - d_from).days > 365:
            raise ValueError("Date range cannot exceed 365 days")
        return self


class RangeUpdate(BaseModel):
    label:     Optional[str] = Field(None, max_length=80)
    notes:     Optional[str] = Field(None, max_length=500)
    date_from: Optional[str] = None
    date_to:   Optional[str] = None

    @model_validator(mode="after")
    def validate_dates(self):
        fmt = "%Y-%m-%d"
        if self.date_from:
            try:
                datetime.strptime(self.date_from, fmt)
            except ValueError:
                raise ValueError("date_from must be YYYY-MM-DD")
        if self.date_to:
            try:
                datetime.strptime(self.date_to, fmt)
            except ValueError:
                raise ValueError("date_to must be YYYY-MM-DD")
        if self.date_from and self.date_to and self.date_to < self.date_from:
            raise ValueError("date_to must be on or after date_from")
        return self


# ════════════════════════════════════════════════════════════════
#  HELPER: build snapshot from weather current data
# ════════════════════════════════════════════════════════════════

def _build_snapshot(cur: dict, weather: dict) -> dict:
    return {
        "temp_c":          cur["temp"],
        "feels_like_c":    cur["feels_like"],
        "humidity":        cur["humidity"],
        "pressure":        cur["pressure"],
        "wind_speed":      cur["wind_speed"],
        "wind_deg":        cur["wind_deg"],
        "visibility":      cur["visibility"],
        "uv_index":        cur["uv_index"],
        "dew_point":       cur["dew_point"],
        "heat_index":      cur["heat_index"],
        "aqi":             cur["aqi"],
        "aqi_label":       cur["aqi_label"],
        "condition":       cur["condition"],
        "condition_icon":  cur["condition_icon"],
        "description":     cur["description"],
        "sunrise":         cur["sunrise"],
        "sunset":          cur["sunset"],
        "timezone_offset": weather["timezone_offset"],
    }


def _days_between(a: str, b: str) -> int:
    fmt = "%Y-%m-%d"
    return (datetime.strptime(b, fmt) - datetime.strptime(a, fmt)).days


# ════════════════════════════════════════════════════════════════
#  HEALTH CHECK
# ════════════════════════════════════════════════════════════════

@app.get("/api/health", tags=["utility"])
def health():
    return {
        "status":           "ok",
        "runtime":          "Python 3 / FastAPI",
        "apiKeyConfigured": bool(os.getenv("OPENWEATHER_API_KEY")),
        "endpoints": [
            "GET  /api/weather/search?q=",
            "GET  /api/weather/coords?lat=&lon=",
            "GET  /api/weather/history",
            "GET  /api/weather/history/{id}",
            "DEL  /api/weather/history/{id}",
            "GET  /api/locations",
            "POST /api/locations",
            "PATCH /api/locations/{id}",
            "DEL  /api/locations/{id}",
            "POST /api/range",
            "GET  /api/range",
            "GET  /api/range/{id}",
            "PATCH /api/range/{id}",
            "DEL  /api/range/{id}",
            "GET  /api/export?format=json|csv|xml|markdown&type=searches|range|locations",
            "GET  /api/map?lat=&lon=",
            "GET  /api/docs",
        ],
    }


# ════════════════════════════════════════════════════════════════
#  WEATHER ROUTES
# ════════════════════════════════════════════════════════════════

@app.get("/api/weather/search", tags=["weather"])
async def weather_search(q: str = Query(..., max_length=100)):
    """Search weather by city name, zip code, landmark, or coordinates."""
    q = q.strip()
    if not q:
        raise HTTPException(422, detail="Query (q) is required")

    try:
        geo_results = await ws.geocode(q)
    except ValueError as e:
        raise HTTPException(404, detail=str(e))

    geo     = geo_results[0]
    weather = await ws.fetch_weather(geo["lat"], geo["lon"])

    # Use geocoder city name (more accurate than OWM district names)
    weather["city"]    = geo.get("name")    or weather["city"]
    weather["country"] = geo.get("country") or weather["country"]

    search_doc = db.create_search({
        "query":   q,
        "city":    weather["city"],
        "country": weather["country"],
        "lat":     weather["lat"],
        "lon":     weather["lon"],
    })
    db.create_snapshot({
        "search_id": search_doc["_id"],
        **_build_snapshot(weather["current"], weather),
    })

    return {"search_id": search_doc["_id"], "geoOptions": geo_results, "weather": weather}


@app.get("/api/weather/coords", tags=["weather"])
async def weather_coords(
    lat: float = Query(..., ge=-90,  le=90,  description="Latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Longitude"),
):
    """Search weather by GPS coordinates with deduplication (1 km / 5 min)."""
    lat_r = round(lat * 100) / 100
    lon_r = round(lon * 100) / 100
    since = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()

    recent = db.find_recent_coord_search(lat_r, lon_r, since)

    import asyncio
    weather, geo_info = await asyncio.gather(
        ws.fetch_weather(lat, lon),
        ws.reverse_geocode(lat, lon),
    )

    weather["city"]    = geo_info["city"]    or weather["city"]
    weather["country"] = geo_info["country"] or weather["country"]

    if recent:
        # Update existing snapshot with fresh data
        search_id = recent["_id"]
        db.update_snapshot(search_id, _build_snapshot(weather["current"], weather))
    else:
        search_doc = db.create_search({
            "query":   f"{weather['city']}, {weather['country']}",
            "city":    weather["city"],
            "country": weather["country"],
            "lat":     lat_r,
            "lon":     lon_r,
        })
        search_id = search_doc["_id"]
        db.create_snapshot({
            "search_id": search_id,
            **_build_snapshot(weather["current"], weather),
        })

    return {"search_id": search_id, "weather": weather}


@app.get("/api/weather/history", tags=["weather"])
def weather_history(limit: int = Query(20, ge=1, le=100)):
    """Read all recent search history, joined with snapshot summary."""
    return db.get_all_searches(limit)


@app.get("/api/weather/history/{id}", tags=["weather"])
def weather_history_item(id: str):
    """Read a single search record with its weather snapshot."""
    search = db.get_search_by_id(id)
    if not search:
        raise HTTPException(404, detail="Not found")
    snapshot = db.get_snapshot_by_search_id(id)
    return {"search": search, "snapshot": snapshot}


@app.delete("/api/weather/history/{id}", tags=["weather"])
def weather_history_delete(id: str):
    """Delete a search record and its associated snapshot."""
    count = db.delete_search(id)
    if not count:
        raise HTTPException(404, detail="Not found")
    return {"message": "Deleted", "id": id}


# ════════════════════════════════════════════════════════════════
#  SAVED LOCATIONS ROUTES
# ════════════════════════════════════════════════════════════════

@app.get("/api/locations", tags=["locations"])
def locations_list():
    """Read all saved locations sorted by name."""
    return db.get_all_locations()


@app.post("/api/locations", status_code=201, tags=["locations"])
def locations_create(body: LocationCreate):
    """Save a new location. Returns 409 if lat/lon already saved."""
    try:
        return db.create_location(body.model_dump())
    except ValueError as e:
        raise HTTPException(409, detail=str(e))


@app.patch("/api/locations/{id}", tags=["locations"])
def locations_update(id: str, body: LocationUpdate):
    """Update a saved location's display name."""
    count = db.update_location(id, body.name)
    if not count:
        raise HTTPException(404, detail="Not found")
    return db.get_location_by_id(id)


@app.delete("/api/locations/{id}", tags=["locations"])
def locations_delete(id: str):
    """Remove a saved location."""
    count = db.delete_location(id)
    if not count:
        raise HTTPException(404, detail="Not found")
    return {"message": "Deleted", "id": id}


# ════════════════════════════════════════════════════════════════
#  DATE RANGE QUERY ROUTES  (Full CRUD — Assessment 2.1)
# ════════════════════════════════════════════════════════════════

@app.post("/api/range", status_code=201, tags=["range"])
async def range_create(body: RangeCreate):
    """
    Create a date-range weather query.
    Step 1: Validate location via geocoding (404 if not found).
    Step 2: Fetch live weather snapshot.
    Step 3: Build and persist record.
    """
    try:
        geo_results = await ws.geocode(body.location)
    except ValueError:
        raise HTTPException(
            404,
            detail=f'Location not found: "{body.location}". '
                   'Try a city name, zip code, or lat,lon coordinates.',
        )

    geo     = geo_results[0]
    weather = await ws.fetch_weather(geo["lat"], geo["lon"])
    cur     = weather["current"]

    record = {
        "location_query": body.location,
        "city":           weather["city"],
        "country":        weather["country"],
        "lat":            geo["lat"],
        "lon":            geo["lon"],
        "date_from":      body.date_from,
        "date_to":        body.date_to,
        "days":           _days_between(body.date_from, body.date_to) + 1,
        "label":          body.label or f"{weather['city']} — {body.date_from} to {body.date_to}",
        "notes":          body.notes or "",
        "snapshot": {
            "temp_c":       cur["temp"],
            "feels_like_c": cur["feels_like"],
            "humidity":     cur["humidity"],
            "pressure":     cur["pressure"],
            "wind_speed":   cur["wind_speed"],
            "wind_dir":     cur["wind_dir"],
            "condition":    cur["condition"],
            "description":  cur["description"],
            "icon":         cur["condition_icon"],
            "uv_index":     cur["uv_index"],
            "visibility":   cur["visibility"],
        },
        "forecast": weather["daily"],
    }
    return db.create_range_query(record)


@app.get("/api/range", tags=["range"])
def range_list(
    limit:  int = Query(50, ge=1, le=200),
    offset: int = Query(0,  ge=0),
    city:   str = Query("", description="Optional city filter"),
):
    """Read all date-range queries, sorted newest first. Supports pagination."""
    total, rows = db.get_all_range_queries(limit, offset, city)
    return {"total": total, "rows": rows}


@app.get("/api/range/{id}", tags=["range"])
def range_get(id: str):
    """Read a single date-range query by ID."""
    doc = db.get_range_query_by_id(id)
    if not doc:
        raise HTTPException(404, detail="Record not found")
    return doc


@app.patch("/api/range/{id}", tags=["range"])
def range_update(id: str, body: RangeUpdate):
    """
    Update label, notes, and/or dates on a range query.
    Recalculates days automatically.
    """
    existing = db.get_range_query_by_id(id)
    if not existing:
        raise HTTPException(404, detail="Record not found")

    updates: dict = {}
    for field in ("label", "notes", "date_from", "date_to"):
        val = getattr(body, field)
        if val is not None:
            updates[field] = val

    if not updates:
        raise HTTPException(422, detail="No updatable fields provided (label, notes, date_from, date_to)")

    # Cross-validate merged dates
    final_from = updates.get("date_from", existing["date_from"])
    final_to   = updates.get("date_to",   existing["date_to"])
    if final_to < final_from:
        raise HTTPException(422, detail="date_to must be on or after date_from")
    if _days_between(final_from, final_to) > 365:
        raise HTTPException(422, detail="Date range cannot exceed 365 days")
    updates["days"] = _days_between(final_from, final_to) + 1

    return db.update_range_query(id, updates)


@app.delete("/api/range/{id}", tags=["range"])
def range_delete(id: str):
    """Delete a date-range query permanently."""
    count = db.delete_range_query(id)
    if not count:
        raise HTTPException(404, detail="Record not found")
    return {"message": "Deleted", "id": id}


# ════════════════════════════════════════════════════════════════
#  EXPORT ROUTE  (Assessment 2.3)
# ════════════════════════════════════════════════════════════════

@app.get("/api/export", tags=["utility"])
def export_data(
    format: Literal["json", "csv", "xml", "markdown"] = Query("json"),
    type:   Literal["searches", "range", "locations"]  = Query("searches"),
):
    """
    Export stored data in four formats.
    The Content-Disposition: attachment header triggers a browser download.
    """
    ext_map = {"json": "json", "csv": "csv", "xml": "xml", "markdown": "md"}
    fname   = f"globeweather-{type}.{ext_map[format]}"

    # ── Gather records ────────────────────────────────────────────────────────
    if type == "searches":
        records = db.get_all_searches(500)
        title   = "Weather Search History"

    elif type == "range":
        _, records = db.get_all_range_queries(limit=500)
        # Omit large forecast array to keep export lean
        records = [{k: v for k, v in r.items() if k != "forecast"} for r in records]
        title   = "Date-Range Weather Queries"

    else:  # locations
        records = db.get_all_locations()
        title   = "Saved Locations"

    # ── Serialise & respond ───────────────────────────────────────────────────
    disposition = f'attachment; filename="{fname}"'

    if format == "json":
        return Response(
            content=ex.to_json(records, type),
            media_type="application/json",
            headers={"Content-Disposition": disposition},
        )

    if format == "csv":
        return PlainTextResponse(
            content=ex.to_csv(records),
            media_type="text/csv",
            headers={"Content-Disposition": disposition},
        )

    if format == "xml":
        tags = {
            "searches":  ("SearchHistory", "search"),
            "range":     ("RangeQueries",  "query"),
            "locations": ("Locations",     "location"),
        }
        root_tag, item_tag = tags[type]
        return Response(
            content=ex.to_xml(records, root_tag, item_tag),
            media_type="application/xml",
            headers={"Content-Disposition": disposition},
        )

    # markdown
    return PlainTextResponse(
        content=ex.to_markdown(records, title),
        media_type="text/markdown",
        headers={"Content-Disposition": disposition},
    )


# ════════════════════════════════════════════════════════════════
#  MAP PROXY ROUTE  (Assessment 2.2 — OpenStreetMap / Nominatim)
# ════════════════════════════════════════════════════════════════

_map_client = httpx.AsyncClient(verify=False, timeout=8.0)

@app.get("/api/map", tags=["utility"])
async def map_proxy(lat: float, lon: float, city: str = ""):
    """
    Reverse geocode via Nominatim and return an OpenStreetMap embed URL.
    No API key required.
    """
    try:
        r = await _map_client.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"lat": lat, "lon": lon, "format": "json", "addressdetails": 1},
            headers={"User-Agent": "GlobeWeatherApp/1.0"},
        )
        place = r.json()
        zoom  = 11
        return {
            "display_name":  place.get("display_name"),
            "address":       place.get("address"),
            "lat":           lat,
            "lon":           lon,
            "map_embed_url": (
                f"https://www.openstreetmap.org/export/embed.html"
                f"?bbox={lon-0.15},{lat-0.10},{lon+0.15},{lat+0.10}"
                f"&layer=mapnik&marker={lat},{lon}"
            ),
            "tile_url": (
                f"https://tile.openstreetmap.org/{zoom}/"
                f"{int((lat + 90) / 180 * 2**zoom)}/"
                f"{int((1 - (1 + 1/abs(lat) if lat == 0 else 1) / 3.14159) / 2 * 2**zoom)}.png"
            ),
            "osm_link": (
                f"https://www.openstreetmap.org/?mlat={lat}&mlon={lon}#map={zoom}/{lat}/{lon}"
            ),
        }
    except Exception as e:
        raise HTTPException(500, detail=str(e))


# ════════════════════════════════════════════════════════════════
#  SERVE FRONTEND  (public/ folder served as static files)
# ════════════════════════════════════════════════════════════════

PUBLIC_DIR = Path(__file__).parent.parent / "public"
if PUBLIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(PUBLIC_DIR), html=True), name="static")


# ════════════════════════════════════════════════════════════════
#  STARTUP MESSAGE
# ════════════════════════════════════════════════════════════════

@app.on_event("startup")
async def on_startup():
    port = os.getenv("PORT", "3000")
    key  = os.getenv("OPENWEATHER_API_KEY", "")
    print(f"\n[GlobeWeather App]     ->  http://localhost:{port}")
    print(f"[Swagger API Docs]    ->  http://localhost:{port}/api/docs")
    print(f"[Health Check]        ->  http://localhost:{port}/api/health\n")
    if not key:
        print("[WARNING] OPENWEATHER_API_KEY not set — edit .env and restart\n")
