# World Embassies

A Terra Cracovianum tool: every embassy and consulate in a city, on one map. Polish by default, English via the PL/EN switch (or `?lang=en`).
Cities: 164 — every European capital, the capitals of the 50 largest economies (IMF, nominal GDP 2025) and of most other states a foreign-policy analyst asks about (the Gulf, the Levant, Central Asia, the Sahel, Latin America), the seats of international organisations (New York, Geneva, Strasbourg, Brussels, Vienna, Nairobi, Addis Ababa), and the consular cities where most countries keep a post outside the capital (Istanbul, Frankfurt, Milan, Shanghai, Hong Kong, Mumbai, Lagos, Los Angeles, São Paulo …), plus Kraków, Gdańsk, Wrocław and Lviv. See `data/cities.json`. The globe's index and the city menu group them by region: Europe, the Americas, Asia & Pacific, the Middle East, Africa. Open one from the globe, the index beside it, the city menu on a map, or `?city=<slug>`.

Live: https://terra-cracovianum.github.io/World-embassies/

## Embedding on terracracovianum.org

Like the election maps, the page is just the tool, with no masthead or footer, so it can sit in an iframe under the site's own page title:

```html
<iframe class="wybory-frame" src="https://terra-cracovianum.github.io/World-embassies/" title="Ambasady i konsulaty w Warszawie"></iframe>
```

## How it works

- **The globe** (`globe.js`) opens the page: Natural Earth land drawn as survey dots with d3-geo on a canvas,
  one pin per city. `app.js` choreographs three moves out of it:
  - globe → city: the globe turns and dives; at the scale where it matches the map at zoom 5
    (`Globe.scaleForZoom`), the map irises open around the city and flies down to street level;
  - city → globe: the reverse;
  - city → city: a flight. Up out of the map, the great-circle route draws itself with the distance
    counting, then down into the next city.
  Each city has its own address (`?city=paris`), and the browser's back button replays the moves.
  `prefers-reduced-motion` turns every move into a cut.
- `assets/globe/` holds the land and dot layers, built by `tools/build-globe.mjs` (instructions inside).

- `index.html` · `styles.css` · `app.js`: a static page with no build step. Leaflet is vendored in `assets/vendor/leaflet`.
  Fonts and colour tokens are copied from the institute's site (see `DESIGN.md` in `Terra-Cracovianum-Website-`).
- `data/cities.json`: the cities the map knows, each with a bounding box.
- `data/<city>.json`: a snapshot of the city's missions from OpenStreetMap, written by `tools/fetch-missions.mjs`.
  The **Refresh mission data** GitHub Action runs it every Monday, on demand, and whenever the data code changes — one parallel job per city — then commits the result. `node tools/check-data.mjs` reports per-city health.
  Ambassadors' residences are left out.
- Photos come from Wikimedia Commons, found by `tools/photos.mjs` in the same Action, using the mission's OSM
  `wikimedia_commons` / `image` / `wikidata` tags first, then categories like "Embassy of Mexico in Warsaw".
  Each popup credits the author and licence and links to the file.
- Flags: `assets/flags`, from [flag-icons](https://github.com/lipis/flag-icons) (MIT).
- `data/overrides.json`: fixes for OpenStreetMap errors, keyed by OSM id. Better still, fix the error on openstreetmap.org and delete the override.
  For a wrong photo, set `"commons": "File:Better photo.jpg"` (or `"photo": null` to hide it).
- If a city has no snapshot yet, the page asks OpenStreetMap (Overpass API) live instead.

## Add a city

1. Add an entry to `data/cities.json` with its name, a bounding box (`[south, west, north, east]`), a centre and a zoom level.
2. Push. The Action writes `data/<slug>.json`.
3. Open `?city=<slug>`.

Data and map tiles © OpenStreetMap contributors, ODbL.
