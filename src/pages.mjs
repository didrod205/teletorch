/**
 * pages.mjs -- page builders
 *
 * buildPage(num, sub, env, ctx) is the main entry point.
 * Each builder receives pre-fetched data objects and never fetches directly.
 * All layout goes through teletext.mjs.
 */

import { pad, wrap, columns, paginate, render, blankPage, toAscii } from './teletext.mjs';
import { usgs, eonet, forecast, airQuality, geocode } from './sources.mjs';

// ---------------------------------------------------------------------------
// WMO weather code table (codes 0-99)
// Short English descriptions, ASCII only, max ~12 chars
// ---------------------------------------------------------------------------
const WMO_CODE = {
  0: 'Clear',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Icy fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Frz drizzle',
  57: 'Hvy frz drzl',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Frz rain',
  67: 'Heavy frz rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Showers',
  82: 'Heavy showers',
  85: 'Snow showers',
  86: 'Hvy snow shwrs',
  95: 'Thunderstorm',
  96: 'T-storm+hail',
  99: 'T-storm+hvy hl',
};

/**
 * Look up a WMO weather code.
 * @param {number} code
 * @returns {string}
 */
export function wmoDescription(code) {
  if (WMO_CODE[code] !== undefined) return WMO_CODE[code];
  // Interpolate for codes without explicit entries
  if (code <= 0) return 'Clear';
  if (code <= 3) return 'Cloudy';
  if (code <= 49) return 'Fog';
  if (code <= 59) return 'Drizzle';
  if (code <= 69) return 'Rain';
  if (code <= 79) return 'Snow';
  if (code <= 84) return 'Showers';
  if (code <= 94) return 'Snow showers';
  return 'Thunderstorm';
}

// ---------------------------------------------------------------------------
// US AQI category
// ---------------------------------------------------------------------------
const AQI_CATEGORIES = [
  [50,  'Good'],
  [100, 'Moderate'],
  [150, 'Sensitive grps'],
  [200, 'Unhealthy'],
  [300, 'Very unhealthy'],
  [Infinity, 'Hazardous'],
];

export function aqiCategory(aqi) {
  for (const [limit, label] of AQI_CATEGORIES) {
    if (aqi <= limit) return label;
  }
  return 'Hazardous';
}

// ---------------------------------------------------------------------------
// Haversine distance (km) between two lat/lon points
// ---------------------------------------------------------------------------

/**
 * Great-circle distance in km between two points.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number}
 */
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Shared fastext link sets
// ---------------------------------------------------------------------------
const LINKS_INDEX = [
  { color: 'red',    num: 100, label: 'INDEX' },
  { color: 'green',  num: 200, label: 'QUAKES' },
  { color: 'yellow', num: 300, label: 'EVENTS' },
  { color: 'cyan',   num: 400, label: 'WEATHER' },
];

const LINKS_QUAKE = [
  { color: 'red',    num: 100, label: 'INDEX' },
  { color: 'green',  num: 200, label: 'M4.5+' },
  { color: 'yellow', num: 201, label: 'SIG 7D' },
  { color: 'cyan',   num: 202, label: 'NEARBY' },
];

const LINKS_WEATHER = [
  { color: 'red',    num: 100, label: 'INDEX' },
  { color: 'green',  num: 400, label: 'FCST' },
  { color: 'yellow', num: 401, label: 'AQI' },
  { color: 'cyan',   num: 101, label: 'NOW' },
];

const LINKS_EVENTS = [
  { color: 'red',    num: 100, label: 'INDEX' },
  { color: 'green',  num: 300, label: 'ALL' },
  { color: 'yellow', num: 301, label: 'FIRES' },
  { color: 'cyan',   num: 302, label: 'STORMS' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a Unix ms timestamp as "HH:MM UTC" */
function fmtTime(ms) {
  if (!ms) return '?';
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} UTC`;
}

/** Format a Unix ms timestamp as short date "DD Mon" */
function fmtDate(ms) {
  if (!ms) return '?';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = new Date(ms);
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

/** Format magnitude to 1 decimal, e.g. "M4.5" */
function fmtMag(mag) {
  if (mag == null) return 'M?  ';
  return 'M' + Number(mag).toFixed(1);
}

/** Return a "SOURCE UNAVAILABLE" line set */
function unavailableLines(sourceName) {
  return [
    { text: '', color: 'white' },
    { text: 'SOURCE UNAVAILABLE', color: 'red' },
    { text: sourceName.toUpperCase(), color: 'red' },
    { text: 'TRY AGAIN LATER', color: 'red' },
  ];
}

/** Build lines for a list of earthquake features */
function quakeLines(features) {
  const lines = [];
  for (const f of features) {
    const p = f.properties || {};
    const coords = (f.geometry && f.geometry.coordinates) || [];
    const mag = fmtMag(p.mag);
    const time = fmtTime(p.time);
    const place = toAscii(String(p.place || 'Unknown location'));
    // Row 1: "M4.5  12:04 UTC  Felt: 2"
    const felt = p.felt ? ` Felt:${p.felt}` : '';
    const row1 = columns([mag, time + felt], [5, 35]);
    // Row 2: place (wrapped if long)
    const placeLines = wrap(place, 38).slice(0, 1);
    lines.push({ text: row1, color: 'yellow' });
    lines.push({ text: ' ' + placeLines[0].trimEnd(), color: 'white' });
  }
  return lines;
}

/**
 * Assemble a page object from sub-pages.
 * @param {number} num
 * @param {number} sub  1-based
 * @param {string} title
 * @param {string[][]} subpages  array of line arrays
 * @param {Array} links
 * @param {string} source
 * @param {string} fetchedAt
 * @returns {object}
 */
function assemblePage(num, sub, title, subpages, links, source, fetchedAt) {
  const total = subpages.length;
  const idx = Math.max(0, Math.min(sub - 1, total - 1));
  return {
    num,
    sub: idx + 1,
    subs: total,
    title,
    lines: subpages[idx] || [],
    links,
    source,
    fetchedAt,
  };
}

// ---------------------------------------------------------------------------
// Place helper
// ---------------------------------------------------------------------------

/**
 * Extract place from the env-like object. Returns { lat, lon, name } or null.
 * The worker passes place info through a plain JS object keyed by
 * { placeLat, placeLon, placeName }.
 */
function getPlace(env) {
  if (!env) return null;
  const lat = parseFloat(env.placeLat);
  const lon = parseFloat(env.placeLon);
  if (isNaN(lat) || isNaN(lon)) return null;
  return { lat, lon, name: String(env.placeName || '') };
}

const NO_PLACE_LINES = [
  { text: '', color: 'white' },
  { text: 'No place selected.', color: 'yellow' },
  { text: '', color: 'white' },
  { text: 'Set your location to see this page:', color: 'white' },
  { text: '', color: 'white' },
  { text: 'Add ?place=London to the URL, or', color: 'cyan' },
  { text: 'use the place form on the home screen.', color: 'cyan' },
];

// ---------------------------------------------------------------------------
// Page 100: Index
// ---------------------------------------------------------------------------

function buildPage100() {
  const lines = [
    { text: '', color: 'white' },
    { text: 'LIVE INFORMATION SERVICE', color: 'cyan' },
    { text: '', color: 'white' },
    { text: '200  Earthquakes M4.5+ past 24h', color: 'yellow' },
    { text: '201  Significant quakes past 7 days', color: 'yellow' },
    { text: '202  Nearest quakes within 1000 km', color: 'yellow' },
    { text: '', color: 'white' },
    { text: '300  Natural events (NASA EONET)', color: 'green' },
    { text: '301  Wildfires', color: 'green' },
    { text: '302  Severe storms', color: 'green' },
    { text: '303  Volcanoes', color: 'green' },
    { text: '304  Floods', color: 'green' },
    { text: '305  Other events', color: 'green' },
    { text: '', color: 'white' },
    { text: '400  7-day weather forecast', color: 'cyan' },
    { text: '401  Air quality (AQI + PM2.5)', color: 'cyan' },
    { text: '', color: 'white' },
    { text: '101  Right now at your location', color: 'white' },
    { text: '199  Sources and licences', color: 'white' },
    { text: '500  Plain-words AI digest', color: 'white' },
  ];
  return {
    num: 100, sub: 1, subs: 1,
    title: 'TELETORCH INDEX',
    lines,
    links: LINKS_INDEX,
    source: 'Teletorch',
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Page 101: Right Now
// ---------------------------------------------------------------------------

async function buildPage101(sub, env, ctx) {
  const place = getPlace(env);
  if (!place) {
    return {
      num: 101, sub: 1, subs: 1,
      title: 'RIGHT NOW',
      lines: NO_PLACE_LINES,
      links: LINKS_WEATHER,
      source: 'Teletorch',
      fetchedAt: new Date().toISOString(),
    };
  }

  const [fcResult, aqResult, quakeResult] = await Promise.all([
    forecast(place.lat, place.lon, ctx),
    airQuality(place.lat, place.lon, ctx),
    usgs('2.5', 'day', ctx),
  ]);

  const lines = [];
  const placeName = toAscii(place.name || `${place.lat},${place.lon}`);
  lines.push({ text: `Place: ${placeName}`, color: 'cyan' });
  lines.push({ text: '', color: 'white' });

  // Weather today
  if (fcResult.ok && fcResult.daily && fcResult.daily.time) {
    const d = fcResult.daily;
    const tmax = d.temperature_2m_max && d.temperature_2m_max[0];
    const tmin = d.temperature_2m_min && d.temperature_2m_min[0];
    const code = d.weather_code && d.weather_code[0];
    const wind = d.wind_speed_10m_max && d.wind_speed_10m_max[0];
    const desc = wmoDescription(code);
    lines.push({ text: 'WEATHER TODAY', color: 'yellow' });
    if (tmax != null && tmin != null) {
      lines.push({ text: `  ${desc}`, color: 'white' });
      lines.push({ text: `  High ${tmax}C  Low ${tmin}C`, color: 'white' });
      if (wind != null) lines.push({ text: `  Wind up to ${wind} km/h`, color: 'white' });
    } else {
      lines.push({ text: '  Data unavailable', color: 'red' });
    }
  } else {
    lines.push({ text: 'WEATHER: UNAVAILABLE', color: 'red' });
  }

  lines.push({ text: '', color: 'white' });

  // Air quality
  if (aqResult.ok && aqResult.current) {
    const aqi = aqResult.current.us_aqi;
    const pm = aqResult.current.pm2_5;
    const cat = aqiCategory(aqi);
    lines.push({ text: 'AIR QUALITY', color: 'yellow' });
    lines.push({ text: `  AQI ${aqi} - ${cat}`, color: 'white' });
    if (pm != null) lines.push({ text: `  PM2.5: ${pm} ug/m3`, color: 'white' });
  } else {
    lines.push({ text: 'AIR QUALITY: UNAVAILABLE', color: 'red' });
  }

  lines.push({ text: '', color: 'white' });

  // Nearest recent quake
  if (quakeResult.ok && quakeResult.features.length > 0) {
    const nearby = quakeResult.features
      .map(f => {
        const coords = f.geometry && f.geometry.coordinates;
        if (!coords) return null;
        const dist = haversine(place.lat, place.lon, coords[1], coords[0]);
        return { f, dist };
      })
      .filter(Boolean)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 1);

    if (nearby.length > 0) {
      const { f, dist } = nearby[0];
      const p = f.properties;
      lines.push({ text: 'NEAREST RECENT QUAKE', color: 'yellow' });
      lines.push({ text: `  ${fmtMag(p.mag)}  ${Math.round(dist)} km away`, color: 'white' });
      lines.push({ text: `  ${toAscii(p.place || '')}`, color: 'white' });
    }
  }

  const subpages = paginate(lines, 20);
  return assemblePage(101, sub, 'RIGHT NOW', subpages, LINKS_WEATHER,
    'USGS / Open-Meteo', new Date().toISOString());
}

// ---------------------------------------------------------------------------
// Page 199: Sources and licences
// ---------------------------------------------------------------------------

function buildPage199() {
  const lines = [
    { text: '', color: 'white' },
    { text: 'DATA SOURCES AND LICENCES', color: 'cyan' },
    { text: '', color: 'white' },
    { text: 'EARTHQUAKES', color: 'yellow' },
    { text: '  USGS Earthquake Hazards Program', color: 'white' },
    { text: '  earthquake.usgs.gov', color: 'white' },
    { text: '  Public domain', color: 'white' },
    { text: '', color: 'white' },
    { text: 'NATURAL EVENTS', color: 'yellow' },
    { text: '  NASA EONET (Earth Observatory Natural', color: 'white' },
    { text: '  Event Tracker)', color: 'white' },
    { text: '  eonet.gsfc.nasa.gov', color: 'white' },
    { text: '  NASA Open Data', color: 'white' },
    { text: '', color: 'white' },
    { text: 'WEATHER AND AIR QUALITY', color: 'yellow' },
    { text: '  Open-Meteo (CC BY 4.0)', color: 'white' },
    { text: '  open-meteo.com', color: 'white' },
    { text: '', color: 'white' },
    { text: 'AI DIGEST (PAGE 500)', color: 'yellow' },
    { text: '  Cloudflare Workers AI', color: 'white' },
  ];
  return {
    num: 199, sub: 1, subs: 1,
    title: 'SOURCES AND LICENCES',
    lines,
    links: LINKS_INDEX,
    source: 'Teletorch',
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Page 200: Earthquakes M4.5+ past 24 hours
// ---------------------------------------------------------------------------

async function buildPage200(sub, env, ctx) {
  const result = await usgs('4.5', 'day', ctx);
  if (!result.ok) {
    return {
      num: 200, sub: 1, subs: 1,
      title: 'EARTHQUAKES M4.5+ 24H',
      lines: unavailableLines('USGS'),
      links: LINKS_QUAKE,
      source: 'USGS',
      fetchedAt: new Date().toISOString(),
    };
  }

  const features = result.features.sort((a, b) =>
    (b.properties.mag || 0) - (a.properties.mag || 0));

  const header = [
    { text: `${features.length} events in past 24 hours`, color: 'cyan' },
    { text: '', color: 'white' },
  ];
  const bodyLines = features.length > 0
    ? quakeLines(features)
    : [{ text: 'No M4.5+ earthquakes in past 24h', color: 'green' }];

  const subpages = paginate([...header, ...bodyLines], 20);
  return assemblePage(200, sub, 'EARTHQUAKES M4.5+ 24H', subpages, LINKS_QUAKE,
    'USGS', new Date().toISOString());
}

// ---------------------------------------------------------------------------
// Page 201: Significant earthquakes past 7 days
// ---------------------------------------------------------------------------

async function buildPage201(sub, env, ctx) {
  const result = await usgs('significant', 'week', ctx);
  if (!result.ok) {
    return {
      num: 201, sub: 1, subs: 1,
      title: 'SIGNIFICANT QUAKES 7D',
      lines: unavailableLines('USGS'),
      links: LINKS_QUAKE,
      source: 'USGS',
      fetchedAt: new Date().toISOString(),
    };
  }

  const features = result.features.sort((a, b) =>
    (b.properties.mag || 0) - (a.properties.mag || 0));

  const header = [
    { text: `${features.length} significant events this week`, color: 'cyan' },
    { text: '', color: 'white' },
  ];
  const bodyLines = features.length > 0
    ? quakeLines(features)
    : [{ text: 'No significant earthquakes this week', color: 'green' }];

  const subpages = paginate([...header, ...bodyLines], 20);
  return assemblePage(201, sub, 'SIGNIFICANT QUAKES 7D', subpages, LINKS_QUAKE,
    'USGS', new Date().toISOString());
}

// ---------------------------------------------------------------------------
// Page 202: Nearest M2.5+ quakes within 1000 km
// ---------------------------------------------------------------------------

async function buildPage202(sub, env, ctx) {
  const place = getPlace(env);
  if (!place) {
    return {
      num: 202, sub: 1, subs: 1,
      title: 'NEARBY QUAKES',
      lines: NO_PLACE_LINES,
      links: LINKS_QUAKE,
      source: 'USGS',
      fetchedAt: new Date().toISOString(),
    };
  }

  const result = await usgs('2.5', 'week', ctx);
  if (!result.ok) {
    return {
      num: 202, sub: 1, subs: 1,
      title: 'NEARBY QUAKES',
      lines: unavailableLines('USGS'),
      links: LINKS_QUAKE,
      source: 'USGS',
      fetchedAt: new Date().toISOString(),
    };
  }

  const placeName = toAscii(place.name || `${place.lat},${place.lon}`);
  const nearby = result.features
    .map(f => {
      const coords = f.geometry && f.geometry.coordinates;
      if (!coords) return null;
      const dist = haversine(place.lat, place.lon, coords[1], coords[0]);
      return { f, dist };
    })
    .filter(r => r && r.dist <= 1000)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 30);

  const header = [
    { text: `Near ${placeName}`, color: 'cyan' },
    { text: `${nearby.length} quakes within 1000 km (7 days)`, color: 'cyan' },
    { text: '', color: 'white' },
  ];

  const bodyLines = nearby.length > 0
    ? nearby.flatMap(({ f, dist }) => {
        const p = f.properties || {};
        return [
          { text: columns([fmtMag(p.mag), fmtTime(p.time), `${Math.round(dist)}km`], [5, 12, 23]), color: 'yellow' },
          { text: ' ' + toAscii(p.place || '').slice(0, 37), color: 'white' },
        ];
      })
    : [{ text: 'No M2.5+ quakes within 1000 km', color: 'green' }];

  const subpages = paginate([...header, ...bodyLines], 20);
  return assemblePage(202, sub, 'NEARBY QUAKES', subpages, LINKS_QUAKE,
    'USGS', new Date().toISOString());
}

// ---------------------------------------------------------------------------
// EONET helpers
// ---------------------------------------------------------------------------

/** Map EONET category ids to display info */
const EONET_CATEGORIES = {
  wildfires:     { label: 'WILDFIRES',       page: 301 },
  severeStorms:  { label: 'SEVERE STORMS',   page: 302 },
  volcanoes:     { label: 'VOLCANOES',       page: 303 },
  floods:        { label: 'FLOODS',          page: 304 },
};

const LINKS_EONET_NEXT = {
  300: LINKS_EVENTS,
  301: [
    { color: 'red',    num: 100, label: 'INDEX' },
    { color: 'green',  num: 300, label: 'ALL' },
    { color: 'yellow', num: 302, label: 'STORMS' },
    { color: 'cyan',   num: 303, label: 'VOLCANS' },
  ],
  302: [
    { color: 'red',    num: 100, label: 'INDEX' },
    { color: 'green',  num: 301, label: 'FIRES' },
    { color: 'yellow', num: 303, label: 'VOLCANS' },
    { color: 'cyan',   num: 304, label: 'FLOODS' },
  ],
  303: [
    { color: 'red',    num: 100, label: 'INDEX' },
    { color: 'green',  num: 302, label: 'STORMS' },
    { color: 'yellow', num: 304, label: 'FLOODS' },
    { color: 'cyan',   num: 305, label: 'OTHER' },
  ],
  304: [
    { color: 'red',    num: 100, label: 'INDEX' },
    { color: 'green',  num: 303, label: 'VOLCANS' },
    { color: 'yellow', num: 305, label: 'OTHER' },
    { color: 'cyan',   num: 300, label: 'ALL' },
  ],
  305: [
    { color: 'red',    num: 100, label: 'INDEX' },
    { color: 'green',  num: 304, label: 'FLOODS' },
    { color: 'yellow', num: 300, label: 'ALL' },
    { color: 'cyan',   num: 400, label: 'WEATHER' },
  ],
};

const EONET_TITLES = {
  300: 'NATURAL EVENTS (EONET)',
  301: 'WILDFIRES',
  302: 'SEVERE STORMS',
  303: 'VOLCANOES',
  304: 'FLOODS',
  305: 'OTHER EVENTS',
};

function eonetLines(events) {
  const lines = [];
  for (const ev of events) {
    const title = toAscii(ev.title || 'Unknown');
    const cats = (ev.categories || []).map(c => toAscii(c.title || c.id)).join(', ');
    // Latest geometry date
    const geoms = ev.geometry || [];
    const dates = geoms.map(g => g.date || '').filter(Boolean).sort();
    const latestDate = dates.length > 0 ? dates[dates.length - 1].slice(0, 10) : '';
    lines.push({ text: `${latestDate}  ${cats}`, color: 'yellow' });
    const titleLines = wrap(title, 38).slice(0, 1);
    lines.push({ text: ' ' + titleLines[0].trimEnd(), color: 'white' });
  }
  return lines;
}

/**
 * Filter EONET events by category (for pages 301-305).
 * @param {Array} events
 * @param {string|null} categoryId  null = all
 */
function filterEonet(events, categoryId) {
  if (!categoryId) return events;
  // "other" = not in main categories
  const mainCats = Object.keys(EONET_CATEGORIES);
  if (categoryId === 'other') {
    return events.filter(ev =>
      !(ev.categories || []).some(c => mainCats.includes(c.id)));
  }
  return events.filter(ev =>
    (ev.categories || []).some(c => c.id === categoryId));
}

const EONET_CATEGORY_BY_PAGE = {
  300: null,
  301: 'wildfires',
  302: 'severeStorms',
  303: 'volcanoes',
  304: 'floods',
  305: 'other',
};

async function buildEonetPage(pageNum, sub, env, ctx) {
  const result = await eonet(ctx);
  const title = EONET_TITLES[pageNum] || 'NATURAL EVENTS';
  const links = LINKS_EONET_NEXT[pageNum] || LINKS_EVENTS;

  if (!result.ok) {
    return {
      num: pageNum, sub: 1, subs: 1,
      title,
      lines: unavailableLines('NASA EONET'),
      links,
      source: 'NASA EONET',
      fetchedAt: new Date().toISOString(),
    };
  }

  const catId = EONET_CATEGORY_BY_PAGE[pageNum];
  const filtered = filterEonet(result.events, catId);

  const header = [
    { text: `${filtered.length} open events (last 14 days)`, color: 'cyan' },
    { text: '', color: 'white' },
  ];
  const bodyLines = filtered.length > 0
    ? eonetLines(filtered)
    : [{ text: 'No events in this category', color: 'green' }];

  const subpages = paginate([...header, ...bodyLines], 20);
  return assemblePage(pageNum, sub, title, subpages, links,
    'NASA EONET', new Date().toISOString());
}

// ---------------------------------------------------------------------------
// Page 400: 7-day weather forecast
// ---------------------------------------------------------------------------

async function buildPage400(sub, env, ctx) {
  const place = getPlace(env);
  if (!place) {
    return {
      num: 400, sub: 1, subs: 1,
      title: '7-DAY WEATHER',
      lines: NO_PLACE_LINES,
      links: LINKS_WEATHER,
      source: 'Open-Meteo',
      fetchedAt: new Date().toISOString(),
    };
  }

  const result = await forecast(place.lat, place.lon, ctx);
  if (!result.ok) {
    return {
      num: 400, sub: 1, subs: 1,
      title: '7-DAY WEATHER',
      lines: unavailableLines('Open-Meteo'),
      links: LINKS_WEATHER,
      source: 'Open-Meteo',
      fetchedAt: new Date().toISOString(),
    };
  }

  const d = result.daily;
  const placeName = toAscii(place.name || `${place.lat},${place.lon}`);
  const tz = toAscii(result.timezone || 'UTC');

  const lines = [
    { text: `${placeName} (${tz})`, color: 'cyan' },
    { text: '', color: 'white' },
    // Column headers
    { text: columns(['Date', 'Hi', 'Lo', 'mm', 'kph', 'Sky'], [10, 4, 4, 5, 5, 12]), color: 'yellow' },
  ];

  const times = d.time || [];
  for (let i = 0; i < times.length; i++) {
    const date = String(times[i] || '').slice(5); // "MM-DD"
    const hi = d.temperature_2m_max ? String(Math.round(d.temperature_2m_max[i] || 0)) : '?';
    const lo = d.temperature_2m_min ? String(Math.round(d.temperature_2m_min[i] || 0)) : '?';
    const prec = d.precipitation_sum ? String((d.precipitation_sum[i] || 0).toFixed(1)) : '?';
    const wind = d.wind_speed_10m_max ? String(Math.round(d.wind_speed_10m_max[i] || 0)) : '?';
    const sky = wmoDescription(d.weather_code ? d.weather_code[i] : 0);
    lines.push({
      text: columns([date, hi, lo, prec, wind, sky], [10, 4, 4, 5, 5, 12]),
      color: 'white',
    });
  }

  lines.push({ text: '', color: 'white' });
  lines.push({ text: 'Source: Open-Meteo (CC BY 4.0)', color: 'white' });
  lines.push({ text: 'open-meteo.com', color: 'white' });

  const subpages = paginate(lines, 20);
  return assemblePage(400, sub, '7-DAY WEATHER', subpages, LINKS_WEATHER,
    'Open-Meteo (CC BY 4.0)', new Date().toISOString());
}

// ---------------------------------------------------------------------------
// Page 401: Air quality
// ---------------------------------------------------------------------------

async function buildPage401(sub, env, ctx) {
  const place = getPlace(env);
  if (!place) {
    return {
      num: 401, sub: 1, subs: 1,
      title: 'AIR QUALITY',
      lines: NO_PLACE_LINES,
      links: LINKS_WEATHER,
      source: 'Open-Meteo',
      fetchedAt: new Date().toISOString(),
    };
  }

  const result = await airQuality(place.lat, place.lon, ctx);
  if (!result.ok) {
    return {
      num: 401, sub: 1, subs: 1,
      title: 'AIR QUALITY',
      lines: unavailableLines('Open-Meteo Air Quality'),
      links: LINKS_WEATHER,
      source: 'Open-Meteo',
      fetchedAt: new Date().toISOString(),
    };
  }

  const placeName = toAscii(place.name || `${place.lat},${place.lon}`);
  const aqi = result.current.us_aqi;
  const pm = result.current.pm2_5;
  const cat = aqiCategory(aqi != null ? aqi : 0);

  const lines = [
    { text: `${placeName}`, color: 'cyan' },
    { text: '', color: 'white' },
    { text: 'CURRENT AIR QUALITY', color: 'yellow' },
    { text: '', color: 'white' },
    { text: `US AQI:  ${aqi != null ? aqi : 'N/A'}`, color: 'white' },
    { text: `Status:  ${cat}`, color: aqi != null && aqi > 150 ? 'red' : aqi != null && aqi > 100 ? 'yellow' : 'green' },
    { text: '', color: 'white' },
    { text: `PM2.5:   ${pm != null ? pm + ' ug/m3' : 'N/A'}`, color: 'white' },
    { text: '', color: 'white' },
    { text: 'AQI SCALE', color: 'yellow' },
    { text: '  0-50   Good', color: 'green' },
    { text: '  51-100 Moderate', color: 'yellow' },
    { text: '  101-150 Unhealthy for sensitive grps', color: 'yellow' },
    { text: '  151-200 Unhealthy', color: 'red' },
    { text: '  201-300 Very unhealthy', color: 'red' },
    { text: '  301+    Hazardous', color: 'red' },
    { text: '', color: 'white' },
    { text: 'Source: Open-Meteo (CC BY 4.0)', color: 'white' },
  ];

  return {
    num: 401, sub: 1, subs: 1,
    title: 'AIR QUALITY',
    lines,
    links: LINKS_WEATHER,
    source: 'Open-Meteo (CC BY 4.0)',
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Page 404: Not found
// ---------------------------------------------------------------------------

export function buildPage404(num) {
  return {
    num: num || 404,
    sub: 1, subs: 1,
    title: 'PAGE NOT IN SERVICE',
    lines: [
      { text: '', color: 'white' },
      { text: `Page ${num || '???'} is not available.`, color: 'red' },
      { text: '', color: 'white' },
      { text: 'Press 100 for the index.', color: 'yellow' },
    ],
    links: LINKS_INDEX,
    source: 'Teletorch',
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

/**
 * Build a page by number.
 * @param {number} num   3-digit page number
 * @param {number} sub   sub-page (1-based)
 * @param {object} env   Cloudflare env bindings + place info (placeLat, placeLon, placeName)
 * @param {object} ctx   Cloudflare ExecutionContext
 * @returns {Promise<object>}  page object for render()
 */
export async function buildPage(num, sub, env, ctx) {
  sub = Math.max(1, parseInt(sub, 10) || 1);

  switch (num) {
    case 100: return buildPage100();
    case 101: return buildPage101(sub, env, ctx);
    case 199: return buildPage199();
    case 200: return buildPage200(sub, env, ctx);
    case 201: return buildPage201(sub, env, ctx);
    case 202: return buildPage202(sub, env, ctx);
    case 300: return buildEonetPage(300, sub, env, ctx);
    case 301: return buildEonetPage(301, sub, env, ctx);
    case 302: return buildEonetPage(302, sub, env, ctx);
    case 303: return buildEonetPage(303, sub, env, ctx);
    case 304: return buildEonetPage(304, sub, env, ctx);
    case 305: return buildEonetPage(305, sub, env, ctx);
    case 400: return buildPage400(sub, env, ctx);
    case 401: return buildPage401(sub, env, ctx);
    default:  return buildPage404(num);
  }
}
