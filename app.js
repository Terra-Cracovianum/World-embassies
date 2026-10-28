import { fetchMissions, OVERPASS_ENDPOINTS } from './lib/missions.mjs';
import { Globe, ease, distanceKm, greatCircle } from './globe.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- words ---------- */
const T = {
  pl: {
    kicker: 'Mapa dyplomatyczna', title: 'Ambasady i konsulaty',
    kickerLanding: 'Terra Cracovianum · Mapa dyplomatyczna', heroA: 'Ambasady', heroB: 'świata',
    lede: 'Każda ambasada i konsulat w mieście — na jednej mapie. Wybierz miasto na globusie albo z listy.',
    drag: 'Przeciągnij, aby obrócić', globe: 'Globus', cities: 'Miasta', open: 'Otwórz mapę',
    regions: { europe: 'Europa', americas: 'Ameryki', asia: 'Azja i Pacyfik', mideast: 'Bliski Wschód', africa: 'Afryka' },
    navLabel: 'Główne', navHome: 'Strona główna', navPublications: 'Publikacje', navProjects: 'Projekty', navAbout: 'O nas',
    city: 'Miasto', menu: 'Menu', close: 'Zamknij', dark: 'Tryb ciemny', changeLang: 'Zmień język', languages: 'Języki',
    search: 'Szukaj kraju lub ulicy', show: 'Pokaż', all: 'Wszystkie', embassies: 'Ambasady', consulates: 'Konsulaty',
    findCity: 'Miasto lub kraj', empty: 'Brak wyników.', source: 'Dane', loading: 'Wczytywanie placówek…', live: 'na żywo',
    loadingLive: 'Ta mapa jest jeszcze przygotowywana — pobieram placówki prosto z OpenStreetMap (do pół minuty)…',
    failed: 'Nie udało się wczytać danych z OpenStreetMap.', retry: 'Spróbuj ponownie',
    preparing: 'Mapa tego miasta jest jeszcze przygotowywana. Zajrzyj za kilka minut.',
    count: (n) => `<b>${n}</b> ${n === 1 ? 'placówka' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'placówki' : 'placówek'}`,
    website: 'Strona', directions: 'Dojazd', photo: 'Fot.',
    kinds: {
      embassy: 'Ambasada', high_commission: 'Wysoka komisja', nunciature: 'Nuncjatura apostolska',
      consulate: 'Konsulat', consulate_general: 'Konsulat generalny', vice_consulate: 'Wicekonsulat',
      honorary_consulate: 'Konsulat honorowy', consular_agency: 'Agencja konsularna',
      permanent_mission: 'Stałe przedstawicielstwo', delegation: 'Delegatura', liaison: 'Biuro łącznikowe',
    },
    mission: 'Przedstawicielstwo',
  },
  en: {
    kicker: 'Diplomatic map', title: 'Embassies and consulates',
    kickerLanding: 'Terra Cracovianum · Diplomatic map', heroA: 'Embassies', heroB: 'of the world',
    lede: 'Every embassy and consulate in a city, on one map. Choose a city on the globe or from the list.',
    drag: 'Drag to turn the globe', globe: 'Globe', cities: 'Cities', open: 'Open the map',
    regions: { europe: 'Europe', americas: 'Americas', asia: 'Asia & Pacific', mideast: 'Middle East', africa: 'Africa' },
    navLabel: 'Primary', navHome: 'Home', navPublications: 'Publications', navProjects: 'Projects', navAbout: 'About Terra',
    city: 'City', menu: 'Menu', close: 'Close', dark: 'Dark mode', changeLang: 'Change language', languages: 'Languages',
    search: 'Search a country or street', show: 'Show', all: 'All', embassies: 'Embassies', consulates: 'Consulates',
    findCity: 'City or country', empty: 'Nothing matches.', source: 'Data', loading: 'Loading missions…', live: 'live',
    loadingLive: 'This map is still being prepared — fetching missions straight from OpenStreetMap (up to half a minute)…',
    failed: 'Could not load data from OpenStreetMap.', retry: 'Try again',
    preparing: 'The map for this city is still being prepared. Check back in a few minutes.',
    count: (n) => `<b>${n}</b> ${n === 1 ? 'mission' : 'missions'}`,
    website: 'Website', directions: 'Directions', photo: 'Photo',
    kinds: {
      embassy: 'Embassy', high_commission: 'High commission', nunciature: 'Apostolic nunciature',
      consulate: 'Consulate', consulate_general: 'Consulate general', vice_consulate: 'Vice-consulate',
      honorary_consulate: 'Honorary consulate', consular_agency: 'Consular agency',
      permanent_mission: 'Permanent mission', delegation: 'Delegation', liaison: 'Liaison office',
    },
    mission: 'Mission',
  },
};

function savedLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q in T) return q;
  try { const s = localStorage.getItem('tc-lang'); if (s in T) return s; } catch {}
  return 'pl';
}

/* Senders with no ISO region code, so Intl.DisplayNames can't name them. */
const NON_STATE = { SMOM: { pl: 'Zakon Maltański', en: 'Order of Malta' } };

const state = { lang: savedLang(), cities: [], index: {}, city: null, data: null, missions: [], group: 'all', query: '', active: null, busy: false };
const cache = new Map(); // slug → loaded data
const t = () => T[state.lang];
const kindLabel = (m) => t().kinds[m.kind] || t().mission;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- map ---------- */
const map = L.map('map', { zoomControl: false });
L.control.zoom({ position: 'topright' }).addTo(map);
// OpenStreetMap's own tiles: no API key (CARTO's basemaps now require one). Tinted in CSS.
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
map.attributionControl.setPrefix(false);
const markers = new Map();

const flag = (m) => `<img class="flag" src="assets/flags/${esc(m.country.toLowerCase())}.svg" alt="" width="20" height="15" loading="lazy" onerror="this.remove()">`;

function slip(m) {
  const links = [
    m.website && `<a href="${esc(m.website)}" target="_blank" rel="noopener">${t().website} ↗</a>`,
    `<a href="https://www.google.com/maps/dir/?api=1&amp;destination=${m.lat},${m.lon}" target="_blank" rel="noopener">${t().directions} ↗</a>`,
  ].filter(Boolean).join('');
  const p = m.photo;
  const credit = p && [p.author, p.license].filter(Boolean).join(' · ');
  return `<div class="slip${p ? ' has-photo' : ''}">
    <div class="slip-text">
      <div class="slip-kind">${esc(kindLabel(m))}</div>
      <h3>${flag(m)}${esc(m.label)}</h3>
      ${m.nameLocal && m.nameLocal !== m.label ? `<p class="slip-name">${esc(m.nameLocal)}</p>` : ''}
      ${m.address ? `<p>${esc(m.address)}</p>` : ''}
      ${m.phone ? `<p><a href="tel:${esc(m.phone.replace(/[^\d+]/g, ''))}">${esc(m.phone)}</a></p>` : ''}
      <div class="slip-links">${links}</div>
    </div>
    ${p ? `<figure class="slip-photo">
      <a href="${esc(p.page)}" target="_blank" rel="noopener"><img src="${esc(p.thumb)}" alt="${esc(m.nameLocal || m.label)}" loading="lazy"></a>
      <figcaption>${t().photo}: <a href="${esc(p.page)}" target="_blank" rel="noopener">${esc(credit || 'Wikimedia Commons')}</a></figcaption>
    </figure>` : ''}
  </div>`;
}

/* ---------- language ---------- */
function applyLang() {
  document.documentElement.lang = state.lang;
  $$('[data-t]').forEach((el) => { el.textContent = t()[el.dataset.t]; });
  $$('[data-t-placeholder]').forEach((el) => { el.placeholder = t()[el.dataset.tPlaceholder]; });
  $$('[data-t-label]').forEach((el) => { el.setAttribute('aria-label', t()[el.dataset.tLabel]); });
  $('#lang-code').textContent = state.lang.toUpperCase();
  $$('.lang-menu [data-lang]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.lang === state.lang)));
  renderStations();
  globe?.relabel(pinLabel);
  if (state.city) {
    $('[data-city]').textContent = state.city.name[state.lang];
    document.title = `${t().title} — ${state.city.name[state.lang]} · Terra Cracovianum`;
    $('#city-btn-name').textContent = state.city.name[state.lang];
    $('#cities').innerHTML = `<input class="cities-find" type="search" autocomplete="off" spellcheck="false" placeholder="${esc(t().findCity)}" aria-label="${esc(t().findCity)}">` +
      byRegion().map(([region, list]) =>
      `<h3 class="cities-region" data-region="${region}">${esc(t().regions[region])}</h3>` + list.map(({ city: c, n }) =>
        `<button type="button" data-slug="${c.slug}" data-region="${region}"${c === state.city ? ' aria-current="page"' : ''}><span>${String(n).padStart(2, '0')}</span>${esc(c.name[state.lang])}</button>`).join('')).join('');
  } else {
    document.title = `${t().heroA} ${t().heroB} · Terra Cracovianum`;
  }
  if (state.data) prepare();
}

/* language dropdown — the site's switcher */
const lang = $('#lang');
const langBtn = $('#lang .pill');
function setLangOpen(open) {
  lang.classList.toggle('open', open);
  langBtn.setAttribute('aria-expanded', String(open));
}
langBtn.addEventListener('click', () => setLangOpen(!lang.classList.contains('open')));
$$('.lang-menu [data-lang]').forEach((b) => b.addEventListener('click', () => {
  state.lang = b.dataset.lang;
  try { localStorage.setItem('tc-lang', state.lang); } catch {}
  applyLang();
  setLangOpen(false);
  langBtn.focus();
}));
document.addEventListener('click', (e) => { if (!lang.contains(e.target)) setLangOpen(false); });

/* dark mode: follows the system until the visitor chooses */
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => (document.documentElement.dataset.theme || (darkQuery.matches ? 'dark' : 'light')) === 'dark';
function paintTheme() {
  const dark = isDark();
  document.body.toggleAttribute('data-dark', dark);
  $('#theme').setAttribute('aria-pressed', String(dark));
  document.querySelector('meta[name="theme-color"]').content = dark ? '#10140f' : '#f3eee3';
}
$('#theme').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('tc-theme', next); } catch {}
  paintTheme();
});
darkQuery.addEventListener('change', paintTheme);
paintTheme();

/* mobile menu — a modal, as on the site: focus moves in, Tab stays in, Escape closes */
const nav = $('#mobile-nav');
const menuBtn = $('#menu');
function setMenuOpen(open) {
  nav.classList.toggle('open', open);
  nav.setAttribute('aria-hidden', String(!open));
  menuBtn.setAttribute('aria-expanded', String(open));
  document.documentElement.classList.toggle('nav-open', open);
  (open ? $('#menu-close') : menuBtn).focus();
}
menuBtn.addEventListener('click', () => setMenuOpen(true));
$('#menu-close').addEventListener('click', () => setMenuOpen(false));
nav.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const items = $$('#mobile-nav button, #mobile-nav a');
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (nav.classList.contains('open')) setMenuOpen(false);
  else if (lang.classList.contains('open')) { setLangOpen(false); langBtn.focus(); }
});

/* ---------- list ---------- */
function prepare() {
  const names = new Intl.DisplayNames([state.lang], { type: 'region' });
  const nameOf = (code) => {
    if (NON_STATE[code]) return NON_STATE[code][state.lang];
    try { return names.of(code) || code; } catch { return code; }
  };
  // A code Intl can't name (ZZ, a typo) reads as "Unknown Region"; the mission's own name says more.
  const unnamed = (code) => { try { return names.of(code) === names.of('ZZ'); } catch { return true; } };
  state.missions = state.data.missions.map((m) => {
    const own = state.lang === 'en' ? m.name || m.nameLocal : m.nameLocal || m.name; // in the page's language where we have it
    const label = !NON_STATE[m.country] && unnamed(m.country) && own ? own : nameOf(m.country);
    return { ...m, label, haystack: [label, m.country, m.name, m.nameLocal, m.address].filter(Boolean).join(' ').toLowerCase() };
  }).sort((a, b) => a.label.localeCompare(b.label, state.lang) || a.group.localeCompare(b.group));
  // Where a country has two entries of one kind (a consular section, an office mapped twice),
  // the list shows each entry's own name so they can be told apart.
  const seen = {};
  for (const m of state.missions) seen[m.country + m.group] = (seen[m.country + m.group] || 0) + 1;
  for (const m of state.missions) m.twin = seen[m.country + m.group] > 1;

  for (const m of state.missions) markers.get(m.id)?.setPopupContent(slip(m));
  $('#updated').textContent = state.data.generated
    ? `· ${new Date(state.data.generated).toLocaleDateString(state.lang === 'pl' ? 'pl-PL' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : `· ${t().live}`;
  render();
}

function render() {
  const shown = state.missions.filter((m) =>
    (state.group === 'all' || m.group === state.group) && (!state.query || m.haystack.includes(state.query)));
  $('#list').innerHTML = shown.map((m) => `
    <li><button class="row" data-id="${esc(m.id)}" data-group="${m.group}"${m.id === state.active ? ' aria-current="true"' : ''}>
      <span><span class="row-name">${flag(m)}${esc(m.label)}</span>
      <span class="row-meta">${esc(m.twin && m.nameLocal ? m.nameLocal : kindLabel(m))}${m.address ? ' · ' + esc(m.address.split(',')[0]) : ''}</span></span>
    </button></li>`).join('');
  $('#empty').hidden = shown.length > 0;
  $('#count').innerHTML = t().count(shown.length);

  const visible = new Set(shown.map((m) => m.id));
  for (const [id, marker] of markers) {
    if (visible.has(id)) marker.addTo(map);
    else marker.remove();
  }
}

function select(id, fromMap = false) {
  const m = state.missions.find((x) => x.id === id);
  if (!m) return;
  markers.get(state.active)?.getElement()?.classList.remove('is-active');
  state.active = id;
  const marker = markers.get(id).addTo(map);
  marker.getElement()?.classList.add('is-active');

  $$('.row[aria-current]').forEach((r) => r.removeAttribute('aria-current'));
  const row = $(`.row[data-id="${CSS.escape(id)}"]`);
  row?.setAttribute('aria-current', 'true');

  if (fromMap) {
    // Only scroll the list itself — never the page, which would also scroll a parent page holding this iframe.
    if (row && matchMedia('(min-width: 761px)').matches) {
      const list = $('#list');
      const top = row.offsetTop - list.offsetTop;
      if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top - 40;
    }
  } else {
    const zoom = Math.max(map.getZoom(), 15);
    // Open the popup once the map has settled: Leaflet can't pan a popup into view mid-flight.
    map.once('moveend', () => marker.openPopup());
    reduced ? map.setView([m.lat, m.lon], zoom) : map.flyTo([m.lat, m.lon], zoom, { duration: 0.7 });
    return;
  }
  marker.openPopup();
}

$('#list').addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  select(row.dataset.id);
  if (matchMedia('(max-width: 760px)').matches) $('#map-view').scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
});
$('#q').addEventListener('input', (e) => { state.query = e.target.value.trim().toLowerCase(); render(); });
$$('.filter').forEach((b) => b.addEventListener('click', () => {
  state.group = b.dataset.group;
  $$('.filter').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  render();
}));

/* ---------- load a city into the map ---------- */
async function loadData(city) {
  if (cache.has(city.slug)) return cache.get(city.slug);
  let data;
  try {
    const res = await fetch(`data/${city.slug}.json`, { cache: 'no-cache' });
    if (res.ok) data = await res.json();
  } catch {}
  // No snapshot for this city yet: ask OpenStreetMap directly.
  data ??= await fetchMissions(city, { timeoutMs: 15000, endpoints: OVERPASS_ENDPOINTS.slice(0, 2) });
  cache.set(city.slug, data);
  return data;
}

function clearMarkers() {
  map.closePopup();
  for (const marker of markers.values()) marker.remove();
  markers.clear();
  state.active = null;
}

/* Fill the map and register with `city`. Returns once the data is in; the markers rise in. */
async function loadCity(city) {
  const status = $('#status');
  clearMarkers();
  state.data = null;
  state.missions = [];
  state.query = ''; $('#q').value = '';
  state.group = 'all';
  $$('.filter').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.group === 'all')));
  $('#list').innerHTML = '';
  status.hidden = false;
  const snapshot = !!state.index[city.slug] || cache.has(city.slug);
  status.innerHTML = `<p>${snapshot ? t().loading : t().loadingLive}</p>`;
  let data;
  try {
    data = await loadData(city);
  } catch (err) {
    console.error(err);
    status.innerHTML = `<p>${snapshot ? t().failed : t().preparing}<button type="button">${t().retry}</button></p>`;
    status.querySelector('button').addEventListener('click', () => loadCity(city));
    return;
  }
  if (state.city !== city) return; // the visitor moved on while this loaded
  await gate; // a move in progress builds the markers and list in its own quiet moment, not mid-animation
  if (state.city !== city) return;
  state.data = data;
  for (const m of data.missions) {
    const marker = L.marker([m.lat, m.lon], {
      icon: L.divIcon({ className: 'pin', html: '<span></span>', iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -8] }),
      riseOnHover: true,
    }).bindPopup('', { maxWidth: Math.min(500, innerWidth - 40), minWidth: 220, autoPanPadding: [20, 20] });
    marker.on('click', () => select(m.id, true));
    // The photo arrives after the popup has panned into view; re-fit once it has a size.
    marker.on('popupopen', (e) => {
      e.popup.getElement()?.querySelector('.slip-photo img')?.addEventListener('load', () => e.popup.update(), { once: true });
    });
    marker.on('add', () => {
      const el = marker.getElement();
      el.dataset.group = m.group;
      el.style.setProperty('--d', `${Math.round(Math.random() * 700)}ms`); // markers rise in, scattered
      el.classList.toggle('is-active', m.id === state.active);
    });
    markers.set(m.id, marker);
  }
  prepare();
  status.hidden = true;
  if (mapOpen) rise();
}

/* Building ~200 markers and rows is one long task; a move opens the gate when a frame can spare it. */
let gate = Promise.resolve();
let openGate = () => {};
function closeGate() { gate = new Promise((r) => { openGate = r; }); }

/* Wait for the city's data, but never hold a move for it: slow data (a live query) arrives later. */
const settle = (loading) => Promise.race([loading, new Promise((r) => setTimeout(r, 400))]);

/* The globe band is switched off entirely behind an open map. */
const globeOn = (on) => globeView.classList.toggle('is-off', !on);

/* The markers rise in, scattered: played when the map is actually on screen. */
let mapOpen = false;
let riseTimer;
function rise() {
  const el = $('#map');
  el.classList.remove('is-rising');
  void el.offsetWidth; // restart the keyframes
  el.classList.add('is-rising');
  clearTimeout(riseTimer);
  riseTimer = setTimeout(() => el.classList.remove('is-rising'), 1800);
}

/* ---------- the opening: stations list + globe ---------- */
const DIVE_ZOOM = 5; // the Leaflet zoom the globe hands over at
const stage = $('#stage');
const globeView = $('#globe-view');
const mapView = $('#map-view');
const landing = $('#landing');
let globe = null;

const coordsOf = (c) => {
  const f = (v, p, n) => `${Math.floor(Math.abs(v))}°${String(Math.round((Math.abs(v) % 1) * 60)).padStart(2, '0')}′${v >= 0 ? p : n}`;
  return `${f(c.center[0], 'N', 'S')} ${f(c.center[1], 'E', 'W')}`;
};
const countOf = (c) => state.index[c.slug]?.count;
const pinLabel = (c) => `<b>${esc(c.name[state.lang])}</b><small>${countOf(c) != null ? t().count(countOf(c)).replace(/<\/?b>/g, '') : coordsOf(c)}</small>`;

/* The cities by region, in the order regions are listed, numbered straight through. */
const REGIONS = ['europe', 'americas', 'asia', 'mideast', 'africa'];
function byRegion() {
  let n = 0;
  return REGIONS.map((r) => [r, state.cities.filter((c) => (c.region || 'europe') === r)])
    .filter(([, list]) => list.length)
    .map(([r, list]) => [r, list.map((city) => ({ city, n: ++n }))]);
}

function renderStations() {
  $('#stations').innerHTML = byRegion().map(([region, list]) =>
    `<li class="stations-region" role="presentation"><span>${esc(t().regions[region])}</span><small>${list.length}</small></li>` +
    list.map(({ city: c, n }) => `
    <li style="--i:${Math.min(n, 24)}"><button type="button" class="station" data-slug="${c.slug}">
      <span class="station-n">${String(n).padStart(2, '0')}</span>
      <span class="station-name">${esc(c.name[state.lang])}</span>
      <span class="station-meta">${countOf(c) != null ? t().count(countOf(c)).replace(/<\/?b>/g, '') : coordsOf(c)}</span>
      <span class="station-go" aria-hidden="true">→</span>
    </button></li>`).join('')).join('');
}
$('#stations').addEventListener('click', (e) => { const b = e.target.closest('.station'); if (b) navigate(b.dataset.slug); });
/* Pointing at a city in the list lights its pin and turns the globe to face it (it may be on the far
   side); the globe holds still while the list or the globe itself is under the pointer. */
let facing = null;
function pointAt(slug) {
  globe?.highlight(slug);
  if (!slug || slug === facing || state.busy) return;
  facing = slug;
  const city = state.cities.find((c) => c.slug === slug);
  if (city && document.body.dataset.view === 'globe') globe.face(city);
}
$('#stations').addEventListener('pointerover', (e) => pointAt(e.target.closest('.station')?.dataset.slug ?? null));
$('#stations').addEventListener('focusin', (e) => pointAt(e.target.closest('.station')?.dataset.slug ?? null));
$('#stations').addEventListener('pointerenter', () => globe?.hold(true));
$('#stations').addEventListener('pointerleave', () => { globe?.highlight(null); globe?.hold(false); facing = null; });
$('#globe').addEventListener('pointerenter', () => globe?.hold(true));
$('#globe').addEventListener('pointerleave', () => globe?.hold(false));
$('#gpins').addEventListener('pointerover', () => globe?.hold(true));
$('#gpins').addEventListener('pointerout', () => globe?.hold(false));
/* the city menu: a pill showing the current city that opens every city, in the language menu's style */
const picker = $('#city-picker');
const pickerBtn = $('#city-btn');
function setPickerOpen(open) {
  picker.classList.toggle('open', open);
  pickerBtn.setAttribute('aria-expanded', String(open));
  if (!open) return;
  const find = $('#cities .cities-find');
  if (find.value) { find.value = ''; filterCities(''); }
  // a typing cursor where there is a keyboard; on touch screens the keyboard would cover the list
  (matchMedia('(pointer:fine)').matches ? find : $('#cities [aria-current]'))?.focus();
}
/* 164 cities: type a city, or a country to see every city it has ("Nigeria" → Abuja, Lagos) */
const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
function filterCities(q) {
  q = fold(q.trim());
  const country = new Intl.DisplayNames([state.lang], { type: 'region' });
  const shown = new Set();
  $$('#cities button').forEach((b) => {
    const c = state.cities.find((x) => x.slug === b.dataset.slug);
    const hit = !q || [c.name.pl, c.name.en, country.of(c.country)].some((n) => fold(n).includes(q));
    b.hidden = !hit;
    if (hit) shown.add(b.dataset.region);
  });
  $$('#cities .cities-region').forEach((h) => { h.hidden = !shown.has(h.dataset.region); });
}
$('#cities').addEventListener('input', (e) => { if (e.target.matches('.cities-find')) filterCities(e.target.value); });
$('#cities').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.cities-find')) $('#cities button:not([hidden])')?.click();
});
pickerBtn.addEventListener('click', () => setPickerOpen(!picker.classList.contains('open')));
document.addEventListener('click', (e) => { if (!picker.contains(e.target)) setPickerOpen(false); });
picker.addEventListener('keydown', (e) => { if (e.key === 'Escape' && picker.classList.contains('open')) { e.stopPropagation(); setPickerOpen(false); pickerBtn.focus(); } });
$('#cities').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  setPickerOpen(false);
  if (b.dataset.slug !== state.city?.slug) navigate(b.dataset.slug);
});
$('#back').addEventListener('click', () => navigate(null));

/* The globe's resting place: the whole Earth, tilted so Europe sits high and both the Americas
   and Asia turn into view. On desktop it sits in the space right of the copy; on phones under the
   headline. */
function homeView() {
  const { w, h } = globe;
  if (w < 761) return { lon: 15, lat: 28, scale: Math.min(w * 0.44, h * 0.27), x: w / 2, y: h * 0.56 };
  const copyRight = $('.landing-copy').getBoundingClientRect().right - stage.getBoundingClientRect().left;
  const room = w - copyRight;
  return { lon: 15, lat: 28, scale: Math.min(h * 0.43, room * 0.42), x: copyRight + room * 0.5, y: h * 0.52 };
}

/* Where the city sits on screen when the map is at DIVE_ZOOM around it: the map pane's centre. */
function mapFocus() {
  const m = $('#map').getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  return { x: m.left - s.left + m.width / 2, y: m.top - s.top + m.height / 2 };
}
const diveView = (city) => {
  const f = mapFocus();
  return { lon: city.center[1], lat: city.center[0], scale: Globe.scaleForZoom(DIVE_ZOOM, city.center[0]), x: f.x, y: f.y };
};

/* The circle that opens the map out of the globe (and closes it back), on the mechanical curve. */
function iris(open, at, duration = 750) {
  const s = stage.getBoundingClientRect();
  const r = Math.hypot(Math.max(at.x, s.width - at.x), Math.max(at.y, s.height - at.y)) + 20;
  const from = `circle(${open ? 0 : r}px at ${at.x}px ${at.y}px)`;
  const to = `circle(${open ? r : 0}px at ${at.x}px ${at.y}px)`;
  if (reduced) { mapView.style.clipPath = ''; return Promise.resolve(); }
  const anim = mapView.animate([{ clipPath: from }, { clipPath: to }], { duration, easing: 'cubic-bezier(.76,0,.24,1)', fill: 'forwards' });
  return anim.finished.then(() => { anim.cancel(); mapView.style.clipPath = open ? '' : to; });
}

const flyMap = (center, zoom, duration) => new Promise((resolve) => {
  if (reduced || duration === 0) { map.setView(center, zoom, { animate: false }); resolve(); return; }
  map.once('moveend', () => resolve());
  map.flyTo(center, zoom, { duration });
});

function setView(name) {
  document.body.dataset.view = name;
  if (name !== 'globe') landing.classList.add('is-leaving'); // riseFrom brings the copy back once the globe has settled
  globeView.inert = name !== 'globe';
  mapView.inert = name !== 'map';
}

function showMapLayer(city) {
  mapView.hidden = false;
  mapView.scrollTop = 0;
  state.city = city;
  applyLang();
  map.invalidateSize();
  map.setView(city.center, DIVE_ZOOM, { animate: false });
}

/* globe → city: turn to the city and dive; at the zoom where globe and map agree, the map irises open. */
async function diveInto(city) {
  globe.locked = true;
  globe.drift = false; // the idle sway would pull the globe off the city the moment the dive ends
  globe.highlight(city.slug);
  landing.classList.add('is-leaving');
  globe.showPins(false);
  mapView.style.clipPath = 'circle(0px at 50% 50%)';
  showMapLayer(city);
  closeGate();
  const loading = loadCity(city);
  const target = diveView(city);
  await globe.animate({ lon: target.lon, lat: target.lat, scale: globe.view.scale * 1.15, x: target.x, y: target.y }, { duration: 900, curve: ease.inOut });
  await globe.animate(target, { duration: 1100, curve: (t) => t * t * t }); // accelerating into the ground
  openGate(); await settle(loading); // the beat between landing and opening: build the city here
  setView('map');
  await iris(true, target);
  mapOpen = true; rise();
  globe.stop(); globeOn(false);
  await flyMap(city.center, city.zoom, 1.6);
  await loading;
}

/* city → globe: the map pulls back, closes onto the city, and the globe lifts away to Europe. */
async function riseFrom(city) {
  map.closePopup();
  await flyMap(city.center, DIVE_ZOOM, 1.1);
  const at = diveView(city);
  globeOn(true);
  globe.drift = false;
  globe.view = { ...at };
  globe.reveal = 1;
  globe.start();
  setView('globe');
  mapOpen = false;
  await iris(false, at);
  mapView.hidden = true;
  mapView.style.clipPath = '';
  state.city = null;
  applyLang();
  landing.classList.remove('is-leaving');
  await globe.animate(homeView(), { duration: 1600, curve: ease.arrive });
  globe.showPins(true);
  globe.highlight(null);
  globe.setHome();
  globe.locked = false;
}

/* city → city: a flight. Up out of the first map, along the great circle with the route
   drawing itself and the distance counting, and down into the second. */
async function fly(from, to) {
  map.closePopup();
  await flyMap(from.center, DIVE_ZOOM, 1.0);
  const a = [from.center[1], from.center[0]];
  const b = [to.center[1], to.center[0]];
  const start = diveView(from);
  globeOn(true);
  globe.drift = false;
  globe.view = { ...start };
  globe.reveal = 1;
  globe.start();
  globe.showPins(false);
  setView('flight');
  mapOpen = false;
  await iris(false, start, 600);
  mapView.style.clipPath = 'circle(0px at 50% 50%)';

  const readout = $('#readout');
  const km = distanceKm(a, b);
  // Pull up until both cities fit in about half the frame, but always far enough to feel the lift.
  const fit = (Math.min(globe.w, globe.h) * 0.55) / (2 * Math.sin(Math.max(km / 6371, 0.002) / 2));
  const altitude = Math.max(homeView().scale * 0.6, Math.min(fit, start.scale * 0.62));
  const mid = greatCircle(a, b)(0.5);
  globe.route = { a, b, t: 0 };
  const tickReadout = (t) => {
    const h = globe.route?.head;
    if (h) readout.style.transform = `translate(${h[0]}px, ${h[1]}px)`;
    readout.innerHTML = `<b>${from.code}</b> → <b>${to.code}</b> <span>${Math.round(km * t).toLocaleString(state.lang === 'pl' ? 'pl-PL' : 'en-GB')} km</span>`;
  };
  // 1 · lift off and frame both cities
  await globe.animate({ lon: mid[0], lat: mid[1], scale: altitude }, { duration: 1000, curve: ease.inOut });
  // 2 · survey the route: the line draws from A to B, the distance counts up, the camera eases after it
  tickReadout(0);
  readout.classList.add('is-on');
  const toward = greatCircle(mid, b)(0.35);
  await globe.animate({ lon: toward[0], lat: toward[1] }, {
    duration: Math.min(1800, 1100 + km / 3), curve: ease.inOut,
    onFrame: (t, e) => { globe.route.t = e; tickReadout(e); },
  });
  readout.classList.remove('is-on');
  showMapLayer(to);
  closeGate();
  const loading = loadCity(to);
  await globe.animate(diveView(to), { duration: 900, curve: (t) => t * t * t });
  globe.route = null;
  openGate(); await settle(loading);
  setView('map');
  await iris(true, diveView(to));
  mapOpen = true; rise();
  globe.stop(); globeOn(false);
  await flyMap(to.center, to.zoom, 1.4);
  await loading;
}

/* One entry point for every move; `push` false when replaying the browser's back/forward. */
async function navigate(slug, { push = true } = {}) {
  if (state.busy) return;
  const to = state.cities.find((c) => c.slug === slug) || null;
  const from = state.city;
  if (to === from) return;
  state.busy = true;
  document.body.classList.add('is-moving');
  if (push) history.pushState(null, '', to ? `?city=${to.slug}` : location.pathname);
  try {
    if (!from && to) await diveInto(to);
    else if (from && !to) await riseFrom(from);
    else if (from && to) await fly(from, to);
  } finally {
    state.busy = false;
    document.body.classList.remove('is-moving');
    // focus follows the move: the back button on a map, the city you came from on the globe
    (to ? $('#back') : $(`.station[data-slug="${from?.slug}"]`) || $('.station'))?.focus({ preventScroll: true });
  }
}
addEventListener('popstate', () => navigate(new URLSearchParams(location.search).get('city'), { push: false }));

/* ---------- start ---------- */
const [cities, index, dots, land] = await Promise.all([
  fetch('data/cities.json').then((r) => r.json()),
  fetch('data/index.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  fetch('assets/globe/dots.json').then((r) => r.json()),
  fetch('assets/globe/land.json').then((r) => r.json()),
]);
state.cities = cities;
state.index = index;

globe = new Globe($('#globe'), $('#gpins'), { dots, land, cities, label: pinLabel, onPick: navigate, onHover: (slug) => {
  $$('.station').forEach((b) => b.classList.toggle('is-lit', b.dataset.slug === slug));
} });

const first = state.cities.find((c) => c.slug === new URLSearchParams(location.search).get('city'));
applyLang();
if (first) {
  // A shared link to a city opens straight on its map; the globe waits behind for the way back.
  setView('map');
  showMapLayer(first);
  map.setView(first.center, first.zoom, { animate: false });
  globe.view = homeView();
  globeOn(false);
  mapOpen = true;
  loadCity(first);
} else {
  setView('globe');
  const home = homeView();
  globe.view = { ...home, lon: home.lon - 70, scale: home.scale * 0.92 };
  globe.start();
  globe.surveyIn(2200);
  await globe.animate(home, { duration: 2200, curve: ease.arrive });
  globe.showPins(true);
  globe.setHome();
}
globe.onResize = () => { if (document.body.dataset.view === 'globe' && !state.busy) { Object.assign(globe.view, homeView()); globe.setHome(); } };
