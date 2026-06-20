/* ═══════════════════════════════════════════════════════
   SKIES — Full Stack Weather App  |  app.js
   Assessment #1 (Frontend) + Assessment #2 (Backend)
   ═══════════════════════════════════════════════════════ */
'use strict';

const API = '/api';

/* ─── State ──────────────────────────────────────────────────── */
const S = {
  unit: 'C',
  weather: null,
  searchId: null,
  activeRecordTab: 'range',
};

/* ─── DOM helpers ─────────────────────────────────────────────── */
const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

/* ─── Element refs ────────────────────────────────────────────── */
const searchForm      = $('searchForm');
const searchInput     = $('searchInput');
const searchError     = $('searchError');
const geoBtn          = $('geoBtn');
const unitC           = $('unitC');
const unitF           = $('unitF');
const historyBtn      = $('historyBtn');
const savedBtn        = $('savedBtn');
const rangeBtn        = $('rangeBtn');
const recordsBtn      = $('recordsBtn');
const historyPanel    = $('historyPanel');
const savedPanel      = $('savedPanel');
const recordsPanel    = $('recordsPanel');
const historyList     = $('historyList');
const savedList       = $('savedList');
const recordsList     = $('recordsList');
const overlay         = $('overlay');
const emptyState      = $('emptyState');
const welcomeGeoBtn   = $('welcomeGeoBtn');
const loadingState    = $('loadingState');
const weatherResults  = $('weatherResults');
const saveLocationBtn = $('saveLocationBtn');
const toast           = $('toast');
const toastMsg        = toast.querySelector('.toast-msg');

/* Hero */
const heroCity        = $('heroCity');
const heroCountry     = $('heroCountry');
const heroLocalTime   = $('heroLocalTime');
const heroIcon        = $('heroIcon');
const heroIconGlow    = $('heroIconGlow');
const heroDescription = $('heroDescription');
const heroTemp        = $('heroTemp');
const heroFeelsLike   = $('heroFeelsLike');
const heroTempMin     = $('heroTempMin');
const heroTempMax     = $('heroTempMax');
const heroBgLayer     = $('heroBgLayer');

/* Stats */
const metaHumidity   = $('metaHumidity');
const metaWind       = $('metaWind');
const metaUV         = $('metaUV');
const metaPressure   = $('metaPressure');
const metaVisibility = $('metaVisibility');
const metaClouds     = $('metaClouds');
const metaSunrise    = $('metaSunrise');
const metaSunset     = $('metaSunset');
const advisories     = $('advisories');

/* Sections */
const hourlyScroll   = $('hourlyScroll');
const dailyForecast  = $('dailyForecast');
const comfortDetails = $('comfortDetails');
const mapIframe      = $('mapIframe');
const mapPlaceholder = $('mapPlaceholder');
const mapOsmLink     = $('mapOsmLink');

/* Range modal */
const rangeModalOverlay = $('rangeModalOverlay');
const rangeModal        = $('rangeModal');
const rangeForm         = $('rangeForm');
const rangeLocation     = $('rangeLocation');
const rangeDateFrom     = $('rangeDateFrom');
const rangeDateTo       = $('rangeDateTo');
const rangeLabel        = $('rangeLabel');
const rangeNotes        = $('rangeNotes');
const rangeFormError    = $('rangeFormError');
const rangeSubmitBtn    = $('rangeSubmitBtn');
const rangeCancelBtn    = $('rangeCancelBtn');

/* Edit modal */
const editModalOverlay = $('editModalOverlay');
const editModal        = $('editModal');
const editForm         = $('editForm');
const editRecordId     = $('editRecordId');
const editLabel        = $('editLabel');
const editNotes        = $('editNotes');
const editDateFrom     = $('editDateFrom');
const editDateTo       = $('editDateTo');
const editFormError    = $('editFormError');

/* Export */
const exportFormat = $('exportFormat');
const exportBtn    = $('exportBtn');

/* ─── Temperature helpers ─────────────────────────────────────── */
const toF      = c  => Math.round((c * 9 / 5 + 32) * 10) / 10;
const fmt      = c  => S.unit === 'C' ? `${c}°C` : `${toF(c)}°F`;
const fmtShort = c  => S.unit === 'C' ? `${c}°`  : `${toF(c)}°`;

/* ─── Fetch wrapper ───────────────────────────────────────────── */
async function apiFetch(url, opts = {}) {
  const res  = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.detail || `HTTP ${res.status}`);
    err.status  = res.status;
    err.details = data.details || null;
    throw err;
  }
  return data;
}

/* ─── Friendly error messages ─────────────────────────────────── */
function friendlyError(err) {
  if (err.status === 404) return '🔍 Location not found. Try a different city name, zip code, or coordinates.';
  if (err.status === 422) {
    if (err.details?.length) return '⚠️ ' + err.details.map(d => d.msg || d.message).join(' · ');
    return '⚠️ ' + (err.message || 'Validation error');
  }
  if (err.status === 429) return '⏱ Too many requests. Please wait a moment and try again.';
  if (err.status >= 500)  return '🌐 Server error. The weather service may be temporarily unavailable.';
  return err.message || 'Something went wrong. Please try again.';
}

/* ════════════════════════════════════════════════════════════════
   WEATHER SEARCH
   ════════════════════════════════════════════════════════════════ */

async function searchByQuery(query) {
  const q = (query || searchInput.value || '').trim();
  if (!q) { showError('Please enter a city, zip code, landmark or coordinates.'); return; }
  clearError();
  showLoading();
  try {
    const data = await apiFetch(`${API}/weather/search?q=${encodeURIComponent(q)}`);
    S.weather  = data.weather;
    S.searchId = data.search_id;
    renderWeather(data.weather);
    loadMap(data.weather.lat, data.weather.lon, data.weather.city);
  } catch (err) {
    hideLoading();
    showError(friendlyError(err));
  }
}

async function searchByCoords(lat, lon) {
  clearError();
  showLoading();
  try {
    const data = await apiFetch(`${API}/weather/coords?lat=${lat}&lon=${lon}`);
    S.weather  = data.weather;
    S.searchId = data.search_id;
    renderWeather(data.weather);
    loadMap(data.weather.lat, data.weather.lon, data.weather.city);
  } catch (err) {
    hideLoading();
    showError(friendlyError(err));
  }
}

/* ─── Geolocation ──────────────────────────────────────────────── */
function useMyLocation() {
  if (!navigator.geolocation) {
    showError('Geolocation is not supported by your browser. Try searching by city name.');
    return;
  }
  setGeoBtnLoading(true);
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      setGeoBtnLoading(false);
      searchByCoords(coords.latitude, coords.longitude);
    },
    (err) => {
      setGeoBtnLoading(false);
      const msgs = {
        1: '🔒 Location access denied. Allow location access in your browser settings, or search by city name.',
        2: '📡 Location unavailable. Please search by city name.',
        3: '⏱ Location request timed out. Please search by city name.',
      };
      showError(msgs[err.code] || 'Could not get your location.');
    },
    { timeout: 12000, maximumAge: 300000 }
  );
}

function setGeoBtnLoading(loading) {
  [geoBtn, welcomeGeoBtn].forEach(btn => {
    if (!btn) return;
    btn.disabled = loading;
    btn.style.opacity = loading ? '0.5' : '';
  });
}

/* ════════════════════════════════════════════════════════════════
   WEATHER THEMES + PARTICLES
   ════════════════════════════════════════════════════════════════ */
const THEMES = {
  Clear:        { a:'#100400', b:'#1e0800', glow:'rgba(255,179,0,0.28)',  accent:'#ffb300', particles:true  },
  Clouds:       { a:'#08060e', b:'#0e0a18', glow:'rgba(199,36,255,0.15)', accent:'#c724ff', particles:false },
  Rain:         { a:'#020610', b:'#040a1e', glow:'rgba(41,121,255,0.22)', accent:'#2979ff', particles:true  },
  Drizzle:      { a:'#020610', b:'#040a1e', glow:'rgba(41,121,255,0.15)', accent:'#60a0ff', particles:false },
  Thunderstorm: { a:'#0a0010', b:'#14001e', glow:'rgba(199,36,255,0.35)', accent:'#c724ff', particles:true  },
  Snow:         { a:'#04080e', b:'#060e1a', glow:'rgba(200,220,255,0.2)', accent:'#c8dcff', particles:true  },
  Mist:         { a:'#080608', b:'#0e0a0e', glow:'rgba(180,120,200,0.15)',accent:'#b478c8', particles:false },
  Fog:          { a:'#080608', b:'#0e0a0e', glow:'rgba(180,120,200,0.15)',accent:'#b478c8', particles:false },
  Haze:         { a:'#100800', b:'#1c0e00', glow:'rgba(255,179,0,0.18)',  accent:'#ffb300', particles:false },
  Dust:         { a:'#120600', b:'#1e0a00', glow:'rgba(255,109,0,0.18)',  accent:'#ff6d00', particles:false },
  default:      { a:'#06030e', b:'#0c0620', glow:'rgba(199,36,255,0.15)', accent:'#c724ff', particles:false },
};

function applyTheme(condition) {
  const t = THEMES[condition] || THEMES.default;
  const r = document.documentElement;
  r.style.setProperty('--wx-a',      t.a);
  r.style.setProperty('--wx-b',      t.b);
  r.style.setProperty('--wx-glow',   t.glow);
  r.style.setProperty('--wx-accent', t.accent);
  if (heroIconGlow) heroIconGlow.style.background = t.glow;
  if (t.particles) spawnParticles(); else clearParticles();
}

let particleInterval = null;
function spawnParticles() {
  clearParticles();
  const field = $('particleField');
  if (!field) return;
  const create = () => {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.cssText = `left:${Math.random()*100}%;width:${1+Math.random()*2}px;height:${1+Math.random()*2}px;animation-duration:${6+Math.random()*10}s;animation-delay:${Math.random()*8}s;--drift:${(Math.random()-0.5)*60}px;opacity:${0.2+Math.random()*0.5}`;
    field.appendChild(p);
    setTimeout(() => p.remove(), 20000);
  };
  for (let i = 0; i < 20; i++) create();
  particleInterval = setInterval(create, 800);
}
function clearParticles() {
  if (particleInterval) { clearInterval(particleInterval); particleInterval = null; }
  const field = $('particleField');
  if (field) field.innerHTML = '';
}

/* ════════════════════════════════════════════════════════════════
   RENDER WEATHER
   ════════════════════════════════════════════════════════════════ */
function renderWeather(w) {
  hideLoading();
  emptyState.classList.add('hidden');
  weatherResults.classList.remove('hidden');

  const cur = w.current;
  applyTheme(cur.condition);

  heroCity.textContent    = w.city;
  heroCountry.textContent = w.country;

  const localMs   = Date.now() + w.timezone_offset * 1000 - new Date().getTimezoneOffset() * 60000;
  heroLocalTime.textContent = new Date(localMs).toLocaleString([], {
    weekday:'short', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit',
  });

  heroIcon.src            = `https://openweathermap.org/img/wn/${cur.condition_icon}@2x.png`;
  heroIcon.alt            = cur.description;
  heroTemp.textContent    = fmt(cur.temp);
  heroDescription.textContent = cur.description;
  heroFeelsLike.textContent   = `Feels like ${fmt(cur.feels_like)}`;
  heroTempMin.textContent = fmtShort(cur.temp_min);
  heroTempMax.textContent = fmtShort(cur.temp_max);

  metaHumidity.textContent   = `${cur.humidity}%`;
  metaWind.textContent       = `${cur.wind_speed} m/s ${cur.wind_dir}${cur.wind_gust ? ` ↑${cur.wind_gust}` : ''}`;
  metaUV.textContent         = cur.uv_index !== null ? `${cur.uv_index} · ${uvLabel(cur.uv_index)}` : 'N/A';
  metaUV.className           = `stat-value ${cur.uv_index !== null ? uvClass(cur.uv_index) : ''}`;
  metaPressure.textContent   = `${cur.pressure} hPa`;
  metaVisibility.textContent = cur.visibility != null
    ? (cur.visibility >= 1000 ? `${(cur.visibility/1000).toFixed(1)} km` : `${cur.visibility} m`) : 'N/A';
  metaClouds.textContent     = cur.cloud_cover != null ? `${cur.cloud_cover}%` : 'N/A';
  metaSunrise.textContent    = localUnix(cur.sunrise, w.timezone_offset);
  metaSunset.textContent     = localUnix(cur.sunset,  w.timezone_offset);

  renderAdvisories(cur);
  renderHourly(w.hourly, w.timezone_offset);
  renderDaily(w.daily);
  renderComfort(cur, w);
  resetBookmarkBtn();

  document.title = `${w.city} — ${fmt(cur.temp)} · GlobeWeather`;
}

function rerender() { if (S.weather) renderWeather(S.weather); }

/* ─── Advisories ───────────────────────────────────────────────── */
function renderAdvisories(cur) {
  advisories.innerHTML = '';
  const add = (emoji, text, type = 'info') => {
    const d = document.createElement('div');
    d.className = `advisory advisory--${type}`;
    d.innerHTML = `<span class="advisory-emoji" aria-hidden="true">${emoji}</span><span class="advisory-text">${text}</span>`;
    advisories.appendChild(d);
  };
  const diff = Math.abs(cur.temp - cur.feels_like);
  if (diff >= 5) {
    const dir = cur.feels_like < cur.temp ? 'colder' : 'warmer';
    add('🌡️', `Feels ${diff.toFixed(0)}° ${dir} than actual — ${dir === 'colder' ? 'wind chill' : 'humidity'} effect.`, diff >= 10 ? 'warning' : 'info');
  }
  if (cur.uv_index !== null) {
    if      (cur.uv_index >= 11) add('☀️','Extreme UV — avoid sun exposure; full SPF required.','danger');
    else if (cur.uv_index >= 8)  add('☀️','Very high UV — limit outdoor time 10am–4pm.','warning');
    else if (cur.uv_index >= 6)  add('☀️','High UV — apply SPF 30+ and wear a hat.','warning');
    else if (cur.uv_index >= 3)  add('☀️','Moderate UV — sunscreen recommended if outdoors.','info');
  }
  if (cur.temp >= 32 && cur.humidity >= 60)      add('🔥',`Heat + humidity (${cur.humidity}%) — heat exhaustion risk. Hydrate.`,'danger');
  else if (cur.temp >= 28 && cur.humidity >= 70) add('♨️','Hot and humid — feels oppressive outdoors.','warning');
  if (cur.temp <= 0)                              add('❄️','Freezing — ice possible on roads and paths.','warning');
  if (cur.wind_speed >= 17)                       add('💨',`Strong winds ${cur.wind_speed} m/s — secure loose objects.`,'warning');
  else if (cur.wind_speed >= 10)                  add('💨',`Breezy ${cur.wind_speed} m/s — jacket recommended.`,'info');
  if (cur.visibility != null && cur.visibility < 1000) add('👁️',`Low visibility (${cur.visibility}m) — drive carefully.`,'warning');
  if (cur.rain_1h > 5)      add('🌧️',`Heavy rain ${cur.rain_1h} mm/hr — waterproofs needed.`,'warning');
  else if (cur.rain_1h > 0) add('🌧️','Light rain — umbrella handy.','info');
  if (cur.snow_1h > 0)      add('🌨️','Snowfall — roads may be slippery.','warning');
  if (cur.humidity >= 80 && cur.temp >= 20) add('💧',`Very high humidity (${cur.humidity}%) — muggy outdoors.`,'warning');
  if (!advisories.children.length) add('✅','Conditions are comfortable. Great time to be outside!','info');
}

/* ─── Hourly ────────────────────────────────────────────────────── */
function renderHourly(hourly, tzOffset) {
  hourlyScroll.innerHTML = '';
  hourly.forEach((h, i) => {
    const localMs = h.time * 1000 + tzOffset * 1000 - new Date().getTimezoneOffset() * 60000;
    const label   = i === 0 ? 'Now' : new Date(localMs).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
    const el = document.createElement('div');
    el.className = `hourly-item${i === 0 ? ' hourly-now' : ''}`;
    el.setAttribute('role','listitem');
    el.innerHTML = `
      <span class="hourly-time">${label}</span>
      <img class="hourly-icon" src="https://openweathermap.org/img/wn/${h.icon}@2x.png" alt="${h.description}" loading="lazy"/>
      <span class="hourly-temp">${fmtShort(h.temp)}</span>
      ${h.pop > 10 ? `<span class="hourly-pop">💧 ${h.pop}%</span>` : '<span></span>'}
    `;
    hourlyScroll.appendChild(el);
  });
}

/* ─── Daily (6-day forecast) ────────────────────────────────────── */
function renderDaily(daily) {
  dailyForecast.innerHTML = '';
  const todayStr = new Date().toISOString().slice(0,10);
  const allMax = Math.max(...daily.map(d => d.temp_max));
  const allMin = Math.min(...daily.map(d => d.temp_min));
  const range  = allMax - allMin || 1;

  daily.forEach((d, i) => {
    const date     = new Date(d.date + 'T12:00:00Z');
    const isToday  = d.date === todayStr;
    const dayLabel = isToday ? 'Today' : i === 1 ? 'Tomorrow'
      : date.toLocaleDateString([], { weekday:'short', month:'short', day:'numeric' });
    const barLeft  = ((d.temp_min - allMin) / range * 100).toFixed(1);
    const barWidth = ((d.temp_max - d.temp_min) / range * 100).toFixed(1);

    const el = document.createElement('div');
    el.className = `daily-item${isToday ? ' daily-today' : ''}`;
    el.setAttribute('role','listitem');
    el.innerHTML = `
      <span class="daily-day">${dayLabel}</span>
      <img class="daily-icon-img" src="https://openweathermap.org/img/wn/${d.icon}@2x.png" alt="${d.condition}" loading="lazy"/>
      <span class="daily-cond-text">${d.condition.toLowerCase()}</span>
      <span class="daily-precip">${d.precipitation_mm > 0 ? `💧 ${d.precipitation_mm} mm` : ''}</span>
      <div class="daily-range">
        <span class="daily-min">${fmtShort(d.temp_min)}</span>
        <div class="daily-bar-wrap" aria-hidden="true">
          <div class="daily-bar-fill" style="margin-left:${barLeft}%;width:${barWidth}%"></div>
        </div>
        <span class="daily-max">${fmtShort(d.temp_max)}</span>
      </div>
    `;
    dailyForecast.appendChild(el);
  });
}

/* ─── Comfort tiles ─────────────────────────────────────────────── */
function renderComfort(cur, w) {
  comfortDetails.innerHTML = '';
  const tile = (label, value, context, barPct, gradient, uvCls = '') => {
    const el = document.createElement('div');
    el.className = 'comfort-tile';
    el.style.setProperty('--tile-accent', gradient || 'linear-gradient(90deg,var(--blue),var(--purple))');
    const bar = barPct != null ? `<div class="tile-bar"><div class="tile-bar-fill" style="width:${Math.min(barPct,100)}%;background:${gradient||'var(--blue)'}"></div></div>` : '';
    el.innerHTML = `<div class="tile-label">${label}</div><div class="tile-value ${uvCls}">${value}</div><div class="tile-context">${context}</div>${bar}`;
    comfortDetails.appendChild(el);
  };

  if (cur.uv_index !== null)
    tile('UV Index',`${cur.uv_index.toFixed(1)} · ${uvLabel(cur.uv_index)}`,uvAdvice(cur.uv_index),cur.uv_index/12*100,uvGradient(cur.uv_index),uvClass(cur.uv_index));

  const hDesc = cur.humidity < 30 ? 'Very dry — skin &amp; lips may crack.'
    : cur.humidity < 50 ? 'Comfortable range.' : cur.humidity < 70 ? 'Slightly humid.'
    : cur.humidity < 85 ? 'Quite humid — feels sticky.' : 'Very humid — oppressive outdoors.';
  tile('Humidity',`${cur.humidity}%`,hDesc,cur.humidity,
    cur.humidity > 70 ? 'linear-gradient(90deg,#f59e0b,#ef4444)' : 'linear-gradient(90deg,#60a5fa,#22d3ee)');

  tile('Feels Like',fmt(cur.feels_like),feelsDesc(cur.temp,cur.feels_like),null,'linear-gradient(90deg,#a78bfa,#f472b6)');

  const wDesc = cur.wind_speed < 2 ? 'Calm.' : cur.wind_speed < 6 ? 'Light breeze — pleasant.'
    : cur.wind_speed < 12 ? 'Moderate breeze.' : cur.wind_speed < 20 ? 'Strong wind — gusty.' : 'Very strong — difficult to walk into.';
  tile('Wind',`${cur.wind_speed} m/s ${cur.wind_dir}`,wDesc,Math.min(cur.wind_speed/25*100,100),'linear-gradient(90deg,#34d399,#60a5fa)');

  if (cur.visibility != null) {
    const km = cur.visibility/1000;
    const vDesc = km < 0.2 ? 'Dense fog — hazardous driving.' : km < 1 ? 'Fog — drive slowly.'
      : km < 5 ? 'Hazy.' : km < 10 ? 'Good visibility.' : 'Excellent visibility.';
    tile('Visibility',km >= 1 ? `${km.toFixed(1)} km` : `${cur.visibility} m`,vDesc,Math.min(km/20*100,100),'linear-gradient(90deg,#818cf8,#60a5fa)');
  }

  const pDesc = cur.pressure < 1000 ? 'Low — unsettled weather likely.'
    : cur.pressure < 1013 ? 'Slightly below average.' : cur.pressure < 1022
    ? 'Normal — stable conditions.' : 'High — generally clear skies.';
  tile('Pressure',`${cur.pressure} hPa`,pDesc,null,'linear-gradient(90deg,#f472b6,#a78bfa)');

  if (cur.dew_point != null) {
    const dpDesc = cur.dew_point < 10 ? 'Dry &amp; comfortable.' : cur.dew_point < 16 ? 'Comfortable.'
      : cur.dew_point < 21 ? 'Noticeable humidity.' : 'Oppressive — sweat won\'t cool you.';
    tile('Dew Point',fmt(cur.dew_point),dpDesc,null,'linear-gradient(90deg,#22d3ee,#60a5fa)');
  }

  /* Heat Index */
  if (cur.heat_index != null) {
    const hiDesc = cur.heat_index < 32 ? 'No additional caution needed.'
      : cur.heat_index < 41 ? 'Caution — fatigue possible with prolonged exposure.'
      : cur.heat_index < 54 ? '⚠️ Extreme caution — heat cramps &amp; exhaustion possible.'
      : '🚨 Danger — heat stroke likely with continued exposure.';
    tile('Heat Index', fmt(cur.heat_index), hiDesc, null, 'linear-gradient(90deg,#f97316,#ef4444)');
  }

  /* Air Quality */
  if (cur.aqi != null) {
    const aqColors = ['','linear-gradient(90deg,#34d399,#22d3ee)','linear-gradient(90deg,#a3e635,#34d399)','linear-gradient(90deg,#fbbf24,#f59e0b)','linear-gradient(90deg,#fb923c,#ef4444)','linear-gradient(90deg,#f87171,#a78bfa)'];
    const aqDesc = { 1:'Air quality is satisfactory.', 2:'Acceptable quality — minor concern for sensitive groups.', 3:'Moderate — sensitive individuals should reduce outdoor activity.', 4:'Poor — everyone may begin to experience health effects.', 5:'Very poor — health warnings; avoid outdoor activity.' };
    const pollStr = cur.pollutants ? `PM2.5: ${cur.pollutants.pm2_5}μg/m³ · PM10: ${cur.pollutants.pm10}μg/m³ · O₃: ${cur.pollutants.o3}μg/m³` : '';
    tile('Air Quality', `${cur.aqi_label} (AQI ${cur.aqi})`, `${aqDesc[cur.aqi] || ''} ${pollStr}`, cur.aqi / 5 * 100, aqColors[cur.aqi] || aqColors[3]);
  }

  const sr  = localUnix(cur.sunrise, w.timezone_offset);
  const ss  = localUnix(cur.sunset,  w.timezone_offset);
  const min = Math.round((cur.sunset - cur.sunrise) / 60);
  tile('Daylight',`${Math.floor(min/60)}h ${min%60}m`,`🌅 ${sr} — 🌇 ${ss}`,null,'linear-gradient(90deg,#fbbf24,#f97316)');
}

/* ─── UV helpers ─────────────────────────────────────────────────── */
const uvLabel    = uv => uv<3?'Low':uv<6?'Moderate':uv<8?'High':uv<11?'Very High':'Extreme';
const uvClass    = uv => uv<3?'uv-low':uv<6?'uv-mod':uv<8?'uv-high':uv<11?'uv-vhigh':'uv-extreme';
const uvGradient = uv => uv<3?'linear-gradient(90deg,#34d399,#6ee7b7)':uv<6?'linear-gradient(90deg,#fbbf24,#fde68a)':uv<8?'linear-gradient(90deg,#fb923c,#fbbf24)':uv<11?'linear-gradient(90deg,#f87171,#fb923c)':'linear-gradient(90deg,#f472b6,#a78bfa)';
const uvAdvice   = uv => uv<3?'No protection needed for brief exposures.':uv<6?'SPF 15+ if outside for long periods.':uv<8?'SPF 30+, hat &amp; shade recommended.':uv<11?'Minimise 10am–4pm exposure.':'Avoid outdoor exposure — burns in minutes.';
const feelsDesc  = (t,f) => { const d=f-t; return d<-8?'Wind chill makes it feel drastically colder.':d<-4?'Noticeably cooler due to wind chill.':d<-2?'Slightly cooler than thermometer reads.':d<2?'Matches actual temperature closely.':d<5?'Humidity adding warmth.':'Significantly hotter — stay hydrated.'; };

/* ─── Time helpers ────────────────────────────────────────────────── */
function localUnix(unix, tzOffset) {
  const ms = (unix + tzOffset - new Date().getTimezoneOffset()*60) * 1000;
  return new Date(ms).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
}
function timeAgo(isoDate) {
  if (!isoDate) return '';
  const sec = Math.floor((Date.now() - new Date(isoDate.endsWith('Z') ? isoDate : isoDate+'Z').getTime()) / 1000);
  if (sec < 60)    return 'just now';
  if (sec < 3600)  return `${Math.floor(sec/60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec/3600)}h ago`;
  return new Date(isoDate).toLocaleDateString([], { month:'short', day:'numeric' });
}

/* ════════════════════════════════════════════════════════════════
   MAP — OpenStreetMap embed (Assessment 2.2 API Integration)
   ════════════════════════════════════════════════════════════════ */
async function loadMap(lat, lon, city) {
  if (!mapIframe || !mapPlaceholder) return;
  mapPlaceholder.classList.add('hidden');
  mapIframe.classList.add('hidden');

  try {
    const data = await apiFetch(`${API}/map?lat=${lat}&lon=${lon}&city=${encodeURIComponent(city||'')}`);
    mapIframe.src = data.map_embed_url;
    mapOsmLink.href = data.osm_link;
    mapIframe.classList.remove('hidden');
  } catch (_) {
    // Fallback: build embed URL directly without API call
    const bbox = `${lon-0.15},${lat-0.10},${lon+0.15},${lat+0.10}`;
    mapIframe.src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;
    mapOsmLink.href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=11/${lat}/${lon}`;
    mapIframe.classList.remove('hidden');
  }
}

/* ════════════════════════════════════════════════════════════════
   BOOKMARK / SAVE LOCATION
   ════════════════════════════════════════════════════════════════ */
function resetBookmarkBtn() {
  saveLocationBtn.classList.remove('saved');
  saveLocationBtn.title = 'Save this location';
}
async function saveCurrentLocation() {
  if (!S.weather) return;
  const w = S.weather;
  try {
    await apiFetch(`${API}/locations`, {
      method: 'POST',
      body: JSON.stringify({ name: w.city, city: w.city, country: w.country, lat: w.lat, lon: w.lon }),
    });
    saveLocationBtn.classList.add('saved');
    toast_show(`${w.city} saved ✓`, 'success');
  } catch (err) {
    toast_show(err.status === 409 ? 'Already saved' : (err.message || 'Could not save'), err.status === 409 ? 'info' : 'error');
  }
}

/* ════════════════════════════════════════════════════════════════
   HISTORY PANEL
   ════════════════════════════════════════════════════════════════ */
async function loadHistory() {
  historyList.innerHTML = '<div class="drawer-empty"><span class="drawer-empty-icon">⏳</span>Loading…</div>';
  try {
    const rows = await apiFetch(`${API}/weather/history?limit=30`);
    if (!rows.length) {
      historyList.innerHTML = '<div class="drawer-empty"><span class="drawer-empty-icon">🕐</span>No searches yet.</div>';
      return;
    }
    historyList.innerHTML = '';
    rows.forEach((row, i) => {
      const el = document.createElement('div');
      el.className = 'history-item';
      el.style.animationDelay = `${i * 0.04}s`;
      el.setAttribute('role','listitem');
      const thumb = row.condition_icon
        ? `<img src="https://openweathermap.org/img/wn/${row.condition_icon}@2x.png" alt=""/>`
        : '<span style="font-size:1.4rem">🌍</span>';
      el.innerHTML = `
        <div class="history-thumb">${thumb}</div>
        <div class="history-info">
          <div class="history-city">${row.city}, ${row.country}</div>
          <div class="history-time">${timeAgo(row.createdAt||row.created_at)}</div>
        </div>
        <div class="history-right">
          ${row.temp_c != null ? `<span class="history-temp">${fmt(row.temp_c)}</span>` : ''}
          <button class="history-del-btn" aria-label="Remove ${row.city}" title="Remove">✕</button>
        </div>`;
      el.querySelector('.history-info').addEventListener('click', () => {
        closeAllPanels();
        searchInput.value = `${row.city}, ${row.country}`;
        searchByQuery(`${row.city}, ${row.country}`);
      });
      el.querySelector('.history-del-btn').addEventListener('click', async e => {
        e.stopPropagation();
        try {
          await apiFetch(`${API}/weather/history/${row._id||row.id}`, { method:'DELETE' });
          el.remove();
          toast_show('Removed from history', 'info');
        } catch (err) { toast_show(err.message||'Could not remove','error'); }
      });
      historyList.appendChild(el);
    });
  } catch (err) {
    historyList.innerHTML = `<div class="drawer-empty" style="color:var(--red)">⚠️ ${err.message}</div>`;
  }
}

/* ════════════════════════════════════════════════════════════════
   SAVED LOCATIONS PANEL
   ════════════════════════════════════════════════════════════════ */
async function loadSaved() {
  savedList.innerHTML = '<div class="drawer-empty"><span class="drawer-empty-icon">⏳</span>Loading…</div>';
  try {
    const rows = await apiFetch(`${API}/locations`);
    if (!rows.length) {
      savedList.innerHTML = '<div class="drawer-empty"><span class="drawer-empty-icon">⭐</span>No saved locations yet.<br>Search a city and tap the bookmark icon.</div>';
      return;
    }
    savedList.innerHTML = '';
    rows.forEach((loc, i) => {
      const el = document.createElement('div');
      el.className = 'saved-item';
      el.style.animationDelay = `${i * 0.04}s`;
      el.innerHTML = `
        <div class="saved-item-icon">📍</div>
        <button class="saved-item-btn" aria-label="Show weather for ${loc.name}">
          ${loc.name}
          <span class="saved-sub">${loc.city}, ${loc.country}</span>
        </button>
        <button class="saved-del-btn" aria-label="Remove ${loc.name}">
          <svg viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>`;
      el.querySelector('.saved-item-btn').addEventListener('click', () => {
        closeAllPanels();
        searchByCoords(loc.lat, loc.lon);
      });
      el.querySelector('.saved-del-btn').addEventListener('click', async () => {
        try {
          await apiFetch(`${API}/locations/${loc._id||loc.id}`, { method:'DELETE' });
          el.remove();
          toast_show(`${loc.name} removed`, 'info');
          if (!savedList.children.length)
            savedList.innerHTML = '<div class="drawer-empty"><span class="drawer-empty-icon">⭐</span>No saved locations.</div>';
        } catch (err) { toast_show(err.message||'Could not remove','error'); }
      });
      savedList.appendChild(el);
    });
  } catch (err) {
    savedList.innerHTML = `<div class="drawer-empty" style="color:var(--red)">⚠️ ${err.message}</div>`;
  }
}

/* ════════════════════════════════════════════════════════════════
   DATE RANGE MODAL  (Assessment 2.1 CREATE)
   ════════════════════════════════════════════════════════════════ */
function openRangeModal() {
  // Set default dates: today → today+7
  const today = new Date().toISOString().slice(0,10);
  const week  = new Date(Date.now() + 7*864e5).toISOString().slice(0,10);
  rangeDateFrom.value = today;
  rangeDateTo.value   = week;
  rangeDateFrom.min   = today;

  rangeFormError.classList.add('hidden');
  rangeFormError.textContent = '';
  rangeForm.reset();
  rangeDateFrom.value = today;
  rangeDateTo.value   = week;

  rangeModalOverlay.classList.remove('hidden');
  rangeModal.classList.remove('hidden');
  setTimeout(() => rangeModal.classList.add('modal--open'), 10);
  rangeLocation.focus();
}

function closeRangeModal() {
  rangeModal.classList.remove('modal--open');
  setTimeout(() => {
    rangeModal.classList.add('hidden');
    rangeModalOverlay.classList.add('hidden');
  }, 300);
}

function setRangeSubmitting(loading) {
  rangeSubmitBtn.disabled = loading;
  rangeSubmitBtn.querySelector('.btn-text').textContent = loading ? 'Saving…' : 'Save & Fetch Weather';
  rangeSubmitBtn.querySelector('.btn-spinner').classList.toggle('hidden', !loading);
}

rangeForm.addEventListener('submit', async e => {
  e.preventDefault();
  rangeFormError.classList.add('hidden');

  const location  = rangeLocation.value.trim();
  const date_from = rangeDateFrom.value;
  const date_to   = rangeDateTo.value;
  const label     = rangeLabel.value.trim();
  const notes     = rangeNotes.value.trim();

  // Client-side validation
  const errs = [];
  if (!location)  errs.push('Location is required.');
  if (!date_from) errs.push('Start date is required.');
  if (!date_to)   errs.push('End date is required.');
  if (date_from && date_to && date_to < date_from) errs.push('End date must be on or after start date.');
  if (errs.length) {
    showFormError(rangeFormError, errs);
    return;
  }

  setRangeSubmitting(true);
  try {
    const rec = await apiFetch(`${API}/range`, {
      method: 'POST',
      body: JSON.stringify({ location, date_from, date_to, label, notes }),
    });
    closeRangeModal();
    toast_show(`Range query saved for ${rec.city} ✓`, 'success');

    // Auto-show the record in the weather results
    S.weather  = { city:rec.city, country:rec.country, lat:rec.lat, lon:rec.lon,
                   timezone_offset:0, current:{ ...rec.snapshot, condition_icon:rec.snapshot.icon,
                   uv_index:rec.snapshot.uv_index, visibility:rec.snapshot.visibility,
                   cloud_cover:null, rain_1h:0, snow_1h:0,
                   sunrise:0, sunset:0, wind_gust:null, dew_point:null,
                   temp_min:rec.snapshot.temp_c-2, temp_max:rec.snapshot.temp_c+2 },
                   hourly:[], daily:rec.forecast||[] };
    renderWeather(S.weather);
    loadMap(rec.lat, rec.lon, rec.city);
  } catch (err) {
    const msg = err.details ? err.details.map(d=>d.msg||d.message).join('<br>') : err.message;
    showFormError(rangeFormError, [msg]);
  } finally {
    setRangeSubmitting(false);
  }
});

/* ════════════════════════════════════════════════════════════════
   RECORDS PANEL  (Assessment 2.1 READ + UPDATE + DELETE)
   ════════════════════════════════════════════════════════════════ */
function openRecordsPanel() {
  closeAllPanels(false);
  recordsPanel.classList.remove('hidden');
  overlay.classList.remove('hidden');
  loadRecords(S.activeRecordTab);
}

async function loadRecords(tab) {
  S.activeRecordTab = tab;
  recordsList.innerHTML = '<div class="records-empty"><span class="records-empty-icon">⏳</span>Loading…</div>';

  // Update tab active state
  $$('.rec-tab').forEach(t => {
    const isActive = t.dataset.tab === tab;
    t.classList.toggle('active', isActive);
    t.setAttribute('aria-selected', String(isActive));
  });

  try {
    if (tab === 'range') {
      const { rows } = await apiFetch(`${API}/range?limit=50`);
      if (!rows.length) {
        recordsList.innerHTML = '<div class="records-empty"><span class="records-empty-icon">📅</span>No date range queries yet.<br>Click "Date Range" to create one.</div>';
        return;
      }
      recordsList.innerHTML = '';
      rows.forEach((r, i) => renderRangeCard(r, i));

    } else if (tab === 'searches') {
      const rows = await apiFetch(`${API}/weather/history?limit=50`);
      if (!rows.length) {
        recordsList.innerHTML = '<div class="records-empty"><span class="records-empty-icon">🔍</span>No search history yet.</div>';
        return;
      }
      recordsList.innerHTML = '';
      rows.forEach((r, i) => renderSearchCard(r, i));

    } else if (tab === 'locations') {
      const rows = await apiFetch(`${API}/locations`);
      if (!rows.length) {
        recordsList.innerHTML = '<div class="records-empty"><span class="records-empty-icon">📍</span>No saved locations yet.</div>';
        return;
      }
      recordsList.innerHTML = '';
      rows.forEach((r, i) => renderLocationCard(r, i));
    }
  } catch (err) {
    recordsList.innerHTML = `<div class="records-empty" style="color:var(--red)">⚠️ ${err.message}</div>`;
  }
}

/* ── Range record card ─────────────────────────────────────────── */
function renderRangeCard(r, i) {
  const el = document.createElement('div');
  el.className = 'record-card';
  el.style.animationDelay = `${i * 0.05}s`;
  const snap = r.snapshot || {};

  el.innerHTML = `
    <div class="record-card-header">
      <div class="record-card-left">
        <div class="record-badge record-badge--range">${snap.icon ? `<img src="https://openweathermap.org/img/wn/${snap.icon}.png" style="width:28px" alt=""/>` : '📅'}</div>
        <div class="record-info">
          <div class="record-title">${escHtml(r.label||r.city)}</div>
          <div class="record-sub">
            <span class="record-tag record-tag--blue">📍 ${escHtml(r.city)}, ${escHtml(r.country)}</span>
            <span class="record-tag">📅 ${r.date_from} → ${r.date_to}</span>
            <span class="record-tag">${r.days} day${r.days!==1?'s':''}</span>
            <span class="record-tag" style="color:var(--ink-3)">${timeAgo(r.createdAt)}</span>
          </div>
        </div>
      </div>
      <div class="record-actions">
        <button class="rec-action-btn rec-action-btn--view" data-id="${r._id}" title="Load weather">
          <svg viewBox="0 0 12 12" fill="none"><path d="M6 1v5M1 6h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M10 2L6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg> View
        </button>
        <button class="rec-action-btn rec-action-btn--edit" data-id="${r._id}" title="Edit record">
          <svg viewBox="0 0 12 12" fill="none"><path d="M8 2l2 2L4 10H2V8L8 2z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Edit
        </button>
        <button class="rec-action-btn rec-action-btn--del" data-id="${r._id}" title="Delete record">
          <svg viewBox="0 0 12 12" fill="none"><path d="M2 3h8M5 3V2h2v1M4 5v4M8 5v4M3 3l.5 7h5L9 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Delete
        </button>
      </div>
    </div>
    <div class="record-card-body">
      <div class="record-weather-snap">
        ${snap.icon ? `<img src="https://openweathermap.org/img/wn/${snap.icon}.png" alt=""/>` : ''}
        <span class="record-weather-temp">${snap.temp_c != null ? fmt(snap.temp_c) : '—'}</span>
        <span>${escHtml(snap.description||snap.condition||'')}</span>
        ${snap.humidity != null ? `<span class="record-tag">💧 ${snap.humidity}%</span>` : ''}
        ${snap.wind_speed != null ? `<span class="record-tag">💨 ${snap.wind_speed} m/s ${snap.wind_dir||''}</span>` : ''}
      </div>
      ${r.notes ? `<div class="record-notes">"${escHtml(r.notes)}"</div>` : ''}
    </div>`;

  // View → load weather
  el.querySelector('.rec-action-btn--view').addEventListener('click', () => {
    closeAllPanels();
    searchByCoords(r.lat, r.lon);
  });
  // Edit
  el.querySelector('.rec-action-btn--edit').addEventListener('click', () => openEditModal(r));
  // Delete
  el.querySelector('.rec-action-btn--del').addEventListener('click', async () => {
    if (!confirm(`Delete record "${r.label||r.city}"?`)) return;
    try {
      await apiFetch(`${API}/range/${r._id}`, { method:'DELETE' });
      el.remove();
      toast_show('Record deleted', 'success');
      if (!recordsList.children.length)
        recordsList.innerHTML = '<div class="records-empty"><span class="records-empty-icon">📅</span>No date range queries yet.</div>';
    } catch (err) { toast_show(err.message||'Could not delete','error'); }
  });

  recordsList.appendChild(el);
}

/* ── Search record card ──────────────────────────────────────────── */
function renderSearchCard(r, i) {
  const el = document.createElement('div');
  el.className = 'record-card';
  el.style.animationDelay = `${i * 0.05}s`;
  // Set green accent for search cards
  el.style.setProperty('--card-accent', 'linear-gradient(90deg,#10b981,#06b6d4)');

  const icon = r.condition_icon
    ? `<img src="https://openweathermap.org/img/wn/${r.condition_icon}@2x.png" style="width:36px;height:36px;display:block" alt="${r.condition||''}"/>`
    : '<span style="font-size:1.6rem">🔍</span>';

  el.innerHTML = `
    <div class="record-card-header" style="align-items:flex-start;">
      <div class="record-card-left" style="flex:1;min-width:0;">
        <div class="record-badge record-badge--search">${icon}</div>
        <div class="record-info" style="min-width:0;">
          <div class="record-title">${escHtml(r.city)}, ${escHtml(r.country)}</div>
          <div class="record-sub" style="margin-top:4px;">
            <span class="record-tag record-tag--green">🔍 "${escHtml(r.query)}"</span>
            ${r.temp_c != null ? `<span class="record-tag">🌡 ${fmt(r.temp_c)}</span>` : ''}
            ${r.condition ? `<span class="record-tag">${escHtml(r.condition)}</span>` : ''}
          </div>
          <div style="margin-top:5px;font-family:var(--font-mono);font-size:var(--fs-2xs);color:var(--t-tertiary);">
            ${r.lat != null ? `📍 ${Number(r.lat).toFixed(3)}, ${Number(r.lon).toFixed(3)}` : ''}
            <span style="margin-left:0.5rem;opacity:0.6">${timeAgo(r.createdAt||r.created_at)}</span>
          </div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;padding-top:2px;">
        <button class="rec-action-btn rec-action-btn--view" title="Re-search">
          <svg viewBox="0 0 12 12" fill="none"><circle cx="5" cy="5" r="3.5" stroke="currentColor" stroke-width="1.2"/><path d="m9 9-1.5-1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg> Search
        </button>
        <button class="rec-action-btn rec-action-btn--del" title="Delete">
          <svg viewBox="0 0 12 12" fill="none"><path d="M2 3h8M5 3V2h2v1M4 5v4M8 5v4M3 3l.5 7h5L9 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Delete
        </button>
      </div>
    </div>
    <div class="record-card-body" style="margin-top:auto;">
      <div class="record-weather-snap">
        ${r.condition_icon ? `<img src="https://openweathermap.org/img/wn/${r.condition_icon}.png" alt=""/>` : ''}
        ${r.temp_c != null ? `<span class="record-weather-temp">${fmt(r.temp_c)}</span>` : ''}
        ${r.condition ? `<span style="color:var(--t-secondary);font-size:var(--fs-xs);text-transform:capitalize">${escHtml(r.condition.toLowerCase())}</span>` : ''}
      </div>
    </div>`;

  el.querySelector('.rec-action-btn--view').addEventListener('click', () => {
    closeAllPanels();
    searchInput.value = `${r.city}, ${r.country}`;
    searchByQuery(`${r.city}, ${r.country}`);
  });
  el.querySelector('.rec-action-btn--del').addEventListener('click', async () => {
    if (!confirm(`Delete this search record?`)) return;
    try {
      await apiFetch(`${API}/weather/history/${r._id||r.id}`, { method:'DELETE' });
      el.remove();
      toast_show('Search record deleted', 'success');
      if (!recordsList.querySelector('.record-card'))
        recordsList.innerHTML = '<div class="records-empty"><span class="records-empty-icon">🔍</span>No search history yet.</div>';
    } catch (err) { toast_show(err.message||'Could not delete','error'); }
  });

  recordsList.appendChild(el);
}

/* ── Location record card ────────────────────────────────────────── */
function renderLocationCard(r, i) {
  const el = document.createElement('div');
  el.className = 'record-card';
  el.style.animationDelay = `${i * 0.05}s`;
  el.innerHTML = `
    <div class="record-card-header">
      <div class="record-card-left">
        <div class="record-badge record-badge--location">📍</div>
        <div class="record-info">
          <div class="record-title">${escHtml(r.name)}</div>
          <div class="record-sub">
            <span class="record-tag record-tag--orange">${escHtml(r.city)}, ${escHtml(r.country)}</span>
            <span class="record-tag">${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}</span>
            <span class="record-tag" style="color:var(--ink-3)">${timeAgo(r.createdAt||r.created_at)}</span>
          </div>
        </div>
      </div>
      <div class="record-actions">
        <button class="rec-action-btn rec-action-btn--view" title="View weather">
          <svg viewBox="0 0 12 12" fill="none"><circle cx="6" cy="5" r="2" stroke="currentColor" stroke-width="1.2"/><path d="M6 1a4 4 0 0 1 4 4c0 3-4 7-4 7S2 8 2 5a4 4 0 0 1 4-4z" stroke="currentColor" stroke-width="1.2"/></svg> Weather
        </button>
        <button class="rec-action-btn rec-action-btn--del" title="Delete">
          <svg viewBox="0 0 12 12" fill="none"><path d="M2 3h8M5 3V2h2v1M4 5v4M8 5v4M3 3l.5 7h5L9 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Remove
        </button>
      </div>
    </div>`;

  el.querySelector('.rec-action-btn--view').addEventListener('click', () => {
    closeAllPanels();
    searchByCoords(r.lat, r.lon);
  });
  el.querySelector('.rec-action-btn--del').addEventListener('click', async () => {
    if (!confirm(`Remove "${r.name}" from saved locations?`)) return;
    try {
      await apiFetch(`${API}/locations/${r._id||r.id}`, { method:'DELETE' });
      el.remove();
      toast_show(`${r.name} removed`, 'success');
    } catch (err) { toast_show(err.message||'Could not remove','error'); }
  });

  recordsList.appendChild(el);
}

/* ════════════════════════════════════════════════════════════════
   EDIT RECORD MODAL  (Assessment 2.1 UPDATE)
   ════════════════════════════════════════════════════════════════ */
function openEditModal(record) {
  editRecordId.value  = record._id;
  editLabel.value     = record.label || '';
  editNotes.value     = record.notes || '';
  editDateFrom.value  = record.date_from || '';
  editDateTo.value    = record.date_to   || '';
  editFormError.classList.add('hidden');

  editModalOverlay.classList.remove('hidden');
  editModal.classList.remove('hidden');
  setTimeout(() => editModal.classList.add('modal--open'), 10);
  editLabel.focus();
}

function closeEditModal() {
  editModal.classList.remove('modal--open');
  setTimeout(() => {
    editModal.classList.add('hidden');
    editModalOverlay.classList.add('hidden');
  }, 300);
}

editForm.addEventListener('submit', async e => {
  e.preventDefault();
  editFormError.classList.add('hidden');

  const id        = editRecordId.value;
  const label     = editLabel.value.trim();
  const notes     = editNotes.value.trim();
  const date_from = editDateFrom.value;
  const date_to   = editDateTo.value;

  // Client-side date validation
  if (date_from && date_to && date_to < date_from) {
    showFormError(editFormError, ['End date must be on or after start date.']);
    return;
  }

  const body = {};
  if (label)     body.label     = label;
  if (notes)     body.notes     = notes;
  if (date_from) body.date_from = date_from;
  if (date_to)   body.date_to   = date_to;

  try {
    await apiFetch(`${API}/range/${id}`, { method:'PATCH', body: JSON.stringify(body) });
    closeEditModal();
    toast_show('Record updated ✓', 'success');
    // Refresh the records list
    loadRecords(S.activeRecordTab);
  } catch (err) {
    const msg = err.details ? err.details.map(d=>d.msg||d.message).join('<br>') : err.message;
    showFormError(editFormError, [msg]);
  }
});

/* ════════════════════════════════════════════════════════════════
   EXPORT  (Assessment 2.3)
   ════════════════════════════════════════════════════════════════ */
exportBtn.addEventListener('click', () => {
  const format = exportFormat.value;
  const type   = S.activeRecordTab === 'range' ? 'range'
               : S.activeRecordTab === 'searches' ? 'searches' : 'locations';
  const url = `${API}/export?format=${format}&type=${type}`;

  // Trigger browser download
  const a = document.createElement('a');
  a.href     = url;
  a.download = `skies-${type}.${format === 'markdown' ? 'md' : format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast_show(`Exporting ${type} as ${format.toUpperCase()}…`, 'info');
});

/* ════════════════════════════════════════════════════════════════
   PANEL / MODAL HELPERS
   ════════════════════════════════════════════════════════════════ */
function openPanel(panel) {
  closeAllPanels(false);
  panel.classList.remove('hidden');
  overlay.classList.remove('hidden');
  const first = panel.querySelector('button');
  if (first) first.focus();
}

function closeAllPanels(hideOverlay = true) {
  [historyPanel, savedPanel, recordsPanel].forEach(p => p.classList.add('hidden'));
  if (hideOverlay) overlay.classList.add('hidden');
}

/* ════════════════════════════════════════════════════════════════
   TOAST
   ════════════════════════════════════════════════════════════════ */
let toastTimer;
function toast_show(msg, type = 'info') {
  toastMsg.textContent = msg;
  toast.className = `toast toast--${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

/* ════════════════════════════════════════════════════════════════
   ERROR / LOADING HELPERS
   ════════════════════════════════════════════════════════════════ */
function showError(msg) {
  searchError.textContent = msg;
  searchError.style.display = 'block';
  searchInput.setAttribute('aria-invalid','true');
  const box = $('searchBox');
  if (box) { box.style.animation='none'; box.offsetHeight; box.style.animation='shake 0.4s ease'; }
}
function clearError() {
  searchError.textContent = '';
  searchInput.removeAttribute('aria-invalid');
}
function showFormError(el, msgs) {
  el.innerHTML = msgs.length === 1
    ? `⚠️ ${msgs[0]}`
    : `⚠️ Please fix the following:<ul>${msgs.map(m=>`<li>${m}</li>`).join('')}</ul>`;
  el.classList.remove('hidden');
}
function showLoading() {
  emptyState.classList.add('hidden');
  weatherResults.classList.add('hidden');
  loadingState.classList.remove('hidden');
}
function hideLoading() { loadingState.classList.add('hidden'); }

/* ── Utility ───────────────────────────────────────────────────── */
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ════════════════════════════════════════════════════════════════
   EVENT BINDINGS
   ════════════════════════════════════════════════════════════════ */

/* Search */
searchForm.addEventListener('submit', e => { e.preventDefault(); searchByQuery(); });
geoBtn.addEventListener('click', useMyLocation);
if (welcomeGeoBtn) welcomeGeoBtn.addEventListener('click', useMyLocation);

/* Unit toggle */
unitC.addEventListener('click', () => {
  if (S.unit==='C') return;
  S.unit='C'; unitC.classList.add('active'); unitC.setAttribute('aria-pressed','true');
  unitF.classList.remove('active'); unitF.setAttribute('aria-pressed','false'); rerender();
});
unitF.addEventListener('click', () => {
  if (S.unit==='F') return;
  S.unit='F'; unitF.classList.add('active'); unitF.setAttribute('aria-pressed','true');
  unitC.classList.remove('active'); unitC.setAttribute('aria-pressed','false'); rerender();
});

/* Nav panels */
historyBtn.addEventListener('click', () => { openPanel(historyPanel); loadHistory(); });
savedBtn.addEventListener('click',   () => { openPanel(savedPanel);   loadSaved();   });
rangeBtn.addEventListener('click',   openRangeModal);
recordsBtn.addEventListener('click', openRecordsPanel);

/* Drawer close buttons */
$$('.drawer-close').forEach(btn => btn.addEventListener('click', () => closeAllPanels()));

/* Overlay closes drawers only (not modals) */
overlay.addEventListener('click', closeAllPanels);

/* Bookmark */
saveLocationBtn.addEventListener('click', saveCurrentLocation);

/* Range modal close */
$('rangeModalClose').addEventListener('click', closeRangeModal);
rangeCancelBtn.addEventListener('click', closeRangeModal);
rangeModalOverlay.addEventListener('click', closeRangeModal);

/* Edit modal close */
$('editModalClose').addEventListener('click', closeEditModal);
$('editCancelBtn').addEventListener('click', closeEditModal);
editModalOverlay.addEventListener('click', closeEditModal);

/* Records tabs */
$$('.rec-tab').forEach(tab => {
  tab.addEventListener('click', () => loadRecords(tab.dataset.tab));
});

/* Keyboard */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!rangeModal.classList.contains('hidden'))  { closeRangeModal(); return; }
    if (!editModal.classList.contains('hidden'))   { closeEditModal();  return; }
    closeAllPanels();
  }
});

/* ════════════════════════════════════════════════════════════════
   DARK / LIGHT MODE TOGGLE
   ════════════════════════════════════════════════════════════════ */
(function initTheme() {
  const btn = document.getElementById('themeToggle');
  if (!btn) return; // safety guard

  const moonIcon    = btn.querySelector('.icon-moon');
  const sunIcon     = btn.querySelector('.icon-sun');
  const label       = document.getElementById('themeBtnLabel');
  const STORAGE_KEY = 'gw-theme';

  function setTheme(mode) {
    if (mode === 'light') {
      document.body.classList.add('light-mode');
      if (moonIcon) moonIcon.style.display = 'none';
      if (sunIcon)  sunIcon.style.display  = '';
      if (label)    label.textContent = 'Dark';
      btn.title = 'Switch to dark mode';
      btn.setAttribute('aria-label', 'Switch to dark mode');
    } else {
      document.body.classList.remove('light-mode');
      if (moonIcon) moonIcon.style.display = '';
      if (sunIcon)  sunIcon.style.display  = 'none';
      if (label)    label.textContent = 'Light';
      btn.title = 'Switch to light mode';
      btn.setAttribute('aria-label', 'Switch to light mode');
    }
    try { localStorage.setItem(STORAGE_KEY, mode); } catch(_) {}
  }

  // Load saved preference or system preference
  let saved;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch(_) {}
  const preferLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  setTheme(saved || (preferLight ? 'light' : 'dark'));

  btn.addEventListener('click', () => {
    const isLight = document.body.classList.contains('light-mode');
    setTheme(isLight ? 'dark' : 'light');
  });

  // React to OS-level theme change (only if no saved pref)
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
    let current;
    try { current = localStorage.getItem(STORAGE_KEY); } catch(_) {}
    if (!current) setTheme(e.matches ? 'light' : 'dark');
  });
})();
(function() {
  const s = document.createElement('style');
  s.textContent = `
    @keyframes shake {
      0%,100%{transform:translateX(0)}
      20%{transform:translateX(-6px)}
      40%{transform:translateX(6px)}
      60%{transform:translateX(-4px)}
      80%{transform:translateX(4px)}
    }`;
  document.head.appendChild(s);
})();

/* ════════════════════════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════════════════════════ */
emptyState.classList.remove('hidden');
loadingState.classList.add('hidden');
weatherResults.classList.add('hidden');
rangeModal.classList.add('hidden');
rangeModalOverlay.classList.add('hidden');
editModal.classList.add('hidden');
editModalOverlay.classList.add('hidden');



/* ════════════════════════════════════════════════════════════════
   DECCAN.AI-INSPIRED ANIMATIONS
   ════════════════════════════════════════════════════════════════ */

// ── Headline word entrance ────────────────────────────────────────
function animateHeadline() {
  const words = document.querySelectorAll('.headline-word');
  words.forEach((w, i) => {
    setTimeout(() => w.classList.add('word-visible'), 100 + i * 160);
  });
}
animateHeadline();

// ── Scroll reveal (IntersectionObserver) ─────────────────────────
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('revealed');
      revealObserver.unobserve(e.target);
    }
  });
}, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

function initReveal() {
  document.querySelectorAll('[data-reveal]').forEach(el => revealObserver.observe(el));
}
initReveal();

// ── Stagger comfort tiles on render ──────────────────────────────
const tileObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      const tiles = e.target.querySelectorAll('.comfort-tile');
      tiles.forEach((t, i) => {
        setTimeout(() => t.classList.add('tile-visible'), i * 60);
      });
      tileObserver.unobserve(e.target);
    }
  });
}, { threshold: 0.05 });

function observeComfort() {
  const mosaic = document.querySelector('.comfort-mosaic');
  if (mosaic) tileObserver.observe(mosaic);
}

// ── Stagger hourly items on render ───────────────────────────────
function animateHourly() {
  const items = document.querySelectorAll('.hourly-item');
  items.forEach((item, i) => {
    setTimeout(() => item.classList.add('item-visible'), i * 40);
  });
}

// ── Stagger daily items on render ────────────────────────────────
function animateDaily() {
  const items = document.querySelectorAll('.daily-item');
  items.forEach((item, i) => {
    setTimeout(() => item.classList.add('item-visible'), i * 60);
  });
}

// ── Stagger hero stats on render ─────────────────────────────────
function animateStats() {
  const stats = document.querySelectorAll('.hero-stat');
  stats.forEach((s, i) => {
    s.classList.remove('stat-in');
    setTimeout(() => s.classList.add('stat-in'), i * 50);
  });
}

// ── Hero city text reveal ─────────────────────────────────────────
function animateCity() {
  const cityEl = document.getElementById('heroCity');
  if (!cityEl) return;
  const text = cityEl.textContent;
  cityEl.innerHTML = `<span class="hero-city-inner">${text}</span>`;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const inner = cityEl.querySelector('.hero-city-inner');
      if (inner) inner.classList.add('city-visible');
    });
  });
}

// ── Stagger record cards ──────────────────────────────────────────
function animateRecordCards() {
  const cards = document.querySelectorAll('.record-card');
  cards.forEach((c, i) => {
    c.style.transitionDelay = `${i * 0.05}s`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => c.classList.add('card-visible'));
    });
  });
}

// ── Parallax orbs on mousemove ────────────────────────────────────
document.addEventListener('mousemove', (e) => {
  const x = (e.clientX / window.innerWidth  - 0.5) * 18;
  const y = (e.clientY / window.innerHeight - 0.5) * 18;
  const orb1 = document.querySelector('.orb-1');
  const orb2 = document.querySelector('.orb-2');
  if (orb1) orb1.style.transform = `translate(${x * 0.4}px, ${y * 0.4}px) scale(1)`;
  if (orb2) orb2.style.transform = `translate(${-x * 0.3}px, ${-y * 0.3}px) scale(1)`;
}, { passive: true });

// ── Hook into weather render to trigger animations ────────────────
const _origRenderWeather = renderWeather;
window._weatherAnimationPatch = function(w) {
  // Re-init reveal for new DOM
  setTimeout(() => {
    initReveal();
    observeComfort();
    animateHourly();
    animateDaily();
    animateStats();
    animateCity();
  }, 50);
};

// Patch renderWeather to call animation hooks
const origRenderWeather = renderWeather;
// Override via prototype isn't possible cleanly, so we hook post-render
// by observing weatherResults visibility
const resultObserver = new MutationObserver(() => {
  const results = document.getElementById('weatherResults');
  if (results && !results.classList.contains('hidden')) {
    setTimeout(() => {
      initReveal();
      observeComfort();
      animateHourly();
      animateDaily();
      animateStats();
      animateCity();
    }, 80);
  }
});
const weatherResultsEl = document.getElementById('weatherResults');
if (weatherResultsEl) {
  resultObserver.observe(weatherResultsEl, { attributes: true, attributeFilter: ['class'] });
}

// ── Hook records panel to animate cards on open ───────────────────
const origLoadRecords = loadRecords;
// Observe recordsList for child changes
const recordsObserver = new MutationObserver(() => {
  setTimeout(animateRecordCards, 30);
});
const recordsListEl = document.getElementById('recordsList');
if (recordsListEl) {
  recordsObserver.observe(recordsListEl, { childList: true });
}
