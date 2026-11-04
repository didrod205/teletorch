# Requirements: Teletorch

## R1 Page model
User story: As a reader on a weak connection, I want every page to have the same fixed size so it loads instantly and reads the same on any screen.
- WHEN any page is rendered THEN the system SHALL return exactly 24 rows of exactly 40 printable ASCII characters.
- Row 1 SHALL be the header: page number, service name "TELETORCH", and UTC time "HH:MM".
- Row 24 SHALL be the fastext row with up to four coloured links (red, green, yellow, cyan) to other page numbers.
- WHEN source text contains non-ASCII letters THEN the system SHALL transliterate common accents and drop other characters.
- WHEN text is longer than a row THEN it SHALL wrap on word boundaries and never cut a word unless the word itself exceeds 40 characters.

## R2 Page numbers
- 100 index; 101 "Right now" summary for the chosen place; 199 sources and licences.
- 200 earthquakes M4.5+ past 24 hours (USGS), 201 significant earthquakes past 7 days, 202 nearest M2.5+ quakes in 7 days within 1000 km of the chosen place.
- 300 open natural events from NASA EONET (last 14 days), 301-305 by category (wildfires, severe storms, volcanoes, floods, other).
- 400 7-day weather for the chosen place, 401 air quality now (US AQI, PM2.5).
- 500 plain-words digest (AI, guarded).
- WHEN a list does not fit on one page THEN the system SHALL split it into sub-pages shown as "1/3" in the header and reachable with `?s=2`.
- WHEN an unknown number is requested THEN the system SHALL return a valid 40x24 "PAGE NOT IN SERVICE" page with HTTP 404.

## R3 Place
- The reader SHALL set a place by name (Open-Meteo geocoding) or by coordinates `lat,lon`.
- WHEN no place is set THEN pages that need one SHALL show how to set it instead of failing.

## R4 Three outputs
- `/p/<num>.txt` SHALL return text/plain, 24 lines joined by "\n".
- `/p/<num>.json` SHALL return `{ num, sub, subs, title, rows[24], links[] , source, fetchedAt }`.
- `/` SHALL serve the teletext screen. Each JSON page SHALL be under 4 KB.

## R5 Honest data
- Every data page SHALL show the source name and the fetch time.
- WHEN an upstream source fails THEN the page SHALL still render and say "SOURCE UNAVAILABLE, TRY AGAIN" with the source name.
- Upstream responses SHALL be cached for 5 minutes.

## R6 Guarded AI digest (page 500)
- The digest SHALL be built only from the facts object used for page 101.
- WHEN the AI output contains any number that does not appear in the facts THEN the system SHALL discard it and use the template digest, and mark the page "TEMPLATE".
- WHEN the AI is unavailable or slow (over 6 s) THEN the template digest SHALL be used.

## R7 Screen (web)
- Black background, teletext 8 colours, monospace grid that scales to fit 360 px wide phones and desktop.
- Keypad entry: typing 3 digits jumps to that page; on-screen keypad for touch; four fastext buttons.
- A "torch" mode: the screen stays dark except a soft spotlight of the current page row band, saving OLED battery (optional toggle, off by default).
- Works with keyboard only and with screen readers (the grid is also exposed as a text block with aria-live).
