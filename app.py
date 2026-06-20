"""
app.py — GlobeWeather (Render entry point)
Self-contained: all modules are at repo root level.
"""

import os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Literal, Optional

import httpx
import urllib3
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator

import database as db
import weather_service as ws
import export_service as ex

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Load .env (local dev only — Render uses dashboard env vars)
_env = Path(__file__).parent / "weather-app" / ".env"
if _env.exists():
    load_dotenv(_env)

app = FastAPI(title="GlobeWeather API", version="1.0.0", docs_url="/api/docs", redoc_url=None)

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── Pydantic models ───────────────────────────────────────────────────────────

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
            raise ValueError("Dates must be YYYY-MM-DD")
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
        for f in [self.date_from, self.date_to]:
            if f:
                try:
                    datetime.strptime(f, fmt)
                except ValueError:
                    raise ValueError("Dates must be YYYY-MM-DD")
        if self.date_from and self.date_to and self.date_to < self.date_from:
            raise ValueError("date_to must be on or after date_from")
        return self


# ── Helpers ───────────────────────────────────────────────────────────────────

def _snapshot(cur, weather):
    return {
        "temp_c": cur["temp"], "feels_like_c": cur["feels_like"],
        "humidity": cur["humidity"], "pressure": cur["pressure"],
        "wind_speed": cur["wind_speed"], "wind_deg": cur["wind_deg"],
        "visibility": cur["visibility"], "uv_index": cur["uv_index"],
        "dew_point": cur["dew_point"], "heat_index": cur["heat_index"],
        "aqi": cur["aqi"], "aqi_label": cur["aqi_label"],
        "condition": cur["condition"], "condition_icon": cur["condition_icon"],
        "description": cur["description"], "sunrise": cur["sunrise"],
        "sunset": cur["sunset"], "timezone_offset": weather["timezone_offset"],
    }

def _days(a, b):
    return (datetime.strptime(b, "%Y-%m-%d") - datetime.strptime(a, "%Y-%m-%d")).days


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok", "runtime": "Python/FastAPI",
            "apiKeyConfigured": bool(os.getenv("OPENWEATHER_API_KEY"))}


# ── Weather ───────────────────────────────────────────────────────────────────

@app.get("/api/weather/search")
async def weather_search(q: str = Query(..., max_length=100)):
    q = q.strip()
    if not q: raise HTTPException(422, "Query required")
    try:
        geo_results = await ws.geocode(q)
    except ValueError as e:
        raise HTTPException(404, str(e))
    geo     = geo_results[0]
    weather = await ws.fetch_weather(geo["lat"], geo["lon"])
    weather["city"]    = geo.get("name")    or weather["city"]
    weather["country"] = geo.get("country") or weather["country"]
    doc = db.create_search({"query": q, "city": weather["city"],
                            "country": weather["country"],
                            "lat": weather["lat"], "lon": weather["lon"]})
    db.create_snapshot({"search_id": doc["_id"], **_snapshot(weather["current"], weather)})
    return {"search_id": doc["_id"], "geoOptions": geo_results, "weather": weather}


@app.get("/api/weather/coords")
async def weather_coords(lat: float = Query(..., ge=-90, le=90),
                         lon: float = Query(..., ge=-180, le=180)):
    import asyncio
    lat_r = round(lat * 100) / 100
    lon_r = round(lon * 100) / 100
    since = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    recent = db.find_recent_coord_search(lat_r, lon_r, since)
    weather, geo_info = await asyncio.gather(ws.fetch_weather(lat, lon),
                                              ws.reverse_geocode(lat, lon))
    weather["city"]    = geo_info["city"]    or weather["city"]
    weather["country"] = geo_info["country"] or weather["country"]
    if recent:
        search_id = recent["_id"]
        db.update_snapshot(search_id, _snapshot(weather["current"], weather))
    else:
        doc = db.create_search({"query": f"{weather['city']}, {weather['country']}",
                                 "city": weather["city"], "country": weather["country"],
                                 "lat": lat_r, "lon": lon_r})
        search_id = doc["_id"]
        db.create_snapshot({"search_id": search_id, **_snapshot(weather["current"], weather)})
    return {"search_id": search_id, "weather": weather}


@app.get("/api/weather/history")
def weather_history(limit: int = Query(20, ge=1, le=100)):
    return db.get_all_searches(limit)

@app.get("/api/weather/history/{id}")
def weather_history_item(id: str):
    s = db.get_search_by_id(id)
    if not s: raise HTTPException(404, "Not found")
    return {"search": s, "snapshot": db.get_snapshot_by_search_id(id)}

@app.delete("/api/weather/history/{id}")
def weather_history_delete(id: str):
    if not db.delete_search(id): raise HTTPException(404, "Not found")
    return {"message": "Deleted", "id": id}


# ── Locations ─────────────────────────────────────────────────────────────────

@app.get("/api/locations")
def locations_list(): return db.get_all_locations()

@app.post("/api/locations", status_code=201)
def locations_create(body: LocationCreate):
    try: return db.create_location(body.model_dump())
    except ValueError as e: raise HTTPException(409, str(e))

@app.patch("/api/locations/{id}")
def locations_update(id: str, body: LocationUpdate):
    if not db.update_location(id, body.name): raise HTTPException(404, "Not found")
    return db.get_location_by_id(id)

@app.delete("/api/locations/{id}")
def locations_delete(id: str):
    if not db.delete_location(id): raise HTTPException(404, "Not found")
    return {"message": "Deleted", "id": id}


# ── Range ─────────────────────────────────────────────────────────────────────

@app.post("/api/range", status_code=201)
async def range_create(body: RangeCreate):
    try:
        geo_results = await ws.geocode(body.location)
    except ValueError:
        raise HTTPException(404, f'Location not found: "{body.location}"')
    geo     = geo_results[0]
    weather = await ws.fetch_weather(geo["lat"], geo["lon"])
    cur     = weather["current"]
    record  = {
        "location_query": body.location, "city": weather["city"],
        "country": weather["country"], "lat": geo["lat"], "lon": geo["lon"],
        "date_from": body.date_from, "date_to": body.date_to,
        "days": _days(body.date_from, body.date_to) + 1,
        "label": body.label or f"{weather['city']} — {body.date_from} to {body.date_to}",
        "notes": body.notes or "",
        "snapshot": {"temp_c": cur["temp"], "feels_like_c": cur["feels_like"],
                     "humidity": cur["humidity"], "pressure": cur["pressure"],
                     "wind_speed": cur["wind_speed"], "wind_dir": cur["wind_dir"],
                     "condition": cur["condition"], "description": cur["description"],
                     "icon": cur["condition_icon"], "uv_index": cur["uv_index"],
                     "visibility": cur["visibility"]},
        "forecast": weather["daily"],
    }
    return db.create_range_query(record)

@app.get("/api/range")
def range_list(limit: int = Query(50, ge=1, le=200),
               offset: int = Query(0, ge=0), city: str = Query("")):
    total, rows = db.get_all_range_queries(limit, offset, city)
    return {"total": total, "rows": rows}

@app.get("/api/range/{id}")
def range_get(id: str):
    doc = db.get_range_query_by_id(id)
    if not doc: raise HTTPException(404, "Record not found")
    return doc

@app.patch("/api/range/{id}")
def range_update(id: str, body: RangeUpdate):
    existing = db.get_range_query_by_id(id)
    if not existing: raise HTTPException(404, "Record not found")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates: raise HTTPException(422, "No updatable fields provided")
    final_from = updates.get("date_from", existing["date_from"])
    final_to   = updates.get("date_to",   existing["date_to"])
    if final_to < final_from: raise HTTPException(422, "date_to must be >= date_from")
    if _days(final_from, final_to) > 365: raise HTTPException(422, "Range > 365 days")
    updates["days"] = _days(final_from, final_to) + 1
    return db.update_range_query(id, updates)

@app.delete("/api/range/{id}")
def range_delete(id: str):
    if not db.delete_range_query(id): raise HTTPException(404, "Record not found")
    return {"message": "Deleted", "id": id}


# ── Export ────────────────────────────────────────────────────────────────────

@app.get("/api/export")
def export_data(format: Literal["json","csv","xml","markdown"] = Query("json"),
                type:   Literal["searches","range","locations"]  = Query("searches")):
    fname = f"globeweather-{type}.{'md' if format=='markdown' else format}"
    if type == "searches":
        records, title = db.get_all_searches(500), "Weather Search History"
    elif type == "range":
        _, records = db.get_all_range_queries(500)
        records = [{k: v for k, v in r.items() if k != "forecast"} for r in records]
        title = "Date-Range Weather Queries"
    else:
        records = [{k: v for k, v in r.items() if k != "lat_lon"}
                   for r in db.get_all_locations()]
        title = "Saved Locations"

    disp = f'attachment; filename="{fname}"'
    if format == "json":
        return Response(ex.to_json(records, type), media_type="application/json",
                        headers={"Content-Disposition": disp})
    if format == "csv":
        return PlainTextResponse(ex.to_csv(records), media_type="text/csv",
                                 headers={"Content-Disposition": disp})
    if format == "xml":
        tags = {"searches":("SearchHistory","search"),
                "range":("RangeQueries","query"), "locations":("Locations","location")}
        return Response(ex.to_xml(records, *tags[type]), media_type="application/xml",
                        headers={"Content-Disposition": disp})
    return PlainTextResponse(ex.to_markdown(records, title), media_type="text/markdown",
                             headers={"Content-Disposition": disp})


# ── Map proxy ─────────────────────────────────────────────────────────────────

_map_client = httpx.AsyncClient(verify=False, timeout=8.0)

@app.get("/api/map")
async def map_proxy(lat: float, lon: float, city: str = ""):
    try:
        r = await _map_client.get("https://nominatim.openstreetmap.org/reverse",
            params={"lat": lat, "lon": lon, "format": "json", "addressdetails": 1},
            headers={"User-Agent": "GlobeWeatherApp/1.0"})
        place = r.json()
        zoom = 11
        return {"display_name": place.get("display_name"), "lat": lat, "lon": lon,
                "map_embed_url": (f"https://www.openstreetmap.org/export/embed.html"
                                  f"?bbox={lon-.15},{lat-.10},{lon+.15},{lat+.10}"
                                  f"&layer=mapnik&marker={lat},{lon}"),
                "osm_link": f"https://www.openstreetmap.org/?mlat={lat}&mlon={lon}#map={zoom}/{lat}/{lon}"}
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Static files (frontend) ───────────────────────────────────────────────────

_public = Path(__file__).parent / "weather-app" / "public"
if _public.exists():
    app.mount("/", StaticFiles(directory=str(_public), html=True), name="static")


# ── Startup ───────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def on_startup():
    port = os.getenv("PORT", "3000")
    print(f"\n⛅ GlobeWeather  →  http://localhost:{port}")
    print(f"📋 API docs     →  http://localhost:{port}/api/docs\n")
    if not os.getenv("OPENWEATHER_API_KEY"):
        print("⚠️  OPENWEATHER_API_KEY not set\n")
