/* Reads the sending country out of a mission's name, for missions mapped without a `country`
   tag ("Embassy of Mexico", "Ambassade de France", "Botschaft von Japan"). Country names come
   from Intl.DisplayNames in the languages of the cities we map, plus the long official forms and
   abbreviations embassies like to use. The longest name found wins, so "Equatorial Guinea"
   beats "Guinea" and "Democratic People's Republic of Korea" beats "Republic of Korea". */

const LANGS = ['en', 'fr', 'de', 'it', 'es', 'pt', 'nl', 'pl', 'sv', 'da', 'nb', 'fi', 'cs', 'hu', 'el', 'uk', 'ru'];
// Region codes that are not countries (or not senders of missions).
const NOT_COUNTRIES = new Set(['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ', 'AQ', 'BV', 'HM', 'UM', 'IC', 'EA', 'DG', 'CP', 'TA', 'AC']);

const ALIASES = {
  US: ['united states of america', 'usa', 'u.s.', 'u.s.a.', 'american embassy', 'stany zjednoczone'],
  GB: ['united kingdom', 'great britain', 'british embassy', 'british high commission'],
  KR: ['republic of korea', 'korea republic', 'rok'],
  KP: ["democratic people's republic of korea", 'dprk', 'north korea'],
  CN: ["people's republic of china", 'chinese embassy'],
  TW: ['taipei', 'taiwan'],
  RU: ['russian federation'],
  CZ: ['czech republic', 'republique tcheque', 'tschechische republik'],
  VA: ['holy see', 'apostolic nunciature', 'nunciature apostolique', 'nunziatura apostolica', 'apostolische nuntiatur', 'nunciatura apostolica', 'nuncjatura'],
  CI: ["cote d'ivoire", 'ivory coast'],
  TR: ['turkiye', 'turkey'],
  CD: ['democratic republic of the congo', 'dr congo', 'rd congo'],
  CG: ['republic of the congo'],
  MK: ['north macedonia', 'macedonia'],
  BA: ['bosnia and herzegovina', 'bosnia'],
  PS: ['palestine', 'state of palestine'],
  IR: ['islamic republic of iran'],
  SY: ['syrian arab republic'],
  LA: ["lao people's democratic republic"],
  VN: ['viet nam'],
  MD: ['republic of moldova'],
  XK: ['kosovo'],
  AE: ['united arab emirates', 'uae'],
  SA: ['saudi arabia', 'kingdom of saudi arabia'],
};

const plain = (s) => (s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’`´]/g, "'");
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let table = null;
function build() {
  const names = new Map(); // plain name → code
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const lang of LANGS) {
    let dn;
    try { dn = new Intl.DisplayNames([lang], { type: 'region' }); } catch { continue; }
    for (const a of letters) for (const b of letters) {
      const code = a + b;
      if (NOT_COUNTRIES.has(code)) continue;
      let name;
      try { name = dn.of(code); } catch { continue; }
      if (!name || name === code) continue;
      const p = plain(name);
      if (p.length >= 4 && !names.has(p)) names.set(p, code);
    }
  }
  for (const [code, list] of Object.entries(ALIASES)) for (const n of list) names.set(plain(n), code);
  // longest first; whole words only, so "niger" never matches inside "nigeria"
  return [...names.entries()]
    .sort((x, y) => y[0].length - x[0].length)
    .map(([name, code]) => ({ code, re: new RegExp(`(^|[^\\p{L}])${escape(name)}($|[^\\p{L}])`, 'u') }));
}

/* `texts`: the mission's names. Returns an ISO code, or null when no country name is found. */
export function countryFromName(texts) {
  table ??= build();
  const hay = texts.filter(Boolean).map(plain);
  if (!hay.length) return null;
  for (const { code, re } of table) if (hay.some((h) => re.test(h))) return code;
  return null;
}
