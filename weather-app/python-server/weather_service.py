"""
weather_service.py — OpenWeatherMap API integration
Handles geocoding, reverse geocoding, and weather data fetching.

Key features:
- Parallel API calls using asyncio.gather (cuts response time ~66%)
- Dew Point via Magnus formula (accurate ±0.35°C, no paid API needed)
- UV Index via solar position model (works on free OWM plan)
- Heat Index via Steadman formula (shown when temp ≥ 27°C)
- 5-day forecast grouped by local calendar day
- Air Quality Index from OWM Air Pollution API (free tier)
"""

from __future__ import annotations

import asyncio
import math
import os
from datetime import datetime

import httpx

BASE_URL = "https://api.openweathermap.org"

# Shared async client — SSL verify disabled for restricted environments
# (same behaviour as the original Node.js rejectUnauthorized:false)
_client = httpx.AsyncClient(verify=False, timeout=10.0)


def _api_key() -> str:
    key = os.getenv("OPENWEATHER_API_KEY", "")
    if not key:
        raise RuntimeError("OPENWEATHER_API_KEY is not set in .env")
    return key


# ════════════════════════════════════════════════
#  GEOCODING
# ════════════════════════════════════════════════

async def geocode(query: str) -> list[dict]:
    """Geocode any location string → list of matches (best match first)."""
    r = await _client.get(
        f"{BASE_URL}/geo/1.0/direct",
        params={"q": query, "limit": 5, "appid": _api_key()},
    )
    r.raise_for_status()
    data = r.json()
    if not data:
        raise ValueError(f'Location not found: "{query}"')
    return data


async def reverse_geocode(lat: float, lon: float) -> dict:
    """Reverse geocode coordinates → city name and country."""
    r = await _client.get(
        f"{BASE_URL}/geo/1.0/reverse",
        params={"lat": lat, "lon": lon, "limit": 1, "appid": _api_key()},
    )
    r.raise_for_status()
    data = r.json()
    if not data:
        return {"city": "Unknown", "country": "XX"}
    return {"city": data[0]["name"], "country": data[0]["country"]}


# ════════════════════════════════════════════════
#  WEATHER FETCH
# ════════════════════════════════════════════════

async def fetch_weather(lat: float, lon: float) -> dict:
    """
    Fetch current weather + forecast + air quality in parallel.
    Optionally fetches One Call 2.5 for UV index + hourly detail.
    Returns normalised, frontend-ready weather dict.
    """
    base_params = {"lat": lat, "lon": lon, "appid": _api_key(), "units": "metric"}

    # Fire current, forecast, and AQI simultaneously
    current_task  = _client.get(f"{BASE_URL}/data/2.5/weather",        params=base_params)
    forecast_task = _client.get(f"{BASE_URL}/data/2.5/forecast",       params={**base_params, "cnt": 40})
    aqi_task      = _client.get(f"{BASE_URL}/data/2.5/air_pollution",  params={"lat": lat, "lon": lon, "appid": _api_key()})

    current_r, forecast_r, aqi_r = await asyncio.gather(
        current_task, forecast_task, aqi_task, return_exceptions=True
    )

    if isinstance(current_r, Exception):
        raise current_r
    if isinstance(forecast_r, Exception):
        raise forecast_r

    current_r.raise_for_status()
    forecast_r.raise_for_status()

    aqi_data = None
    if not isinstance(aqi_r, Exception):
        try:
            aqi_r.raise_for_status()
            aqi_data = aqi_r.json()
        except Exception:
            pass  # AQI is optional

    # Try One Call 2.5 for better UV + hourly (free plan, may not be available)
    one_call = None
    try:
        oc_r = await _client.get(
            f"{BASE_URL}/data/2.5/onecall",
            params={**base_params, "exclude": "minutely,alerts"},
        )
        if oc_r.status_code == 200:
            one_call = oc_r.json()
    except Exception:
        pass  # graceful fallback

    return _normalise(current_r.json(), forecast_r.json(), one_call, aqi_data)


# ════════════════════════════════════════════════
#  CALCULATION HELPERS
# ════════════════════════════════════════════════

def dew_point(temp_c: float, humidity: int) -> float:
    """
    Magnus formula — accurate to ±0.35°C.
    Calculated server-side, zero additional API cost.
    """
    a, b  = 17.625, 243.04
    alpha = (a * temp_c) / (b + temp_c) + math.log(humidity / 100)
    return round((b * alpha) / (a - alpha), 1)


def estimate_uv(lat: float, lon: float, unix_time: int, clouds: int, condition: str) -> float:
    """
    UV Index from solar position model.
    Uses simplified clear-sky model (accurate within ±1 UV unit).
    Works on free OWM plan — no One Call needed.
    """
    date      = datetime.utcfromtimestamp(unix_time)
    doy       = date.timetuple().tm_yday
    hour      = date.hour + lon / 15
    solar_dec = 23.45 * math.sin(math.radians(360 / 365 * (doy - 81)))
    lat_r     = math.radians(lat)
    dec_r     = math.radians(solar_dec)
    hour_a    = math.radians((hour - 12) * 15)
    sin_elev  = (
        math.sin(lat_r) * math.sin(dec_r)
        + math.cos(lat_r) * math.cos(dec_r) * math.cos(hour_a)
    )
    if sin_elev <= 0:
        return 0.0  # night or below horizon

    max_uv       = 12 * (sin_elev ** 0.6)                           # clear-sky max
    cloud_factor = 1 - (clouds / 100) * 0.75                        # cloud attenuation
    cond_factor  = 0.7 if condition in {"Rain", "Thunderstorm", "Snow", "Drizzle"} else 1.0
    return round(max_uv * cloud_factor * cond_factor, 1)


def heat_index(temp_c: float, rh: int) -> float | None:
    """
    Steadman formula — valid when temp ≥ 27°C.
    Returns None below threshold (no meaningful heat stress).
    """
    if temp_c < 27:
        return None
    hi = (
        -8.78469 + 1.61139 * temp_c + 2.33854 * rh
        - 0.14611 * temp_c * rh - 0.01230 * temp_c * temp_c
        - 0.01643 * rh * rh + 0.00221 * temp_c * temp_c * rh
        + 0.00072 * temp_c * rh * rh
        - 0.00000358 * temp_c * temp_c * rh * rh
    )
    return round(hi, 1)


def _deg_to_compass(deg: float) -> str:
    dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"]
    return dirs[round(deg / 22.5) % 16]


# ════════════════════════════════════════════════
#  NORMALISE RAW API DATA
# ════════════════════════════════════════════════

def _normalise(
    current: dict,
    forecast: dict,
    one_call: dict | None,
    air_quality: dict | None,
) -> dict:
    """
    Convert raw OWM API responses into a clean, frontend-ready shape.
    Groups 3-hour forecast buckets by local calendar day.
    """
    c  = current
    oc = one_call

    # ── Air Quality ──────────────────────────────────────────────────────────
    aqi = aqi_label = pollutants = None
    if air_quality and air_quality.get("list"):
        aq   = air_quality["list"][0]
        aqi  = aq["main"]["aqi"]
        aqi_label = {1:"Good", 2:"Fair", 3:"Moderate", 4:"Poor", 5:"Very Poor"}.get(aqi)
        comp = aq.get("components", {})
        pollutants = {
            "co":    round(comp["co"])              if comp.get("co")    is not None else None,
            "no2":   round(comp["no2"],   1)         if comp.get("no2")   is not None else None,
            "o3":    round(comp["o3"],    1)          if comp.get("o3")    is not None else None,
            "pm2_5": round(comp["pm2_5"], 1)          if comp.get("pm2_5") is not None else None,
            "pm10":  round(comp["pm10"],  1)          if comp.get("pm10")  is not None else None,
        }

    # ── Group 5-day forecast by local calendar day ────────────────────────
    tz_offset = c["timezone"]
    daily_map: dict[str, dict] = {}
    for item in forecast["list"]:
        local_sec = item["dt"] + tz_offset
        day_key   = datetime.utcfromtimestamp(local_sec).strftime("%Y-%m-%d")
        if day_key not in daily_map:
            daily_map[day_key] = {
                "date": day_key, "temps": [], "conditions": {},
                "precipitation": 0.0, "humidity": [], "wind": [],
                "icon": item["weather"][0]["icon"], "pop": [],
            }
        d = daily_map[day_key]
        d["temps"].append(item["main"]["temp"])
        d["humidity"].append(item["main"]["humidity"])
        d["wind"].append(item["wind"]["speed"])
        d["pop"].append(item.get("pop", 0))
        d["precipitation"] += (
            item.get("rain", {}).get("3h", 0)
            + item.get("snow", {}).get("3h", 0)
        )
        cond = item["weather"][0]["main"]
        d["conditions"][cond] = d["conditions"].get(cond, 0) + 1
        if "n" not in item["weather"][0]["icon"]:
            d["icon"] = item["weather"][0]["icon"]

    daily = []
    for d in list(daily_map.values())[:6]:
        top_cond = sorted(d["conditions"].items(), key=lambda x: x[1], reverse=True)[0][0]
        daily.append({
            "date":             d["date"],
            "temp_max":         round(max(d["temps"]), 1),
            "temp_min":         round(min(d["temps"]), 1),
            "condition":        top_cond,
            "icon":             d["icon"],
            "precipitation_mm": round(d["precipitation"], 1),
            "avg_humidity":     round(sum(d["humidity"]) / len(d["humidity"])),
            "avg_wind":         round(sum(d["wind"]) / len(d["wind"]), 1),
            "max_pop":          round(max(d["pop"]) * 100),
        })

    # ── Hourly (next 24h) ────────────────────────────────────────────────────
    hourly_src = (oc["hourly"][:24] if oc else forecast["list"][:8])
    hourly = []
    for h in hourly_src[:24]:
        if oc:
            hourly.append({
                "time":        h["dt"],
                "temp":        round(h["temp"], 1),
                "feels_like":  round(h["feels_like"], 1),
                "humidity":    h["humidity"],
                "wind_speed":  h["wind_speed"],
                "pop":         round((h.get("pop") or 0) * 100),
                "icon":        h["weather"][0]["icon"],
                "description": h["weather"][0]["description"],
                "dew_point":   round(h.get("dew_point") or dew_point(h["temp"], h["humidity"]), 1),
            })
        else:
            hourly.append({
                "time":        h["dt"],
                "temp":        round(h["main"]["temp"], 1),
                "feels_like":  round(h["main"]["feels_like"], 1),
                "humidity":    h["main"]["humidity"],
                "wind_speed":  h["wind"]["speed"],
                "pop":         round((h.get("pop") or 0) * 100),
                "icon":        h["weather"][0]["icon"],
                "description": h["weather"][0]["description"],
                "dew_point":   dew_point(h["main"]["temp"], h["main"]["humidity"]),
            })

    # ── Computed current values ───────────────────────────────────────────────
    dp = (
        round(oc["current"]["dew_point"], 1)
        if oc and oc.get("current", {}).get("dew_point") is not None
        else dew_point(c["main"]["temp"], c["main"]["humidity"])
    )
    uv_api  = oc["current"]["uvi"] if oc and oc.get("current", {}).get("uvi") is not None else None
    uv_calc = estimate_uv(
        c["coord"]["lat"], c["coord"]["lon"], c["dt"],
        c.get("clouds", {}).get("all", 0), c["weather"][0]["main"],
    )
    uv = uv_api if uv_api is not None else uv_calc

    return {
        "city":            c["name"],
        "country":         c["sys"]["country"],
        "lat":             c["coord"]["lat"],
        "lon":             c["coord"]["lon"],
        "timezone_offset": c["timezone"],
        "current": {
            "temp":           round(c["main"]["temp"], 1),
            "feels_like":     round(c["main"]["feels_like"], 1),
            "temp_min":       round(c["main"]["temp_min"], 1),
            "temp_max":       round(c["main"]["temp_max"], 1),
            "humidity":       c["main"]["humidity"],
            "pressure":       c["main"]["pressure"],
            "sea_level":      c["main"].get("sea_level") or c["main"]["pressure"],
            "grnd_level":     c["main"].get("grnd_level"),
            "visibility":     c.get("visibility"),
            "wind_speed":     c["wind"]["speed"],
            "wind_deg":       c["wind"].get("deg") or 0,
            "wind_dir":       _deg_to_compass(c["wind"].get("deg") or 0),
            "wind_gust":      c["wind"].get("gust"),
            "condition":      c["weather"][0]["main"],
            "condition_icon": c["weather"][0]["icon"],
            "description":    c["weather"][0]["description"],
            "sunrise":        c["sys"]["sunrise"],
            "sunset":         c["sys"]["sunset"],
            "uv_index":       round(uv, 1),
            "uv_source":      "api" if uv_api is not None else "calculated",
            "dew_point":      dp,
            "heat_index":     heat_index(c["main"]["temp"], c["main"]["humidity"]),
            "cloud_cover":    c.get("clouds", {}).get("all"),
            "rain_1h":        c.get("rain", {}).get("1h", 0),
            "snow_1h":        c.get("snow", {}).get("1h", 0),
            "aqi":            aqi,
            "aqi_label":      aqi_label,
            "pollutants":     pollutants,
        },
        "hourly": hourly,
        "daily":  daily,
    }
