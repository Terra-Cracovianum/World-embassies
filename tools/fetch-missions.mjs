#!/usr/bin/env node
/* Snapshot every city in data/cities.json from OpenStreetMap into data/<slug>.json.
   Run by .github/workflows/refresh-data.yml; also works locally: `node tools/fetch-missions.mjs [slug]`. */
import { readFile, writeFile } from 'node:fs/promises';
import { fetchMissions } from '../lib/missions.mjs';

const root = new URL('../', import.meta.url);
const cities = JSON.parse(await readFile(new URL('data/cities.json', root), 'utf8'));
const overrides = JSON.parse(await readFile(new URL('data/overrides.json', root), 'utf8'));
const only = process.argv[2];

let failed = false;
for (const city of cities) {
  if (only && city.slug !== only) continue;
  try {
    const data = await fetchMissions(city, {
      headers: { 'User-Agent': 'TerraCracovianum-WorldEmbassies/1.0 (+https://github.com/Terra-Cracovianum/World-embassies)' },
      rounds: 3,
      timeoutMs: 150000,
      log: (line) => console.log(`  ${line}`),
    });
    for (const m of data.missions) Object.assign(m, overrides[m.id]?.set);
    if (data.count === 0) throw new Error('Overpass returned no missions — refusing to overwrite with an empty file');
    await writeFile(new URL(`data/${city.slug}.json`, root), JSON.stringify(data, null, 1) + '\n');
    const by = data.missions.reduce((n, m) => ({ ...n, [m.group]: (n[m.group] || 0) + 1 }), {});
    console.log(`${city.slug}: ${data.count} missions`, by);
  } catch (err) {
    failed = true;
    console.error(`${city.slug}: ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
