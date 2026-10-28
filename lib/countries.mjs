/* Reads the sending country out of a mission's name, for missions mapped without a `country`
   tag ("Embassy of Mexico", "Ambassade de France", "Botschaft von Japan"). Country names come
   from Intl.DisplayNames in the languages of the cities we map, plus the long official forms and
   abbreviations embassies like to use. The longest name found wins, so "Equatorial Guinea"
   beats "Guinea" and "Democratic People's Republic of Korea" beats "Republic of Korea". */

const LANGS = ['en', 'fr', 'de', 'it', 'es', 'pt', 'nl', 'pl', 'sv', 'da', 'nb', 'fi', 'cs', 'hu', 'el', 'uk', 'ru',
  'zh', 'zh-Hant', 'ja', 'ko', 'tr', 'id', 'ar', 'hi'];
// Scripts written without spaces between words: their names can't be matched as whole words.
const UNSPACED = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;
// Region codes that are not countries (or not senders of missions).
const NOT_COUNTRIES = new Set(['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ', 'AQ', 'BV', 'HM', 'UM', 'IC', 'EA', 'DG', 'CP', 'TA', 'AC',
  // historical states Intl still names (East Germany, the USSR, Yugoslavia …)
  'DD', 'SU', 'YU', 'CS', 'ZR', 'BU', 'TP', 'NT', 'YD', 'FX', 'AN', 'RH', 'DY', 'HV', 'NH', 'VD']);
// Languages that decline country names ("Посольство Франции", "Ambasada Francji"): their names are
// matched by stem, the last letter dropped and up to three letters of ending allowed. A Latin-script stem
// needs six letters ("Kongo" → "Kong" would match inside "Hong Kong"); Cyrillic five (Китай, Катар, Индия).
const INFLECTED = new Set(['ru', 'uk', 'pl', 'cs']);

const ALIASES = {
  US: ['united states of america', 'usa', 'u.s.', 'u.s.a.', 'american embassy', 'stany zjednoczone', 'сша'],
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
      if ((p.length >= 4 || (UNSPACED.test(p) && p.length >= 2)) && !names.has(p)) names.set(p, { code, stem: INFLECTED.has(lang) && p.length >= (/[\u0400-\u04ff]/.test(p) ? 5 : 6) });
    }
  }
  for (const [code, list] of Object.entries(ALIASES)) for (const n of list) names.set(plain(n), { code, stem: false });
  // longest first; whole words only ("niger" never matches inside "nigeria"), except in scripts
  // without spaces, where a name sits directly against the next word (法国大使馆)
  return [...names.entries()]
    .sort((x, y) => y[0].length - x[0].length)
    .map(([name, { code, stem }]) => ({
      code,
      re: UNSPACED.test(name) ? new RegExp(escape(name), 'u')
        : stem ? new RegExp(`(^|[^\\p{L}])${escape(name.slice(0, -1))}\\p{L}{0,3}($|[^\\p{L}])`, 'u')
        : new RegExp(`(^|[^\\p{L}])${escape(name)}($|[^\\p{L}])`, 'u'),
    }));
}

/* `texts`: the mission's names; `host`: the country the city is in. Returns the ISO code of the
   longest country name found that isn't the host — "美国驻中国大使馆" (the US embassy in China)
   names both, and the sender is the one that isn't China — or null when there is none. */
export function countryFromName(texts, host = null) {
  table ??= build();
  const hay = texts.filter(Boolean).map(plain);
  if (!hay.length) return null;
  for (const { code, re } of table) if (code !== host && hay.some((h) => re.test(h))) return code;
  return null;
}
