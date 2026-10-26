/* Finds a photo of each mission on Wikimedia Commons, with the credit its licence requires.
   Tried in order: the mission's own OSM tags (wikimedia_commons, image, wikidata → P18 / P373),
   then the Commons category Wikipedians usually file embassy photos under
   ("Embassy of Mexico in Warsaw"). Node only — runs inside the GitHub Action. */

const UA = 'TerraCracovianum-WorldEmbassies/1.0 (+https://github.com/Terra-Cracovianum/World-embassies)';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const IMAGE = /\.(jpe?g|png|webp|tiff?)$/i;
const english = new Intl.DisplayNames(['en'], { type: 'region' });

async function getJSON(url, params) {
  const u = new URL(url);
  if (params) for (const [k, v] of Object.entries({ format: 'json', ...params })) u.searchParams.set(k, v);
  const res = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${u.host} answered ${res.status}`);
  return res.json();
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

export async function addPhotos(data, city, log = () => {}) {
  let found = 0;
  for (const m of data.missions) {
    try {
      // An override may already have set the photo (or null, to hide a bad one).
      if (!('photo' in m)) m.photo = await photoFor(m, city);
    } catch (err) {
      m.photo = null;
      log(`${m.id} (${m.country}): ${err.message}`);
    }
    if (m.photo) found++;
    delete m.commons;
    delete m.image;
  }
  log(`photos: ${found} of ${data.missions.length}`);
}
