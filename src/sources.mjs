/**
 * sources.mjs -- data adapters for USGS, NASA EONET, Open-Meteo
 *
 * Rules:
 * - Every exported function returns plain objects and never throws to the caller.
 *   On failure: return { ok: false, error: <string> }
 * - All fetch goes through cached(url, ttl) which uses the Workers Cache API (5 min).
 * - No side-effects beyond network I/O.
 */

// ---------------------------------------------------------------------------
// Cache wrapper
// ---------------------------------------------------------------------------

const DEFAULT_TTL = 300; // 5 minutes

/**
 * Fetch a URL with Cache API caching.
 * Falls back to direct fetch if caches is not available (e.g. unit tests).
 *
 * @param {string} url
 * @param {number} [ttl=300]  seconds
 * @param {object} [ctx]      Cloudflare ExecutionContext (for ctx.waitUntil)
 * @returns {Promise<Response>}
 */
async function cached(url, ttl = DEFAULT_TTL, ctx) {
  // In Workers, `caches` is the global Cache API. In tests it may be absent.
  const cache = (typeof caches !== 'undefined') ? caches.default : null;

  if (cache) {
    const cachedResp = await cache.match(url);
    if (cachedResp) return cachedResp;
  }

  const resp = await fetch(url);
  if (cache && resp.ok) {
    const toCache = new Response(resp.clone().body, resp);
    toCache.headers.set('Cache-Control', `public, max-age=${ttl}`);
    const put = cache.put(url, toCache);
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(put);
    } else {
      // fire-and-forget in tests
      put.catch(() => {});
    }
  }
  return resp;
}

// ---------------------------------------------------------------------------
// USGS earthquake feeds
// Feeds: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/
//   <threshold>_<period>.geojson
//   threshold: significant | 4.5 | 2.5 | 1.0 | all
//   period:    hour | day | week | month
// ---------------------------------------------------------------------------

const USGS_BASE = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/';

/**
 * Fetch a USGS GeoJSON earthquake feed.
 * @param {'significant'|'4.5'|'2.5'|'1.0'|'all'} threshold
 * @param {'hour'|'day'|'week'|'month'} period
 * @param {object} [ctx]
 * @returns {Promise<{ok:boolean, features: Array, metadata: object, error?: string}>}
 */
export async function usgs(threshold, period, ctx) {
  const url = `${USGS_BASE}${threshold}_${period}.geojson`;
  try {
    const resp = await cached(url, DEFAULT_TTL, ctx);
    if (!resp.ok) {
      return { ok: false, features: [], metadata: {}, error: `USGS HTTP ${resp.status}` };
    }
    const data = await resp.json();
    return {
      ok: true,
      features: Array.isArray(data.features) ? data.features : [],
      metadata: data.metadata || {},
      source: 'USGS Earthquake Hazards Program',
      url: 'earthquake.usgs.gov',
    };
  } catch (err) {
    return { ok: false, features: [], metadata: {}, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// NASA EONET v3
// ---------------------------------------------------------------------------

const EONET_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=14';

/**
 * Fetch open natural events from NASA EONET v3.
 * @param {object} [ctx]
 * @returns {Promise<{ok:boolean, events: Array, error?: string}>}
 */
export async function eonet(ctx) {
  try {
    const resp = await cached(EONET_URL, DEFAULT_TTL, ctx);
    if (!resp.ok) {
      return { ok: false, events: [], error: `EONET HTTP ${resp.status}` };
    }
    const data = await resp.json();
    return {
      ok: true,
      events: Array.isArray(data.events) ? data.events : [],
      source: 'NASA EONET',
      url: 'eonet.gsfc.nasa.gov',
    };
  } catch (err) {
    return { ok: false, events: [], error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Open-Meteo forecast
// daily: temperature_2m_max, temperature_2m_min, precipitation_sum,
//        weather_code, wind_speed_10m_max
// ---------------------------------------------------------------------------

/**
 * Fetch 7-day daily weather forecast from Open-Meteo.
 * @param {number} lat
 * @param {number} lon
 * @param {object} [ctx]
 * @returns {Promise<{ok:boolean, daily: object, timezone: string, error?: string}>}
 */
export async function forecast(lat, lon, ctx) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code,wind_speed_10m_max` +
    `&timezone=auto&forecast_days=7`;
  try {
    const resp = await cached(url, DEFAULT_TTL, ctx);
    if (!resp.ok) {
      return { ok: false, daily: {}, timezone: 'UTC', error: `Forecast HTTP ${resp.status}` };
    }
    const data = await resp.json();
    return {
      ok: true,
      daily: data.daily || {},
      timezone: data.timezone || 'UTC',
      elevation: data.elevation,
      source: 'Open-Meteo (CC BY 4.0)',
      url: 'open-meteo.com',
    };
  } catch (err) {
    return { ok: false, daily: {}, timezone: 'UTC', error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Open-Meteo air quality
// ---------------------------------------------------------------------------

/**
 * Fetch current air quality from Open-Meteo Air Quality API.
 * @param {number} lat
 * @param {number} lon
 * @param {object} [ctx]
 * @returns {Promise<{ok:boolean, current: {us_aqi:number, pm2_5:number}, error?: string}>}
 */
export async function airQuality(lat, lon, ctx) {
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=us_aqi,pm2_5`;
  try {
    const resp = await cached(url, DEFAULT_TTL, ctx);
    if (!resp.ok) {
      return { ok: false, current: {}, error: `AirQuality HTTP ${resp.status}` };
    }
    const data = await resp.json();
    return {
      ok: true,
      current: data.current || {},
      source: 'Open-Meteo Air Quality (CC BY 4.0)',
      url: 'open-meteo.com',
    };
  } catch (err) {
    return { ok: false, current: {}, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Open-Meteo geocoding
// ---------------------------------------------------------------------------

/**
 * Geocode a place name to lat/lon using Open-Meteo geocoding API.
 * @param {string} name
 * @param {object} [ctx]
 * @returns {Promise<{ok:boolean, lat:number, lon:number, name:string, country:string, timezone:string, error?: string}>}
 */
export async function geocode(name, ctx) {
  const url =
    `https://geocoding-api.open-meteo.com/v1/search` +
    `?name=${encodeURIComponent(name)}&count=1&language=en&format=json`;
  try {
    const resp = await cached(url, DEFAULT_TTL, ctx);
    if (!resp.ok) {
      return { ok: false, lat: 0, lon: 0, name: '', country: '', timezone: '', error: `Geocode HTTP ${resp.status}` };
    }
    const data = await resp.json();
    const results = data.results;
    if (!Array.isArray(results) || results.length === 0) {
      return { ok: false, lat: 0, lon: 0, name: '', country: '', timezone: '', error: 'No results' };
    }
    const r = results[0];
    return {
      ok: true,
      lat: r.latitude,
      lon: r.longitude,
      name: r.name || '',
      country: r.country || '',
      admin1: r.admin1 || '',
      timezone: r.timezone || 'UTC',
      population: r.population || 0,
    };
  } catch (err) {
    return { ok: false, lat: 0, lon: 0, name: '', country: '', timezone: '', error: String(err) };
  }
}
