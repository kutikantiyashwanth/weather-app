const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { queries } = require('../db');

const router = express.Router();

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ error: 'Validation failed', details: errors.array() });
  }
  next();
}

// ── GET /api/locations ─── READ all ──────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const rows = await queries.getAllLocations();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/locations ─── CREATE ───────────────────────────────────────────
router.post(
  '/',
  [
    body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 60 }),
    body('city').trim().notEmpty().withMessage('City is required'),
    body('country').trim().notEmpty().withMessage('Country is required').isLength({ min: 2, max: 2 }),
    body('lat').isFloat({ min: -90,  max: 90  }).withMessage('Invalid latitude'),
    body('lon').isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
  ],
  validate,
  async (req, res) => {
    try {
      const { name, city, country, lat, lon } = req.body;
      const location = await queries.insertLocation({ name, city, country, lat, lon });
      res.status(201).json(location);
    } catch (err) {
      if (err.status === 409) return res.status(409).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  }
);

// ── PATCH /api/locations/:id ─── UPDATE name ─────────────────────────────────
router.patch(
  '/:id',
  [
    param('id').notEmpty(),
    body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 60 }),
  ],
  validate,
  async (req, res) => {
    try {
      const count = await queries.updateLocation(req.params.id, req.body.name);
      if (!count) return res.status(404).json({ error: 'Not found' });
      const location = await queries.getLocationById(req.params.id);
      res.json(location);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── DELETE /api/locations/:id ─── DELETE ─────────────────────────────────────
router.delete(
  '/:id',
  [param('id').notEmpty()],
  validate,
  async (req, res) => {
    try {
      const count = await queries.deleteLocation(req.params.id);
      if (!count) return res.status(404).json({ error: 'Not found' });
      res.json({ message: 'Deleted', id: req.params.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
