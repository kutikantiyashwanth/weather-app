"""
main.py — Skies Weather App  |  Python / FastAPI Backend
==========================================================
Assessment #2 — Full Stack (Backend)

Endpoints:
  GET  /api/weather/search?q=
  GET  /api/weather/coords?lat=&lon=
  GET  /api/weather/history
  GET  /api/weather/history/{id}
  DEL  /api/weather/history/{id}
  GET  /api/locations
  POST /api/locations
  PATCH /api/locations/{id}
  DEL  /api/locations/{id}
  POST /api/range
  GET  /api/range
  GET  /api/range/{id}
  PATCH /api/range/{id}
  DEL  /api/range/{id}
  GET  /api/export?format=json|csv|xml|markdown&type=searches|range|locations
  GET  /api/map?lat=&lon=
  GET  /api/health
"""

import os
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Query, Path as FPath, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator, model_validator

import database as db
import weather_service as ws
import export_service as exp

# ── Load env ──────────────────────────────────────────────────────────────────
load_dotenv(Path(__file__).parent.parent / ".env")

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Skies Weather API", version="2.0.0", docs_url="/api/docs")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Pydantic models ───────────────────────────────────────────────────────────

class LocationCreate(BaseModel):
    name:    str
    city:    str
    country: str
    lat:     float
    lon:     float

    @field_validator("name", "city")
    @classmethod
    def not_empty(cls, v):
        if not v.strip():
            raise ValueError("Field cannot be empty")
        return v.strip()

    @field_validator("country")
    @classmethod
    def valid_country(cls, v):
        if len(v.strip()) != 2:
            raise ValueError("Country must be a 2-letter code")
        return v.strip().upper()

    @field_validator("lat")
    @classmethod
    def valid_lat(cls, v):
        if not -90 <= v <= 90:
            raise ValueError("Latitude must be between -90 and 90")
        return v

    @field_validator("lon")
    @classmethod
    def valid_lon(cls, v):
        if not -180 <= v <= 180:
            raise ValueError("Longitude must be between -180 and 180")
        return v


class LocationUpdate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def not_empty(cls, v):
        if not v.strip():
            raise ValueError("Name cannot be empty")
        return v.strip()


class RangeCreate(BaseModel):
    location:  str
    date_from: str
    date_to:   str
    label:     Optional[str] = ""
    notes:     Optional[str] = ""

    @field_validator("location")
    @classmethod
    def not_empty(cls, v):
        if not v.strip():
            raise ValueError("Location is required")
        if len(v) > 120:
            raise ValueError("Location too long")
        return v.strip()

    @model_validator(mode="after")
    def validate_dates(self):
        try:
            d_from = datetime.strptime(self.date_from, "%Y-%m-%d")
            d_to   = datetime.strptime(self.date_to,   "%Y-%m-%d")
        except ValueError:
            raise ValueError("Dates must be in YYYY-MM-DD format")
        if d_to < d_from:
            raise ValueError("date_to must be on or after date_from")
        if (d_to - d_from).days > 365:
            raise ValueError("Date range cannot exceed 365 days")
        return self


class RangeUpdate(BaseModel):
    label:     Optional[str] = None
    notes:     Optional[str] = None
    date_from: Optional[str] = None
    date_to:   Optional[str] = None

    @model_validator(mode="after")
    def validate_dates(self):
        if self.date_from and self.date_to:
            try:
                d_from = datetime.strptime(self.date_from, "%Y-%m-%d")
                d_to   = datetime.strptime(self.date_to,   "%Y-%m-%d")
            except ValueError:
                raise ValueError("Dates must be in YYYY-MM-DD format")
            if d_to < d_from:
                raise ValueError("date_to must be on or after date_from")
        return self


# ── Helper ────────────────────────────────────────────────────────────────────

def _snapshot(cur: dict, weather: dict) -> dict:
    return {
        "temp_c":          cur["temp"],
        "feels_like_c":    cur["feels_like"],
        "humidity":        cur["humidity"],
        "pressure":        cur["pressure"],
        "wind_speed":      cur["wind_speed"],
        "wind_deg":        cur["wind_deg"],
        "visibility":      cur.get("visibility"),
        "uv_index":        cur.get("uv_index"),
        "dew_point":       cur.get("dew_point"),
        "heat_index":      cur.get("heat_index"),
        "aqi":             cur.get("aqi"),
        "aqi_label":       cur.get("aqi_label"),
        "condition":       cur["condition"],
        "condition_icon":  cur["condition_icon"],
        "description":     cur["description"],
        "sunrise":         cur["sunrise"],
        "sunset":          cur["sunset"],
        "timezone_offset": weather["timezone_offset"],
    }


# ════════════════════════════════════════════════════════════════════════════
# WEATHER ROUTES
# ════════════════════════════════════════════════════════════════════════════

@app.get("/api/weather/search")
async def weather_search(q: str = Query(..., min_length=1, max_length=100)):
    """Search weather by city name, zip, landmark, or coordinates."""
    q = q.strip()
    if not q:
        raise HTTPException(422, detail="Query (q) is required")
    try:
        geo_results = await ws.geocode(q)
    except ValueError as e:
        raise HTTPException(404, detail=str(e))
    except Exception as e:
        raise HTTPException(500, detail=str(e))

    geo = geo_results[0]
    try:
        weather = await ws.fetch_weather(geo["lat"], geo["lon"])
    except Exception as e:
        raise HTTPException(500, detail=str(e))

    # Use geocoder name for accuracy
    weather["city"]    = geo.get("name", weather["city"])
    weather["country"] = geo.get("country", weather["country"])

    search_doc = db.create_search({
        "query":   q,
        "city":    weather["city"],
        "country": weather["country"],
        "lat":     weather["lat"],
        "lon":     weather["lon"],
    })
    db.create_snapshot({"search_id": search_doc["_id"], **_snapshot(weather["current"], weather)})

    return {"search_id": search_doc["_id"], "geoOptions": geo_results, "weather": weather}


@app.get("/api/weather/coords")
async def weather_coords(
    lat: float = Query(..., ge=-90,  le=90),
    lon: float = Query(..., ge=-180, le=180),
):
    """Search weather by GPS coordinates with dedup logic."""
    since = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    lat_r = round(lat * 100) / 100
    lon_r = round(lon * 100) / 100

    recent = db.find_recent_coord_search(lat_r, lon_r, since)

    try:
        weather, geo_info = await _parallel(ws.fetch_weather(lat, lon), ws.reverse_geocode(lat, lon))
    except Exception as e:
        raise HTTPException(500, detail=str(e))

    display_city    = geo_info["city"]    or weather["city"]
    display_country = geo_info["country"] or weather["country"]
    weather["city"]    = display_city
    weather["country"] = display_country

    if recent:
        search_id = recent["_id"]
        db.update_snapshot(search_id, _snapshot(weather["current"], weather))
    else:
        search_doc = db.create_search({
            "query":   f"{display_city}, {display_country}",
            "city":    display_city,
            "country": display_country,
            "lat":     lat_r,
            "lon":     lon_r,
        })
        search_id = search_doc["_id"]
        db.create_snapshot({"search_id": search_id, **_snapshot(weather["current"], weather)})

    return {"search_id": search_id, "weather": weather}


@app.get("/api/weather/history")
async def weather_history(limit: int = Query(20, ge=1, le=100)):
    """READ — return recent weather searches."""
    return db.get_all_searches(limit)


@app.get("/api/weather/history/{search_id}")
async def weather_history_one(search_id: str = FPath(...)):
    """READ — single search + snapshot."""
    search = db.get_search_by_id(search_id)
    if not search:
        raise HTTPException(404, detail="Not found")
    snap = db.get_snapshot_by_search_id(search_id)
    return {"search": search, "snapshot": snap}


@app.delete("/api/weather/history/{search_id}")
async def weather_history_delete(search_id: str = FPath(...)):
    """DELETE — remove search and its snapshot."""
    if not db.delete_search(search_id):
        raise HTTPException(404, detail="Not found")
    return {"message": "Deleted", "id": search_id}


# ════════════════════════════════════════════════════════════════════════════
# SAVED LOCATIONS ROUTES  (full CRUD)
# ════════════════════════════════════════════════════════════════════════════

@app.get("/api/locations")
async def locations_read():
    """READ — all saved locations."""
    return db.get_all_locations()


@app.post("/api/locations", status_code=201)
async def locations_create(body: LocationCreate):
    """CREATE — save a location."""
    try:
        loc = db.create_location(body.model_dump())
    except ValueError as e:
        raise HTTPException(409, detail=str(e))
    return loc


@app.patch("/api/locations/{loc_id}")
async def locations_update(body: LocationUpdate, loc_id: str = FPath(...)):
    """UPDATE — rename a saved location."""
    if not db.update_location(loc_id, body.name):
        raise HTTPException(404, detail="Not found")
    return db.get_location_by_id(loc_id)


@app.delete("/api/locations/{loc_id}")
async def locations_delete(loc_id: str = FPath(...)):
    """DELETE — remove a saved location."""
    if not db.delete_location(loc_id):
        raise HTTPException(404, detail="Not found")
    return {"message": "Deleted", "id": loc_id}


# ════════════════════════════════════════════════════════════════════════════
# DATE RANGE QUERIES  (full CRUD — Assessment 2.1)
# ════════════════════════════════════════════════════════════════════════════

@app.post("/api/range", status_code=201)
async def range_create(body: RangeCreate):
    """CREATE — geocode location, validate dates, fetch weather, store."""
    # Validate location exists
    try:
        geo_results = await ws.geocode(body.location)
    except ValueError:
        raise HTTPException(404, detail={
            "error":  "Location not found",
            "detail": f'"{body.location}" could not be geocoded. Try a city name, zip, or coordinates.',
        })

    geo = geo_results[0]
    try:
        weather = await ws.fetch_weather(geo["lat"], geo["lon"])
    except Exception as e:
        raise HTTPException(500, detail=str(e))

    cur = weather["current"]
    d_from = datetime.strptime(body.date_from, "%Y-%m-%d")
    d_to   = datetime.strptime(body.date_to,   "%Y-%m-%d")
    days   = (d_to - d_from).days + 1

    record = {
        "location_query": body.location,
        "city":           geo.get("name", weather["city"]),
        "country":        geo.get("country", weather["country"]),
        "lat":            geo["lat"],
        "lon":            geo["lon"],
        "date_from":      body.date_from,
        "date_to":        body.date_to,
        "days":           days,
        "label":          body.label or f"{geo.get('name', weather['city'])} — {body.date_from} to {body.date_to}",
        "notes":          body.notes or "",
        "snapshot": {
            "temp_c":        cur["temp"],
            "feels_like_c":  cur["feels_like"],
            "humidity":      cur["humidity"],
            "pressure":      cur["pressure"],
            "wind_speed":    cur["wind_speed"],
            "wind_dir":      cur["wind_dir"],
            "condition":     cur["condition"],
            "description":   cur["description"],
            "icon":          cur["condition_icon"],
            "uv_index":      cur.get("uv_index"),
            "visibility":    cur.get("visibility"),
        },
        "forecast": weather.get("daily", []),
    }

    return db.create_range_query(record)


@app.get("/api/range")
async def range_read_all(
    limit: int = Query(50, ge=1, le=200),
    city:  str = Query(""),
):
    """READ — all date-range queries (with optional city filter)."""
    rows, total = db.get_all_range_queries(limit, city)
    return {"total": total, "rows": rows}


@app.get("/api/range/{qid}")
async def range_read_one(qid: str = FPath(...)):
    """READ — single range query."""
    doc = db.get_range_query_by_id(qid)
    if not doc:
        raise HTTPException(404, detail="Record not found")
    return doc


@app.patch("/api/range/{qid}")
async def range_update(body: RangeUpdate, qid: str = FPath(...)):
    """UPDATE — edit label, notes, or date range."""
    existing = db.get_range_query_by_id(qid)
    if not existing:
        raise HTTPException(404, detail="Record not found")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(422, detail="No updatable fields provided")

    # Cross-validate merged dates
    final_from = updates.get("date_from", existing.get("date_from", ""))
    final_to   = updates.get("date_to",   existing.get("date_to",   ""))
    if final_from and final_to:
        d_from = datetime.strptime(final_from, "%Y-%m-%d")
        d_to   = datetime.strptime(final_to,   "%Y-%m-%d")
        if d_to < d_from:
            raise HTTPException(422, detail="date_to must be on or after date_from")
        if (d_to - d_from).days > 365:
            raise HTTPException(422, detail="Date range cannot exceed 365 days")
        updates["days"] = (d_to - d_from).days + 1

    updated = db.update_range_query(qid, updates)
    return updated


@app.delete("/api/range/{qid}")
async def range_delete(qid: str = FPath(...)):
    """DELETE — remove a range query."""
    if not db.delete_range_query(qid):
        raise HTTPException(404, detail="Record not found")
    return {"message": "Deleted", "id": qid}


# ════════════════════════════════════════════════════════════════════════════
# DATA EXPORT  (Assessment 2.3)
# ════════════════════════════════════════════════════════════════════════════

@app.get("/api/export")
async def export_data(
    format: str = Query("json", pattern="^(json|csv|xml|markdown)$"),
    type:   str = Query("searches", pattern="^(searches|range|locations)$"),
):
    """Export database records as JSON, CSV, XML, or Markdown."""
    records = db.get_all_for_export(type, 500)

    titles = {"searches": "Weather Search History", "range": "Date-Range Weather Queries", "locations": "Saved Locations"}
    tags   = {"searches": ("SearchHistory", "search"), "range": ("RangeQueries", "query"), "locations": ("Locations", "location")}
    title  = titles[type]
    ext    = "md" if format == "markdown" else format
    fname  = f"skies-{type}.{ext}"

    if format == "json":
        content = exp.to_json(records, type)
        return PlainTextResponse(content, media_type="application/json",
                                 headers={"Content-Disposition": f'attachment; filename="{fname}"'})
    elif format == "csv":
        content = exp.to_csv(records)
        return PlainTextResponse(content, media_type="text/csv",
                                 headers={"Content-Disposition": f'attachment; filename="{fname}"'})
    elif format == "xml":
        root_tag, item_tag = tags[type]
        content = exp.to_xml(records, root_tag, item_tag)
        return PlainTextResponse(content, media_type="application/xml",
                                 headers={"Content-Disposition": f'attachment; filename="{fname}"'})
    elif format == "markdown":
        content = exp.to_markdown(records, title)
        return PlainTextResponse(content, media_type="text/markdown",
                                 headers={"Content-Disposition": f'attachment; filename="{fname}"'})


# ════════════════════════════════════════════════════════════════════════════
# MAP  (Assessment 2.2 — API Integration)
# ════════════════════════════════════════════════════════════════════════════

@app.get("/api/map")
async def map_data(
    lat: float = Query(..., ge=-90,  le=90),
    lon: float = Query(..., ge=-180, le=180),
):
    """Reverse geocode via Nominatim + return OpenStreetMap embed URL."""
    try:
        async with httpx.AsyncClient(verify=False, timeout=6,
                                     headers={"User-Agent": "SkiesWeatherApp/2.0"}) as client:
            r = await client.get("https://nominatim.openstreetmap.org/reverse",
                                 params={"lat": lat, "lon": lon, "format": "json", "addressdetails": 1})
        place = r.json()
    except Exception:
        place = {}

    bbox_str = f"{lon-0.15},{lat-0.10},{lon+0.15},{lat+0.10}"
    return {
        "display_name":  place.get("display_name", ""),
        "address":       place.get("address", {}),
        "lat":           lat,
        "lon":           lon,
        "map_embed_url": f"https://www.openstreetmap.org/export/embed.html?bbox={bbox_str}&layer=mapnik&marker={lat},{lon}",
        "osm_link":      f"https://www.openstreetmap.org/?mlat={lat}&mlon={lon}#map=11/{lat}/{lon}",
    }


# ════════════════════════════════════════════════════════════════════════════
# HEALTH CHECK
# ════════════════════════════════════════════════════════════════════════════

@app.get("/api/health")
async def health():
    return {
        "status":           "ok",
        "backend":          "Python FastAPI",
        "python_version":   "3.13",
        "apiKeyConfigured": bool(os.getenv("OPENWEATHER_API_KEY")),
        "time":             datetime.now(timezone.utc).isoformat(),
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
            "GET  /api/docs  (Swagger UI)",
        ],
    }


# ════════════════════════════════════════════════════════════════════════════
# SERVE FRONTEND STATIC FILES
# ════════════════════════════════════════════════════════════════════════════

PUBLIC_DIR = Path(__file__).parent.parent / "public"
app.mount("/", StaticFiles(directory=str(PUBLIC_DIR), html=True), name="static")


# ── Parallel async helper ─────────────────────────────────────────────────────
import asyncio

async def _parallel(*coros):
    return await asyncio.gather(*coros)
