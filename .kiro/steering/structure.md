---
inclusion: always
---
# Structure

- `src/worker.mjs`  routes: `/`, `/p/<num>`, `/p/<num>.txt`, `/p/<num>.json`, `/health`
- `src/teletext.mjs`  pure page model and layout helpers (pad, wrap, header, fastext row, render to text)
- `src/sources.mjs`  USGS, EONET, Open-Meteo adapters + geocoding + cache wrapper
- `src/pages.mjs`  page builders: number -> page object, uses teletext.mjs and sources.mjs
- `src/digest.mjs`  AI digest + `numbersAreGrounded()` guard
- `src/page.mjs`  generated from `web/index.html` by `scripts/deploy.py --build-only` (do not edit by hand)
- `test/*.test.mjs`  node:test unit and property tests
