#!/usr/bin/env node
/* Builds the globe's two static layers from Natural Earth (world-atlas, land-110m):
     assets/globe/land.json — land as GeoJSON, filled when the globe dives toward a city
     assets/globe/dots.json — the survey dots: an even-area grid of points that fall on land
   Run once, whenever the look of the dot field should change:
     npm i --no-save d3-geo@3.1.1 topojson-client@3.1.0 world-atlas@2.0.2 && node tools/build-globe.mjs */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

const require = createRequire(new URL(`file://${process.cwd()}/`));
const { geoContains } = require('d3-geo');
const { feature } = require('topojson-client');
const topo = require('world-atlas/land-110m.json');

const root = new URL('../', import.meta.url);
const land = feature(topo, topo.objects.land);

// Rows every STEP degrees; along each row the spacing widens by 1/cos(lat) so the dots stay
// evenly spread over the sphere instead of bunching at the poles.
const STEP = 1.25;
const dots = [];
for (let lat = -58; lat <= 84; lat += STEP) {
  const lonStep = STEP / Math.max(Math.cos((lat * Math.PI) / 180), 0.15);
  const offset = (Math.round(lat / STEP) % 2) * lonStep / 2; // stagger rows: a woven, not square, field
  for (let lon = -180 + offset; lon < 180; lon += lonStep) {
    if (geoContains(land, [lon, lat])) dots.push(+lon.toFixed(2), +lat.toFixed(2));
  }
}

await mkdir(new URL('assets/globe/', root), { recursive: true });
// ~1 km of precision is plenty at the globe's closest zoom, and halves the file.
await writeFile(new URL('assets/globe/land.json', root), JSON.stringify(land, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)));
await writeFile(new URL('assets/globe/dots.json', root), JSON.stringify(dots));
console.log(`land: ${land.features?.length ?? 1} feature(s); dots: ${dots.length / 2}`);
