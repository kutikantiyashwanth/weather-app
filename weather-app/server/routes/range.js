/**
 * /api/range  — Date-range weather queries (Assessment 2.1 CRUD)
 *
 * CREATE  POST   /api/range          — geocode location, validate dates, fetch weather, store
 * READ    GET    /api/range          — list all stored range queries
 * READ    GET    /api/range/:id      — get single record
 * UPDATE  PATCH  /api/range/:id      — update label/notes on a record
 * DELETE  DELETE /api/range/:id      — delete a record
 */

const express  = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { geocode, fetchWeather } = require('../weatherService');
const Datastore = require('@seald-io/nedb');
const path      = require('path');
const fs        = require('fs');

const router = express.Router();

// ── Collection ────────────────────────────────────────────────────────────────

const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const rangeDb = new Datastore({
  filename: path.join(dataDir, 'range_queries.db'),
  autoload: true,
  timestampData: true,
});

// ── Validation helper ─────────────────────────────────────────────────────────

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      error:   'Validation failed',
      details: errors.array().map(e => ({ field: e.path, msg: e.msg })),
    });
  }
  next();
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function isValidDate(str) {
  const d = new Date(str);
  return !isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}$/.test(str);
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

// ── CREATE — POST /api/range ─────────────────────────────────────────────────

router.post(
  '/',
  [
    body('location')
      .trim().notEmpty().withMessage('Location is required')
      .isLength({ max: 120 }).withMessage('Location too long'),
    body('date_from')
      .notEmpty().withMessage('Start date (date_from) is required')
      .custom(v => {
        if (!isValidDate(v)) throw new Error('date_from must be YYYY-MM-DD');
        return true;
      }),
    body('date_to')
      .notEmpty().withMessage('End date (date_to) is required')
      .custom((v, { req }) => {
        if (!isValidDate(v)) throw new Error('date_to must be YYYY-MM-DD');
        if (new Date(v) < new Date(req.body.date_from))
          throw new Error('date_to must be on or after date_from');
        if (daysBetween(req.body.date_from, v) > 365)
          throw new Error('Date range cannot exceed 365 days');
        return true;
      }),
    body('label')
      .optional().trim().isLength({ max: 80 }).withMessage('Label too long'),
    body('notes')
      .optional().trim().isLength({ max: 500 }).withMessage('Notes too long'),
  ],
  validate,
  async (req, res) => {
    try {
      const { location, date_from, date_to, label, notes } = req.body;

      // 1. Validate location exists (geocode)
      let geoResults;
      try {
        geoResults = await geocode(location);
      } catch (geoErr) {
        return res.status(404).json({
          error:  'Location not found',
          detail: `"${location}" could not be geocoded. Try a city name, zip code, or coordinates.`,
        });
      }
      const geo = geoResults[0];

      // 2. Fetch current weather snapshot for the geocoded location
      const weather = await fetchWeather(geo.lat, geo.lon);
      const cur     = weather.current;

      // 3. Build record
      const record = {
        location_query: location,
        city:     weather.city,
        country:  weather.country,
        lat:      geo.lat,
        lon:      geo.lon,
        date_from,
        date_to,
        days:     daysBetween(date_from, date_to) + 1,
        label:    label || `${weather.city} — ${date_from} to ${date_to}`,
        notes:    notes || '',
        // Weather snapshot at time of query
        snapshot: {
          temp_c:       cur.temp,
          feels_like_c: cur.feels_like,
          humidity:     cur.humidity,
          pressure:     cur.pressure,
          wind_speed:   cur.wind_speed,
          wind_dir:     cur.wind_dir,
          condition:    cur.condition,
          description:  cur.description,
          icon:         cur.condition_icon,
          uv_index:     cur.uv_index,
          visibility:   cur.visibility,
        },
        // Store full daily forecast for the date range
        forecast: weather.daily,
      };

      const doc = await rangeDb.insertAsync(record);
      res.status(201).json(doc);

    } catch (err) {
      const status = err.status || err.response?.status || 500;
      res.status(status).json({ error: err.message || 'Failed to create range query' });
    }
  }
);

// ── READ ALL — GET /api/range ─────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit)  || 50, 200);
    const skip   = Math.max(parseInt(req.query.offset) || 0,  0);
    const filter = {};

    // optional city filter
    if (req.query.city) filter.city = new RegExp(req.query.city, 'i');

    const rows = await rangeDb
      .findAsync(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await rangeDb.countAsync(filter);

    res.json({ total, rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── READ ONE — GET /api/range/:id ─────────────────────────────────────────────

router.get(
  '/:id',
  [param('id').notEmpty()],
  validate,
  async (req, res) => {
    try {
      const doc = await rangeDb.findOneAsync({ _id: req.params.id });
      if (!doc) return res.status(404).json({ error: 'Record not found' });
      res.json(doc);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── UPDATE — PATCH /api/range/:id ─────────────────────────────────────────────

router.patch(
  '/:id',
  [
    param('id').notEmpty(),
    body('label')
      .optional().trim().isLength({ max: 80 }).withMessage('Label too long'),
    body('notes')
      .optional().trim().isLength({ max: 500 }).withMessage('Notes too long'),
    body('date_from')
      .optional()
      .custom(v => {
        if (!isValidDate(v)) throw new Error('date_from must be YYYY-MM-DD');
        return true;
      }),
    body('date_to')
      .optional()
      .custom((v, { req }) => {
        if (!isValidDate(v)) throw new Error('date_to must be YYYY-MM-DD');
        // cross-check only if both are provided
        const from = req.body.date_from || null;
        if (from && new Date(v) < new Date(from))
          throw new Error('date_to must be on or after date_from');
        return true;
      }),
  ],
  validate,
  async (req, res) => {
    try {
      const existing = await rangeDb.findOneAsync({ _id: req.params.id });
      if (!existing) return res.status(404).json({ error: 'Record not found' });

      const allowed  = ['label', 'notes', 'date_from', 'date_to'];
      const updates  = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }

      // Re-validate dates against each other using merged values
      const finalFrom = updates.date_from || existing.date_from;
      const finalTo   = updates.date_to   || existing.date_to;
      if (new Date(finalTo) < new Date(finalFrom)) {
        return res.status(422).json({ error: 'date_to must be on or after date_from' });
      }
      if (daysBetween(finalFrom, finalTo) > 365) {
        return res.status(422).json({ error: 'Date range cannot exceed 365 days' });
      }
      updates.days = daysBetween(finalFrom, finalTo) + 1;

      if (!Object.keys(updates).length) {
        return res.status(422).json({ error: 'No updatable fields provided (label, notes, date_from, date_to)' });
      }

      await rangeDb.updateAsync({ _id: req.params.id }, { $set: updates }, {});
      const updated = await rangeDb.findOneAsync({ _id: req.params.id });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── DELETE — DELETE /api/range/:id ────────────────────────────────────────────

router.delete(
  '/:id',
  [param('id').notEmpty()],
  validate,
  async (req, res) => {
    try {
      const count = await rangeDb.removeAsync({ _id: req.params.id }, {});
      if (!count) return res.status(404).json({ error: 'Record not found' });
      res.json({ message: 'Deleted', id: req.params.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = { router, rangeDb };
