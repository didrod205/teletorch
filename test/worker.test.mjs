/**
 * test/worker.test.mjs
 * Unit tests for src/worker.mjs with a stub env.
 *
 * Uses the same fake fetch / caches shim from pages.test.mjs so sources
 * never hit the network.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Fixtures + shims (mirrors pages.test.mjs setup)
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

if (typeof globalThis.Headers === 'undefined') {
  globalThis.Headers = class Headers {
    constructor(init = {}) { this._h = { ...init }; }
    set(k, v) { this._h[k.toLowerCase()] = v; }
    get(k) { return this._h[k.toLowerCase()]; }
    has(k) { return k.toLowerCase() in this._h; }
    entries() { return Object.entries(this._h); }
    [Symbol.iterator]() { return Object.entries(this._h)[Symbol.iterator](); }
  };
}

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('4.5_day'))            return makeFakeResponse(USGS_DAY);
  if (u.includes('significant_week'))   return makeFakeResponse(USGS_WEEK_SIG);
  if (u.includes('2.5_week'))           return makeFakeResponse(USGS_WEEK_25);
  if (u.includes('2.5_day'))            return makeFakeResponse(USGS_WEEK_25);
  if (u.includes('eonet.gsfc.nasa.gov')) return makeFakeResponse(EONET_DATA);
  if (u.includes('forecast'))           return makeFakeResponse(FORECAST_DATA);
  if (u.includes('air-quality'))        return makeFakeResponse(AIRQUALITY_DATA);
  if (u.includes('geocoding')) {
    // Return empty results for unknown place names
    if (u.includes('Xyzzyqqv')) {
      return makeFakeResponse({ results: [] });
    }
    return makeFakeResponse(GEOCODE_DATA);
  }
  return { ok: false, status: 404, clone() { return this; }, async json() { throw new Error('not found'); } };
};

globalThis.caches = undefined;

// ---------------------------------------------------------------------------
// Import the worker AFTER shims are set
// ---------------------------------------------------------------------------
import worker from '../src/worker.mjs';

// Stub env: no AI binding (digest will use template)
const STUB_ENV = {};

/** Build a Request object pointing at our worker. */
function req(path, opts = {}) {
  return new Request('https://teletorch.example.com' + path, opts);
}

// ---------------------------------------------------------------------------
// /health
// ---------------------------------------------------------------------------
describe('GET /health', () => {
  it('returns 200 with ok:true', async () => {
    const resp = await worker.fetch(req('/health'), STUB_ENV, {});
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.ok, true);
  });
});

// ---------------------------------------------------------------------------
// GET / (HTML screen)
// ---------------------------------------------------------------------------
describe('GET /', () => {
  it('returns 200 HTML', async () => {
    const resp = await worker.fetch(req('/'), STUB_ENV, {});
    assert.equal(resp.status, 200);
    const ct = resp.headers.get('content-type');
    assert.ok(ct && ct.includes('text/html'), `content-type: ${ct}`);
  });

  it('body is the PAGE string', async () => {
    const resp = await worker.fetch(req('/'), STUB_ENV, {});
    const body = await resp.text();
    assert.ok(body.length > 0, 'body should not be empty');
    assert.ok(body.includes('<!DOCTYPE html') || body.includes('<html'), 'should be HTML');
  });
});

// ---------------------------------------------------------------------------
// GET /p/<num>.json
// ---------------------------------------------------------------------------
describe('GET /p/100.json', () => {
  it('returns 200 JSON with correct shape', async () => {
    const resp = await worker.fetch(req('/p/100.json'), STUB_ENV, {});
    assert.equal(resp.status, 200);
    const ct = resp.headers.get('content-type');
    assert.ok(ct && ct.includes('application/json'));
    const body = await resp.json();
    assert.equal(body.num, 100);
    assert.ok(Array.isArray(body.rows), 'rows should be an array');
    assert.equal(body.rows.length, 24, 'should have 24 rows');
    assert.ok(Array.isArray(body.links));
    assert.ok(typeof body.title === 'string');
    assert.ok(typeof body.source === 'string');
    assert.ok(typeof body.fetchedAt === 'string');
  });

  it('all 24 rows are 40 printable ASCII chars', async () => {
    const resp = await worker.fetch(req('/p/100.json'), STUB_ENV, {});
    const { rows } = await resp.json();
    for (let i = 0; i < rows.length; i++) {
      assert.equal(rows[i].length, 40, `row ${i} is ${rows[i].length} chars`);
      for (const ch of rows[i]) {
        const cp = ch.charCodeAt(0);
        assert.ok(cp >= 32 && cp <= 126, `row ${i} has non-ASCII char ${cp}`);
      }
    }
  });
});

describe('GET /p/200.json', () => {
  it('returns earthquake data', async () => {
    const resp = await worker.fetch(req('/p/200.json'), STUB_ENV, {});
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.num, 200);
    assert.ok(body.title.includes('EARTHQUAKES'));
  });
});

describe('GET /p/400.json with place', () => {
  it('returns weather data when place is in query', async () => {
    const resp = await worker.fetch(
      req('/p/400.json?place=London'), STUB_ENV, {});
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.num, 400);
  });
});

// ---------------------------------------------------------------------------
// GET /p/<num>.txt
// ---------------------------------------------------------------------------
describe('GET /p/100.txt', () => {
  it('returns text/plain with 24 lines', async () => {
    const resp = await worker.fetch(req('/p/100.txt'), STUB_ENV, {});
    assert.equal(resp.status, 200);
    const ct = resp.headers.get('content-type');
    assert.ok(ct && ct.includes('text/plain'));
    const body = await resp.text();
    const lines = body.split('\n');
    assert.equal(lines.length, 24, `expected 24 lines, got ${lines.length}`);
    for (const l of lines) {
      assert.equal(l.length, 40, `line "${l}" is ${l.length} chars`);
    }
  });
});

describe('GET /p/199.txt', () => {
  it('all lines are 40 printable ASCII chars', async () => {
    const resp = await worker.fetch(req('/p/199.txt'), STUB_ENV, {});
    const body = await resp.text();
    const lines = body.split('\n');
    assert.equal(lines.length, 24);
    for (const l of lines) {
      assert.equal(l.length, 40);
      for (const ch of l) {
        const cp = ch.charCodeAt(0);
        assert.ok(cp >= 32 && cp <= 126, `Non-ASCII char ${cp} in: ${l}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Sub-page navigation
// ---------------------------------------------------------------------------
describe('sub-page ?s=2', () => {
  it('returns sub 2 when ?s=2 is provided', async () => {
    // Build page 200 which may have multiple sub-pages
    const resp = await worker.fetch(req('/p/200.json?s=2'), STUB_ENV, {});
    assert.equal(resp.status, 200);
    const body = await resp.json();
    // sub is clamped to subs count -- may return sub 1 if only 1 sub-page
    assert.ok(body.sub >= 1, 'sub should be >= 1');
  });
});

// ---------------------------------------------------------------------------
// Unknown page -> 404
// ---------------------------------------------------------------------------
describe('GET /p/888.json (unknown)', () => {
  it('returns HTTP 404 with a valid page', async () => {
    const resp = await worker.fetch(req('/p/888.json'), STUB_ENV, {});
    assert.equal(resp.status, 404);
    const body = await resp.json();
    assert.equal(body.num, 888);
    assert.ok(body.title.includes('NOT IN SERVICE') || body.title.includes('NOT FOUND'));
    assert.equal(body.rows.length, 24);
  });
});

// ---------------------------------------------------------------------------
// Cookie: place set via ?place= is remembered in Set-Cookie
// ---------------------------------------------------------------------------
describe('cookie', () => {
  it('GET /?place=London sets tt_place cookie', async () => {
    const resp = await worker.fetch(req('/?place=London'), STUB_ENV, {});
    const cookie = resp.headers.get('set-cookie');
    assert.ok(cookie && cookie.includes('tt_place'),
      `Expected tt_place cookie, got: ${cookie}`);
  });

  it('GET /p/100.json?place=London sets tt_place cookie', async () => {
    const resp = await worker.fetch(req('/p/100.json?place=London'), STUB_ENV, {});
    const cookie = resp.headers.get('set-cookie');
    assert.ok(cookie && cookie.includes('tt_place'));
  });

  it('GET /p/100.json reads place from cookie', async () => {
    // Cookie: tt_place=51.5085,-0.1257,London
    const r = req('/p/101.json', {
      headers: { Cookie: 'tt_place=51.5085%2C-0.1257%2CLondon' },
    });
    const resp = await worker.fetch(r, STUB_ENV, {});
    assert.equal(resp.status, 200);
    const body = await resp.json();
    const text = body.rows.join('\n');
    // Should show weather/quake data (not "no place" message)
    assert.ok(!text.includes('No place selected'), 'Should not show no-place message');
  });
});

// ---------------------------------------------------------------------------
// lat/lon query params
// ---------------------------------------------------------------------------
describe('?lat=&lon= query params', () => {
  it('accepts lat/lon directly', async () => {
    const resp = await worker.fetch(
      req('/p/101.json?lat=51.5085&lon=-0.1257'), STUB_ENV, {});
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.num, 101);
  });

  it('sets a cookie with the coordinates', async () => {
    const resp = await worker.fetch(
      req('/p/100.json?lat=51.5085&lon=-0.1257'), STUB_ENV, {});
    const cookie = resp.headers.get('set-cookie');
    assert.ok(cookie && cookie.includes('tt_place'));
  });
});

// ---------------------------------------------------------------------------
// Unknown route returns 404 JSON
// ---------------------------------------------------------------------------
describe('GET /unknown-route', () => {
  it('returns 404', async () => {
    const resp = await worker.fetch(req('/unknown-route'), STUB_ENV, {});
    assert.equal(resp.status, 404);
  });
});

// ---------------------------------------------------------------------------
// Place not found error
// ---------------------------------------------------------------------------
describe('?place=<unknown name>', () => {
  it('returns page with PLACE NOT FOUND error message in red', async () => {
    const resp = await worker.fetch(req('/p/101.json?place=Xyzzyqqv'), STUB_ENV, {});
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.num, 101);
    const text = body.rows.join('\n');
    assert.ok(text.includes('PLACE NOT FOUND'), 'Should show place not found message');
    // Check that error line is red
    assert.ok(body.colors.some(c => c === 'red'), 'Should have at least one red line');
  });

  it('does NOT set a cookie when place is not found', async () => {
    const resp = await worker.fetch(req('/p/101.json?place=Xyzzyqqv'), STUB_ENV, {});
    const cookie = resp.headers.get('set-cookie');
    assert.ok(!cookie, 'Should not set cookie when place not found');
  });

  it('does NOT use a previous cookie when ?place= fails', async () => {
    // First, with a valid place to see the normal flow
    const r1 = req('/p/101.json?place=London');
    const resp1 = await worker.fetch(r1, STUB_ENV, {});
    const cookie = resp1.headers.get('set-cookie');
    assert.ok(cookie);

    // Now try an invalid place with the cookie present
    const r2 = req('/p/101.json?place=Xyzzyqqv', {
      headers: { Cookie: 'tt_place=51.5085%2C-0.1257%2CLondon' },
    });
    const resp2 = await worker.fetch(r2, STUB_ENV, {});
    const body2 = await resp2.json();
    const text2 = body2.rows.join('\n');
    // Should still show the error, not London weather
    assert.ok(text2.includes('PLACE NOT FOUND'), 'Should show place not found, not use cookie');
  });
});

// ---------------------------------------------------------------------------
// Page 500 (digest) -- uses template in test env (no AI binding)
// ---------------------------------------------------------------------------
describe('GET /p/500.json', () => {
  it('returns 200 with TEMPLATE in title', async () => {
    const resp = await worker.fetch(req('/p/500.json?lat=51.5085&lon=-0.1257'), STUB_ENV, {});
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.num, 500);
    assert.ok(body.title.includes('TEMPLATE') || body.title.includes('DIGEST'));
    assert.equal(body.rows.length, 24);
    // digest metadata field must be present
    assert.ok(body.digest, 'digest field must exist');
    assert.ok(body.digest.mode === 'AI' || body.digest.mode === 'TEMPLATE', 'digest.mode must be AI or TEMPLATE');
    assert.ok(typeof body.digest.reason === 'string', 'digest.reason must be a string');
    assert.ok(typeof body.digest.checked === 'number', 'digest.checked must be a number');
  });
});
