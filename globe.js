/* The survey globe: the institute's globe idiom (sand survey dots, a hairline graticule, a
   steady home ring on Kraków) drawn on a canvas with d3-geo's orthographic projection.
   It knows nothing about the map: it renders a `view`, tweens between views, draws a route,
   and positions one DOM pin per city. app.js choreographs the transitions out of those parts. */

const { geoOrthographic, geoPath, geoGraticule10, geoInterpolate, geoDistance } = window.d3;

const RAD = Math.PI / 180;
const KRAKOW = [19.94, 50.06];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const unit = ([lon, lat]) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];

/* The site's two curves, as functions of t: arrivals settle, wipes are mechanical. */
export const ease = {
  arrive: (t) => 1 - (1 - t) ** 4,
  wipe: (t) => (t < 0.5 ? 8 * t ** 4 : 1 - 8 * (1 - t) ** 4),
  inOut: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
};

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Globe {
  constructor(canvas, layer, { dots, land, cities, label, onPick, onHover }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.land = land;
    this.graticule = geoGraticule10();
    this.view = { lon: 0, lat: 30, scale: 300, x: 0, y: 0 };
    this.reveal = reducedMotion ? 1 : 0;   // survey reveal out from Kraków, 0 → 1
    this.route = null;                      // { a, b, t } while a flight draws its line
    this.drift = !reducedMotion;
    this.locked = false;                    // no dragging while a transition runs
    this.running = false;
    this.home = null;

    // Dots as unit vectors, so visibility and the reveal are a dot product each.
    this.dots = [];
    const k = unit(KRAKOW);
    for (let i = 0; i < dots.length; i += 2) {
      const p = [dots[i], dots[i + 1]];
      const v = unit(p);
      this.dots.push({ p, v, fromHome: Math.acos(clamp(v[0] * k[0] + v[1] * k[1] + v[2] * k[2], -1, 1)) });
    }

    this.cities = cities.map((c) => {
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = `gpin gpin-${c.labelSide || 'e'}${c.slug === 'krakow' ? ' is-home' : ''}`;
      pin.dataset.slug = c.slug;
      pin.innerHTML = '<i class="gpin-mark" aria-hidden="true"></i><span class="gpin-label"></span>';
      pin.addEventListener('click', () => onPick(c.slug));
      pin.addEventListener('pointerenter', () => onHover?.(c.slug));
      pin.addEventListener('pointerleave', () => onHover?.(null));
      pin.addEventListener('focus', () => onHover?.(c.slug));
      pin.addEventListener('blur', () => onHover?.(null));
      layer.appendChild(pin);
      return { ...c, pin, v: unit([c.center[1], c.center[0]]) };
    });

    this.relabel(label);
    this.#bindDrag();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  projection(view = this.view) {
    return geoOrthographic().rotate([-view.lon, -view.lat]).scale(view.scale).translate([view.x, view.y]).clipAngle(90).precision(0.6);
  }

  /* The scale at which the globe matches a Leaflet map at `zoom` around `lat`, so the dive can
     hand over to the map without a jump: px per radian on the globe = px per radian on Mercator. */
  static scaleForZoom(zoom, lat) {
    return (256 * 2 ** zoom) / (2 * Math.PI * Math.cos(lat * RAD));
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width; this.h = r.height;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.onResize?.(this.w, this.h);
    this.render();
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = (now) => {
      if (!this.running) return;
      if (this.drift && this.home && !this.dragging && !this.tweening) {
        // the slow sway of an instrument left on the bench, around the home view
        this.view.lon = this.home.lon + Math.sin((now - this.home.t0) / 9000) * 7;
      }
      this.#inertia();
      this.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop() { this.running = false; }

  /* Where the idle sway centres; it starts from zero offset, so settling never jumps. */
  setHome() {
    this.home = { lon: this.view.lon, t0: performance.now() };
    this.drift = !reducedMotion;
  }

  /* Tween to `to` ({lon, lat, scale, x, y}, any subset). The centre travels the great circle,
     the scale moves geometrically (so a dive feels even all the way down), x/y linearly. */
  animate(to, { duration = 1000, curve = ease.inOut, onFrame } = {}) {
    const from = { ...this.view };
    const target = { ...from, ...to };
    const path = geoInterpolate([from.lon, from.lat], [target.lon, target.lat]);
    this.tweening = true;
    if (reducedMotion) duration = 0;
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now) => {
        const t = duration ? clamp((now - t0) / duration, 0, 1) : 1;
        const e = curve(t);
        const [lon, lat] = path(e);
        this.view = {
          lon, lat,
          scale: Math.exp(lerp(Math.log(from.scale), Math.log(target.scale), e)),
          x: lerp(from.x, target.x, e),
          y: lerp(from.y, target.y, e),
        };
        onFrame?.(t, e);
        if (!this.running) this.render();
        if (t < 1) requestAnimationFrame(step);
        else { this.tweening = false; resolve(); }
      };
      requestAnimationFrame(step);
    });
  }

  /* Survey the land out from Kraków, as the site's hero does. */
  surveyIn(duration = 2000) {
    if (reducedMotion) { this.reveal = 1; return Promise.resolve(); }
    const t0 = performance.now();
    return new Promise((resolve) => {
      const step = (now) => {
        const t = clamp((now - t0) / duration, 0, 1);
        this.reveal = ease.arrive(t);
        if (t < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  screenPoint(lonlat) { return this.projection()(lonlat); }

  render() {
    const { ctx, w, h, view } = this;
    if (!w) return;
    const proj = this.projection();
    const path = geoPath(proj, ctx);
    ctx.clearRect(0, 0, w, h);

    // How far into a dive we are: dots give way to filled land as the ground comes up.
    const near = smooth(700, 1500, view.scale);

    // atmosphere: a faint sand halo just outside the rim
    if (view.scale < 4000) {
      const g = ctx.createRadialGradient(view.x, view.y, view.scale * 0.92, view.x, view.y, view.scale * 1.22);
      g.addColorStop(0, 'rgba(217,160,107,0.10)');
      g.addColorStop(1, 'rgba(217,160,107,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.beginPath(); path({ type: 'Sphere' });
    ctx.fillStyle = 'rgba(243,238,227,0.025)'; ctx.fill();
    ctx.strokeStyle = 'rgba(243,238,227,0.22)'; ctx.lineWidth = 1; ctx.stroke();

    ctx.beginPath(); path(this.graticule);
    ctx.strokeStyle = `rgba(243,238,227,${0.07 * this.reveal})`; ctx.lineWidth = 0.6; ctx.stroke();

    if (near > 0) {
      ctx.beginPath(); path(this.land);
      ctx.fillStyle = `rgba(217,160,107,${0.12 * near})`; ctx.fill();
      ctx.strokeStyle = `rgba(217,160,107,${0.55 * near})`; ctx.lineWidth = 0.8; ctx.stroke();
    }

    if (near < 1) {
      const c = unit([view.lon, view.lat]);
      const size = clamp(view.scale / 220, 1.1, 3);
      const front = this.reveal * Math.PI * 1.05;
      ctx.fillStyle = '#d9a06b';
      for (const d of this.dots) {
        const facing = d.v[0] * c[0] + d.v[1] * c[1] + d.v[2] * c[2];
        if (facing <= 0.02) continue;
        if (d.fromHome > front) continue;
        const p = proj(d.p);
        if (!p || p[0] < -4 || p[1] < -4 || p[0] > w + 4 || p[1] > h + 4) continue;
        const band = this.reveal < 1 ? Math.max(0, 1 - Math.abs(front - d.fromHome) / 0.18) : 0; // the bright survey front
        ctx.globalAlpha = (0.18 + 0.6 * facing) * (1 - near) + band * 0.6;
        const s = size * (0.55 + 0.45 * facing);
        ctx.fillRect(p[0] - s / 2, p[1] - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
    }

    if (this.route) this.#drawRoute(proj, path);
    this.#placePins(proj);
  }

  #drawRoute(proj, path) {
    const { ctx } = this;
    const { a, b, t } = this.route;
    const along = geoInterpolate(a, b);
    const steps = 96;
    const full = { type: 'LineString', coordinates: Array.from({ length: steps + 1 }, (_, i) => along(i / steps)) };
    ctx.setLineDash([2, 5]);
    ctx.beginPath(); path(full);
    ctx.strokeStyle = 'rgba(243,238,227,0.28)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.setLineDash([]);
    const n = Math.max(1, Math.round(steps * t));
    const done = { type: 'LineString', coordinates: Array.from({ length: n + 1 }, (_, i) => along((i / n) * t)) };
    ctx.beginPath(); path(done);
    ctx.strokeStyle = '#d4572c'; ctx.lineWidth = 2; ctx.stroke();
    const head = proj(along(t));
    if (head) {
      ctx.beginPath(); ctx.arc(head[0], head[1], 9, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(212,87,44,0.18)'; ctx.fill();
      ctx.beginPath(); ctx.arc(head[0], head[1], 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#f3eee3'; ctx.fill();
      this.route.head = head;
    }
  }

  #placePins(proj) {
    const c = unit([this.view.lon, this.view.lat]);
    for (const city of this.cities) {
      const facing = city.v[0] * c[0] + city.v[1] * c[1] + city.v[2] * c[2];
      const p = proj([city.center[1], city.center[0]]);
      const shown = p && facing > 0.08 && this.pinsShown;
      city.pin.style.transform = p ? `translate(${p[0]}px, ${p[1]}px)` : '';
      city.pin.classList.toggle('is-away', !shown);
      if (city.shown !== shown) { // take far-side pins out of the Tab order
        city.shown = shown;
        city.pin.tabIndex = shown ? 0 : -1;
        city.pin.setAttribute('aria-hidden', String(!shown));
      }
    }
  }

  /* label(city) → the pin's label HTML; called again when the language changes. */
  relabel(label) {
    for (const c of this.cities) c.pin.querySelector('.gpin-label').innerHTML = label(c);
  }

  showPins(on) { this.pinsShown = on; this.render(); }

  highlight(slug) {
    for (const c of this.cities) c.pin.classList.toggle('is-lit', c.slug === slug);
  }

  #bindDrag() {
    const el = this.canvas;
    let last = null;
    el.addEventListener('pointerdown', (e) => {
      if (this.locked) return;
      this.dragging = true; this.drift = false; this.vel = null;
      last = { x: e.clientX, y: e.clientY, t: performance.now() };
      el.setPointerCapture(e.pointerId);
      el.classList.add('is-dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const now = performance.now();
      const k = 57 / this.view.scale; // degrees per pixel: the ground follows the finger
      const dLon = -(e.clientX - last.x) * k;
      const dLat = (e.clientY - last.y) * k;
      this.view.lon += dLon;
      this.view.lat = clamp(this.view.lat + dLat, -55, 75);
      const dt = Math.max(now - last.t, 1);
      this.vel = { lon: dLon / dt, lat: dLat / dt, t: now };
      last = { x: e.clientX, y: e.clientY, t: now };
    });
    const end = () => { this.dragging = false; el.classList.remove('is-dragging'); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  #inertia() {
    if (this.dragging || !this.vel || reducedMotion) return;
    const now = performance.now();
    const dt = now - this.vel.t;
    this.vel.t = now;
    const decay = Math.exp(-dt / 320);
    this.vel.lon *= decay; this.vel.lat *= decay;
    this.view.lon += this.vel.lon * dt;
    this.view.lat = clamp(this.view.lat + this.vel.lat * dt, -55, 75);
    if (Math.abs(this.vel.lon) + Math.abs(this.vel.lat) < 0.0005) this.vel = null;
  }
}

export const distanceKm = (a, b) => geoDistance(a, b) * 6371;
export const greatCircle = (a, b) => geoInterpolate(a, b);
