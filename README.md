# GlobeWeather — Full Stack Weather Application

Real-time weather intelligence built with Python (FastAPI) + Vanilla JS.

## Repository Structure

```
pm-accelerator/                  ← repo root
│
├── app.py                       ← Render entry point (FastAPI app)
├── database.py                  ← TinyDB CRUD layer
├── weather_service.py           ← OpenWeatherMap API integration
├── export_service.py            ← JSON/CSV/XML/Markdown exporters
├── requirements.txt             ← Python dependencies
├── render.yaml                  ← Render.com deployment config
├── Procfile                     ← Railway/Heroku deployment config
│
└── weather-app/
    ├── public/                  ← Frontend (HTML/CSS/JS)
    │   ├── index.html
    │   ├── styles.css
    │   └── app.js
    │
    ├── python-server/           ← Local development server
    │   ├── main.py
    │   ├── database.py
    │   ├── weather_service.py
    │   ├── export_service.py
    │   └── requirements.txt
    │
    ├── data/                    ← TinyDB JSON files (auto-created)
    ├── .env                     ← API keys (not committed)
    └── .env.example             ← Template
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML5, CSS3, JavaScript ES2022 |
| Backend | Python 3 + FastAPI + Uvicorn |
| Database | TinyDB (embedded JSON store) |
| API | OpenWeatherMap (weather + geocoding + AQI) |
| Map | OpenStreetMap + Nominatim |

## Local Development

```bash
cd weather-app/python-server
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 3000 --reload
```

Open: http://localhost:3000

## Render Deployment

Deployed at repo root level using:
- **Build:** `pip install -r requirements.txt`
- **Start:** `uvicorn app:app --host 0.0.0.0 --port $PORT`

Environment variables required:
- `OPENWEATHER_API_KEY`
- `RENDER=true`

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/weather/search?q=` | Search by city/zip/coords |
| GET | `/api/weather/coords?lat=&lon=` | Search by GPS |
| GET | `/api/weather/history` | Search history |
| DELETE | `/api/weather/history/{id}` | Delete history item |
| GET | `/api/locations` | Saved locations |
| POST | `/api/locations` | Save location |
| PATCH | `/api/locations/{id}` | Update location |
| DELETE | `/api/locations/{id}` | Delete location |
| POST | `/api/range` | Create date-range query |
| GET | `/api/range` | List range queries |
| PATCH | `/api/range/{id}` | Update range query |
| DELETE | `/api/range/{id}` | Delete range query |
| GET | `/api/export?format=&type=` | Export data |
| GET | `/api/map?lat=&lon=` | Map proxy |
| GET | `/api/docs` | Swagger UI |
