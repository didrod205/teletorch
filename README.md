# Teletorch

Teletext, resurrected for emergencies. Live earthquake, natural-event, weather and air-quality pages in the old 40 x 24 teletext format, reached by 3-digit page numbers, light enough for a dying phone battery or a congested network.

- Live app: https://teletorch.elab-studio.com
- Plain text, no browser needed: `curl https://teletorch.elab-studio.com/p/101.txt?place=Seoul`
- Category: **Resurrection** (Kiroween 2026)
- License: MIT

## The one-minute version

BBC Ceefax, the first teletext service, went live on 23 September 1974 and made its final broadcast in October 2012. Teletext worked because it was tiny: numbered pages of 40 columns by 24 rows that any TV could show.

The modern web is the opposite. When the power is out, the network is congested after a disaster, or the device is old, heavy pages fail exactly when people need facts. Teletorch brings the teletext format back with today's public data:

| Page | What it shows | Source |
|---|---|---|
| 100 | Index | |
| 101 | Right now at your place: weather, air quality, nearest recent quake | Open-Meteo, USGS |
| 200 / 201 / 202 | Earthquakes M4.5+ in 24 h / significant in 7 days / within 1000 km of you in 7 days | USGS earthquake feeds |
| 300-305 | Open natural events (storms, wildfires, volcanoes, floods, other), last 14 days | NASA EONET v3 |
| 400 / 401 | 7-day forecast / air quality (US AQI, PM2.5, model estimate) | Open-Meteo (CC BY 4.0) |
| 500 | Plain-words digest written by an AI model, with every number checked | Cloudflare Workers AI |
| 199 | Sources and licences | |

Every page is served three ways: the teletext screen (`/p/101`), plain text (`/p/101.txt`) and JSON (`/p/101.json`). A JSON page is about 1.5 KB and a text page under 1 KB (measured on 2026-11-04). Every data page shows its source and fetch time on row 23.

### The AI cannot invent numbers

Page 500 asks a Workers AI model (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) to explain the page-101 facts in plain English. Before anything is shown, `numbersAreGrounded()` extracts every number from the answer and checks it against the facts. One number that is not in the source data, a timeout over 6 s, or an error, and the page falls back to a template built directly from the facts. The page says which mode it is in ("DIGEST [AI]" with "N numbers checked vs source data", or "DIGEST [TEMPLATE]"). Property-based tests try random texts and facts to prove that ungrounded numbers are always rejected.

Known limit: the check proves each number exists in the source data, not that it is attached to the right sentence.

## How to use

- Type three digits (keyboard or on-screen keypad), or press the four coloured fastext buttons.
- Set a place by city name or `lat,lon`; it is kept in a cookie. An unknown name shows "PLACE NOT FOUND".
- Left and right arrows change sub-pages (`?s=2`).
- **Torch** mode keeps the screen dark except a three-row beam that follows your finger or the up and down keys.
- Screen readers get the same 24 lines as plain text in an aria-live region.

## Architecture

```
browser / curl
   |  /  /p/<num>  /p/<num>.txt  /p/<num>.json
Cloudflare Worker (src/worker.mjs)
   |-- pages.mjs     page number -> page object (lines, colours, fastext links)
   |-- teletext.mjs  pure layout: ASCII transliteration, wrap, paginate, 24 x 40 render
   |-- sources.mjs   USGS, NASA EONET, Open-Meteo forecast / air quality / geocoding, 5-minute Cache API
   |-- digest.mjs    Workers AI digest + numbersAreGrounded() guard + template fallback
   '-- page.mjs      web/index.html (one file, no framework, no external requests)
```

No bundler and no runtime dependencies. `scripts/deploy.py` uploads the ES modules with the plain Cloudflare REST API.

## Run it yourself

```
npm install          # dev dependency: fast-check
npm test             # node --test
python3 scripts/deploy.py --build-only   # builds src/page.mjs from web/index.html
CF_API_TOKEN=... CF_ACCOUNT_ID=... python3 scripts/deploy.py   # deploys the Worker (AI binding)
```

## How Kiro was used

All application code in `src/`, `web/`, `test/` and `scripts/` was written by Kiro CLI 3.0.0 in 9 non-interactive runs. The full run log with instructions, durations, commits and credits is in [KIRO_LOG.md](KIRO_LOG.md).

- **Spec-driven development**: `.kiro/specs/teletorch/` has requirements in EARS style (R1-R7), a design and 10 tasks. Kiro implemented the tasks in order and ticked each checkbox after the tests passed.
- **Steering**: three always-included files (`product.md`, `tech.md`, `structure.md`) fixed the product rules (exactly 40 x 24 ASCII, never let AI invent numbers), the runtime (one Worker, no bundler, Cache API, Workers AI) and the file layout. The steering rule about AI numbers became the `numbersAreGrounded()` guard and its tests.
- **Custom agent**: Kiro created `.kiro/agents/teletorch-builder.json` (resources = steering + spec, tools read, write, shell); runs 2-9 used it with `kiro-cli chat --agent teletorch-builder`.
- **Agent hooks**: Kiro created two `PostFileSave` hooks in `.kiro/hooks/`: `run-tests-on-save` (runs the test suite after any src or test file is saved) and `ascii-guard` (fails if a source file contains non-ASCII characters). Kiro's session records show they fired 43 and 29 times during the build.
- **Property-based testing**: fast-check properties (12 `fc.assert` blocks) check that any input renders to exactly 24 rows of 40 printable ASCII characters, that wrapping never loses words, and that the digest guard always rejects ungrounded numbers. 166 tests pass.
- **Models**: runs 1-7 used Kiro's `auto` model; run 8 (a small edge-case fix) used `claude-haiku-4.5` at 0.40x credits to save the free-plan budget.
- **Review loop**: after each deploy we looked at real screenshots (1440 x 900 and 360 px) and fed concrete bug reports back to Kiro (missing colours, overflowing grid, AI digest always falling back). Run 7 was interrupted by a rate limit and finished with `kiro-cli chat --resume`.

## Built with AI

Planning, the spec, the steering documents and the review feedback were written by Claude (Anthropic). Code was implemented by Kiro. Kyoungchan Yang (E:LAB STUDIO, a one-person studio in Korea) reviewed and submitted the project. Files written outside Kiro: the spec and steering (Claude, commit e8b0fbe), LICENSE, README.md and KIRO_LOG.md (Claude).

## Data and credits

- Earthquakes: U.S. Geological Survey, Earthquake Hazards Program GeoJSON feeds.
- Natural events: NASA Earth Observatory Natural Event Tracker (EONET) v3.
- Weather, air quality and geocoding: Open-Meteo.com, licensed CC BY 4.0 (air quality is a CAMS model estimate, not a station reading).
- Teletext history: BBC (Ceefax launched 1974, ended 2012). Teletorch is not affiliated with the BBC or any broadcaster.

Teletorch is an information aid, not an official warning service. Always follow your local authorities.
