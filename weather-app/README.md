# GlobeWeather — Full Stack Weather Application

**Completes:** Tech Assessment #1 (Frontend) + Tech Assessment #2 (Backend / Full Stack)

---

## Technology Stack

| Layer     | Technology |
|-----------|-----------|
| Frontend  | Vanilla HTML5, CSS3, JavaScript ES2022 — no framework |
| Backend   | Python 3.13 + FastAPI |
| Server    | Uvicorn (ASGI) |
| Database  | TinyDB (NoSQL, pure Python) |
| API       | OpenWeatherMap (Current, Forecast, Geocoding, Air Pollution, One Call 2.5) |
| Map       | OpenStreetMap + Nominatim (no API key required) |
| Docs      | Swagger UI — built into FastAPI at `/api/docs` |

---

## Project Structure

```
weather-app/
│
├── public/                         ← FRONTEND (Assessment #1)
│   ├── index.html                  ← Single page application shell
│   ├── styles.css                  ← Complete CSS (no framework)
│   └── app.js                      ← All frontend JavaScript logic
│
├── python-server/                  ← BACKEND (Assessment #2)
│   ├── main.py                     ← FastAPI app + all 16 API routes
│   ├── database.py                 ← TinyDB CRUD operations
│   ├── weather_service.py          ← OpenWeatherMap API integration
│   ├── export_service.py           ← JSON/CSV/XML/Markdown exporters
│   └── requirements.txt            ← Python dependencies
│
├── data/                           ← DATABASE FILES (auto-created)
│   ├── py_searches.json            ← Search history collection
│   ├── py_snapshots.json           ← Weather snapshots collection
│   ├── py_locations.json           ← Saved locations collection
│   └── py_range_queries.json       ← Date range queries collection
│
├── .env                            ← API key configuration
├── .env.example                    ← Template for setup
└── README.md
```

---

## How to Run

### Step 1 — Configure API key
```
Edit .env:
OPENWEATHER_API_KEY=your_api_key_here
PORT=3000
```

### Step 2 — Install Python dependencies
```bash
cd weather-app/python-server
python -m pip install fastapi "uvicorn[standard]" httpx tinydb python-dotenv aiofiles python-multipart
```

### Step 3 — Start the server
```bash
python -m uvicorn main:app --host 0.0.0.0 --port 3000 --reload
```

### Step 4 — Open in browser
```
http://localhost:3000            ← The application
http://localhost:3000/api/docs   ← Swagger API documentation
http://localhost:3000/api/health ← Health check
```

---

## API Endpoints (16 total)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/health | Server health check |
| GET | /api/weather/search?q= | Search weather by any location |
| GET | /api/weather/coords?lat=&lon= | Search by GPS coordinates |
| GET | /api/weather/history | Get search history |
| GET | /api/weather/history/{id} | Get single search + snapshot |
| DELETE | /api/weather/history/{id} | Delete search record |
| GET | /api/locations | Get saved locations |
| POST | /api/locations | Save a location |
| PATCH | /api/locations/{id} | Update location name |
| DELETE | /api/locations/{id} | Delete saved location |
| POST | /api/range | Create date range query |
| GET | /api/range | Get all range queries |
| GET | /api/range/{id} | Get single range query |
| PATCH | /api/range/{id} | Update range query |
| DELETE | /api/range/{id} | Delete range query |
| GET | /api/export?format=&type= | Export as JSON/CSV/XML/Markdown |
| GET | /api/map?lat=&lon= | OpenStreetMap + reverse geocode |
| GET | /api/docs | Swagger UI |
