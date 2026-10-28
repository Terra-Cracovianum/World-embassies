/* Missions OpenStreetMap doesn't have yet, from Wikidata. OSM is thin wherever consulates sit high up
   in office towers (Hong Kong had 30 of its 100-odd, and not Poland's), and Wikidata often holds the
   very missions it lacks, with coordinates and the sending state as operator (P137). Only missions
   OSM is missing are added: one with the same Wikidata item, or the same sending country and group,
   is already on the map. Node only — runs inside the GitHub Action. */
import { countryMatch } from '../lib/countries.mjs';

const UA = 'TerraCracovianum-WorldEmbassies/1.0 (+https://github.com/Terra-Cracovianum/World-embassies)';
const SPARQL = 'https://query.wikidata.org/sparql';

/* Every diplomatic mission (Q7843791 and its subclasses: embassy, consulate general, honorary
   consulate …) inside the city's box, still open, with its sending state's ISO code where it has one. */
function query([s, w, n, e]) {
  return `SELECT ?m ?mLabel ?coord ?iso (GROUP_CONCAT(DISTINCT ?tl; separator="|") AS ?types)
       (SAMPLE(?site) AS ?website) (SAMPLE(?addr) AS ?address) WHERE {
  SERVICE wikibase:box {
    ?m wdt:P625 ?coord .
    bd:serviceParam wikibase:cornerSouthWest "Point(${w} ${s})"^^geo:wktLiteral ;
                    wikibase:cornerNorthEast "Point(${e} ${n})"^^geo:wktLiteral .
  }
  ?m wdt:P31/wdt:P279* wd:Q7843791 .
  FILTER NOT EXISTS { ?m wdt:P576 [] }
  OPTIONAL { ?m wdt:P137 ?op . ?op wdt:P297 ?iso }
  OPTIONAL { ?m wdt:P31 ?t . ?t rdfs:label ?tl . FILTER(lang(?tl) = "en") }
  OPTIONAL { ?m wdt:P856 ?site }
  OPTIONAL { ?m wdt:P6375 ?addr . FILTER(lang(?addr) = "en" || lang(?addr) = "") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,fr,de,es,ru,zh,ar,pl" . ?m rdfs:label ?mLabel . }
} GROUP BY ?m ?mLabel ?coord ?iso`;
}

/* What kind of mission, from its Wikidata classes and its name. */
function kindOf(text) {
  if (/honorary/.test(text)) return 'honorary_consulate';
  if (/consul/.test(text)) return /general/.test(text) ? 'consulate_general' : 'consulate';
  if (/permanent (mission|delegation|representation)|delegation to|mission to the/.test(text)) return 'permanent_mission';
  if (/nunciature/.test(text)) return 'nunciature';
  if (/high commission/.test(text)) return 'high_commission';
  if (/embass/.test(text)) return 'embassy';
  if (/liaison|representative office|trade office|economic and cultural|representation/.test(text)) return 'liaison';
  return 'mission';
}
const GROUP = { embassy: 'embassy', high_commission: 'embassy', nunciature: 'embassy',
  consulate: 'consulate', consulate_general: 'consulate', honorary_consulate: 'consulate' };
const NOT_A_MISSION = /residen|school|former|old building/i;

export async function wikidataMissions(city) {
  const body = new URLSearchParams({ query: query(city.bbox) });
  const res = await fetch(SPARQL, {
    method: 'POST', body,
    headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`query.wikidata.org answered ${res.status}`);
  const seen = new Set();
  const missions = [];
  for (const row of (await res.json()).results.bindings) {
    const v = (k) => row[k]?.value || null;
    const qid = v('m').split('/').pop();
    const name = v('mLabel');
    if (seen.has(qid) || !name || name === qid || NOT_A_MISSION.test(name)) continue;
    seen.add(qid);
    const [lon, lat] = v('coord').match(/-?[\d.]+/g).map(Number);
    // the sending state: its ISO code, or else read from the name ("Consulate-General of the Netherlands")
    const country = v('iso') || countryMatch([name], city.country)?.code;
    if (!country || country === city.country) continue;
    const kind = kindOf(`${v('types') || ''} ${name}`.toLowerCase());
    missions.push({
      id: `wikidata/${qid}`,
      group: GROUP[kind] || 'other',
      kind,
      country,
      name,
      nameLocal: null,
      lat: +lat.toFixed(6),
      lon: +lon.toFixed(6),
      address: v('address'),
      website: v('website'),
      phone: null,
      source: 'wikidata',
      wikidata: qid, // tools/photos.mjs reads its P18 photo
    });
  }
  return missions;
}

/* Adds the Wikidata missions OSM lacks to `data`; returns how many. */
export function mergeMissing(data, extra, host, partOf = []) {
  const known = new Set(data.missions.map((m) => m.wikidata).filter(Boolean));
  const covered = new Set(data.missions.map((m) => `${m.country}|${m.group}`));
  let added = 0;
  for (const m of extra) {
    if (known.has(m.wikidata) || covered.has(`${m.country}|${m.group}`) || partOf.includes(m.country)) continue;
    covered.add(`${m.country}|${m.group}`);
    data.missions.push(m);
    added++;
  }
  data.missions.sort((a, b) => a.country.localeCompare(b.country) || a.group.localeCompare(b.group) || a.id.localeCompare(b.id));
  data.count = data.missions.length;
  return added;
}
