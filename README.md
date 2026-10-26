# World Embassies

A Terra Cracovianum tool: every embassy and consulate in a city, on one map. Polish by default, English via the PL/EN switch (or `?lang=en`).
First city: **Warsaw**.

Live: https://terra-cracovianum.github.io/World-embassies/

## Embedding on terracracovianum.org

Like the election maps, the page is just the tool, with no masthead or footer, so it can sit in an iframe under the site's own page title:

```html
<iframe class="wybory-frame" src="https://terra-cracovianum.github.io/World-embassies/" title="Ambasady i konsulaty w Warszawie"></iframe>
```

## How it works

- `index.html` · `styles.css` · `app.js`: a static page with no build step. Leaflet is vendored in `assets/vendor/leaflet`.
  Fonts and colour tokens are copied from the institute's site (see `DESIGN.md` in `Terra-Cracovianum-Website-`).
- `data/cities.json`: the cities the map knows, each with a bounding box.
- `data/<city>.json`: a snapshot of the city's missions from OpenStreetMap, written by `tools/fetch-missions.mjs`.
  The **Refresh mission data** GitHub Action runs it every Monday, on demand, and whenever the data code changes, then commits the result.
  Ambassadors' residences are left out.
- `data/overrides.json`: fixes for OpenStreetMap errors, keyed by OSM id. Better still, fix the error on openstreetmap.org and delete the override.
- If a city has no snapshot yet, the page asks OpenStreetMap (Overpass API) live instead.

## Add a city

1. Add an entry to `data/cities.json` with its name, a bounding box (`[south, west, north, east]`), a centre and a zoom level.
2. Push. The Action writes `data/<slug>.json`.
3. Open `?city=<slug>`.

Data and map tiles © OpenStreetMap contributors, ODbL.
