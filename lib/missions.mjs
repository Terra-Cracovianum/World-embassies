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
import { countryFromName } from './countries.mjs';

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

/* Codes some mappers use in place of ISO 3166-1 alpha-2. */
const COUNTRY_ALIAS = {
  KRLD: 'KP', UK: 'GB', USA: 'US', GBR: 'GB', DEU: 'DE', FRA: 'FR', CHN: 'CN', JPN: 'JP', IND: 'IN', CAN: 'CA',
  BRA: 'BR', RUS: 'RU', KOR: 'KR', AUS: 'AU', MEX: 'MX', TUR: 'TR', IDN: 'ID', SAU: 'SA', NLD: 'NL', ITA: 'IT', ESP: 'ES',
};

/* Names are compared without accents, so "Résidence" and "École" match too. */
const plain = (s) => (s || '').normalize('NFD').replace(/\p{M}/gu, '');
/* Ambassadors' residences and embassy schools are often tagged like embassies; nobody goes there for a visa. */
const NOT_A_MISSION = /rezydencj|residen|\b(ecole|school|lycee|szkola|schule|scuola|escuela|escola|colegio)\b|公邸|官邸|관저|резиденция/i;
/* Delegations to an international organisation, not to the host state: the OECD and UNESCO in Paris,
   the EU and NATO in Brussels, the UN and OSCE in Vienna, the FAO in Rome. */
const PERMANENT = /permanent (mission|delegation|representation)|(mission|delegation|representation) permanente|representation permanente|standige vertretung|sta[lł]e przedstawicielstwo|\b(oecd|ocde|unesco|nato|otan|osce|fao|ifad|wfp)\b|to the (eu|european union|united nations|un)\b/i;

/* A bounding box rather than the city's boundary area: far cheaper for Overpass to answer,
   and a mission just over the city line still belongs on the city's map. bbox = [south, west, north, east]. */
export function overpassQuery(city) {
  const bbox = city.bbox.join(',');
  return `[out:json][timeout:120];
(
  nwr["office"="diplomatic"](${bbox});
  nwr["amenity"="embassy"](${bbox});
  nwr["diplomatic"~"^(embassy|consulate|consulate_general|honorary_consulate|high_commission|nunciature)$"](${bbox});
);
out center tags;`;
}

function metres(a, b) {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * 6371000;
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
    const code = clean(t.country)?.toUpperCase().split(/[;,]/)[0].trim();
    let country = COUNTRY_ALIAS[code] || code;
    let inferred = false;
    if (!country) {
      // Mapped without a country tag: read it from the name. A name that only names the host
      // country is a host-government office, not a foreign mission.
      const named = [t.name, t['name:en'], t.official_name, t['official_name:en'], t.operator,
        ...Object.keys(t).filter((k) => k.startsWith('name:')).map((k) => t[k])];
      country = countryFromName(named, city.country); // never the host: a name naming only it is a host office
      inferred = !!country;
    }
    if (lat == null || lon == null || !country) continue;
    const names = plain(`${t.name || ''} ${t['name:en'] || ''} ${t['name:pl'] || ''}`);
    if (t.diplomatic === 'ambassadors_residence' || t.diplomatic === 'residence' || NOT_A_MISSION.test(names)) continue;

    let kind = clean(t.diplomatic) || (t.amenity === 'embassy' ? 'embassy' : null);
    // Mappers often tag every consulate plainly; its name usually says which kind it is.
    if (kind === 'consulate') {
      if (/honor/i.test(names)) kind = 'honorary_consulate';
      else if (/general/i.test(names)) kind = 'consulate_general'; // also matches "generalny", "général"
    }
    if (PERMANENT.test(names)) kind = 'permanent_mission';
    const group = GROUP[kind] || 'other';
    const key = `${country}|${kind}`;
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
      ...(inferred && { inferred: true }), // country read from the name, not tagged
      // Pointers to a photo; tools/photos.mjs resolves them and removes them.
      wikidata: clean(t.wikidata),
      commons: clean(t.wikimedia_commons),
      image: clean(t.image),
    };

    // Same mission mapped twice (an office node inside or beside a tagged building): keep one, fill its gaps.
    const twin = (seen.get(key) || []).find((m) => metres(m, mission) < 150);
    if (twin) {
      for (const [k, v] of Object.entries(mission)) if (twin[k] == null) twin[k] = v;
      continue;
    }
    seen.set(key, [...(seen.get(key) || []), mission]);
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
