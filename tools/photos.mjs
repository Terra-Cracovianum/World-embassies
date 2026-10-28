/* Finds a photo of each mission on Wikimedia Commons, with the credit its licence requires.
   Tried in order: the mission's own OSM tags (wikimedia_commons, image, wikidata → P18 / P373),
   then the Commons category Wikipedians usually file embassy photos under
   ("Embassy of Mexico in Warsaw"). Node only — runs inside the GitHub Action. */

const UA = 'TerraCracovianum-WorldEmbassies/1.0 (+https://github.com/Terra-Cracovianum/World-embassies)';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const IMAGE = /\.(jpe?g|png|webp|tiff?)$/i;
const english = new Intl.DisplayNames(['en'], { type: 'region' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP_MS = 250; // ~4 requests a second: Wikimedia answers 429 to anything much faster
let last = 0;
// A city's photos get a fixed share of the job: when many cities run at once Wikimedia slows to a
// crawl, and a job cut off by its timeout saves nothing at all. Past the budget, missions keep the
// photo an earlier run found and the rest wait for the next run.
const BUDGET_MS = Number(process.env.PHOTO_BUDGET_MIN || 12) * 60000;
let deadline = Infinity;

/* Paced, and retried when Wikimedia says "too many" (429) or is briefly down (5xx). */
async function getJSON(url, params) {
  const u = new URL(url);
  if (params) for (const [k, v] of Object.entries({ format: 'json', ...params })) u.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const res = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 4 && Date.now() < deadline) {
      const after = Number(res.headers.get('retry-after'));
      await sleep(Math.min(60, after > 0 ? after : 5 * 2 ** attempt) * 1000);
      continue;
    }
    throw new Error(`${u.host} answered ${res.status}`);
  }
}

const fileTitle = (name) => `File:${decodeURIComponent(name).replace(/^(File|Image):/i, '').replace(/_/g, ' ')}`;

/* "File:x.jpg", a commons.wikimedia.org/wiki/File:… link, or an upload.wikimedia.org URL → "File:x.jpg" */
function fileFrom(value) {
  if (!value) return null;
  if (/^(File|Image):/i.test(value)) return fileTitle(value);
  const wiki = value.match(/commons\.wikimedia\.org\/wiki\/((?:File|Image):[^?#]+)/i);
  if (wiki) return fileTitle(wiki[1]);
  const upload = value.match(/upload\.wikimedia\.org\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/i);
  if (upload) return fileTitle(upload[1]);
  return null;
}

async function firstImageIn(category) {
  const data = await getJSON(COMMONS, {
    action: 'query', list: 'categorymembers', cmtitle: `Category:${category.replace(/^Category:/i, '')}`,
    cmtype: 'file', cmlimit: '30', cmsort: 'sortkey',
  });
  return data.query?.categorymembers?.map((m) => m.title).find((t) => IMAGE.test(t)) || null;
}

async function wikidataPointers(qid) {
  const data = await getJSON(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
  const claims = Object.values(data.entities || {})[0]?.claims || {};
  const value = (p) => claims[p]?.[0]?.mainsnak?.datavalue?.value;
  return { file: value('P18') ? fileTitle(value('P18')) : null, category: value('P373') || null };
}

const stripHtml = (s) => (s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

async function describe(title) {
  const data = await getJSON(COMMONS, {
    action: 'query', titles: title, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '480',
  });
  const page = Object.values(data.query?.pages || {})[0];
  const info = page?.imageinfo?.[0];
  if (!info?.thumburl) return null;
  const meta = info.extmetadata || {};
  return {
    thumb: info.thumburl,
    page: info.descriptionurl,
    author: stripHtml(meta.Artist?.value).slice(0, 80) || null,
    license: stripHtml(meta.LicenseShortName?.value) || null,
  };
}

function categoryGuesses(m, city) {
  let name;
  try { name = english.of(m.country); } catch { return []; } // not an ISO region (e.g. SMOM)
  if (!name || name === m.country) return [];
  const place = city.name.en;
  const kinds = m.group === 'consulate'
    ? ['Consulate General of', 'Consulate of', 'Honorary Consulate of']
    : ['Embassy of'];
  return kinds.flatMap((k) => [`${k} ${name} in ${place}`, `${k} the ${name} in ${place}`]);
}

async function photoFor(m, city) {
  const tried = new Set();
  const tryFile = async (title) => {
    if (!title || tried.has(title) || !IMAGE.test(title)) return null;
    tried.add(title);
    return describe(title);
  };
  const tryCategory = async (category) => (category ? tryFile(await firstImageIn(category)) : null);

  const commons = m.commons || '';
  let photo = await tryFile(fileFrom(commons)) || await tryFile(fileFrom(m.image));
  if (!photo && /^Category:/i.test(commons)) photo = await tryCategory(commons);
  if (!photo && m.wikidata) {
    const wd = await wikidataPointers(m.wikidata);
    photo = await tryFile(wd.file) || await tryCategory(wd.category);
  }
  for (const guess of photo ? [] : categoryGuesses(m, city)) {
    photo = await tryCategory(guess);
    if (photo) break;
  }
  return photo;
}

/* `previous` maps mission id → the photo from the last snapshot. A lookup that fails keeps it,
   so one bad run against Wikimedia can't strip the map of its photos. */
export async function addPhotos(data, city, log = () => {}, previous = {}) {
  let found = 0;
  let failed = 0;
  let skipped = 0;
  deadline = Date.now() + BUDGET_MS;
  for (const m of data.missions) {
    if (!('photo' in m) && Date.now() > deadline) {
      m.photo = previous[m.id] ?? null;
      if (!m.photo) skipped++;
    } else try {
      // An override may already have set the photo (or null, to hide a bad one). A photo found on an
      // earlier run is kept without asking again, so the weekly run only looks for the missing ones;
      // PHOTO_REFRESH=1 re-checks everything.
      if (!('photo' in m)) {
        m.photo = (!process.env.PHOTO_REFRESH && previous[m.id]) || await photoFor(m, city);
      }
    } catch (err) {
      m.photo = previous[m.id] ?? null;
      failed++;
      log(`${m.id} (${m.country}): ${err.message}${m.photo ? ' — kept the previous photo' : ''}`);
    }
    if (m.photo) found++;
    delete m.commons;
    delete m.image;
  }
  log(`photos: ${found} of ${data.missions.length}${failed ? ` (${failed} lookups failed)` : ''}${skipped ? ` (${skipped} left for the next run: out of time)` : ''}`);
}
