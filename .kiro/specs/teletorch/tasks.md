# Tasks: Teletorch

- [x] 1. Project setup: package.json (type module, test script `node --test test/`), dev dependency fast-check, .gitignore (node_modules only). _R1_
- [x] 2. `src/teletext.mjs`: toAscii, pad, wrap, columns, paginate, header, fastext, render. _R1, R2_
- [x] 3. `test/teletext.test.mjs`: unit tests + property tests (24x40 ASCII for any input, wrap keeps all words). _R1_
- [x] 4. `src/sources.mjs`: cached fetch, usgs(feed), eonet(), forecast(lat,lon), airQuality(lat,lon), geocode(name); never throw. _R3, R5_
- [x] 5. `src/pages.mjs`: builders for 100, 101, 199, 200, 201, 202, 300-305, 400, 401, 404 page; distance helper (haversine). _R2, R3, R5_
- [x] 6. `test/pages.test.mjs` with fixtures in `test/fixtures/` (no network). _R2_
- [x] 7. `src/digest.mjs`: facts -> AI prompt, 6 s timeout, extractNumbers, numbersAreGrounded, template digest; property test that ungrounded numbers are always rejected. _R6_
- [x] 8. `src/worker.mjs`: routing, place from `?place=` or `?lat=&lon=` or cookie, .txt/.json/HTML, 404 page, /health. _R4_
- [ ] 9. `web/index.html`: teletext screen, keypad, fastext buttons, place form, torch toggle, aria-live text, fits 360 px. _R7_
- [x] 10. `scripts/deploy.py`: build src/page.mjs from web/index.html, upload all src/*.mjs modules with the AI binding, enable workers.dev, attach custom domain. _R4_
