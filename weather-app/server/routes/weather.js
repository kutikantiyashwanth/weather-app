const express = require('express');
const { query, param, validationResult } = require('express-validator');
const { geocode, reverseGeocode, fetchWeather } = require('../weatherService');
const { queries } = require('../db');

const router = express.Router();

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ error: 'Validation failed', details: errors.array() });
  }
  next();
}

/* Round coords to 2 decimal places for dedup (≈1.1km precision) */
const roundCoord = v => Math.round(v * 100) / 100;

/* Build snapshot object from weather current */
function buildSnapshot(cur, weather) {
  return {
    temp_c:          cur.temp,
    feels_like_c:    cur.feels_like,
    humidity:        cur.humidity,
    pressure:        cur.pressure,
    wind_speed:      cur.wind_speed,
    wind_deg:        cur.wind_deg,
    visibility:      cur.visibility,
    uv_index:        cur.uv_index,
    dew_point:       cur.dew_point,
    heat_index:      cur.heat_index,
    aqi:             cur.aqi,
    aqi_label:       cur.aqi_label,
    condition:       cur.condition,
    condition_icon:  cur.condition_icon,
    description:     cur.description,
    sunrise:         cur.sunrise,
    sunset:          cur.sunset,
    timezone_offset: weather.timezone_offset,
    raw_json:        JSON.stringify(weather),
  };
}

// ── GET /api/weather/search?q= ────────────────────────────────────────────────
router.get(
  '/search',
  [
    query('q')
      .trim()
      .notEmpty().withMessage('Query (q) is required')
      .isLength({ max: 100 }).withMessage('Query too long'),
  ],
  validate,
  async (req, res) => {
    try {
      const userQuery = req.query.q.trim();

      // 1. Geocode — use geocoder's city name (more accurate than OWM's)
      const geoResults = await geocode(userQuery);
      const geo = geoResults[0];

      // 2. Fetch weather
      const weather = await fetchWeather(geo.lat, geo.lon);

      // 3. Use geocoder name when OWM returns a district/neighbourhood
      const displayCity    = geo.name    || weather.city;
      const displayCountry = geo.country || weather.country;
      weather.city    = displayCity;
      weather.country = displayCountry;

      // 4. Persist
      const searchDoc = await queries.insertSearch({
        query:   userQuery,
        city:    displayCity,
        country: displayCountry,
        lat:     weather.lat,
        lon:     weather.lon,
      });

      await queries.insertSnapshot({
        search_id: searchDoc._id,
        ...buildSnapshot(weather.current, weather),
      });

      res.json({ search_id: searchDoc._id, geoOptions: geoResults, weather });
    } catch (err) {
      const status = err.status || err.response?.status || 500;
      res.status(status).json({ error: err.message || 'Weather fetch failed' });
    }
  }
);

// ── GET /api/weather/coords?lat=&lon= ─────────────────────────────────────────
router.get(
  '/coords',
  [
    query('lat').isFloat({ min: -90,  max: 90  }).withMessage('Invalid latitude'),
    query('lon').isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
  ],
  validate,
  async (req, res) => {
    try {
      const lat = parseFloat(req.query.lat);
      const lon = parseFloat(req.query.lon);

      // Dedup: skip saving if we already have a search within ~1km in last 5 min
      const latR = roundCoord(lat);
      const lonR = roundCoord(lon);
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const recent = await queries.findRecentCoordSearch(latR, lonR, fiveMinAgo);

      const [weather, geoInfo] = await Promise.all([
        fetchWeather(lat, lon),
        reverseGeocode(lat, lon),
      ]);

      // Use reverse geocoder name — more accurate than OWM district names
      const displayCity    = geoInfo.city    || weather.city;
      const displayCountry = geoInfo.country || weather.country;
      weather.city    = displayCity;
      weather.country = displayCountry;

      // Only save a new DB record if no recent duplicate
      let searchId;
      if (recent) {
        searchId = recent._id;
        // Update the snapshot with fresh data
        await queries.updateSnapshot(searchId, buildSnapshot(weather.current, weather));
      } else {
        const searchDoc = await queries.insertSearch({
          query:   `${displayCity}, ${displayCountry}`,
          city:    displayCity,
          country: displayCountry,
          lat:     latR,
          lon:     lonR,
        });
        searchId = searchDoc._id;
        await queries.insertSnapshot({
          search_id: searchId,
          ...buildSnapshot(weather.current, weather),
        });
      }

      res.json({ search_id: searchId, weather });
    } catch (err) {
      const status = err.status || err.response?.status || 500;
      res.status(status).json({ error: err.message || 'Weather fetch failed' });
    }
  }
);

// ── GET /api/weather/history ─── READ ─────────────────────────────────────────
router.get('/history', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const rows  = await queries.getAllSearches(limit);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/weather/history/:id ─── READ one ─────────────────────────────────
router.get(
  '/history/:id',
  [param('id').notEmpty()],
  validate,
  async (req, res) => {
    try {
      const search = await queries.getSearchById(req.params.id);
      if (!search) return res.status(404).json({ error: 'Not found' });
      const snapshot = await queries.getSnapshotBySearchId(req.params.id);
      res.json({ search, snapshot });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── DELETE /api/weather/history/:id ─── DELETE ────────────────────────────────
router.delete(
  '/history/:id',
  [param('id').notEmpty()],
  validate,
  async (req, res) => {
    try {
      const count = await queries.deleteSearch(req.params.id);
      if (!count) return res.status(404).json({ error: 'Not found' });
      res.json({ message: 'Deleted', id: req.params.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
