import { fetchMissions } from './lib/missions.mjs';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
function countryName(code) {
  try { return regionNames.of(code) || code; } catch { return code; }
}

const KIND = {
  embassy: 'Embassy', high_commission: 'High commission', nunciature: 'Apostolic nunciature',
  consulate: 'Consulate', consulate_general: 'Consulate general', vice_consulate: 'Vice-consulate',
  honorary_consulate: 'Honorary consulate', consular_agency: 'Consular agency',
  permanent_mission: 'Permanent mission', delegation: 'Delegation', liaison: 'Liaison office',
};
const kindLabel = (m) => KIND[m.kind] || m.kind.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function dms(value, pos, neg, precise) {
  const a = Math.abs(value);
  const d = Math.floor(a);
  const mFloat = (a - d) * 60;
  const m = Math.floor(mFloat);
  const s = Math.round((mFloat - m) * 60);
  const pad = (n) => String(n).padStart(2, '0');
  return precise ? `${d}°${pad(m)}′${pad(s)}″${value >= 0 ? pos : neg}` : `${d}°${pad(m)}′${value >= 0 ? pos : neg}`;
}
const coords = (lat, lon, precise = true) => `${dms(lat, 'N', 'S', precise)} ${dms(lon, 'E', 'W', precise)}`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- state ---------- */
const state = { missions: [], group: 'all', query: '', active: null };
const markers = new Map();

/* ---------- map ---------- */
const map = L.map('map', { zoomControl: false, attributionControl: true, minZoom: 10 });
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  subdomains: 'abcd',
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>',
}).addTo(map);
map.attributionControl.setPrefix(false);

const readout = $('#readout span');
map.on('mousemove', (e) => { readout.textContent = coords(e.latlng.lat, e.latlng.lng); });

function pinIcon(m) {
  return L.divIcon({
    className: 'pin',
    html: '<span></span>',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -10],
  });
}

function slip(m) {
  const name = countryName(m.country);
  const local = m.nameLocal && m.nameLocal !== name ? `<div class="slip-local">${esc(m.nameLocal)}</div>` : '';
  const rows = [
    m.address && `<dt>Address</dt><dd>${esc(m.address)}</dd>`,
    m.phone && `<dt>Phone</dt><dd><a href="tel:${esc(m.phone.replace(/[^\d+]/g, ''))}">${esc(m.phone)}</a></dd>`,
  ].filter(Boolean).join('');
  const links = [
    m.website && `<a href="${esc(m.website)}" target="_blank" rel="noopener">Website →</a>`,
    `<a href="https://www.google.com/maps/dir/?api=1&amp;destination=${m.lat},${m.lon}" target="_blank" rel="noopener">Directions →</a>`,
    `<a href="https://www.openstreetmap.org/${esc(m.id)}" target="_blank" rel="noopener">OSM →</a>`,
  ].filter(Boolean).join('');
  return `<div class="slip" data-group="${m.group}">
    <div class="slip-coords">${coords(m.lat, m.lon)}</div>
    <div class="slip-rule"></div>
    <div class="slip-kind">${esc(kindLabel(m))}</div>
    <h3>${esc(name)}</h3>${local}
    ${rows ? `<dl>${rows}</dl>` : ''}
    <div class="slip-links">${links}</div>
  </div>`;
}

/* ---------- register ---------- */
function matches(m) {
  if (state.group !== 'all' && m.group !== state.group) return false;
  if (!state.query) return true;
  return m.haystack.includes(state.query);
}

function render() {
  const list = $('#list');
  const shown = state.missions.filter(matches);
  list.innerHTML = shown.map((m) => `
    <li><button class="mission" data-id="${esc(m.id)}" data-group="${m.group}"${m.id === state.active ? ' aria-current="true"' : ''}>
      <span class="mission-code">${esc(m.country)}</span>
      <span><span class="mission-name">${esc(m.label)}</span>
      <span class="mission-meta">${esc(kindLabel(m))}${m.address ? ' · ' + esc(m.address) : ''}</span></span>
      <span class="mission-go" aria-hidden="true">→</span>
    </button></li>`).join('');
  $('#empty').hidden = shown.length > 0 || state.missions.length === 0;
  $('#shown').textContent = `${shown.length} of ${state.missions.length} shown`;

  const visible = new Set(shown.map((m) => m.id));
  for (const [id, marker] of markers) {
    const on = visible.has(id);
    if (on && !map.hasLayer(marker)) marker.addTo(map);
    if (!on && map.hasLayer(marker)) marker.remove();
  }
}

function select(id, { fromMap = false } = {}) {
  const m = state.missions.find((x) => x.id === id);
  if (!m) return;
  if (state.active) markers.get(state.active)?.getElement()?.classList.remove('is-active');
  state.active = id;
  const marker = markers.get(id);
  if (!map.hasLayer(marker)) marker.addTo(map);
  marker.getElement()?.classList.add('is-active');

  $$('.mission[aria-current]').forEach((b) => b.removeAttribute('aria-current'));
  const row = $(`.mission[data-id="${CSS.escape(id)}"]`);
  if (row) {
    row.setAttribute('aria-current', 'true');
    if (fromMap) row.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }

  if (!fromMap) {
    const zoom = Math.max(map.getZoom(), 15);
    if (reduced) map.setView([m.lat, m.lon], zoom);
    else map.flyTo([m.lat, m.lon], zoom, { duration: 0.8 });
  }
  marker.openPopup();
  history.replaceState(null, '', `#${id}`);
}

$('#list').addEventListener('click', (e) => {
  const btn = e.target.closest('.mission');
  if (!btn) return;
  select(btn.dataset.id);
  if (matchMedia('(max-width: 900px)').matches) {
    $('.map-wrap').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }
});

$('#q').addEventListener('input', (e) => {
  state.query = e.target.value.trim().toLowerCase();
  render();
});

$$('.filter').forEach((btn) => btn.addEventListener('click', () => {
  state.group = btn.dataset.group;
  $$('.filter').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  render();
}));

/* ---------- load ---------- */
async function load(city) {
  const res = await fetch(`data/${city.slug}.json`, { cache: 'no-cache' });
  if (res.ok) return res.json();
  // No snapshot committed yet (e.g. a newly added city): ask OpenStreetMap directly.
  $('#status p').textContent = 'No snapshot yet — surveying OpenStreetMap live…';
  return fetchMissions(city);
}

async function init() {
  const cities = await (await fetch('data/cities.json')).json();
  const slug = new URLSearchParams(location.search).get('city') || cities[0].slug;
  const city = cities.find((c) => c.slug === slug) || cities[0];

  document.title = `Embassies of ${city.name} — Terra Cracovianum`;
  $$('[data-city-name]').forEach((el) => { el.textContent = city.name; });
  $('[data-city-coords]').textContent = coords(city.center[0], city.center[1], false);
  map.setView(city.center, city.zoom);

  let data;
  try {
    data = await load(city);
  } catch (err) {
    $('#status p').textContent = 'The survey could not be loaded. Try again in a moment.';
    console.error(err);
    return;
  }

  state.missions = data.missions.map((m) => {
    const name = countryName(m.country);
    return {
      ...m,
      label: name,
      haystack: [name, m.country, m.name, m.nameLocal, m.address, kindLabel(m)].filter(Boolean).join(' ').toLowerCase(),
    };
  }).sort((a, b) => a.label.localeCompare(b.label, 'en') || a.group.localeCompare(b.group));

  const counts = { all: state.missions.length, embassy: 0, consulate: 0, other: 0 };
  state.missions.forEach((m) => { counts[m.group] += 1; });
  $$('[data-count]').forEach((el) => {
    el.textContent = String(counts[el.dataset.count]).padStart(el.closest('.page-hero-index') ? 3 : 0, '0');
  });
  $('.filter[data-group="other"]').hidden = counts.other === 0;
  $('#updated').textContent = data.generated
    ? `· ${new Date(data.generated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : '· live';

  for (const m of state.missions) {
    const marker = L.marker([m.lat, m.lon], {
      icon: pinIcon(m),
      title: `${m.label} — ${kindLabel(m)}`,
      alt: `${m.label}, ${kindLabel(m)}`,
      riseOnHover: true,
    }).bindPopup(() => slip(m), { maxWidth: 320, autoPanPadding: [40, 40] });
    marker.on('click', () => select(m.id, { fromMap: true }));
    marker.on('add', () => {
      const el = marker.getElement();
      el.dataset.group = m.group;
      el.classList.toggle('is-active', m.id === state.active);
    });
    markers.set(m.id, marker);
  }

  render();
  if (state.missions.length) {
    map.fitBounds(L.latLngBounds(state.missions.map((m) => [m.lat, m.lon])), { padding: [40, 40], maxZoom: 14 });
  }
  $('#status').hidden = true;

  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (fromHash && markers.has(fromHash)) select(fromHash);
}

init();
