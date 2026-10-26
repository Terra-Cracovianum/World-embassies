import { fetchMissions } from './lib/missions.mjs';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- words ---------- */
const T = {
  pl: {
    kicker: 'Mapa dyplomatyczna', title: 'Ambasady i konsulaty',
    navLabel: 'Główne', navHome: 'Strona główna', navPublications: 'Publikacje', navProjects: 'Projekty', navAbout: 'O nas',
    city: 'Miasto', menu: 'Menu', close: 'Zamknij', dark: 'Tryb ciemny', changeLang: 'Zmień język', languages: 'Języki',
    search: 'Szukaj kraju lub ulicy', show: 'Pokaż', all: 'Wszystkie', embassies: 'Ambasady', consulates: 'Konsulaty',
    empty: 'Brak wyników.', source: 'Dane', loading: 'Wczytywanie placówek…', live: 'na żywo',
    failed: 'Nie udało się wczytać danych z OpenStreetMap.', retry: 'Spróbuj ponownie',
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
    navLabel: 'Primary', navHome: 'Home', navPublications: 'Publications', navProjects: 'Projects', navAbout: 'About Terra',
    city: 'City', menu: 'Menu', close: 'Close', dark: 'Dark mode', changeLang: 'Change language', languages: 'Languages',
    search: 'Search a country or street', show: 'Show', all: 'All', embassies: 'Embassies', consulates: 'Consulates',
    empty: 'Nothing matches.', source: 'Data', loading: 'Loading missions…', live: 'live',
    failed: 'Could not load data from OpenStreetMap.', retry: 'Try again',
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

const state = { lang: savedLang(), cities: [], city: null, data: null, missions: [], group: 'all', query: '', active: null };
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
  if (state.city) {
    $('[data-city]').textContent = state.city.name[state.lang];
    document.title = `${t().title} — ${state.city.name[state.lang]} · Terra Cracovianum`;
    $('#cities').innerHTML = state.cities.map((c) => `<a href="?city=${c.slug}"${c === state.city ? ' aria-current="page"' : ''}>${esc(c.name[state.lang])}</a>`).join('');
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
    const label = !NON_STATE[m.country] && unnamed(m.country) && (m.nameLocal || m.name) ? (m.nameLocal || m.name) : nameOf(m.country);
    return { ...m, label, haystack: [label, m.country, m.name, m.nameLocal, m.address].filter(Boolean).join(' ').toLowerCase() };
  }).sort((a, b) => a.label.localeCompare(b.label, state.lang) || a.group.localeCompare(b.group));

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
      <span class="row-meta">${esc(kindLabel(m))}${m.address ? ' · ' + esc(m.address.split(',')[0]) : ''}</span></span>
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
  if (matchMedia('(max-width: 760px)').matches) window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
});
$('#q').addEventListener('input', (e) => { state.query = e.target.value.trim().toLowerCase(); render(); });
$$('.filter').forEach((b) => b.addEventListener('click', () => {
  state.group = b.dataset.group;
  $$('.filter').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  render();
}));

/* ---------- load ---------- */
async function loadData(city) {
  try {
    const res = await fetch(`data/${city.slug}.json`, { cache: 'no-cache' });
    if (res.ok) return await res.json();
  } catch {}
  // No snapshot for this city yet: ask OpenStreetMap directly.
  return fetchMissions(city, { timeoutMs: 30000 });
}

async function start() {
  const status = $('#status');
  status.hidden = false;
  status.innerHTML = `<p>${t().loading}</p>`;
  try {
    state.data = await loadData(state.city);
  } catch (err) {
    console.error(err);
    status.innerHTML = `<p>${t().failed}<button type="button">${t().retry}</button></p>`;
    status.querySelector('button').addEventListener('click', start);
    return;
  }

  for (const m of state.data.missions) {
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
      el.classList.toggle('is-active', m.id === state.active);
    });
    markers.set(m.id, marker);
  }
  prepare();
  if (state.missions.length) {
    map.fitBounds(L.latLngBounds(state.missions.map((m) => [m.lat, m.lon])), { padding: [30, 30], maxZoom: 14 });
  }
  status.hidden = true;
}

state.cities = await (await fetch('data/cities.json')).json();
const slug = new URLSearchParams(location.search).get('city');
state.city = state.cities.find((c) => c.slug === slug) || state.cities[0];
map.setView(state.city.center, state.city.zoom);
applyLang();
start();
