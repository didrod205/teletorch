/**
 * worker.mjs -- Cloudflare Worker entry point for Teletorch
 *
 * Routes:
 *   GET /               -> HTML teletext screen (src/page.mjs)
 *   GET /p/<num>        -> HTML screen pre-loaded with page <num>
 *   GET /p/<num>.json   -> JSON page object
 *   GET /p/<num>.txt    -> plain-text 24x40 render
 *   GET /health         -> {"ok":true}
 *   Everything else     -> 404 page (valid 40x24)
 *
 * Place resolution order:
 *   1. ?lat=&lon= query params (immediate coordinates)
 *   2. ?place=<name> query param (geocoded via Open-Meteo)
 *   3. Cookie tt_place (previously resolved lat,lon,name)
 *   4. No place -- pages that need it show a "set your location" message.
 *
 * Cookie format: tt_place=<lat>,<lon>,<name>
 *   e.g. tt_place=51.5085,-0.1257,London
 */

import { PAGE } from './page.mjs';
import { buildPage, buildPage404 } from './pages.mjs';
import { geocode } from './sources.mjs';
import { render, toAscii } from './teletext.mjs';

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/**
 * Parse the tt_place cookie.
 * @param {string} cookieHeader  value of the Cookie header
 * @returns {{ lat: number, lon: number, name: string }|null}
 */
function parsePlaceCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)tt_place=([^;]+)/);
  if (!match) return null;
  const val = decodeURIComponent(match[1]);
  const firstComma = val.indexOf(',');
  const secondComma = val.indexOf(',', firstComma + 1);
  if (firstComma === -1 || secondComma === -1) return null;
  const lat = parseFloat(val.slice(0, firstComma));
  const lon = parseFloat(val.slice(firstComma + 1, secondComma));
  const name = val.slice(secondComma + 1);
  if (isNaN(lat) || isNaN(lon)) return null;
  return { lat, lon, name };
}

/**
 * Build a Set-Cookie header value for tt_place.
 * @param {number} lat
 * @param {number} lon
 * @param {string} name
 * @returns {string}
 */
function buildPlaceCookie(lat, lon, name) {
  const val = encodeURIComponent(`${lat},${lon},${name}`);
  return `tt_place=${val}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

// ---------------------------------------------------------------------------
// Place resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the place for a request.
 * Returns { place, setCookie } where place may be null and setCookie is
 * either a Set-Cookie string or null.
 *
 * @param {URL} url
 * @param {Request} request
 * @param {object} env  Cloudflare env bindings
 * @param {object} ctx  ExecutionContext
 * @returns {Promise<{ place: {lat,lon,name}|null, setCookie: string|null }>}
 */
async function resolvePlace(url, request, env, ctx) {
  // 1. Direct coordinates
  const qLat = url.searchParams.get('lat');
  const qLon = url.searchParams.get('lon');
  if (qLat !== null && qLon !== null) {
    const lat = parseFloat(qLat);
    const lon = parseFloat(qLon);
    if (!isNaN(lat) && !isNaN(lon)) {
      const name = `${lat.toFixed(4)},${lon.toFixed(4)}`;
      return { place: { lat, lon, name }, setCookie: buildPlaceCookie(lat, lon, name) };
    }
  }

  // 2. Named place (geocode)
  const qPlace = url.searchParams.get('place');
  if (qPlace) {
    const result = await geocode(qPlace, ctx);
    if (result.ok) {
      const name = toAscii(`${result.name}${result.country ? ', ' + result.country : ''}`);
      return {
        place: { lat: result.lat, lon: result.lon, name },
        setCookie: buildPlaceCookie(result.lat, result.lon, name),
      };
    }
    // Geocode failed -- fall through to cookie
  }

  // 3. Cookie
  const cookieHeader = request.headers.get('Cookie') || '';
  const fromCookie = parsePlaceCookie(cookieHeader);
  if (fromCookie) {
    return { place: fromCookie, setCookie: null };
  }

  return { place: null, setCookie: null };
}

// ---------------------------------------------------------------------------
// Parse page number and sub-page from pathname + query string
// Accepts: /p/100, /p/100.json, /p/100.txt
// ---------------------------------------------------------------------------

function parsePath(pathname) {
  // /p/<num>, /p/<num>.json, /p/<num>.txt
  const m = pathname.match(/^\/p\/(\d{3})(\.json|\.txt)?$/);
  if (m) {
    return { num: parseInt(m[1], 10), ext: m[2] || '' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Build env object for page builders
// ---------------------------------------------------------------------------

function makePageEnv(env, place) {
  return {
    ...env,
    placeLat:  place ? String(place.lat)  : '',
    placeLon:  place ? String(place.lon)  : '',
    placeName: place ? String(place.name) : '',
  };
}

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

const JSON_HEADERS  = { 'Content-Type': 'application/json; charset=utf-8' };
const TXT_HEADERS   = { 'Content-Type': 'text/plain; charset=utf-8' };
const HTML_HEADERS  = { 'Content-Type': 'text/html; charset=utf-8' };

/**
 * Add optional Set-Cookie to headers object.
 * @param {object} headers
 * @param {string|null} setCookie
 * @returns {object}
 */
function withCookie(headers, setCookie) {
  if (!setCookie) return headers;
  return { ...headers, 'Set-Cookie': setCookie };
}

/**
 * Build the JSON response body for a page.
 * @param {object} page  raw page object from buildPage
 * @param {object} rendered  { rows, colors } from render()
 * @returns {object}
 */
function pageToJson(page, rendered) {
  return {
    num:       page.num,
    sub:       page.sub,
    subs:      page.subs,
    title:     page.title,
    rows:      rendered.rows,
    links:     page.links || [],
    source:    page.source || '',
    fetchedAt: page.fetchedAt || '',
  };
}

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // ------------------------------------------------------------------
    // GET /health
    // ------------------------------------------------------------------
    if (pathname === '/health') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: JSON_HEADERS,
      });
    }

    // ------------------------------------------------------------------
    // GET / or GET /p/<num>  (HTML screen)
    // ------------------------------------------------------------------
    if (pathname === '/' || pathname === '/p/' || /^\/p\/\d{3}$/.test(pathname)) {
      const { place, setCookie } = await resolvePlace(url, request, env, ctx);
      return new Response(PAGE, {
        headers: withCookie(HTML_HEADERS, setCookie),
      });
    }

    // ------------------------------------------------------------------
    // GET /p/<num>.json  or  /p/<num>.txt
    // ------------------------------------------------------------------
    const parsed = parsePath(pathname);
    if (parsed) {
      const { num, ext } = parsed;
      const sub = parseInt(url.searchParams.get('s') || '1', 10) || 1;

      const { place, setCookie } = await resolvePlace(url, request, env, ctx);
      const pageEnv = makePageEnv(env, place);

      const nowUtc = new Date().toISOString();

      // Build the page
      let page;
      let status = 200;
      try {
        page = await buildPage(num, sub, pageEnv, ctx);
        // If the page is a 404-style page for an unknown number, use HTTP 404
        if (page && page.title && page.title.includes('PAGE NOT IN SERVICE') && page.num !== 404) {
          status = 404;
        }
      } catch (_err) {
        page = buildPage404(num);
        status = 500;
      }

      // Specifically for unknown page numbers return 404
      if (!page) {
        page = buildPage404(num);
        status = 404;
      }

      const rendered = render(page, nowUtc);

      if (ext === '.txt') {
        const body = rendered.rows.join('\n');
        return new Response(body, {
          status,
          headers: withCookie(TXT_HEADERS, setCookie),
        });
      }

      // .json or default JSON for known /p/<num> routes
      const body = JSON.stringify(pageToJson(page, rendered));
      return new Response(body, {
        status,
        headers: withCookie(JSON_HEADERS, setCookie),
      });
    }

    // ------------------------------------------------------------------
    // 404 -- unknown route
    // ------------------------------------------------------------------
    const page404 = buildPage404(404);
    const rendered = render(page404, new Date().toISOString());
    const body = JSON.stringify(pageToJson(page404, rendered));
    return new Response(body, {
      status: 404,
      headers: JSON_HEADERS,
    });
  },
};
