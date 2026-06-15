"""
weather_service.py — OpenWeatherMap API integration
Handles geocoding, reverse geocoding, weather fetching,
UV calculation, dew point, heat index, and air quality.
"""

import math
import os
import httpx
from datetime import datetime, timezone

BASE_URL = "https://api.openweathermap.org"
VERIFY_SSL = False  # Allow in restricted environments


def _key() -> str:
    k = os.getenv("OPENWEATHER_API_KEY", "")
    if not k:
        raise RuntimeError("OPENWEATHER_API_KEY is not set in .env")
    return k


# ── Geocoding ─────────────────────────────────────────────────────────────────

async def geocode(query: str) -> list[dict]:
    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=8) as client:
        r = await client.get(f"{BASE_URL}/geo/1.0/direct",
                             params={"q": query, "limit": 5, "appid": _key()})
    r.raise_for_status()
    data = r.json()
    if not data:
        raise ValueError(f"Location not found: \"{query}\"")
    return data


async def reverse_geocode(lat: float, lon: float) -> dict:
    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=8) as client:
        r = await client.get(f"{BASE_URL}/geo/1.0/reverse",
                             params={"lat": lat, "lon": lon, "limit": 1, "appid": _key()})
    r.raise_for_status()
    data = r.json()
    if not data:
        return {"city": "Unknown", "country": "XX"}
    return {"city": data[0]["name"], "country": data[0]["country"]}


# ── Weather fetch ─────────────────────────────────────────────────────────────

async def fetch_weather(lat: float, lon: float) -> dict:
    key = _key()
    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=10) as client:
        # Parallel: current weather + 5-day forecast + air quality
        current_r, forecast_r, aqi_r = await _gather(
            client.get(f"{BASE_URL}/data/2.5/weather",
                       params={"lat": lat, "lon": lon, "appid": key, "units": "metric"}),
            client.get(f"{BASE_URL}/data/2.5/forecast",
                       params={"lat": lat, "lon": lon, "appid": key, "units": "metric", "cnt": 40}),
            client.get(f"{BASE_URL}/data/2.5/air_pollution",
                       params={"lat": lat, "lon": lon, "appid": key}),
        )

    current  = current_r.json()
    forecast = forecast_r.json()
    aqi_data = aqi_r.json() if aqi_r.status_code == 200 else None

    # Try One Call 2.5 for hourly UV
    one_call = None
    try:
        async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=8) as client:
            oc = await client.get(f"{BASE_URL}/data/2.5/onecall",
                                  params={"lat": lat, "lon": lon, "appid": key,
                                          "units": "metric", "exclude": "minutely,alerts"})
            if oc.status_code == 200:
                one_call = oc.json()
    except Exception:
        pass

    return _normalise(current, forecast, one_call, aqi_data)


async def _gather(*coros):
    """Simple sequential gather — httpx async client handles concurrent requests."""
    import asyncio
    return await asyncio.gather(*coros, return_exceptions=False)


# ── Normalise ─────────────────────────────────────────────────────────────────

def _normalise(current: dict, forecast: dict, one_call: dict | None, aqi: dict | None) -> dict:
    c  = current
    oc = one_call

    # ── Dew point (Magnus formula) ────────────────────────────────────────────
    def dew_point(temp_c: float, humidity: int) -> float:
        a, b = 17.625, 243.04
        alpha = (a * temp_c) / (b + temp_c) + math.log(humidity / 100)
        return round((b * alpha) / (a - alpha), 1)

    # ── UV estimate from solar position ───────────────────────────────────────
    def estimate_uv(lat: float, lon: float, unix_time: int, clouds: int, condition: str) -> float:
        dt = datetime.fromtimestamp(unix_time, tz=timezone.utc)
        doy = dt.timetuple().tm_yday
        hour = dt.hour + lon / 15
        decl = 23.45 * math.sin(math.radians(360 / 365 * (doy - 81)))
        lat_r = math.radians(lat)
        decl_r = math.radians(decl)
        ha = math.radians((hour - 12) * 15)
        sin_elev = (math.sin(lat_r) * math.sin(decl_r) +
                    math.cos(lat_r) * math.cos(decl_r) * math.cos(ha))
        if sin_elev <= 0:
            return 0.0
        max_uv = 12 * (sin_elev ** 0.6)
        cloud_factor = 1 - (clouds / 100) * 0.75
        cond_factor = 0.7 if condition in ("Rain", "Thunderstorm", "Snow", "Drizzle") else 1.0
        return round(max_uv * cloud_factor * cond_factor, 1)

    # ── Heat index (Steadman formula) ─────────────────────────────────────────
    def heat_index(t: float, rh: int) -> float | None:
        if t < 27:
            return None
        hi = (-8.78469 + 1.61139 * t + 2.33854 * rh
              - 0.14611 * t * rh - 0.01230 * t * t
              - 0.01643 * rh * rh + 0.00221 * t * t * rh
              + 0.00072 * t * rh * rh - 0.00000358 * t * t * rh * rh)
        return round(hi, 1)

    # ── Air quality ───────────────────────────────────────────────────────────
    aqi_val, aqi_label, pollutants = None, None, None
    if aqi and "list" in aqi and aqi["list"]:
        aq = aqi["list"][0]
        aqi_val = aq.get("main", {}).get("aqi")
        labels = {1: "Good", 2: "Fair", 3: "Moderate", 4: "Poor", 5: "Very Poor"}
        aqi_label = labels.get(aqi_val)
        comp = aq.get("components", {})
        pollutants = {
            "co":    round(comp.get("co",   0)),
            "no2":   round(comp.get("no2",  0), 1),
            "o3":    round(comp.get("o3",   0), 1),
            "pm2_5": round(comp.get("pm2_5", 0), 1),
            "pm10":  round(comp.get("pm10",  0), 1),
        }

    # ── 5-day forecast grouping ───────────────────────────────────────────────
    tz_offset = c.get("timezone", 0)
    daily_map: dict[str, dict] = {}
    for item in forecast.get("list", []):
        local_ms = (item["dt"] + tz_offset) * 1000
        day_key = datetime.fromtimestamp(item["dt"] + tz_offset).strftime("%Y-%m-%d")
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
        d["precipitation"] += item.get("rain", {}).get("3h", 0) + item.get("snow", {}).get("3h", 0)
        cond = item["weather"][0]["main"]
        d["conditions"][cond] = d["conditions"].get(cond, 0) + 1
        if "n" not in item["weather"][0]["icon"]:
            d["icon"] = item["weather"][0]["icon"]

    daily = []
    for d in list(daily_map.values())[:6]:
        top_cond = max(d["conditions"], key=d["conditions"].get)
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

    # ── Hourly ────────────────────────────────────────────────────────────────
    hourly_src = oc.get("hourly", [])[:24] if oc else forecast.get("list", [])[:8]
    hourly = []
    for h in hourly_src:
        if oc:
            hourly.append({
                "time":        h["dt"],
                "temp":        round(h["temp"], 1),
                "feels_like":  round(h["feels_like"], 1),
                "humidity":    h["humidity"],
                "wind_speed":  h["wind_speed"],
                "pop":         round((h.get("pop", 0)) * 100),
                "icon":        h["weather"][0]["icon"],
                "description": h["weather"][0]["description"],
                "dew_point":   round(h.get("dew_point", dew_point(h["temp"], h["humidity"])), 1),
            })
        else:
            hourly.append({
                "time":        h["dt"],
                "temp":        round(h["main"]["temp"], 1),
                "feels_like":  round(h["main"]["feels_like"], 1),
                "humidity":    h["main"]["humidity"],
                "wind_speed":  h["wind"]["speed"],
                "pop":         round((h.get("pop", 0)) * 100),
                "icon":        h["weather"][0]["icon"],
                "description": h["weather"][0]["description"],
                "dew_point":   dew_point(h["main"]["temp"], h["main"]["humidity"]),
            })

    # ── Wind direction ────────────────────────────────────────────────────────
    dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"]
    wind_dir = dirs[round((c.get("wind", {}).get("deg", 0)) / 22.5) % 16]

    # ── Computed values ───────────────────────────────────────────────────────
    temp    = round(c["main"]["temp"], 1)
    humidity = c["main"]["humidity"]
    clouds   = c.get("clouds", {}).get("all", 0)
    condition = c["weather"][0]["main"]

    dp = (round(oc["current"]["dew_point"], 1)
          if oc and "dew_point" in oc.get("current", {})
          else dew_point(temp, humidity))

    uv_api = oc["current"].get("uvi") if oc else None
    uv_val = round(uv_api, 1) if uv_api is not None else estimate_uv(
        c["coord"]["lat"], c["coord"]["lon"], c["dt"], clouds, condition)

    return {
        "city":             c["name"],
        "country":          c["sys"]["country"],
        "lat":              c["coord"]["lat"],
        "lon":              c["coord"]["lon"],
        "timezone_offset":  c["timezone"],
        "current": {
            "temp":           temp,
            "feels_like":     round(c["main"]["feels_like"], 1),
            "temp_min":       round(c["main"]["temp_min"], 1),
            "temp_max":       round(c["main"]["temp_max"], 1),
            "humidity":       humidity,
            "pressure":       c["main"]["pressure"],
            "sea_level":      c["main"].get("sea_level", c["main"]["pressure"]),
            "grnd_level":     c["main"].get("grnd_level"),
            "visibility":     c.get("visibility"),
            "wind_speed":     c.get("wind", {}).get("speed", 0),
            "wind_deg":       c.get("wind", {}).get("deg", 0),
            "wind_dir":       wind_dir,
            "wind_gust":      c.get("wind", {}).get("gust"),
            "condition":      condition,
            "condition_icon": c["weather"][0]["icon"],
            "description":    c["weather"][0]["description"],
            "sunrise":        c["sys"]["sunrise"],
            "sunset":         c["sys"]["sunset"],
            "uv_index":       uv_val,
            "uv_source":      "api" if uv_api is not None else "calculated",
            "dew_point":      dp,
            "heat_index":     heat_index(temp, humidity),
            "cloud_cover":    clouds,
            "rain_1h":        c.get("rain", {}).get("1h", 0),
            "snow_1h":        c.get("snow", {}).get("1h", 0),
            "aqi":            aqi_val,
            "aqi_label":      aqi_label,
            "pollutants":     pollutants,
        },
        "hourly": hourly,
        "daily":  daily,
    }
