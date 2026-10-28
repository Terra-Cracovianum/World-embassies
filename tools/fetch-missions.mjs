#!/usr/bin/env node
/* Snapshot every city in data/cities.json from OpenStreetMap into data/<slug>.json.
   Run by .github/workflows/refresh-data.yml; also works locally: `node tools/fetch-missions.mjs [slug]`. */
import { readFile, writeFile } from 'node:fs/promises';
import { fetchMissions } from '../lib/missions.mjs';
import { addPhotos } from './photos.mjs';
import { wikidataMissions, mergeMissing } from './wikidata.mjs';
import { PART_OF } from '../lib/countries.mjs';

const root = new URL('../', import.meta.url);
const cities = JSON.parse(await readFile(new URL('data/cities.json', root), 'utf8'));
const overrides = JSON.parse(await readFile(new URL('data/overrides.json', root), 'utf8'));
// `node tools/fetch-missions.mjs [slug]` fetches one city (or all); `--index-only` just rebuilds data/index.json.
const indexOnly = process.argv.includes('--index-only');
const only = process.argv.slice(2).find((a) => !a.startsWith('--'));

let failed = false;
let first = true;
for (const city of indexOnly ? [] : cities) {
  if (only && city.slug !== only) continue;
  if (!first) await new Promise((r) => setTimeout(r, 10000)); // a breath between cities: Overpass throttles bursts
  first = false;
  try {
    const data = await fetchMissions(city, {
      headers: { 'User-Agent': 'TerraCracovianum-WorldEmbassies/1.0 (+https://github.com/Terra-Cracovianum/World-embassies)' },
      rounds: 3,
      timeoutMs: 150000,
      log: (line) => console.log(`  ${line}`),
    });
    if (data.count === 0) throw new Error('Overpass returned no missions — refusing to overwrite with an empty file');
    // overrides: `set` corrects fields; `drop` removes an entry that isn't a foreign mission at all
    data.missions = data.missions.filter((m) => !overrides[m.id]?.drop);
    data.count = data.missions.length;
    const before = await readFile(new URL(`data/${city.slug}.json`, root), 'utf8').then(JSON.parse).catch(() => ({ missions: [] }));
    // Then what OpenStreetMap lacks, from Wikidata. If Wikidata can't be reached, last run's additions stay.
    let extra;
    try {
      extra = await wikidataMissions(city);
    } catch (err) {
      console.log(`  wikidata: ${err.message} — keeping the previous additions`);
      extra = before.missions.filter((m) => m.source === 'wikidata');
    }
    const added = mergeMissing(data, extra.filter((m) => !overrides[m.id]?.drop), city.country, PART_OF[city.country]);
    console.log(`  wikidata: ${extra.length} missions, ${added} missing from OpenStreetMap`);
    if (added) data.source = 'OpenStreetMap contributors, ODbL — via the Overpass API; Wikidata, CC0';
    for (const m of data.missions) Object.assign(m, overrides[m.id]?.set);
    const previous = Object.fromEntries(before.missions.filter((m) => m.photo).map((m) => [m.id, m.photo]));
    await addPhotos(data, city, (line) => console.log(`  ${line}`), previous);
    await writeFile(new URL(`data/${city.slug}.json`, root), JSON.stringify(data, null, 1) + '\n');
    const by = data.missions.reduce((n, m) => ({ ...n, [m.group]: (n[m.group] || 0) + 1 }), {});
    console.log(`${city.slug}: ${data.count} missions`, by);
  } catch (err) {
    failed = true;
    console.error(`${city.slug}: ${err.message}`);
  }
}
// A small summary for the globe's opening screen, so it can count missions without loading every city.
const index = {};
for (const city of cities) {
  try {
    const { missions, generated } = JSON.parse(await readFile(new URL(`data/${city.slug}.json`, root), 'utf8'));
    const count = (g) => missions.filter((m) => m.group === g).length;
    index[city.slug] = { count: missions.length, embassies: count('embassy'), consulates: count('consulate'), generated };
  } catch { /* not snapshotted yet: the page falls back to a live query */ }
}
await writeFile(new URL('data/index.json', root), JSON.stringify(index, null, 1) + '\n');

process.exit(failed ? 1 : 0);
