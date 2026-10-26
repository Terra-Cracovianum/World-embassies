/* Shared by the browser (app.js) and the data tool (tools/fetch-missions.mjs):
   one Overpass query and one normaliser, so a city fetched live in the browser and a
   city snapshotted by the GitHub Action come out identical. */

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

/* OSM `diplomatic=*` → the three groups the map filters by.
   A nunciature is the Holy See's embassy; a high commission is a Commonwealth one. */
const GROUP = {
  embassy: 'embassy',
  high_commission: 'embassy',
  nunciature: 'embassy',
  consulate: 'consulate',
  consulate_general: 'consulate',
  vice_consulate: 'consulate',
  honorary_consulate: 'consulate',
  consular_agency: 'consulate',
};

/* A bounding box rather than the city's boundary area: far cheaper for Overpass to answer,
   and a mission just over the city line still belongs on the city's map. bbox = [south, west, north, east]. */
export function overpassQuery(city) {
  const bbox = city.bbox.join(',');
  return `[out:json][timeout:120];
(
  nwr["office"="diplomatic"](${bbox});
  nwr["amenity"="embassy"](${bbox});
);
out center tags;`;
}

function clean(s) {
  return typeof s === 'string' && s.trim() ? s.trim() : null;
}

function address(t) {
  const street = [clean(t['addr:street']) || clean(t['addr:place']), clean(t['addr:housenumber'])]
    .filter(Boolean).join(' ');
  const city = [clean(t['addr:postcode']), clean(t['addr:city'])].filter(Boolean).join(' ');
  return [street, city].filter(Boolean).join(', ') || clean(t['addr:full']);
}

function website(t) {
  const w = clean(t.website) || clean(t['contact:website']) || clean(t.url);
  if (!w) return null;
  return /^https?:\/\//i.test(w) ? w : `https://${w}`;
}

/* Overpass JSON → the file format the map reads. Elements without a sending country
   or a position are dropped: the map can't place or name them. */
export function normalise(osm, city) {
  const seen = new Map();
  const missions = [];
  for (const el of osm.elements || []) {
    const t = el.tags || {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const country = clean(t.country)?.toUpperCase().split(/[;,]/)[0].trim();
    if (lat == null || lon == null || !country) continue;

    const kind = clean(t.diplomatic) || (t.amenity === 'embassy' ? 'embassy' : null);
    const group = GROUP[kind] || 'other';
    const key = `${country}|${kind}|${lat.toFixed(4)}|${lon.toFixed(4)}`;
    const mission = {
      id: `${el.type}/${el.id}`,
      group,
      kind: kind || 'mission',
      country,
      name: clean(t['name:en']) || clean(t.name),
      nameLocal: clean(t.name),
      lat: +lat.toFixed(6),
      lon: +lon.toFixed(6),
      address: address(t),
      website: website(t),
      phone: clean(t.phone) || clean(t['contact:phone']),
    };

    // Same mission mapped twice (an office node inside a tagged building): keep one, fill its gaps.
    const twin = seen.get(key);
    if (twin) {
      for (const [k, v] of Object.entries(mission)) if (twin[k] == null) twin[k] = v;
      continue;
    }
    seen.set(key, mission);
    missions.push(mission);
  }
  missions.sort((a, b) => a.country.localeCompare(b.country) || a.group.localeCompare(b.group) || a.id.localeCompare(b.id));
  return {
    city: city.slug,
    generated: new Date().toISOString(),
    source: 'OpenStreetMap contributors, ODbL — via the Overpass API',
    count: missions.length,
    missions,
  };
}

/* Tries each endpoint in turn, `rounds` times over, waiting a little longer between rounds:
   the public Overpass servers shed load with 429/504 and usually answer a minute later. */
export async function fetchMissions(city, {
  endpoints = OVERPASS_ENDPOINTS, headers = {}, rounds = 1, timeoutMs = 45000, log = () => {},
} = {}) {
  const body = new URLSearchParams({ data: overpassQuery(city) });
  const errors = [];
  for (let round = 0; round < rounds; round++) {
    if (round) await new Promise((r) => setTimeout(r, 15000 * round));
    for (const url of endpoints) {
      try {
        const res = await fetch(url, { method: 'POST', body, headers, signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) throw new Error(`answered ${res.status}`);
        const data = normalise(await res.json(), city);
        log(`${url}: ${data.count} missions`);
        return data;
      } catch (err) {
        errors.push(`${url}: ${err.message}`);
        log(`${url}: ${err.message}`);
      }
    }
  }
  throw new Error(`every Overpass endpoint failed —\n  ${errors.join('\n  ')}`);
}
