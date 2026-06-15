require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS || '') + ' --use-system-ca';

const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const weatherRoutes  = require('./routes/weather');
const locationRoutes = require('./routes/locations');
const { router: rangeRoutes } = require('./routes/range');
const exportRoutes   = require('./routes/export');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,                  // raised to 60/min to allow for new endpoints
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});
app.use('/api', apiLimiter);

// ── API Routes ────────────────────────────────────────────────────────────────

app.use('/api/weather',   weatherRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/range',     rangeRoutes);
app.use('/api/export',    exportRoutes);

// ── Map tile proxy (wraps OpenStreetMap nominatim — no API key needed) ────────
// Returns place details + a static map URL using OpenStreetMap tiles
const https = require('https');
const axios = require('axios');
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

app.get('/api/map', async (req, res) => {
  const { lat, lon, city } = req.query;
  if (!lat || !lon) return res.status(422).json({ error: 'lat and lon are required' });

  try {
    // Nominatim reverse geocode for rich place data
    const nominatim = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: { lat, lon, format: 'json', addressdetails: 1 },
      headers: { 'User-Agent': 'SkiesWeatherApp/1.0' },
      timeout: 6000,
      httpsAgent,
    });

    const place = nominatim.data;
    const zoom  = 11;

    res.json({
      display_name: place.display_name,
      address:      place.address,
      lat:          parseFloat(lat),
      lon:          parseFloat(lon),
      // OpenStreetMap iframe embed URL (no API key required)
      map_embed_url: `https://www.openstreetmap.org/export/embed.html?bbox=${parseFloat(lon)-0.15},${parseFloat(lat)-0.10},${parseFloat(lon)+0.15},${parseFloat(lat)+0.10}&layer=mapnik&marker=${lat},${lon}`,
      // Static tile URL for preview image
      tile_url: `https://tile.openstreetmap.org/${zoom}/${latToTileX(parseFloat(lat), zoom)}/${lonToTileY(parseFloat(lon), zoom)}.png`,
      osm_link:  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function latToTileX(lat, zoom) {
  return Math.floor((lat + 90) / 180 * Math.pow(2, zoom));
}
function lonToTileY(lon, zoom) {
  return Math.floor((1 - Math.log(Math.tan(lon * Math.PI / 180) + 1 / Math.cos(lon * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
}

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    apiKeyConfigured: !!process.env.OPENWEATHER_API_KEY,
    time: new Date().toISOString(),
    endpoints: [
      'GET  /api/weather/search?q=',
      'GET  /api/weather/coords?lat=&lon=',
      'GET  /api/weather/history',
      'GET  /api/weather/history/:id',
      'DEL  /api/weather/history/:id',
      'GET  /api/locations',
      'POST /api/locations',
      'PATCH /api/locations/:id',
      'DEL  /api/locations/:id',
      'POST /api/range',
      'GET  /api/range',
      'GET  /api/range/:id',
      'PATCH /api/range/:id',
      'DEL  /api/range/:id',
      'GET  /api/export?format=json|csv|xml|markdown&type=searches|range|locations',
      'GET  /api/map?lat=&lon=',
    ],
  });
});

// ── Static ────────────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// ── Error handler ─────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🌤  Skies Weather App  →  http://localhost:${PORT}`);
  console.log(`📋  API docs:          →  http://localhost:${PORT}/api/health\n`);
  if (!process.env.OPENWEATHER_API_KEY)
    console.warn('⚠️  OPENWEATHER_API_KEY not set — add it to your .env file');
});
