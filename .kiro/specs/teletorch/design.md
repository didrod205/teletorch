# Design: Teletorch

## Architecture
Browser or curl -> Cloudflare Worker (`worker.mjs`) -> `pages.mjs` builds a page object -> `teletext.mjs` lays it out to 24x40 -> response as HTML shell + JSON, or .txt.
`sources.mjs` fetches USGS GeoJSON (earthquake.usgs.gov/earthquakes/feed/v1.0/summary/*.geojson), NASA EONET v3 (eonet.gsfc.nasa.gov/api/v3/events?status=open&days=14), Open-Meteo forecast, air quality and geocoding. Each fetch goes through `cached(url, ttl=300)` using `caches.default`.
`digest.mjs` calls Workers AI (`env.AI.run`) with the facts JSON and a strict prompt, then `numbersAreGrounded(text, facts)`.

## Page object
```
{ num, sub, subs, title, lines: [ { text, color } ], links: [ {color, num, label} ], source, fetchedAt }
```
`render(page, nowUtc)` -> `{ rows: string[24], colors: string[24] }`: row 1 header, rows 2-23 body (22 lines, sub-pages if more), row 24 fastext.
Colours: white, yellow, cyan, green, red, magenta, blue (one colour per row keeps JSON small).

## Key helpers (teletext.mjs)
- `toAscii(s)`: NFD normalize, strip combining marks, map known letters (ß->ss, ø->o, ł->l, æ->ae), drop non-printables.
- `pad(s, n=40)`, `wrap(s, width=40)`, `columns([...], widths)` for tables like "M5.1  12:04  80km SW of X".
- `paginate(lines, perPage=22)`.
- `header(num, sub, subs, nowUtc)`, `fastext(links)`.

## Grounding guard (digest.mjs)
`extractNumbers(text)` finds integers and decimals (also "4.5", "-3", "12:04" split into 12 and 04). A number is grounded if it equals (after removing leading zeros) a number in the flattened facts or is in the allow list {24, 7, 1000 if present in facts}. Any ungrounded number -> template.

## Testing
- Unit tests for every page builder with fixture JSON (no network).
- Property tests (fast-check): for any random title, lines, links and Unicode text, `render` returns 24 rows of 40 ASCII chars; `wrap` never loses words; `numbersAreGrounded` rejects any text containing a number absent from facts.
