# World Embassies

A Terra Cracovianum instrument: every embassy and consulate in a city, on one map.
First city: **Warsaw**.

Live (once GitHub Pages is on): `https://terra-cracovianum.github.io/World-embassies/`

## How it works

- `index.html` · `styles.css` · `app.js` — a static page, no build step. Leaflet is vendored in
  `assets/vendor/leaflet`; fonts, logo and colour tokens are copied from the institute's site
  (see `DESIGN.md` in `Terra-Cracovianum-Website-`).
- `data/cities.json` — the cities the map knows. Each one names its OpenStreetMap boundary relation.
- `data/<city>.json` — a snapshot of the city's missions from OpenStreetMap, written by
  `tools/fetch-missions.mjs`. The **Refresh mission data** GitHub Action runs it every Monday, on demand,
  and whenever the data tool changes, and commits the result.
- If a city has no snapshot yet, the page asks OpenStreetMap (Overpass API) live instead.

## Add a city

1. Find the city's boundary relation on openstreetmap.org (e.g. Warsaw is `336075`).
2. Add an entry to `data/cities.json`.
3. Push — the Action writes `data/<slug>.json`. Open `?city=<slug>`.

## Turn on GitHub Pages

Settings → Pages → *Deploy from a branch* → `main` / `(root)`.

Data © OpenStreetMap contributors, ODbL. Basemap © CARTO.
