const axios = require('axios');
const https = require('https');

const BASE_URL = 'https://api.openweathermap.org';

// Allow self-signed / unverifiable certs in restricted environments.
// In production this should be removed in favour of a proper CA bundle.
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Geocode a city name to coordinates using OpenWeather Geocoding API.
 * Returns the best match.
 */
async function geocode(query) {
  const key = process.env.OPENWEATHER_API_KEY;
  const res = await axios.get(`${BASE_URL}/geo/1.0/direct`, {
    params: { q: query, limit: 5, appid: key },
    timeout: 8000,
    httpsAgent,
  });
  if (!res.data || res.data.length === 0) {
    const err = new Error(`Location not found: "${query}"`);
    err.status = 404;
    throw err;
  }
  return res.data; // array of matches
}

/**
 * Reverse geocode coordinates to a city name.
 */
async function reverseGeocode(lat, lon) {
  const key = process.env.OPENWEATHER_API_KEY;
  const res = await axios.get(`${BASE_URL}/geo/1.0/reverse`, {
    params: { lat, lon, limit: 1, appid: key },
    timeout: 8000,
    httpsAgent,
  });
  if (!res.data || res.data.length === 0) {
    return { city: 'Unknown', country: 'XX' };
  }
  const loc = res.data[0];
  return { city: loc.name, country: loc.country };
}

/**
 * Fetch current weather + forecast.
 * UV index is calculated from solar position (free, no extra API needed).
 * Dew point is derived from temperature + humidity (Magnus formula).
 * Air Quality fetched from OWM free Air Pollution API.
 */
async function fetchWeather(lat, lon) {
  const key = process.env.OPENWEATHER_API_KEY;

  // Parallel fetch: current + 5-day forecast + air quality (all free tier)
  const [currentRes, forecastRes, aqiRes] = await Promise.all([
    axios.get(`${BASE_URL}/data/2.5/weather`, {
      params: { lat, lon, appid: key, units: 'metric' },
      timeout: 8000,
      httpsAgent,
    }),
    axios.get(`${BASE_URL}/data/2.5/forecast`, {
      params: { lat, lon, appid: key, units: 'metric', cnt: 40 },
      timeout: 8000,
      httpsAgent,
    }),
    // Air Pollution API — completely free, no subscription needed
    axios.get(`${BASE_URL}/data/2.5/air_pollution`, {
      params: { lat, lon, appid: key },
      timeout: 8000,
      httpsAgent,
    }).catch(() => null),
  ]);

  // Try One Call 2.5 (free) for UV + hourly detail
  let oneCall = null;
  try {
    const ocRes = await axios.get(`${BASE_URL}/data/2.5/onecall`, {
      params: {
        lat, lon, appid: key, units: 'metric',
        exclude: 'minutely,alerts',
      },
      timeout: 8000,
      httpsAgent,
    });
    oneCall = ocRes.data;
  } catch (_) {
    // One Call 2.5 may not be available — use calculated UV
  }

  return normalise(currentRes.data, forecastRes.data, oneCall, aqiRes?.data);
}

/**
 * Normalise raw API data into a clean, frontend-ready shape.
 */
function normalise(current, forecast, oneCall, airQuality) {
  const c  = current;
  const oc = oneCall;

  // ── Dew Point (Magnus formula — accurate to ±0.35°C) ────────────────────
  function calcDewPoint(tempC, humidity) {
    const a = 17.625, b = 243.04;
    const alpha = (a * tempC) / (b + tempC) + Math.log(humidity / 100);
    return Math.round((b * alpha) / (a - alpha) * 10) / 10;
  }

  // ── UV Index estimate from solar elevation + cloud cover ─────────────────
  // Uses a simplified clear-sky model (accurate within ±1 UV unit)
  function estimateUV(lat, lon, unixTime, clouds, condition) {
    const date   = new Date(unixTime * 1000);
    const doy    = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
    const hour   = date.getUTCHours() + lon / 15;
    const solarDecl = 23.45 * Math.sin((360 / 365 * (doy - 81)) * Math.PI / 180);
    const latRad    = lat * Math.PI / 180;
    const declRad   = solarDecl * Math.PI / 180;
    const hourAngle = (hour - 12) * 15 * Math.PI / 180;
    const sinElev   = Math.sin(latRad) * Math.sin(declRad)
                    + Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngle);
    if (sinElev <= 0) return 0;  // night or below horizon

    // Max possible UV at this solar angle (clear sky)
    const maxUV = 12 * Math.pow(sinElev, 0.6);

    // Cloud attenuation
    const cloudFactor = 1 - (clouds / 100) * 0.75;

    // Rain/thunderstorm further reduce UV
    const condFactor = ['Rain','Thunderstorm','Snow','Drizzle'].includes(condition) ? 0.7 : 1;

    return Math.round(maxUV * cloudFactor * condFactor * 10) / 10;
  }

  // ── Air Quality Index ─────────────────────────────────────────────────────
  let aqi = null;
  let aqiLabel = null;
  let pollutants = null;
  if (airQuality?.list?.[0]) {
    const aqData = airQuality.list[0];
    aqi = aqData.main?.aqi;
    const aqiLabels = { 1:'Good', 2:'Fair', 3:'Moderate', 4:'Poor', 5:'Very Poor' };
    aqiLabel = aqiLabels[aqi] || null;
    const comp = aqData.components || {};
    pollutants = {
      co:    comp.co    != null ? Math.round(comp.co)    : null,
      no2:   comp.no2   != null ? Math.round(comp.no2 * 10) / 10 : null,
      o3:    comp.o3    != null ? Math.round(comp.o3 * 10) / 10  : null,
      pm2_5: comp.pm2_5 != null ? Math.round(comp.pm2_5 * 10) / 10 : null,
      pm10:  comp.pm10  != null ? Math.round(comp.pm10 * 10) / 10  : null,
    };
  }

  // ── Group 5-day forecast by calendar day ─────────────────────────────────
  const tzOffset = c.timezone * 1000;
  const dailyMap = {};
  for (const item of forecast.list) {
    const localMs = item.dt * 1000 + tzOffset;
    const dayKey  = new Date(localMs).toISOString().slice(0, 10);
    if (!dailyMap[dayKey]) {
      dailyMap[dayKey] = {
        date: dayKey, temps: [], conditions: {},
        precipitation: 0, humidity: [], wind: [],
        icon: item.weather[0].icon, pop: [],
      };
    }
    const d = dailyMap[dayKey];
    d.temps.push(item.main.temp);
    d.humidity.push(item.main.humidity);
    d.wind.push(item.wind.speed);
    d.pop.push(item.pop || 0);
    d.precipitation += (item.rain?.['3h'] || 0) + (item.snow?.['3h'] || 0);
    const cond = item.weather[0].main;
    d.conditions[cond] = (d.conditions[cond] || 0) + 1;
    if (!item.weather[0].icon.includes('n')) d.icon = item.weather[0].icon;
  }

  const daily = Object.values(dailyMap)
    .slice(0, 6)
    .map((d) => ({
      date:             d.date,
      temp_max:         Math.round(Math.max(...d.temps) * 10) / 10,
      temp_min:         Math.round(Math.min(...d.temps) * 10) / 10,
      condition:        Object.entries(d.conditions).sort((a, b) => b[1] - a[1])[0][0],
      icon:             d.icon,
      precipitation_mm: Math.round(d.precipitation * 10) / 10,
      avg_humidity:     Math.round(d.humidity.reduce((a, b) => a + b, 0) / d.humidity.length),
      avg_wind:         Math.round((d.wind.reduce((a, b) => a + b, 0) / d.wind.length) * 10) / 10,
      max_pop:          Math.round(Math.max(...d.pop) * 100),
    }));

  // ── Hourly (next 24h) ─────────────────────────────────────────────────────
  const hourly = (oc?.hourly || forecast.list.slice(0, 8)).slice(0, 24).map((h) => {
    if (oc) {
      return {
        time:        h.dt,
        temp:        Math.round(h.temp * 10) / 10,
        feels_like:  Math.round(h.feels_like * 10) / 10,
        humidity:    h.humidity,
        wind_speed:  h.wind_speed,
        pop:         Math.round((h.pop || 0) * 100),
        icon:        h.weather[0].icon,
        description: h.weather[0].description,
        dew_point:   h.dew_point != null ? Math.round(h.dew_point * 10) / 10 : calcDewPoint(h.temp, h.humidity),
      };
    }
    return {
      time:        h.dt,
      temp:        Math.round(h.main.temp * 10) / 10,
      feels_like:  Math.round(h.main.feels_like * 10) / 10,
      humidity:    h.main.humidity,
      wind_speed:  h.wind.speed,
      pop:         Math.round((h.pop || 0) * 100),
      icon:        h.weather[0].icon,
      description: h.weather[0].description,
      dew_point:   calcDewPoint(h.main.temp, h.main.humidity),
    };
  });

  // ── Computed values ───────────────────────────────────────────────────────
  const dewPoint = oc?.current?.dew_point != null
    ? Math.round(oc.current.dew_point * 10) / 10
    : calcDewPoint(c.main.temp, c.main.humidity);

  const uvFromOneCall = oc?.current?.uvi ?? null;
  const uvEstimated  = estimateUV(c.coord.lat, c.coord.lon, c.dt, c.clouds?.all || 0, c.weather[0].main);
  const uvIndex      = uvFromOneCall !== null ? uvFromOneCall : uvEstimated;

  // ── Heat Index (Steadman formula, valid when temp ≥ 27°C) ────────────────
  function heatIndex(t, rh) {
    if (t < 27) return null;
    const hi = -8.78469 + 1.61139 * t + 2.33854 * rh
      - 0.14611 * t * rh - 0.01230 * t * t
      - 0.01643 * rh * rh + 0.00221 * t * t * rh
      + 0.00072 * t * rh * rh - 0.00000358 * t * t * rh * rh;
    return Math.round(hi * 10) / 10;
  }

  const windDir = degToCompass(c.wind.deg || 0);

  return {
    city:             c.name,
    country:          c.sys.country,
    lat:              c.coord.lat,
    lon:              c.coord.lon,
    timezone_offset:  c.timezone,

    current: {
      temp:           Math.round(c.main.temp * 10) / 10,
      feels_like:     Math.round(c.main.feels_like * 10) / 10,
      temp_min:       Math.round(c.main.temp_min * 10) / 10,
      temp_max:       Math.round(c.main.temp_max * 10) / 10,
      humidity:       c.main.humidity,
      pressure:       c.main.pressure,
      sea_level:      c.main.sea_level || c.main.pressure,
      grnd_level:     c.main.grnd_level || null,
      visibility:     c.visibility || null,
      wind_speed:     c.wind.speed,
      wind_deg:       c.wind.deg || 0,
      wind_dir:       windDir,
      wind_gust:      c.wind.gust || null,
      condition:      c.weather[0].main,
      condition_icon: c.weather[0].icon,
      description:    c.weather[0].description,
      sunrise:        c.sys.sunrise,
      sunset:         c.sys.sunset,
      uv_index:       Math.round(uvIndex * 10) / 10,
      uv_source:      uvFromOneCall !== null ? 'api' : 'calculated',
      dew_point:      dewPoint,
      heat_index:     heatIndex(c.main.temp, c.main.humidity),
      cloud_cover:    c.clouds?.all ?? null,
      rain_1h:        c.rain?.['1h'] || 0,
      snow_1h:        c.snow?.['1h'] || 0,
      // Air quality
      aqi:            aqi,
      aqi_label:      aqiLabel,
      pollutants:     pollutants,
    },

    hourly,
    daily,
  };
}

function degToCompass(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

module.exports = { geocode, reverseGeocode, fetchWeather };
