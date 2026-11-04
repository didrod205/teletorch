---
inclusion: always
---
# Product: Teletorch

Teletorch brings broadcast teletext back to life (BBC Ceefax ran from 1974 to 2012) as a tiny, page-numbered information service for moments when the modern web is too heavy: power cuts on a phone battery, congested networks after a disaster, old devices, screen readers.

- Every page is exactly 40 columns x 24 rows of text, reached by a 3-digit page number, like TV teletext.
- Live public data only: USGS earthquake feeds, NASA EONET natural events, Open-Meteo weather and air quality (CC BY 4.0, attribution required on page 199).
- The same page is served three ways: the web screen, `/p/<num>.txt` plain text (works with curl), `/p/<num>.json`.
- One page (500) is a plain-words digest written by an AI model. The model may rephrase, but every number it outputs must already exist in the source data; otherwise the digest falls back to a fixed template. Never let AI invent numbers, places or times.
- Audience: anyone who needs facts fast on a weak connection. Judges must understand the app in one minute.
- Tone: calm, factual, no fear-mongering. Halloween flavour is limited to the "torch in the dark" idea (black screen, a torch that lights the page you type).
