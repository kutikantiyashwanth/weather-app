# Skies — Full Stack Weather App

**Completes:** Tech Assessment #1 (Frontend) + Tech Assessment #2 (Backend / Full Stack)

---

## Tech Stack

| Layer    | Technology |
|----------|-----------|
| Frontend | Vanilla HTML5, CSS3, JavaScript (ES2022) — no framework |
| Backend  | Node.js + Express |
| Database | NeDB (pure-JS embedded NoSQL — zero native compilation) |
| API      | OpenWeatherMap (Current Weather, Geocoding, 5-day Forecast, One Call 3.0) |

---

## Setup

### 1. Get a free API key
Register at [openweathermap.org](https://openweathermap.org/api) and copy your key.

### 2. Create `.env`
```bash
cp .env.example .env
# then edit .env and paste your key:
OPENWEATHER_API_KEY=your_key_here
PORT=3000
```

### 3. Install & run
```bash
npm install
npm start
# visit http://localhost:3000
```

---

## Features

### Frontend (Assessment #1)
- **Responsive design** — mobile-first CSS with fluid typography (`clamp()`), flexbox, and CSS Grid
- Three dedicated breakpoints: smartphone (≤640px), tablet (≤900px), desktop (≥1100px)
- Sticky glassmorphism header with backdrop blur
- Smooth search: city name, zip code, or `lat,lon` coordinates
- One-click GPS location via the Geolocation API
- °C / °F toggle — all values re-render instantly, no refetch
- Animated hero card with current conditions
- Horizontally-scrollable 24-hour forecast strip
- 6-day daily forecast with precipitation totals
- Comfort & Safety detail cards (UV, humidity, dew point, pressure, visibility, daylight)
- Smart advisory banners (feels-like mismatch, UV warnings, heat+humidity risk, freeze alerts, low visibility, wind)
- Save/unsave locations panel (bookmarks)
- Search history panel with re-search and delete
- Toast notification system
- Full keyboard navigation + ARIA labels throughout

### Backend (Assessment #2)
**RESTful API with full CRUD on three resources:**

| Method | Route | Operation |
|--------|-------|-----------|
| GET | `/api/weather/search?q=` | Geocode + fetch + **Create** search & snapshot |
| GET | `/api/weather/coords?lat=&lon=` | Coords + fetch + **Create** search & snapshot |
| GET | `/api/weather/history` | **Read** all recent searches |
| GET | `/api/weather/history/:id` | **Read** single search + snapshot |
| DELETE | `/api/weather/history/:id` | **Delete** search + snapshot |
| GET | `/api/locations` | **Read** all saved locations |
| POST | `/api/locations` | **Create** saved location |
| PATCH | `/api/locations/:id` | **Update** location name |
| DELETE | `/api/locations/:id` | **Delete** saved location |

**Other backend highlights:**
- Input validation on every endpoint via `express-validator`
- Rate limiting: 30 requests/minute/IP (protects OpenWeatherMap quota)
- Graceful One Call 3.0 fallback (UV data available with paid plan; app works without it)
- Normalised data shape — raw API response never sent directly to client
- Data persisted across restarts in `./data/*.db` files

---

## Non-obvious things the app surfaces

1. **Feels-like temperature** — explained with a banner when the gap is ≥ 5°C
2. **UV Index** — colour-coded low → extreme with advice on sun protection
3. **Dew point** — a better comfort measure than humidity alone
4. **Local time** at the destination — critical for travellers crossing time zones
5. **Visibility** — low visibility warnings with driving safety notes
6. **Humidity × heat combo** — heat exhaustion risk banner when both are high
7. **Precipitation probability** — shown per-hour and per-day
8. **Daylight hours** — useful in high-latitude destinations with very short/long days
9. **Wind direction** — compass direction shown (N, NNE, etc.) not just speed
10. **Pressure trend** — context on whether conditions are stable or changing

---

## Project Structure

```
weather-app/
├── public/                # Frontend (Assessment #1)
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── server/                # Backend (Assessment #2)
│   ├── index.js           # Express app entry point
│   ├── db.js              # NeDB collections + query helpers
│   ├── weatherService.js  # OpenWeatherMap API integration
│   └── routes/
│       ├── weather.js     # /api/weather/* routes
│       └── locations.js   # /api/locations/* routes
├── data/                  # Auto-created; NeDB flat-file databases
├── .env.example
├── .gitignore
└── package.json
```
