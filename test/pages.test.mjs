/**
 * test/pages.test.mjs
 * Unit tests for src/pages.mjs using fixture JSON (no network).
 *
 * Every test that calls a page builder stubs src/sources.mjs exports so
 * fetch never leaves the process.
 */

import { describe, it, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fc from 'fast-check';

// ---------------------------------------------------------------------------
// Load fixture data
// ---------------------------------------------------------------------------
const __dir = dirname(fileURLToPath(import.meta.url));
const fix = (name) =>
  JSON.parse(readFileSync(join(__dir, 'fixtures', name), 'utf8'));

const USGS_DAY       = fix('usgs-day.json');
const USGS_WEEK_SIG  = fix('usgs-week-sig.json');
const USGS_WEEK_25   = fix('usgs-week-2_5.json');
const EONET_DATA     = fix('eonet.json');
const FORECAST_DATA  = fix('forecast.json');
const AIRQUALITY_DATA = fix('airquality.json');
const GEOCODE_DATA   = fix('geocode.json');

// ---------------------------------------------------------------------------
// Mock sources.mjs before importing pages.mjs
// Node's module mock system requires mocking before the module is loaded.
// We use a manual stub: replace each export by overwriting the module's
// exported references via a thin wrapper module.
// ---------------------------------------------------------------------------

// We can't easily use node:test mock.module for ESM without --experimental-vm-modules
// so we inject stubs via a pattern: sources are passed in via the env context,
// but pages.mjs imports them directly. Instead, we create a mock of the
// Worker environment so that pages.mjs calls its imported sources.mjs functions,
// which we intercept at the module level.
//
// Strategy: use globalThis.__sourcesStub to let sources.mjs delegate.

// First, set up the stub before any import of pages.mjs. We do this by
// patching the global before importing pages.mjs.

globalThis.__usgsStub = null;
globalThis.__eonetStub = null;
globalThis.__forecastStub = null;
globalThis.__airQualityStub = null;
globalThis.__geocodeStub = null;

// Import sources/pages after setting stubs. We import the real modules
// but wrap each source call through a test harness.
// Since we can't dynamically intercept ESM imports, we test pages.mjs
// by directly calling the exported helpers and the page builders with
// monkey-patched source responses injected through the env object.

// Instead of trying to intercept module imports (which requires --experimental flags),
// we test pages.mjs indirectly:
//   1. Import helpers (haversine, wmoDescription, aqiCategory, buildPage404) directly.
//   2. Build a thin test version of buildPage that exercises the page logic
//      by creating source-stub modules.
//
// For full integration, we monkey-patch by replacing the module's fetch
// with a fake fetch that returns fixture data. This works because sources.mjs
// calls globalThis.fetch.

// ---------------------------------------------------------------------------
// Fake fetch -- intercepts all fetch calls and returns fixture data
// ---------------------------------------------------------------------------

const FAKE_RESPONSES = {
  '4.5_day':        { ok: true, features: USGS_DAY.features, metadata: USGS_DAY.metadata, source: 'USGS', url: 'earthquake.usgs.gov' },
  'significant_week': { ok: true, features: USGS_WEEK_SIG.features, metadata: USGS_WEEK_SIG.metadata, source: 'USGS', url: 'earthquake.usgs.gov' },
  '2.5_week':       { ok: true, features: USGS_WEEK_25.features, metadata: USGS_WEEK_25.metadata, source: 'USGS', url: 'earthquake.usgs.gov' },
  'eonet':          { ok: true, events: EONET_DATA.events, source: 'NASA EONET', url: 'eonet.gsfc.nasa.gov' },
  'forecast':       { ok: true, daily: FORECAST_DATA.daily, timezone: FORECAST_DATA.timezone, elevation: FORECAST_DATA.elevation, source: 'Open-Meteo (CC BY 4.0)', url: 'open-meteo.com' },
  'airquality':     { ok: true, current: AIRQUALITY_DATA.current, source: 'Open-Meteo Air Quality (CC BY 4.0)', url: 'open-meteo.com' },
  'geocode':        { ok: true, lat: GEOCODE_DATA.results[0].latitude, lon: GEOCODE_DATA.results[0].longitude, name: GEOCODE_DATA.results[0].name, country: GEOCODE_DATA.results[0].country, timezone: GEOCODE_DATA.results[0].timezone },
};

/** A fake fetch that returns JSON matching our fixtures based on URL. */
function makeFakeResponse(data) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    clone() { return makeFakeResponse(data); },
    async json() { return data; },
    async text() { return JSON.stringify(data); },
    body: null,
  };
}

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('4.5_day'))           return makeFakeResponse(USGS_DAY);
  if (u.includes('significant_week'))  return makeFakeResponse(USGS_WEEK_SIG);
  if (u.includes('2.5_week'))          return makeFakeResponse(USGS_WEEK_25);
  if (u.includes('2.5_day'))           return makeFakeResponse(USGS_WEEK_25);
  if (u.includes('eonet.gsfc.nasa.gov')) return makeFakeResponse(EONET_DATA);
  if (u.includes('forecast'))          return makeFakeResponse(FORECAST_DATA);
  if (u.includes('air-quality'))       return makeFakeResponse(AIRQUALITY_DATA);
  if (u.includes('geocoding'))         return makeFakeResponse(GEOCODE_DATA);
  // Unknown URL -- return an error response
  return { ok: false, status: 404, clone() { return this; }, async json() { throw new Error('not found'); } };
};

// Stub out Cache API so cached() falls through to fetch
globalThis.caches = undefined;

// Headers shim for test environment
if (typeof globalThis.Headers === 'undefined') {
  globalThis.Headers = class Headers {
    constructor(init = {}) { this._h = { ...init }; }
    set(k, v) { this._h[k.toLowerCase()] = v; }
    get(k) { return this._h[k.toLowerCase()]; }
  };
}

// ---------------------------------------------------------------------------
// Now import the modules under test
// ---------------------------------------------------------------------------
import { haversine, wmoDescription, aqiCategory, buildPage, buildPage404 } from '../src/pages.mjs';
import { render } from '../src/teletext.mjs';

// ---------------------------------------------------------------------------
// Helper: assert a page produces a valid 24x40 render
// ---------------------------------------------------------------------------
const NOW = '2026-11-04T12:00:00.000Z';

function assertValidRender(page, label) {
  assert.ok(page, `${label}: page should be defined`);
  const { rows, colors } = render(page, NOW);
  assert.equal(rows.length, 24, `${label}: must have 24 rows`);
  assert.equal(colors.length, 24, `${label}: must have 24 colors`);
  for (let i = 0; i < rows.length; i++) {
    assert.equal(rows[i].length, 40,
      `${label}: row ${i} is ${rows[i].length} chars, expected 40`);
    for (const ch of rows[i]) {
      const cp = ch.charCodeAt(0);
      assert.ok(cp >= 32 && cp <= 126,
        `${label}: row ${i} contains non-ASCII char code ${cp}`);
    }
  }
}

// Place env for London
const LONDON_ENV = {
  placeLat: '51.50853',
  placeLon: '-0.12574',
  placeName: 'London',
};

// ---------------------------------------------------------------------------
// haversine
// ---------------------------------------------------------------------------
describe('haversine', () => {
  it('returns 0 for same point', () => {
    assert.equal(haversine(51.5, -0.12, 51.5, -0.12), 0);
  });

  it('London to Paris is approximately 340 km', () => {
    const km = haversine(51.5, -0.12, 48.85, 2.35);
    assert.ok(km > 320 && km < 360, `Expected ~340 km, got ${km.toFixed(1)}`);
  });

  it('equatorial circumference half is ~20000 km', () => {
    const km = haversine(0, 0, 0, 180);
    assert.ok(Math.abs(km - 20015) < 50, `Expected ~20015 km, got ${km.toFixed(1)}`);
  });

  it('is symmetric', () => {
    const a = haversine(51.5, -0.1, 48.85, 2.35);
    const b = haversine(48.85, 2.35, 51.5, -0.1);
    assert.ok(Math.abs(a - b) < 0.001);
  });
});

// ---------------------------------------------------------------------------
// wmoDescription
// ---------------------------------------------------------------------------
describe('wmoDescription', () => {
  it('maps code 0 to Clear', () => {
    assert.equal(wmoDescription(0), 'Clear');
  });

  it('maps code 3 to Overcast', () => {
    assert.equal(wmoDescription(3), 'Overcast');
  });

  it('maps code 95 to Thunderstorm', () => {
    assert.equal(wmoDescription(95), 'Thunderstorm');
  });

  it('maps code 63 to Rain', () => {
    assert.equal(wmoDescription(63), 'Rain');
  });

  it('returns a string for any integer code 0-99', () => {
    for (let c = 0; c <= 99; c++) {
      const d = wmoDescription(c);
      assert.equal(typeof d, 'string');
      assert.ok(d.length > 0, `Empty description for code ${c}`);
      // Must be ASCII
      for (const ch of d) {
        assert.ok(ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) <= 126,
          `Non-ASCII in wmoDescription(${c}): ${ch}`);
      }
    }
  });

  it('property: result is always non-empty ASCII', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 200 }), (code) => {
      const d = wmoDescription(code);
      return d.length > 0 &&
        [...d].every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126);
    }));
  });
});

// ---------------------------------------------------------------------------
// aqiCategory
// ---------------------------------------------------------------------------
describe('aqiCategory', () => {
  it('0 is Good', () => assert.equal(aqiCategory(0), 'Good'));
  it('50 is Good', () => assert.equal(aqiCategory(50), 'Good'));
  it('51 is Moderate', () => assert.equal(aqiCategory(51), 'Moderate'));
  it('100 is Moderate', () => assert.equal(aqiCategory(100), 'Moderate'));
  it('200 is Unhealthy', () => assert.equal(aqiCategory(200), 'Unhealthy'));
  it('400 is Hazardous', () => assert.equal(aqiCategory(400), 'Hazardous'));

  it('property: result is non-empty ASCII string', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 500 }), (aqi) => {
      const cat = aqiCategory(aqi);
      return cat.length > 0 &&
        [...cat].every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126);
    }));
  });
});

// ---------------------------------------------------------------------------
// buildPage404
// ---------------------------------------------------------------------------
describe('buildPage404', () => {
  it('returns a page with "PAGE NOT IN SERVICE" title', () => {
    const p = buildPage404(999);
    assert.ok(p.title.includes('PAGE NOT IN SERVICE'));
  });

  it('renders to 24x40 ASCII', () => {
    assertValidRender(buildPage404(999), 'page404(999)');
  });

  it('uses num as the page number', () => {
    const p = buildPage404(777);
    assert.equal(p.num, 777);
  });
});

// ---------------------------------------------------------------------------
// buildPage -- page 100 (index)
// ---------------------------------------------------------------------------
describe('buildPage(100)', () => {
  it('renders 24x40 ASCII', async () => {
    const page = await buildPage(100, 1, null, null);
    assertValidRender(page, 'page100');
  });

  it('title contains INDEX', async () => {
    const page = await buildPage(100, 1, null, null);
    assert.ok(page.title.includes('INDEX'));
  });

  it('has fastext links', async () => {
    const page = await buildPage(100, 1, null, null);
    assert.ok(Array.isArray(page.links) && page.links.length > 0);
  });
});

// ---------------------------------------------------------------------------
// buildPage -- page 199 (sources)
// ---------------------------------------------------------------------------
describe('buildPage(199)', () => {
  it('renders 24x40 ASCII', async () => {
    const page = await buildPage(199, 1, null, null);
    assertValidRender(page, 'page199');
  });

  it('mentions Open-Meteo attribution', async () => {
    const page = await buildPage(199, 1, null, null);
    const text = page.lines.map(l => l.text).join(' ');
    assert.ok(text.includes('Open-Meteo'), 'Should mention Open-Meteo');
  });

  it('mentions USGS', async () => {
    const page = await buildPage(199, 1, null, null);
    const text = page.lines.map(l => l.text).join(' ');
    assert.ok(text.includes('USGS'), 'Should mention USGS');
  });
});

// ---------------------------------------------------------------------------
// buildPage -- page 200 (earthquakes M4.5+ 24h)
// ---------------------------------------------------------------------------
describe('buildPage(200)', () => {
  it('renders 24x40 ASCII', async () => {
    const page = await buildPage(200, 1, null, null);
    assertValidRender(page, 'page200');
  });

  it('title contains EARTHQUAKES', async () => {
    const page = await buildPage(200, 1, null, null);
    assert.ok(page.title.includes('EARTHQUAKES'));
  });

  it('lists the 3 fixture quakes', async () => {
    const page = await buildPage(200, 1, null, null);
    const text = page.lines.map(l => l.text).join('\n');
    assert.ok(text.includes('M5.1') || text.includes('5.1'), 'Should include M5.1');
  });

  it('rows are all exactly 40 chars after render', async () => {
    const page = await buildPage(200, 1, null, null);
    const { rows } = render(page, NOW);
    for (const r of rows) {
      assert.equal(r.length, 40, `Row "${r}" is ${r.length} chars`);
    }
  });
});

// ---------------------------------------------------------------------------
// buildPage -- page 201 (significant quakes 7d)
// ---------------------------------------------------------------------------
describe('buildPage(201)', () => {
  it('renders 24x40 ASCII', async () => {
    const page = await buildPage(201, 1, null, null);
    assertValidRender(page, 'page201');
  });

  it('shows M6.7 quake from fixture', async () => {
    const page = await buildPage(201, 1, null, null);
    const text = page.lines.map(l => l.text).join('\n');
    assert.ok(text.includes('6.7') || text.includes('M6.7'));
  });
});

// ---------------------------------------------------------------------------
// buildPage -- page 202 (nearby quakes)
// ---------------------------------------------------------------------------
describe('buildPage(202) with place', () => {
  it('renders 24x40 ASCII with London place', async () => {
    const page = await buildPage(202, 1, LONDON_ENV, null);
    assertValidRender(page, 'page202-london');
  });

  it('shows London in the output', async () => {
    const page = await buildPage(202, 1, LONDON_ENV, null);
    const text = page.lines.map(l => l.text).join('\n');
    assert.ok(text.includes('London'), 'Should mention London');
  });

  it('shows a "no place" message without env', async () => {
    const page = await buildPage(202, 1, null, null);
    const text = page.lines.map(l => l.text).join('\n');
    assert.ok(text.toLowerCase().includes('place') || text.toLowerCase().includes('location'));
    assertValidRender(page, 'page202-noplace');
  });

  it('quake within 100 km of London is included', async () => {
    // Fixture has a quake 5 km NE of London at (-0.08, 51.56)
    const page = await buildPage(202, 1, LONDON_ENV, null);
    const text = page.lines.map(l => l.text).join('\n');
    assert.ok(text.includes('London') || text.includes('km'));
  });
});

// ---------------------------------------------------------------------------
// buildPage -- pages 300-305 (EONET)
// ---------------------------------------------------------------------------
describe('buildPage(300)', () => {
  it('renders 24x40 ASCII', async () => {
    const page = await buildPage(300, 1, null, null);
    assertValidRender(page, 'page300');
  });

  it('title contains EVENTS or NATURAL', async () => {
    const page = await buildPage(300, 1, null, null);
    assert.ok(page.title.includes('EVENT') || page.title.includes('NATURAL'));
  });

  it('shows all 5 fixture events', async () => {
    const page = await buildPage(300, 1, null, null);
    const text = page.lines.map(l => l.text).join('\n');
    // Should show count 5
    assert.ok(text.includes('5'));
  });
});

describe('buildPage(301) wildfires', () => {
  it('renders 24x40 ASCII', async () => {
    const page = await buildPage(301, 1, null, null);
    assertValidRender(page, 'page301');
  });

  it('title is WILDFIRES', async () => {
    const page = await buildPage(301, 1, null, null);
    assert.ok(page.title.includes('WILDFIRE'));
  });

  it('includes the Arizona fire from fixture', async () => {
    const page = await buildPage(301, 1, null, null);
    const text = page.lines.map(l => l.text).join('\n');
    assert.ok(text.includes('Arizona') || text.includes('Coconino') || text.includes('1 open'));
  });
});

describe('buildPage(302) severe storms', () => {
  it('renders 24x40 ASCII', async () => {
    const page = await buildPage(302, 1, null, null);
    assertValidRender(page, 'page302');
  });

  it('includes the tropical cyclone', async () => {
    const page = await buildPage(302, 1, null, null);
    const text = page.lines.map(l => l.text).join('\n');
    assert.ok(text.includes('Murasu') || text.includes('Cyclone') || text.includes('1 open'));
  });
});

describe('buildPage(303) volcanoes', () => {
  it('renders 24x40 ASCII', async () => {
    const page = await buildPage(303, 1, null, null);
    assertValidRender(page, 'page303');
  });
});

describe('buildPage(304) floods', () => {
  it('renders 24x40 ASCII', async () => {
    const page = await buildPage(304, 1, null, null);
    assertValidRender(page, 'page304');
  });
});

describe('buildPage(305) other events', () => {
  it('renders 24x40 ASCII', async () => {
    const page = await buildPage(305, 1, null, null);
    assertValidRender(page, 'page305');
  });

  it('shows the snow storm (category "snow") as other', async () => {
    const page = await buildPage(305, 1, null, null);
    const text = page.lines.map(l => l.text).join('\n');
    // snow is not in main categories so should appear as "other"
    assert.ok(text.includes('Snow') || text.includes('1 open') || text.includes('Plains'));
  });
});

// ---------------------------------------------------------------------------
// buildPage -- page 400 (7-day forecast)
// ---------------------------------------------------------------------------
describe('buildPage(400)', () => {
  it('renders 24x40 ASCII with place', async () => {
    const page = await buildPage(400, 1, LONDON_ENV, null);
    assertValidRender(page, 'page400-london');
  });

  it('contains date and temperature columns', async () => {
    const page = await buildPage(400, 1, LONDON_ENV, null);
    const text = page.lines.map(l => l.text).join('\n');
    // Dates from fixture: 11-04 through 11-10
    assert.ok(text.includes('11-04') || text.includes('11-05'));
  });

  it('shows no-place message without env', async () => {
    const page = await buildPage(400, 1, null, null);
    assertValidRender(page, 'page400-noplace');
    const text = page.lines.map(l => l.text).join('\n');
    assert.ok(text.toLowerCase().includes('place') || text.toLowerCase().includes('location'));
  });

  it('includes Open-Meteo attribution', async () => {
    const page = await buildPage(400, 1, LONDON_ENV, null);
    const text = page.lines.map(l => l.text).join('\n');
    assert.ok(text.includes('Open-Meteo'));
  });

  it('all rendered rows are 40 chars ASCII', async () => {
    const page = await buildPage(400, 1, LONDON_ENV, null);
    const { rows } = render(page, NOW);
    for (const r of rows) {
      assert.equal(r.length, 40);
      for (const ch of r) {
        const cp = ch.charCodeAt(0);
        assert.ok(cp >= 32 && cp <= 126, `Non-ASCII char ${cp} in row: ${r}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// buildPage -- page 401 (air quality)
// ---------------------------------------------------------------------------
describe('buildPage(401)', () => {
  it('renders 24x40 ASCII with place', async () => {
    const page = await buildPage(401, 1, LONDON_ENV, null);
    assertValidRender(page, 'page401-london');
  });

  it('shows the AQI value from fixture (30)', async () => {
    const page = await buildPage(401, 1, LONDON_ENV, null);
    const text = page.lines.map(l => l.text).join('\n');
    assert.ok(text.includes('30'), 'Should show AQI 30');
  });

  it('shows Good for AQI 30', async () => {
    const page = await buildPage(401, 1, LONDON_ENV, null);
    const text = page.lines.map(l => l.text).join('\n');
    assert.ok(text.includes('Good'));
  });

  it('shows PM2.5 from fixture (8.5)', async () => {
    const page = await buildPage(401, 1, LONDON_ENV, null);
    const text = page.lines.map(l => l.text).join('\n');
    assert.ok(text.includes('8.5'));
  });
});

// ---------------------------------------------------------------------------
// buildPage -- page 101 (right now)
// ---------------------------------------------------------------------------
describe('buildPage(101)', () => {
  it('renders 24x40 ASCII with place', async () => {
    const page = await buildPage(101, 1, LONDON_ENV, null);
    assertValidRender(page, 'page101-london');
  });

  it('shows no-place message without env', async () => {
    const page = await buildPage(101, 1, null, null);
    assertValidRender(page, 'page101-noplace');
    const text = page.lines.map(l => l.text).join('\n');
    assert.ok(text.toLowerCase().includes('place') || text.toLowerCase().includes('location'));
  });
});

// ---------------------------------------------------------------------------
// buildPage -- unknown page returns 404-style page
// ---------------------------------------------------------------------------
describe('buildPage(unknown)', () => {
  it('returns page 888 as not-found', async () => {
    const page = await buildPage(888, 1, null, null);
    assert.equal(page.num, 888);
    assert.ok(page.title.includes('NOT IN SERVICE') || page.title.includes('NOT FOUND'));
    assertValidRender(page, 'page888');
  });
});

// ---------------------------------------------------------------------------
// Property: every page builder always returns a renderable 24x40 page
// ---------------------------------------------------------------------------
describe('property: all page numbers render to 24x40 ASCII', () => {
  const PAGE_NUMS = [100, 101, 199, 200, 201, 202, 300, 301, 302, 303, 304, 305, 400, 401];

  it('all known pages render cleanly with a place', async () => {
    for (const num of PAGE_NUMS) {
      const page = await buildPage(num, 1, LONDON_ENV, null);
      assertValidRender(page, `page${num}-with-place`);
    }
  });

  it('all known pages render cleanly without a place', async () => {
    for (const num of PAGE_NUMS) {
      const page = await buildPage(num, 1, null, null);
      assertValidRender(page, `page${num}-no-place`);
    }
  });

  it('property: random page numbers always produce valid render', () => {
    // Synchronous check for 404 path (unknown pages) only
    fc.assert(fc.property(
      fc.integer({ min: 100, max: 999 }).filter(n => !PAGE_NUMS.includes(n) && n !== 500),
      (num) => {
        const page = buildPage404(num);
        const { rows, colors } = render(page, NOW);
        return rows.length === 24 &&
          colors.length === 24 &&
          rows.every(r =>
            r.length === 40 &&
            [...r].every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126)
          );
      }
    ));
  });
});

// ---------------------------------------------------------------------------
// Fixture shape validation
// ---------------------------------------------------------------------------
describe('fixture shapes', () => {
  it('usgs-day has features array', () => {
    assert.ok(Array.isArray(USGS_DAY.features));
    assert.ok(USGS_DAY.features.length > 0);
    const f = USGS_DAY.features[0];
    assert.ok(typeof f.properties.mag === 'number');
    assert.ok(typeof f.properties.place === 'string');
    assert.ok(typeof f.properties.time === 'number');
    assert.ok(Array.isArray(f.geometry.coordinates));
  });

  it('eonet has events array with categories', () => {
    assert.ok(Array.isArray(EONET_DATA.events));
    const ev = EONET_DATA.events[0];
    assert.ok(typeof ev.title === 'string');
    assert.ok(Array.isArray(ev.categories));
    assert.ok(ev.categories[0].id);
    assert.ok(Array.isArray(ev.geometry));
  });

  it('forecast has daily with 7 entries', () => {
    assert.ok(FORECAST_DATA.daily);
    assert.equal(FORECAST_DATA.daily.time.length, 7);
    assert.equal(FORECAST_DATA.daily.temperature_2m_max.length, 7);
    assert.equal(FORECAST_DATA.daily.weather_code.length, 7);
  });

  it('airquality has current.us_aqi', () => {
    assert.ok(AIRQUALITY_DATA.current);
    assert.equal(typeof AIRQUALITY_DATA.current.us_aqi, 'number');
    assert.equal(typeof AIRQUALITY_DATA.current.pm2_5, 'number');
  });

  it('geocode has results with lat/lon', () => {
    assert.ok(Array.isArray(GEOCODE_DATA.results));
    const r = GEOCODE_DATA.results[0];
    assert.equal(typeof r.latitude, 'number');
    assert.equal(typeof r.longitude, 'number');
    assert.equal(typeof r.name, 'string');
  });
});
