#!/usr/bin/env node
/* A health report on the snapshots: `node tools/check-data.mjs`.
   For each city: missions by group, how many countries were read from names rather than tagged,
   photos, entries a visitor can't tell apart, and the embassy count against a rough reference of
   how many resident embassies the capital hosts. OpenStreetMap is the only source, so a city far
   under its reference is a city whose missions are still missing from the map, not from this tool. */
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const cities = JSON.parse(await readFile(new URL('data/cities.json', root), 'utf8'));

// Approximate resident embassies to the host state (diplomatic lists, rounded). Kraków and
// Amsterdam host consulates only; the Netherlands' embassies are in The Hague.
const REFERENCE = {
  warsaw: 100, krakow: 0, paris: 165, london: 160, kyiv: 75, berlin: 155, rome: 130, madrid: 120,
  lisbon: 85, vienna: 115, prague: 90, budapest: 85, brussels: 180, amsterdam: 0, copenhagen: 75,
  stockholm: 100, helsinki: 70, oslo: 60, dublin: 60, athens: 85,
  washington: 175, beijing: 165, tokyo: 155, 'new-delhi': 140, ottawa: 125, brasilia: 130, moscow: 145,
  seoul: 115, canberra: 85, 'mexico-city': 85, ankara: 120, jakarta: 100, riyadh: 115, 'the-hague': 105,
};

let problems = 0;
console.log('city        missions  emb  cons  other  inferred  photos  ref  note');
for (const c of cities) {
  let data;
  try { data = JSON.parse(await readFile(new URL(`data/${c.slug}.json`, root), 'utf8')); }
  catch { console.log(`${c.slug.padEnd(12)}— no snapshot yet`); problems++; continue; }
  const m = data.missions;
  const n = (f) => m.filter(f).length;
  const emb = n((x) => x.group === 'embassy');
  const ref = REFERENCE[c.slug];
  const notes = [];
  if (ref && emb < ref * 0.6) { notes.push(`embassies well under reference`); problems++; }
  const unnamed = n((x) => !x.name && !x.nameLocal);
  if (unnamed) notes.push(`${unnamed} without a name`);
  const twins = new Map();
  for (const x of m) { const k = `${x.country}|${x.group}|${x.nameLocal || x.name || ''}`; twins.set(k, (twins.get(k) || 0) + 1); }
  const dup = [...twins.values()].filter((v) => v > 1).length;
  if (dup) notes.push(`${dup} identical-looking pairs`);
  console.log(
    `${c.slug.padEnd(12)}${String(m.length).padStart(8)}${String(emb).padStart(5)}${String(n((x) => x.group === 'consulate')).padStart(6)}` +
    `${String(n((x) => x.group === 'other')).padStart(7)}${String(n((x) => x.inferred)).padStart(10)}${String(n((x) => x.photo)).padStart(8)}` +
    `${String(ref ?? '?').padStart(5)}  ${notes.join('; ')}`,
  );
}
process.exit(problems ? 1 : 0);
