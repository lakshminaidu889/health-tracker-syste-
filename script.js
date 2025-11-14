/* Weather Tracker using Open-Meteo (no API key required)
   - Geocoding: https://geocoding-api.open-meteo.com/v1/search
   - Weather:   https://api.open-meteo.com/v1/forecast
   - This fetches current_weather + hourly relativehumidity_2m and matches by time.
*/

const REFRESH_INTERVAL_MS = 1000 * 60 * 5; // 5 minutes

// DOM
const cityInput = document.getElementById('city-input');
const searchBtn = document.getElementById('search-btn');
const geoBtn = document.getElementById('geo-btn');
const unitBtn = document.getElementById('unit-btn');

const tempEl = document.getElementById('temp');
const descriptionEl = document.getElementById('description');
const humidityEl = document.getElementById('humidity');
const windEl = document.getElementById('wind');
const locationEl = document.getElementById('location');
const iconEl = document.getElementById('icon');
const updatedEl = document.getElementById('updated');
const weatherCard = document.getElementById('weather-card');

let currentUnits = 'metric'; // metric = °C and m/s ; imperial will convert to °F and mph
unitBtn.textContent = '°C';
let lastCoords = null;
let refreshTimer = null;

function setLoading(loading){
  weatherCard.style.opacity = loading ? 0.6 : 1;
}

function showError(msg){
  tempEl.textContent = '--°';
  descriptionEl.textContent = 'Error';
  humidityEl.textContent = '--';
  windEl.textContent = '--';
  locationEl.textContent = msg;
  iconEl.textContent = '❗';
  updatedEl.textContent = '--';
  setLoading(false);
}

// Map Open-Meteo weathercode to description + emoji (simple)
const weatherCodeMap = {
  0:  {desc: 'Clear sky', icon:'☀️'},
  1:  {desc: 'Mainly clear', icon:'🌤️'},
  2:  {desc: 'Partly cloudy', icon:'⛅'},
  3:  {desc: 'Overcast', icon:'☁️'},
  45: {desc: 'Fog', icon:'🌫️'},
  48: {desc: 'Depositing rime fog', icon:'🌫️'},
  51: {desc: 'Light drizzle', icon:'🌦️'},
  53: {desc: 'Moderate drizzle', icon:'🌦️'},
  55: {desc: 'Dense drizzle', icon:'🌧️'},
  56: {desc: 'Light freezing drizzle', icon:'🌧️❄️'},
  57: {desc: 'Dense freezing drizzle', icon:'🌧️❄️'},
  61: {desc: 'Slight rain', icon:'🌦️'},
  63: {desc: 'Moderate rain', icon:'🌧️'},
  65: {desc: 'Heavy rain', icon:'⛈️'},
  66: {desc: 'Light freezing rain', icon:'🌧️❄️'},
  67: {desc: 'Heavy freezing rain', icon:'🌧️❄️'},
  71: {desc: 'Slight snow', icon:'🌨️'},
  73: {desc: 'Moderate snow', icon:'🌨️'},
  75: {desc: 'Heavy snow', icon:'❄️'},
  77: {desc: 'Snow grains', icon:'❄️'},
  80: {desc: 'Slight rain showers', icon:'🌦️'},
  81: {desc: 'Moderate rain showers', icon:'🌧️'},
  82: {desc: 'Violent rain showers', icon:'⛈️'},
  85: {desc: 'Slight snow showers', icon:'🌨️'},
  86: {desc: 'Heavy snow showers', icon:'❄️'},
  95: {desc: 'Thunderstorm', icon:'⛈️'},
  96: {desc: 'Thunderstorm with slight hail', icon:'⛈️❄️'},
  99: {desc: 'Thunderstorm with heavy hail', icon:'⛈️❄️'}
};

function mapWeatherCode(code){
  return weatherCodeMap[code] || {desc: 'Unknown', icon: '🌈'};
}

// Convert units when needed
function cToF(c){ return Math.round((c * 9/5) + 32); }
function msToMph(ms){ return Math.round(ms * 2.23694 * 10)/10; } // 1 m/s = 2.23694 mph

async function fetchByCoords(lat, lon){
  setLoading(true);
  lastCoords = {lat, lon};
  try {
    // Request current_weather + hourly humidity (relativehumidity_2m) with timezone auto
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=relativehumidity_2m&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Weather fetch failed');
    const data = await res.json();

    // Extract fields
    const cw = data.current_weather;
    if (!cw) throw new Error('No current weather data');
    const tempC = Math.round(cw.temperature);
    const windSpeed = (typeof cw.windspeed !== 'undefined') ? cw.windspeed : '--';
    const code = cw.weathercode;
    const timeStr = cw.time; // matches hourly.time format when timezone=auto

    // Find humidity from hourly arrays by matching time
    let humidity = '--';
    if (data.hourly && data.hourly.time && data.hourly.relativehumidity_2m) {
      const idx = data.hourly.time.indexOf(timeStr);
      if (idx !== -1) {
        humidity = data.hourly.relativehumidity_2m[idx];
      } else {
        // fallback: use last available humidity value
        humidity = data.hourly.relativehumidity_2m[data.hourly.relativehumidity_2m.length - 1];
      }
    }

    render({
      tempC,
      windSpeed,
      humidity,
      code,
      place: (data.timezone ? '' : '') // we'll set place by reverse geocode? skip - keep location from geocoding if used
    });

  } catch (err) {
    console.error(err);
    showError(err.message || 'Failed to fetch weather');
  } finally {
    setLoading(false);
    scheduleRefresh();
  }
}

async function fetchByCityName(city){
  if (!city) return;
  setLoading(true);
  try {
    // Geocode (Open-Meteo geocoding)
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
    const gres = await fetch(geoUrl);
    if (!gres.ok) throw new Error('Geocoding failed');
    const gdata = await gres.json();
    if (!gdata.results || gdata.results.length === 0) {
      throw new Error('City not found');
    }
    const place = gdata.results[0];
    const name = `${place.name}${place.admin1 ? ', ' + place.admin1 : ''}${place.country ? ', ' + place.country : ''}`;
    // fetch weather by coords
    await fetchByCoords(place.latitude, place.longitude);
    locationEl.textContent = name;
  } catch (err) {
    console.error(err);
    showError(err.message || 'Failed to find city');
  } finally {
    setLoading(false);
  }
}

function render({tempC, windSpeed, humidity, code}){
  let displayTemp = tempC;
  let windText = windSpeed + ' m/s';
  if (currentUnits === 'imperial') {
    displayTemp = cToF(tempC);
    windText = msToMph(windSpeed) + ' mph';
  } else {
    displayTemp = Math.round(tempC);
  }
  tempEl.textContent = `${displayTemp}°`;
  const wc = mapWeatherCode(code);
  descriptionEl.textContent = wc.desc;
  iconEl.textContent = wc.icon;
  humidityEl.textContent = (typeof humidity !== 'undefined') ? `${humidity}%` : '--';
  windEl.textContent = windText;
  updatedEl.textContent = 'Last updated: ' + new Date().toLocaleString();
  // locationEl is set either by geolocation reverse (below) or geocoding step
  if (!locationEl.textContent || locationEl.textContent === 'Unknown' || locationEl.textContent.includes('Please')) {
    locationEl.textContent = `Lat ${lastCoords ? lastCoords.lat.toFixed(2) : '--'}, Lon ${lastCoords ? lastCoords.lon.toFixed(2) : '--'}`;
  }
}

function scheduleRefresh(){
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (lastCoords) {
      fetchByCoords(lastCoords.lat, lastCoords.lon);
    }
  }, REFRESH_INTERVAL_MS);
}

/* Geolocation flow
   - Use navigator.geolocation to get coords, then call fetchByCoords.
   - Also attempt a reverse geocode (optional): use geocoding reverse by lat/lon (Open-Meteo supports reverse via same endpoint with name? We'll use the "reverse" search by using the geocoding endpoint with 'latitude' 'longitude' params)
*/
function tryGeolocation(){
  if (!navigator.geolocation) {
    showError('Geolocation not supported');
    return;
  }
  setLoading(true);
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    lastCoords = {lat, lon};
    // reverse geocode to get nice name (Open-Meteo geocoding supports lat/lon lookup via 'reverse' search using same endpoint)
    try {
      const reverseUrl = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&count=1`;
      const rres = await fetch(reverseUrl);
      if (rres.ok) {
        const rdata = await rres.json();
        if (rdata && rdata.results && rdata.results.length > 0) {
          const p = rdata.results[0];
          locationEl.textContent = `${p.name}${p.admin1 ? ', ' + p.admin1 : ''}${p.country ? ', ' + p.country : ''}`;
        } else {
          locationEl.textContent = `Lat ${lat.toFixed(2)}, Lon ${lon.toFixed(2)}`;
        }
      } else {
        locationEl.textContent = `Lat ${lat.toFixed(2)}, Lon ${lon.toFixed(2)}`;
      }
    } catch(e){
      locationEl.textContent = `Lat ${lat.toFixed(2)}, Lon ${lon.toFixed(2)}`;
    }
    await fetchByCoords(lat, lon);
  }, err => {
    console.warn('Geolocation error', err);
    setLoading(false);
    showError('Location denied or unavailable — try searching a city.');
  }, { enableHighAccuracy: false, timeout: 10000 });
}

/* Event listeners */
searchBtn.addEventListener('click', () => {
  const city = cityInput.value.trim();
  if (!city) return;
  locationEl.textContent = 'Searching...';
  fetchByCityName(city);
});
cityInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchBtn.click();
});
geoBtn.addEventListener('click', () => {
  tryGeolocation();
});
unitBtn.addEventListener('click', () => {
  currentUnits = (currentUnits === 'metric') ? 'imperial' : 'metric';
  unitBtn.textContent = currentUnits === 'metric' ? '°C' : '°F';
  // re-render using lastCoords
  if (lastCoords) fetchByCoords(lastCoords.lat, lastCoords.lon);
});

/* Init: try geolocation, fallback to Hyderabad after 4s if nothing */
(function init(){
  tryGeolocation();

  // fallback default city
  setTimeout(() => {
    if (locationEl.textContent === 'Unknown' || locationEl.textContent.includes('denied') || locationEl.textContent.includes('Please')) {
      // use a friendly default city
      fetchByCityName('Hyderabad');
    }
  }, 4000);
})();
