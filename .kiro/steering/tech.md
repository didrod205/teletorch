---
inclusion: always
---
# Tech rules

- Runtime: one Cloudflare Worker, plain ES modules in `src/` (no bundler, no TypeScript, no npm runtime dependencies). Deployed by `scripts/deploy.py` through the Cloudflare REST API (wrangler cannot run on the build machine).
- `src/teletext.mjs` is pure (no fetch, no Date.now inside layout functions). All layout goes through it.
- Data adapters live in `src/sources.mjs`, each returns plain objects and never throws to the caller (return `{ ok:false, error }`).
- Cache upstream responses with the Workers Cache API for 5 minutes (Open-Meteo free tier: under 10,000 calls per day).
- Workers AI binding name is `AI`, model `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Always validate AI text with `numbersAreGrounded()` before showing it.
- Characters: pages contain printable ASCII only (code 32 to 126). Transliterate accents (e.g. "Mexico" for "México"), drop anything else.
- Tests: `node --test test/` with the built-in runner. Property-based tests use `fast-check` (dev dependency only).
- Front end: `web/index.html`, one file, no framework, no external fonts or CDNs, total under 30 KB. Teletext 8-colour palette on black, no glow, no blur, no gradients, no italics.
- Never commit secrets. Tokens come from environment variables only.
