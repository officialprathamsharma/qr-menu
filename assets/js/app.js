/* ==========================================================
   QR Menu — guest app
   URL:   /?r=<restaurant-slug>&t=<table>   (#cat-<category-id> optional)
   Flags: ?preview → skip the desktop gate
          ?source=local → read the dashboard's unpublished draft in this browser
   ========================================================== */
import { loadMenu, withResolvedMedia, supabaseEnabled, getSupabase } from './store.js';
import { parseQuery, mergeFilters, hasFilters, matchDish, scoreDish } from './search.js';

const params = new URLSearchParams(location.search);
const slug = (params.get('r') || 'arabico').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'arabico';
const tableNo = (params.get('t') || '').replace(/[^\w-]/g, '').slice(0, 8);
const source = params.get('source') === 'local' ? 'local' : undefined;

const conn = navigator.connection;
const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const slowNetwork = Boolean(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '')));

const app = document.getElementById('app');
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const pref = {
  get(k) { try { return localStorage.getItem(`qrmenu:${k}`); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`qrmenu:${k}`, v); } catch { /* private mode */ } },
};

let data;
let menuSource = 'static'; // 'supabase' | 'local' | 'static' — ordering only works on a published (Supabase) menu
let fmtPrice = (n) => String(n); // prices are shown as plain numbers, without a currency symbol
const catById = new Map();
const groupById = new Map();

const state = {
  query: '',
  chips: new Set(), // popular | veg | drinks | food
  sheetFilters: {}, // from the filter sheet
  openCat: null, // the one category that is expanded (accordion)
  autoplay: pref.get('autoplay') == null ? !(prefersReduced || slowNetwork) : pref.get('autoplay') === '1',
  active: null,
  manual: null,
  userPaused: new WeakSet(),
  sheetOpen: false,
};
const failedVideos = new Set();

/* ---------- Icons ---------- */
const svg = (p) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const icons = {
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  dish: svg('<path d="M3 17h18M5 17a7 7 0 0 1 14 0M12 7V5M10 5h4"/>'),
  flame: svg('<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.8 2.5-5 .3 1.6 1 2.6 2 3 0-3-1-5.5.5-8z" fill="currentColor" stroke="none"/>'),
  bolt: svg('<path d="M13 3 5 13h6l-1 8 8-10h-6z"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  sliders: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  snow: svg('<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/>'),
  cup: svg('<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3M12 3v3"/>'),
  bag: svg('<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>'),
  wifi: svg('<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/>'),
  check: svg('<path d="m5 12 5 5 9-10"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" stroke-width="2.2"/>'),
  star: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor" stroke="none"/>'),
};

/* ---------- Theme ---------- */
function normHex(hex) {
  let h = String(hex || '').trim().replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(h) ? `#${h}` : null;
}
function readableOn(hex) {
  const [r, g, b] = hex.slice(1).match(/.{2}/g).map((x) => {
    const c = parseInt(x, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.36 ? '#0b0b0b' : '#ffffff';
}
function applyTheme({ primary, secondary } = {}) {
  const root = document.documentElement.style;
  const p = normHex(primary) || '#d9a441';
  const s = normHex(secondary) || '#b2453a';
  root.setProperty('--primary', p);
  root.setProperty('--secondary', s);
  root.setProperty('--on-primary', readableOn(p));
  root.setProperty('--on-secondary', readableOn(s));
}

/* ---------- Boot ---------- */
// The NomNom splash (in index.html) stays up for at least ~1.3 s from page start, then lifts away.
const SPLASH_MIN = prefersReduced ? 500 : 1300;
function hideSplash() {
  const el = document.getElementById('splash');
  if (!el || el.dataset.leaving) return;
  el.dataset.leaving = '1';
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 500);
  }, Math.max(0, SPLASH_MIN - performance.now()));
}

const isDesktop = () => matchMedia('(hover: hover) and (pointer: fine)').matches && innerWidth > 820;

async function init() {
  try {
    const loaded = await loadMenu(slug, source);
    menuSource = loaded.source;
    data = await withResolvedMedia(loaded.data);
  } catch {
    app.innerHTML = `<div class="gate"><div class="gate-card"><h1>Menu not found</h1><p>Please ask a member of staff for help.</p></div></div>`;
    hideSplash();
    return;
  }
  normalize();
  applyTheme(data.theme);
  document.title = `${data.name} · Menu`;
  try {
    fmtPrice = new Intl.NumberFormat(data.locale || 'en-IN', {
      maximumFractionDigits: 0,
    }).format;
  } catch { /* keep default */ }

  if (isDesktop() && !params.has('preview')) renderGate();
  else renderMenu();
  hideSplash();
}

function normalize() {
  data.groups ||= [{ id: 'drinks', label: 'Drinks' }, { id: 'food', label: 'Food' }];
  data.sections ||= [];
  data.dishes ||= [];
  data.groups.forEach((g) => groupById.set(g.id, g));
  data.categories = data.sections.filter((s) => s.type === 'category');
  data.rails = data.sections.filter((s) => s.type === 'tag');
  data.categories.forEach((c) => catById.set(c.match, c));
  for (const d of data.dishes) {
    d.diet ||= {};
    d.badges ||= [];
    d.tags ||= [];
  }
}

const ctx = {
  groupOf: (d) => catById.get(d.category)?.group,
  categoryLabel: (d) => catById.get(d.category)?.label || '',
  groupLabel: (d) => groupById.get(catById.get(d.category)?.group)?.label || '',
};
const label = (s) => String(s.label || '').replaceAll('{name}', data.name);
const byId = (id) => data.dishes.find((d) => d.id === id);
const soldOut = (d) => d.available === false;

/* ---------- Desktop gate: the product is phone-only ---------- */
function renderGate() {
  const url = new URL(location.href);
  url.searchParams.delete('preview');
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=0&data=${encodeURIComponent(url.href)}`;
  app.innerHTML = `
    <div class="gate"><div class="gate-card">
      ${logoHtml()}
      <h1>${esc(data.name)}</h1>
      <p>This menu is made for your phone. Scan the code with your camera to open it.</p>
      <div class="qr"><img src="${qr}" alt="QR code for this menu" width="200" height="200"></div>
      <small>Videos, dish stories and search work best on mobile.</small>
      <button class="btn" id="preview">Preview on this screen ${icons.arrow}</button>
    </div></div>`;
  $('#preview').onclick = () => {
    document.body.classList.add('framed');
    renderMenu();
  };
}

function logoHtml() {
  return data.logo
    ? `<img class="logo" src="${esc(data.logo)}" alt="${esc(data.name)} logo">`
    : `<div class="logo monogram" aria-hidden="true">${esc(data.name.trim()[0] || '•')}</div>`;
}

/* ---------- Reviews & Instagram ---------- */
function safeGoogle(v) {
  try {
    const u = new URL(v);
    const host = u.hostname.replace(/^www\./, '');
    const ok = u.protocol === 'https:' && (['g.page', 'maps.app.goo.gl', 'goo.gl', 'search.google.com', 'maps.google.com'].includes(host) || /^google\.[a-z.]+$/.test(host));
    return ok ? u.href : '';
  } catch { return ''; }
}
function safeInstagram(v) {
  try {
    const u = new URL(v);
    const name = u.pathname.split('/').filter(Boolean)[0] || '';
    return u.protocol === 'https:' && /(^|\.)instagram\.com$/.test(u.hostname) && /^[A-Za-z0-9._]{1,30}$/.test(name) ? `https://www.instagram.com/${name}/` : '';
  } catch { return ''; }
}
function socialHtml() {
  // Without the owner's review link, the Google button opens the café on Google Maps (search by name and
  // area), where guests can tap "Write a review". Instagram shows once the owner adds their handle.
  const ownG = safeGoogle(data.links?.google);
  const place = [data.name, data.tagline].filter(Boolean).join(' ').replace(/[·|•]/g, ' ').replace(/\s+/g, ' ').trim();
  const g = ownG || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
  const ig = safeInstagram(data.links?.instagram);
  const handle = ig ? `@${ig.split('/')[3]}` : '';
  return `
    <section class="social" aria-labelledby="social-title">
      <h2 id="social-title">Liked what you ate?</h2>
      <p>Tell people about ${esc(data.name)}, or see what’s new before your next visit.</p>
      <div class="social-actions">
        ${g ? `<a class="social-btn" href="${esc(g)}" target="_blank" rel="noopener noreferrer"><img src="assets/icons/google-icon.svg" alt="" width="24" height="24"><span><b>Review us on Google</b><small>${ownG ? 'Takes a minute' : 'Find us on Google Maps'}</small></span>${icons.arrow}</a>` : ''}
        ${ig ? `<a class="social-btn" href="${esc(ig)}" target="_blank" rel="noopener noreferrer"><img src="assets/icons/instagram-icon.svg" alt="" width="24" height="24"><span><b>Follow on Instagram</b><small>${esc(handle)}</small></span>${icons.arrow}</a>` : ''}
      </div>
    </section>`;
}

/* ---------- Shell ---------- */
const QUICK = [
  { id: 'popular', label: 'Popular', icon: icons.star },
  { id: 'veg', label: 'Veg', icon: '<span class="vnv veg" aria-hidden="true"></span>' },
  { id: 'drinks', label: 'Drinks' },
  { id: 'food', label: 'Food' },
];

function renderMenu() {
  app.innerHTML = `
    <header class="masthead">
      <div class="mast-top">
        ${logoHtml()}
        <div class="mast-chips">
          ${data.wifi?.ssid ? `<button type="button" class="table-chip" id="wifi-chip" aria-haspopup="dialog">${icons.wifi}Wi-Fi</button>` : ''}
          ${tableNo ? `<span class="table-chip">${icons.dish}Table ${esc(tableNo)}</span>` : ''}
        </div>
      </div>
      <h1 class="mast-name">${esc(data.name)}</h1>
      ${data.tagline ? `<p class="mast-tag">${esc(data.tagline)}</p>` : ''}
    </header>
    <section class="hero" id="hero" aria-label="Spotlight"></section>
    <div class="toolbar">
      <form class="search" role="search" onsubmit="return false">
        ${icons.search}
        <input id="q" type="search" inputmode="search" enterkeyhint="search" autocomplete="off"
          placeholder="Search · try “cold, no coffee”" aria-label="Search the menu">
        <button type="button" class="search-clear" aria-label="Clear search" hidden>${icons.close}</button>
        <button type="button" class="filter-btn" id="open-filters" aria-haspopup="dialog" aria-label="Filters">${icons.sliders}<span class="chip-count" hidden></span></button>
      </form>
      <div class="chips" role="group" aria-label="Quick filters">
        ${QUICK.map((c) => `<button type="button" class="chip" data-chip="${c.id}" aria-pressed="false">${c.icon || ''}${c.label}</button>`).join('')}
      </div>
    </div>
    <main id="feed" class="feed" aria-live="polite"></main>
    <button type="button" class="menu-fab" id="menu-fab" aria-haspopup="dialog" hidden>${icons.list}<span>Menu</span></button>
    <div class="cartbar" id="cartbar" hidden><button type="button" id="open-cart" aria-haspopup="dialog"></button></div>
    <footer class="foot">
      ${socialHtml()}
      ${data.footerNote ? `<p class="foot-note">${esc(data.footerNote)}</p>` : ''}
      <a class="made-by" href="https://heynomnom.in" target="_blank" rel="noopener"><span>Menu by</span><img src="assets/brand/nomnom-logo-t.png" alt="NomNom" width="64" height="38"></a>
    </footer>
    <div class="sheet" id="sheet" aria-hidden="true">
      <div class="sheet-backdrop" data-close></div>
      <div class="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div class="sheet-grab"><span></span></div>
        <button class="sheet-close glass" data-close aria-label="Close">${icons.close}</button>
        <div class="sheet-scroll"></div>
      </div>
    </div>`;

  const q = $('#q');
  const clear = $('.search-clear');
  let t;
  q.addEventListener('input', () => {
    clear.hidden = !q.value;
    clearTimeout(t);
    t = setTimeout(() => { state.query = q.value; renderFeed(true); }, 180);
  });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') q.blur(); });
  clear.onclick = () => { q.value = ''; clear.hidden = true; state.query = ''; renderFeed(true); q.focus(); };

  $('.chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-chip]');
    if (!chip) return;
    const id = chip.dataset.chip;
    if (state.chips.has(id)) state.chips.delete(id);
    else {
      state.chips.add(id);
      // Veg means vegetarian FOOD, so it can't be combined with Drinks.
      if (id === 'drinks') { state.chips.delete('food'); state.chips.delete('veg'); }
      if (id === 'food') state.chips.delete('drinks');
      if (id === 'veg') state.chips.delete('drinks');
    }
    syncChips();
    renderFeed(true);
  });
  $('#open-filters').onclick = openFilters;
  $('#menu-fab').onclick = openCategories;
  $('#open-cart').onclick = () => (cartCount() ? openCart() : openOrderStatus());
  $('#wifi-chip')?.addEventListener('click', openWifi);
  loadCart();
  syncCartBar();
  const toolbar = $('.toolbar');
  new ResizeObserver(() => document.documentElement.style.setProperty('--toolbar-h', `${toolbar.offsetHeight}px`)).observe(toolbar);
  addEventListener('scroll', onScrollFab, { passive: true });

  $('#feed').addEventListener('click', onFeedClick);
  $('#hero').addEventListener('click', onFeedClick);
  bindSheet();
  addEventListener('hashchange', () => jumpToCategory(location.hash.slice(1)));

  renderFeed();
  if (location.hash.startsWith('#cat-')) jumpToCategory(location.hash.slice(1), false);
}

function syncChips() {
  $$('[data-chip]').forEach((c) => c.setAttribute('aria-pressed', state.chips.has(c.dataset.chip)));
  const n = Object.values(state.sheetFilters).filter((v) => v !== undefined && v !== null && v !== false).length;
  const badge = $('.chip-count');
  badge.hidden = !n;
  badge.textContent = n;
  $('#open-filters').setAttribute('aria-label', n ? `Filters, ${n} active` : 'Filters');
  $('#open-filters').classList.toggle('on', n > 0);
}

function currentFilters() {
  const parsed = parseQuery(state.query);
  const chipF = {};
  if (state.chips.has('popular')) chipF.popular = true;
  if (state.chips.has('veg')) { chipF.veg = true; chipF.group = 'food'; }
  if (state.chips.has('drinks')) chipF.group = 'drinks';
  if (state.chips.has('food')) chipF.group = 'food';
  return { parsed, filters: mergeFilters(chipF, state.sheetFilters, parsed.filters) };
}

/* ---------- Feed ---------- */
function renderFeed(resetScroll = false) {
  const feed = $('#feed');
  const { parsed, filters } = currentFilters();
  resetVideos();
  const browsing = !hasFilters(filters, parsed.terms);
  if (browsing) renderBrowse(feed);
  else renderResults(feed, parsed, filters);
  renderHero(browsing);
  observeVideos(feed);
  observeVideos($('#hero'));
  bindRails(feed);
  onScrollFab();
  if (resetScroll) {
    const top = $('.toolbar').offsetTop;
    if (scrollY > top) scrollTo({ top, behavior: 'auto' });
  }
}

function renderBrowse(feed) {
  const rails = data.rails.map(railHtml).join('');
  const cats = data.categories.filter((c) => countIn(c));
  const groups = data.groups
    .map((g) => {
      const gc = cats.filter((c) => c.group === g.id);
      if (!gc.length) return '';
      return `<section class="group" aria-labelledby="g-${esc(g.id)}">
        <h3 class="group-title" id="g-${esc(g.id)}">${esc(g.label)}</h3>
        ${gc.map(categoryBlock).join('')}
      </section>`;
    })
    .join('');
  const items = cats.reduce((n, c) => n + countIn(c), 0);
  const menu = `
    <section class="menu-sec" id="menu-start" aria-labelledby="menu-title">
      <div class="sec-head">
        <h2 id="menu-title">The full menu</h2>
        <p class="sec-meta">${items} items · ${cats.length} sections</p>
      </div>
      ${groups}
    </section>`;
  feed.innerHTML = rails + bestSellersHtml() + menu;
}

function railList(s) {
  let list = data.dishes.filter((d) => d.tags.includes(s.match));
  if (s.order?.length) {
    const rank = (d) => { const i = s.order.indexOf(d.id); return i < 0 ? 1e9 : i; };
    list = list.sort((a, b) => rank(a) - rank(b));
  }
  return list;
}

/* Featured lists: a row of tall cards you swipe through. The card in view plays its clip;
   the counter and the track under the row follow your thumb. */
function railHtml(s) {
  const list = railList(s);
  if (!list.length) return '';
  return `
    <section class="rail-sec" aria-labelledby="rail-${esc(s.id)}">
      <div class="sec-head">
        <div>
          ${s.eyebrow ? `<p class="eyebrow">${esc(s.eyebrow)}</p>` : ''}
          <h2 id="rail-${esc(s.id)}">${esc(label(s))}</h2>
        </div>
        ${list.length > 1 ? `<p class="rail-count" aria-hidden="true"><b>1</b> / ${list.length}</p>` : ''}
      </div>
      <div class="rail" data-rail>${list.map((d, i) => featureCard(d, i)).join('')}</div>
      ${list.length > 1 ? `<div class="rail-track" aria-hidden="true"><span style="width:${(100 / list.length).toFixed(2)}%"></span></div>` : ''}
    </section>`;
}

function bindRails(root) {
  for (const rail of $$('[data-rail]', root)) {
    if (rail.dataset.bound) continue;
    rail.dataset.bound = '1';
    const sec = rail.closest('.rail-sec');
    const count = $('.rail-count b', sec);
    const thumb = $('.rail-track span', sec);
    const n = rail.children.length;
    let tick = false;
    rail.addEventListener('scroll', () => {
      if (tick) return;
      tick = true;
      requestAnimationFrame(() => {
        tick = false;
        const max = rail.scrollWidth - rail.clientWidth;
        const f = max > 0 ? rail.scrollLeft / max : 0;
        if (thumb) thumb.style.transform = `translateX(${(f * (n - 1) * 100).toFixed(1)}%)`;
        if (count) count.textContent = Math.min(n, Math.round(f * (n - 1)) + 1);
      });
    }, { passive: true });
  }
}

/* Best sellers: the dishes the owner marks Bestseller, topped up from the featured list, as a numbered top 5. */
function bestSellers() {
  const marked = data.dishes.filter((d) => !soldOut(d) && (d.badges.includes('bestseller') || d.tags.includes('bestseller')));
  if (!marked.length) return [];
  const out = [...marked];
  for (const r of data.rails) for (const d of railList(r)) if (out.length < 5 && !soldOut(d) && !out.includes(d)) out.push(d);
  return out.slice(0, 5);
}

function bestSellersHtml() {
  const list = bestSellers();
  if (list.length < 3) return '';
  return `
    <section class="top-sec" aria-labelledby="top-title">
      <div class="sec-head">
        <div><p class="eyebrow">Top ${list.length}</p><h2 id="top-title">Best sellers</h2></div>
      </div>
      <ol class="top-list">${list.map((d, i) => `
        <li class="top-li${hasVideo(d) ? ' has-clip' : ''}" data-id="${esc(d.id)}">
          <span class="top-n" aria-hidden="true">${i + 1}</span>
          ${mediaHtml(d, 'top-media')}
          <span class="top-text">
            <span class="top-name">${vegMark(d)}<button type="button" class="name-btn">${esc(d.name)}</button></span>
            <span class="top-meta"><span class="price">${esc(fmtPrice(d.price))}</span>${esc(ctx.categoryLabel(d))}</span>
          </span>
          ${addControl(d) || `<span class="top-go" aria-hidden="true">${icons.arrow}</span>`}
        </li>`).join('')}
      </ol>
    </section>`;
}

const dishesIn = (c) => data.dishes.filter((d) => d.category === c.match);

const countIn = (c) => dishesIn(c).length;

// Accordion: categories are collapsed headings and only one is open at a time. The open one's heading
// sticks under the search bar while you scroll through its items.
function categoryBlock(c) {
  const list = dishesIn(c);
  const open = state.openCat === c.id;
  const clips = list.filter(hasVideo).length;
  const peek = list.filter((d) => d.thumb || d.image).slice(0, 3)
    .map((d) => `<img src="${esc(d.thumb || sizedImage(d.image, 160))}" alt="" loading="lazy" decoding="async" style="object-position:${esc(d.focus || '50% 50%')}">`).join('');
  return `
    <section class="cat${open ? ' open' : ''}" id="cat-${esc(c.id)}">
      <h3 class="cat-h">
        <button type="button" class="cat-head" data-cat="${esc(c.id)}" aria-expanded="${open}" aria-controls="body-${esc(c.id)}">
          <span class="cat-name">
            <span class="cat-title">${esc(label(c))}</span>
            <span class="cat-meta">${list.length} ${list.length === 1 ? 'item' : 'items'}${clips ? ` · <span class="cat-clips">${clips} on video</span>` : ''}${c.eyebrow ? ` · ${esc(c.eyebrow)}` : ''}</span>
          </span>
          ${peek ? `<span class="cat-peek" aria-hidden="true">${peek}</span>` : ''}
          <span class="chev">${icons.chevron}</span>
        </button>
      </h3>
      <div class="cat-body" id="body-${esc(c.id)}" ${open ? '' : 'hidden'}>${open ? listHtml(byMedia(list)) : ''}</div>
    </section>`;
}

/* Accordion animation: the body slides open/closed (height + fade) and the chevron turns.
   A category closing ABOVE the one you tapped collapses instantly and the page is shifted to match, so the
   heading under your finger doesn't jump; one closing below it slides shut. Reduced motion: no animation. */
const ACC_MS = prefersReduced ? 0 : 300;
const ACC_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const toolbarHeight = () => $('.toolbar')?.offsetHeight || 0;

function slide(body, from, to, done) {
  body.getAnimations().forEach((a) => a.cancel());
  if (!ACC_MS) return done?.();
  body.style.overflow = 'hidden';
  const anim = body.animate(
    [{ height: `${from}px`, opacity: from ? 1 : 0 }, { height: `${to}px`, opacity: to ? 1 : 0 }],
    { duration: ACC_MS, easing: ACC_EASE },
  );
  anim.onfinish = () => { body.style.overflow = ''; done?.(); };
}

function collapse(block, animate) {
  block.classList.remove('open');
  $('.cat-head', block).setAttribute('aria-expanded', 'false');
  const body = $('.cat-body', block);
  $$('video', body).forEach((v) => v.pause());
  const finish = () => { body.hidden = true; body.innerHTML = ''; };
  if (animate) slide(body, body.offsetHeight, 0, finish);
  else { body.getAnimations().forEach((a) => a.cancel()); finish(); }
}

function expand(block, c) {
  block.classList.add('open');
  $('.cat-head', block).setAttribute('aria-expanded', 'true');
  const body = $('.cat-body', block);
  body.innerHTML = listHtml(byMedia(dishesIn(c)));
  body.hidden = false;
  observeVideos(body);
  slide(body, 0, Math.min(body.scrollHeight, innerHeight * 1.5));
}

function toggleCategory(id, force) {
  const block = $(`#cat-${CSS.escape(id)}`);
  if (!block) return;
  const open = force ?? state.openCat !== id;
  const tb = toolbarHeight();

  // Closing the open category by tapping its own heading.
  if (!open) {
    const stuck = block.getBoundingClientRect().top < tb; // heading is pinned: content above the fold
    collapse(block, !stuck);
    if (stuck) scrollTo({ top: scrollY + block.getBoundingClientRect().top - tb, behavior: 'auto' });
    state.openCat = null;
    return pickActive();
  }

  // Opening: close the other one first (only one open at a time).
  const before = block.getBoundingClientRect().top;
  for (const other of $$('.cat.open')) {
    if (other === block) continue;
    const isAbove = other.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING;
    collapse(other, !isAbove);
    if (isAbove) scrollTo({ top: scrollY + block.getBoundingClientRect().top - before, behavior: 'auto' });
  }
  state.openCat = id;
  if (!block.classList.contains('open')) expand(block, data.categories.find((x) => x.id === id));
  // Bring the heading near the top if it's hidden under the toolbar or low on the screen.
  const top = block.getBoundingClientRect().top;
  if (top < tb || top > innerHeight * 0.55) scrollTo({ top: scrollY + top - tb, behavior: prefersReduced ? 'auto' : 'smooth' });
  pickActive();
}

function jumpToCategory(hashId) {
  if (!hashId?.startsWith('cat-')) return;
  const id = hashId.slice(4);
  if (!$(`#cat-${CSS.escape(id)}`)) clearAll(); // in results mode: go back to browsing first
  toggleCategory(id, true);
  const block = $(`#cat-${CSS.escape(id)}`);
  if (block) scrollTo({ top: scrollY + block.getBoundingClientRect().top - toolbarHeight(), behavior: prefersReduced ? 'auto' : 'smooth' });
}

/* Floating "Menu" button: appears once you scroll past the category overview, opens a category list. */
let fabTick = false;
function onScrollFab() {
  if (fabTick) return;
  fabTick = true;
  requestAnimationFrame(() => {
    fabTick = false;
    const fab = $('#menu-fab');
    const ms = $('#menu-start');
    // Hidden again near the bottom so it never covers the reviews or the NomNom credit.
    const foot = $('.foot');
    const atFoot = foot && foot.getBoundingClientRect().top < innerHeight - 40;
    const show = Boolean(ms) && ms.getBoundingClientRect().top < 0 && !atFoot && !state.sheetOpen;
    fab.hidden = !ms;
    fab.classList.toggle('show', show);
  });
}

function openCategories() {
  const toolbarH = $('.toolbar').offsetHeight;
  let current = null;
  const openEl = $('.cat.open');
  if (openEl && openEl.getBoundingClientRect().top <= toolbarH + 2) current = openEl.id;
  const html = data.groups.map((g) => {
    const cats = data.categories.filter((c) => c.group === g.id && countIn(c));
    if (!cats.length) return '';
    return `<h3 class="catlist-group">${esc(g.label)}</h3>
      <ul class="catlist">${cats.map((c) => `<li><button type="button" data-goto="cat-${esc(c.id)}"${current === `cat-${c.id}` ? ' aria-current="true"' : ''}>
        <span>${esc(label(c))}</span><small>${countIn(c)}</small></button></li>`).join('')}</ul>`;
  }).join('');
  openSheet(`<div class="sheet-body catsheet"><h2 id="sheet-title">Menu</h2>${html}</div>`, { kind: 'cats' });
}

function renderResults(feed, parsed, filters) {
  // A query that literally matches a dish name ("cold brew", "iced latte") outranks everything.
  const rawQ = state.query.trim().toLowerCase();
  const exact = (d) => (rawQ.length > 2 && d.name.toLowerCase().includes(rawQ) ? 100 : 0);
  let list = data.dishes
    .filter((d) => matchDish(d, filters, ctx) || exact(d))
    .map((d) => ({ d, s: scoreDish(d, parsed.terms, ctx) + exact(d) }))
    .filter((x) => x.s > 0);
  let isLoose = false;
  if (!list.length && parsed.terms.length > 1) {
    // Nothing matched every word — fall back to any word.
    list = data.dishes
      .filter((d) => matchDish(d, filters, ctx))
      .map((d) => ({ d, s: scoreDish(d, parsed.terms, ctx, true) }))
      .filter((x) => x.s > 0);
    isLoose = list.length > 0;
  }
  const order = new Map(data.categories.map((c, i) => [c.match, i]));
  list.sort((a, b) => soldOut(a.d) - soldOut(b.d) || (parsed.terms.length ? b.s - a.s : 0) || order.get(a.d.category) - order.get(b.d.category));

  const SHEET_LABELS = { veg: 'Veg', vegan: 'Vegan', noEgg: 'No egg', nonveg: 'Non-veg', noDairy: 'No dairy', noGluten: 'No gluten',
    noNuts: 'No nuts', noCoffee: 'No coffee', quick: 'Ready in ≤10 min', notSpicy: 'Not spicy', spicy: 'Spicy', light: 'Light' };
  const understood = [...parsed.labels];
  const chipLabels = { popular: 'Popular', veg: 'Veg', drinks: 'Drinks', food: 'Food' };
  for (const c of state.chips) if (!understood.includes(chipLabels[c])) understood.push(chipLabels[c]);
  for (const [k, v] of Object.entries(state.sheetFilters)) {
    if (!v) continue;
    const l = k === 'temp' ? (v === 'cold' ? 'Cold' : 'Hot') : k === 'maxPrice' ? `Under ${fmtPrice(v)}` : SHEET_LABELS[k];
    if (l && !understood.includes(l)) understood.push(l);
  }
  if (parsed.terms.length) understood.unshift(`“${parsed.terms.join(' ')}”`);
  const summary = `
    <div class="results-head">
      <p class="results-count"><strong>${list.length}</strong> ${list.length === 1 ? 'match' : 'matches'}${isLoose ? ' (closest)' : ''}</p>
      ${understood.length ? `<p class="understood">Showing: ${understood.map((l) => `<span>${esc(l)}</span>`).join('')}</p>` : ''}
      <button type="button" class="link-btn" data-clear>Clear all</button>
    </div>`;

  if (!list.length) {
    feed.innerHTML = `${summary}
      <div class="empty">
        <p>Nothing matches that just yet.</p>
        <p class="empty-sub">Try one of these:</p>
        <div class="suggest">
          ${['something cold without coffee', 'veg meal under 350', 'quick snack', 'spicy chicken', 'hot drink no coffee']
            .map((s) => `<button type="button" class="chip" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}
        </div>
      </div>`;
    return;
  }

  // Group by category when not ranking by keywords.
  let html = '';
  if (parsed.terms.length) html = listHtml(list.map((x) => x.d));
  else {
    const byCat = new Map();
    for (const { d } of list) byCat.set(d.category, [...(byCat.get(d.category) || []), d]);
    for (const [, ds] of byCat) html += `<h3 class="results-cat">${esc(ctx.categoryLabel(ds[0]))}</h3>${listHtml(byMedia(ds))}`;
  }
  feed.innerHTML = `${summary}<div class="results">${html}</div>`;
}

function clearAll() {
  state.query = '';
  state.chips.clear();
  state.sheetFilters = {};
  const q = $('#q');
  if (q) { q.value = ''; $('.search-clear').hidden = true; }
  syncChips();
  renderFeed();
}

/* ---------- Cards ---------- */
function badgeLabel(key) {
  return (data.badges?.[key] || { label: key }).label;
}
function badgeHtml(key) {
  const b = data.badges?.[key] || { label: key, tone: 'neutral' };
  return `<span class="badge ${esc(b.tone || 'neutral')}">${esc(b.label)}</span>`;
}

function vegMark(d) {
  if (d.diet?.veg == null) return '';
  const kind = d.diet.veg ? 'veg' : d.diet.egg ? 'egg' : 'nonveg';
  const text = { veg: 'Vegetarian', egg: 'Contains egg', nonveg: 'Non-vegetarian' }[kind];
  return `<span class="vnv ${kind}" role="img" aria-label="${text}"></span>`;
}

function pills(d, { kcal = false } = {}) {
  const out = [];
  if (d.prepTime) out.push(`<span class="pill">${icons.clock}${d.prepTime} min</span>`);
  if (d.temp === 'cold') out.push(`<span class="pill">${icons.snow}Cold</span>`);
  if (d.temp === 'hot') out.push(`<span class="pill">${icons.cup}Hot</span>`);
  if (d.spice > 0) out.push(`<span class="pill spice" role="img" aria-label="Spice level ${d.spice} of 3">${icons.flame.repeat(d.spice)}</span>`);
  if (d.diet?.vegan) out.push('<span class="pill">Vegan</span>');
  if (kcal && d.kcal) out.push(`<span class="pill">${icons.bolt}${d.kcal} kcal</span>`);
  return out.join('');
}

/* Pick a file size that fits the slot, for the stock hosts we use (Unsplash photos, Mixkit clips).
   Owner uploads are already resized in the dashboard. A 108px row thumbnail needs ~320px, not 900px,
   and a 360p clip is ~1 MB instead of ~6 MB at 720p, so cards show up fast on mobile data. */
function sizedImage(url, w) {
  if (!url) return url;
  if (url.includes('images.unsplash.com/')) return /[?&]w=\d+/.test(url) ? url.replace(/([?&])w=\d+/, `$1w=${w}`) : `${url}${url.includes('?') ? '&' : '?'}w=${w}`;
  if (url.includes('assets.mixkit.co/') && w <= 400) return url.replace('-thumb-720-', '-thumb-360-');
  return url;
}
function sizedVideo(url, small) {
  return small && /assets\.mixkit\.co\/.+-720\.mp4$/.test(url) ? url.replace(/-720\.mp4$/, '-360.mp4') : url;
}
// Photos fade in over a shimmer instead of popping in on a blank box.
const imgLoaded = `onload="this.classList.add('ld')" onerror="this.classList.add('ld')"`;

function mediaHtml(d, cls, { eager = false, w = 320 } = {}) {
  const hasVid = d.video && !failedVideos.has(d.video);
  const focus = esc(d.focus || '50% 50%');
  if (!d.image && !hasVid) {
    // No photo yet (e.g. just imported): a quiet monogram instead of an empty box.
    return `<div class="${cls} no-photo" aria-hidden="true"><span>${esc(d.name.trim()[0] || '•')}</span>
      ${soldOut(d) ? '<span class="soldout-tag">Sold out</span>' : ''}</div>`;
  }
  return `
    <div class="${cls}${hasVid ? ' has-video' : ''}">
      ${d.image ? `<img src="${esc(w <= 400 && d.thumb ? d.thumb : sizedImage(d.image, w))}" alt="" loading="${eager ? 'eager' : 'lazy'}"${eager ? ' fetchpriority="high"' : ''} decoding="async" ${imgLoaded} style="object-position:${focus}">` : ''}
      ${hasVid ? `
        <video muted loop playsinline preload="none" data-src="${esc(sizedVideo(d.video, true))}" aria-hidden="true" tabindex="-1" style="object-position:${focus}"></video>
        <span class="vspin" aria-hidden="true"></span>` : ''}
      ${soldOut(d) ? '<span class="soldout-tag">Sold out</span>' : ''}
    </div>`;
}

/* Featured rails: tall "story" cards — the food fills the card; name, price and Add sit on a dark fade. */
function featureCard(d, i) {
  return `
    <article class="feature story-card${soldOut(d) ? ' is-soldout' : ''}" data-id="${esc(d.id)}">
      ${mediaHtml(d, 'media', { eager: i < 3, w: 640 })}
      <div class="feature-body overlay">
        ${d.badges.length ? `<div class="badges-inline">${d.badges.slice(0, 1).map(badgeHtml).join('')}</div>` : ''}
        <h3>${vegMark(d)}<button type="button" class="name-btn">${esc(d.name)}</button></h3>
        <div class="story-foot"><span class="price">${esc(fmtPrice(d.price))}</span>${d.prepTime ? `<span class="pill">${icons.clock}${d.prepTime} min</span>` : ''}${addControl(d)}</div>
      </div>
    </article>`;
}

/* Spotlight: one signature dish, edge to edge, at the top of the menu (hidden while searching/filtering).
   Off unless the owner switches it on (menu.hero.enabled). Uses menu.hero.dishId if chosen, else the first
   video item of the first featured list. */
function spotlightDish() {
  const pick = (id) => id && byId(id) && !soldOut(byId(id)) ? byId(id) : null;
  if (pick(data.hero?.dishId)) return pick(data.hero.dishId);
  for (const r of data.rails) {
    for (const id of r.order || []) if (pick(id)?.video) return pick(id);
    const first = data.dishes.find((d) => d.tags.includes(r.match) && d.video && !soldOut(d));
    if (first) return first;
  }
  return data.dishes.find((d) => d.video && !soldOut(d)) || data.dishes.find((d) => d.image && !soldOut(d)) || null;
}

function renderHero(show) {
  const el = $('#hero');
  if (!el) return;
  const d = show && data.hero?.enabled ? spotlightDish() : null;
  el.hidden = !d;
  if (!d) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <article class="hero-card" data-id="${esc(d.id)}">
      ${mediaHtml(d, 'media hero-media', { eager: true, w: 900 })}
      <div class="hero-body">
        <p class="eyebrow">${esc(data.hero?.label || 'Tonight’s spotlight')}</p>
        <h2 class="hero-title">${vegMark(d)}<button type="button" class="name-btn">${esc(d.name)}</button></h2>
        ${d.description ? `<p class="hero-desc">${esc(d.description)}</p>` : ''}
        <div class="hero-foot"><span class="price">${esc(fmtPrice(d.price))}</span>${pills(d)}${addControl(d)}</div>
      </div>
    </article>`;
}

// Items with a video show as full-width cards (like the featured cards at the top) with a 16:9 video,
// about twice the height of a photo row. Everything stays in menu order.
const hasVideo = (d) => Boolean(d.video) && !failedVideos.has(d.video);
// Inside a section, dishes with a video come first (as big video cards), then dishes with a photo,
// then the rest; sold-out dishes go last. Menu order is kept within each group.
const mediaRank = (d) => (soldOut(d) ? 3 : hasVideo(d) ? 0 : d.image || d.thumb ? 1 : 2);
const byMedia = (list) => list.map((d, i) => [d, i]).sort((a, b) => mediaRank(a[0]) - mediaRank(b[0]) || a[1] - b[1]).map(([d]) => d);
const listHtml = (list) => list.map((d) => (hasVideo(d) ? wideCard(d) : rowCard(d))).join('');

function wideCard(d) {
  return `
    <article class="feature wide${soldOut(d) ? ' is-soldout' : ''}" data-id="${esc(d.id)}">
      <div class="wide-media">
        ${mediaHtml(d, 'media', { w: 900 })}
        ${d.badges.length ? `<div class="badges">${d.badges.slice(0, 2).map(badgeHtml).join('')}</div>` : ''}
        <div class="wide-title">
          <h3>${vegMark(d)}<button type="button" class="name-btn">${esc(d.name)}</button></h3>
          <span class="price">${esc(fmtPrice(d.price))}</span>
        </div>
      </div>
      <div class="feature-body">
        ${d.description ? `<p class="desc">${esc(d.description)}</p>` : ''}
        <div class="pills">${pills(d)}${addControl(d)}</div>
      </div>
    </article>`;
}

function rowCard(d) {
  const badge = d.badges[0];
  const media = d.image || d.video;
  return `
    <article class="row${soldOut(d) ? ' is-soldout' : ''}${media ? '' : ' no-media'}" data-id="${esc(d.id)}">
      <div class="row-text">
        ${badge ? `<p class="row-badge">${esc(badgeLabel(badge))}</p>` : ''}
        <h3>${vegMark(d)}<button type="button" class="name-btn">${esc(d.name)}</button></h3>
        <p class="desc">${esc(d.description)}</p>
        <div class="row-foot"><span class="price">${esc(fmtPrice(d.price))}</span>${pills(d)}</div>
      </div>
      ${media || canOrder() ? `<div class="row-side">${media ? mediaHtml(d, 'row-media') : ''}${addControl(d)}</div>` : ''}
    </article>`;
}

function onFeedClick(e) {
  const t = e.target;
  const add = t.closest('[data-add]');
  if (add) return onAddClick(e, add);
  const cat = t.closest('[data-cat]');
  if (cat) return toggleCategory(cat.dataset.cat);
  const jump = t.closest('[data-jump]');
  if (jump) {
    e.preventDefault();
    history.replaceState(history.state, '', `#${jump.dataset.jump}`);
    return jumpToCategory(jump.dataset.jump);
  }
  if (t.closest('[data-clear]')) return clearAll();
  const sug = t.closest('[data-suggest]');
  if (sug) {
    $('#q').value = sug.dataset.suggest;
    $('.search-clear').hidden = false;
    state.query = sug.dataset.suggest;
    return renderFeed(true);
  }
  const card = t.closest('[data-id]');
  if (card) openDish(card.dataset.id);
}

/* ==========================================================
   Video engine
   - Sources load ~300px before a video scrolls in.
   - Autoplay (if on): the topmost video ≥60% visible plays, muted; all others pause.
   - No video buttons: clips are silent loops. Tapping a card opens the dish. Scrolling never starts a
     video (no touchstart). Guests can switch autoplay off in Filters; it starts off for reduce-motion/data saver.
   - Nothing video-related downloads until the page's photos have loaded, so photos appear first on slow data.
   - If a video errors or hasn't started after 8 s, it is dropped and the photo stays.
   ========================================================== */
let playIO;
let loadIO;
let pageLoaded = document.readyState === 'complete';
const waitingForLoad = new Set();
addEventListener('load', () => {
  pageLoaded = true;
  waitingForLoad.forEach(prepare);
  waitingForLoad.clear();
  pickActive();
});
const ratios = new Map();
const timers = new WeakMap();

function resetVideos() {
  playIO?.disconnect();
  loadIO?.disconnect();
  ratios.clear();
  state.active?.pause();
  state.active = null;
  state.manual = null;
  playIO = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        ratios.set(e.target, e.intersectionRatio);
        if (e.intersectionRatio >= 0.25 && pageLoaded && e.target.getAttribute('src')) e.target.preload = 'auto';
        if (e.intersectionRatio === 0) state.userPaused.delete(e.target);
      }
      pickActive();
    },
    { threshold: [0, 0.25, 0.45, 0.6, 0.8, 1] },
  );
  loadIO = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (e.isIntersecting) { prepare(e.target); loadIO.unobserve(e.target); }
    }),
    { rootMargin: '300px 300px' },
  );
}

function observeVideos(root) {
  for (const v of $$('video', root)) {
    if (v.dataset.bound) continue;
    v.dataset.bound = '1';
    const media = v.parentElement;
    v.addEventListener('playing', () => {
      clearTimeout(timers.get(v));
      media.classList.add('playing');
      media.classList.remove('buffering');
    });
    v.addEventListener('pause', () => {
      clearTimeout(timers.get(v));
      media.classList.remove('playing', 'buffering');
    });
    v.addEventListener('waiting', () => media.classList.add('buffering'));
    v.addEventListener('error', () => failVideo(v));
    v.addEventListener('loadedmetadata', () => {
      // Upright clips (shot on a phone) are shown whole, never cut: they sit on a soft blurred copy of the photo.
      if (v.videoHeight > v.videoWidth * 1.05) {
        media.classList.add('upright');
        if (media.closest('.feature.wide')) media.classList.add('tall');
      }
    });
    loadIO.observe(v);
    playIO.observe(v);
  }
}

function prepare(v) {
  if (!pageLoaded) { waitingForLoad.add(v); return; }
  if (!v.getAttribute('src') && v.dataset.src) {
    v.src = v.dataset.src;
    v.preload = 'metadata';
  }
}

function failVideo(v) {
  clearTimeout(timers.get(v));
  if (v.dataset.src) failedVideos.add(v.dataset.src);
  const media = v.parentElement;
  playIO?.unobserve(v);
  ratios.delete(v);
  if (state.active === v) state.active = null;
  if (state.manual === v) state.manual = null;
  v.removeAttribute('src');
  v.remove();
  $('.vspin', media)?.remove();
  media?.classList.remove('has-video', 'playing', 'buffering');
  media?.classList.add('video-failed');
  pickActive();
}

function pickActive() {
  if (state.sheetOpen || document.hidden || !pageLoaded) return;
  if (state.manual && (ratios.get(state.manual) || 0) >= 0.3) return play(state.manual);
  state.manual = null;
  if (!state.autoplay) return play(null);
  const candidates = [...ratios.entries()]
    .filter(([v, r]) => r >= 0.6 && !state.userPaused.has(v) && v.isConnected)
    .map(([v]) => v);
  candidates.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return ra.top - rb.top || ra.left - rb.left;
  });
  play(candidates[0] || null);
}

function play(v) {
  if (state.active && state.active !== v) state.active.pause();
  state.active = v;
  if (!v) return;
  prepare(v);
  v.muted = true;
  if (!v.paused) return;
  v.parentElement.classList.add('buffering');
  clearTimeout(timers.get(v));
  timers.set(v, setTimeout(() => { if (v.readyState < 3) failVideo(v); }, 8000));
  v.play()?.catch((err) => {
    if (err?.name === 'NotAllowedError') { v.parentElement.classList.remove('buffering'); return; }
    failVideo(v);
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) state.active?.pause();
  else pickActive();
});

/* ---------- Bottom sheet (dish details + filters) ---------- */
function openSheet(html, { replace = false, kind = 'dish' } = {}) {
  const sheet = $('#sheet');
  const scroll = $('.sheet-scroll', sheet);
  stopSheetVideo();
  state.active?.pause();
  state.sheetOpen = true;
  sheet.dataset.kind = kind;
  scroll.innerHTML = html;
  scroll.scrollTop = 0;
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  $('#menu-fab')?.classList.remove('show');
  document.documentElement.classList.add('lock');
  if (replace) history.replaceState({ sheet: kind }, '');
  else if (!history.state?.sheet) history.pushState({ sheet: kind }, '');
  $('.sheet-close', sheet).focus({ preventScroll: true });
}

function stopSheetVideo() {
  const v = $('#sheet .sheet-scroll video');
  if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
}

function closeSheet(fromPop = false) {
  if (!state.sheetOpen) return;
  const sheet = $('#sheet');
  state.sheetOpen = false;
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
  document.documentElement.classList.remove('lock');
  $('.sheet-panel', sheet).style.transform = '';
  setTimeout(stopSheetVideo, 380);
  if (!fromPop && history.state?.sheet) history.back();
  if (sheet.dataset.kind === 'filters') renderFeed(true);
  if (sheet.dataset.kind === 'cart') { state.orderNote = $('#order-note')?.value ?? state.orderNote; state.orderTable = $('#order-table')?.value ?? state.orderTable; }
  clearInterval(statusTimer);
  syncCartBar();
  setTimeout(pickActive, 60);
  onScrollFab();
}

function bindSheet() {
  const sheet = $('#sheet');
  const panel = $('.sheet-panel', sheet);
  const scroll = $('.sheet-scroll', sheet);

  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closeSheet();
    const pair = e.target.closest('[data-open]');
    if (pair) return openDish(pair.dataset.open, true);
    const add = e.target.closest('[data-add]');
    if (add) return onAddClick(e, add);
    if (e.target.closest('#place-order')) return placeOrder();
    if (e.target.closest('[data-reorder]')) { closeSheet(); return; }
    const cp = e.target.closest('[data-copy]');
    if (cp) return copyText(cp.dataset.copy, cp);
    const go = e.target.closest('[data-goto]');
    if (go) {
      closeSheet();
      setTimeout(() => jumpToCategory(go.dataset.goto), 60);
      return;
    }
    onFilterClick(e);
  });
  sheet.addEventListener('input', onFilterInput);
  addEventListener('popstate', () => { if (state.sheetOpen) closeSheet(true); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  let startY = null;
  let dy = 0;
  panel.addEventListener('touchstart', (e) => {
    if (scroll.scrollTop > 0 && !e.target.closest('.sheet-grab')) return;
    if (e.target.closest('input[type=range]')) return;
    startY = e.touches[0].clientY;
    dy = 0;
  }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    if (dy > 4) { sheet.classList.add('dragging'); panel.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  panel.addEventListener('touchend', () => {
    if (startY == null) return;
    sheet.classList.remove('dragging');
    if (dy > 110) closeSheet();
    else panel.style.transform = '';
    startY = null;
  });
}

/* ---------- Dish sheet ---------- */
function openDish(id, replace = false) {
  const d = byId(id);
  if (!d) return;
  openSheet(dishHtml(d), { replace, kind: 'dish' });
  // The dish page frame takes the shape of the dish's own photo or clip, so nothing is cut off and
  // there are no side bars (very tall media stops at the height limit and is shown whole inside it).
  const frame = $('#sheet .sheet-media');
  // Landscape media fills a square frame instead (a little is trimmed at the sides) so it isn't a thin strip.
  const fit = (w, h) => {
    if (!frame || !w || !h) return;
    const upright = h >= w;
    frame.style.aspectRatio = upright ? `${w} / ${h}` : '1 / 1';
    frame.classList.toggle('fill', !upright);
  };
  const photo = $('#sheet .sheet-fit');
  const v = $('#sheet .sheet-scroll video');
  if (photo) {
    const usePhoto = () => { if (!v || !v.videoWidth) fit(photo.naturalWidth, photo.naturalHeight); };
    if (photo.complete) usePhoto(); else photo.addEventListener('load', usePhoto, { once: true });
  }
  if (v) {
    const media = v.parentElement;
    if (v.readyState >= 1) fit(v.videoWidth, v.videoHeight);
    v.addEventListener('loadedmetadata', () => fit(v.videoWidth, v.videoHeight));
    v.addEventListener('playing', () => { media.classList.add('playing'); media.classList.remove('buffering'); });
    v.addEventListener('waiting', () => media.classList.add('buffering'));
    v.addEventListener('error', () => {
      failedVideos.add(d.video);
      v.remove();
      $('.vspin', media)?.remove();
      media.classList.remove('has-video', 'playing', 'buffering');
    });
    v.muted = true;
    if (state.autoplay) {
      media.classList.add('buffering');
      v.play()?.catch(() => media.classList.remove('buffering'));
    }
  }
}

function dishHtml(d) {
  const cat = catById.get(d.category);
  const facts = [];
  if (d.prepTime) facts.push(`<span class="fact">${icons.clock}Ready in ~${d.prepTime} min</span>`);
  if (d.temp) facts.push(`<span class="fact">${d.temp === 'cold' ? `${icons.snow}Served cold` : `${icons.cup}Served hot`}</span>`);
  if (d.kcal) facts.push(`<span class="fact">${icons.bolt}${d.kcal} kcal</span>`);
  if (d.diet?.veg != null) facts.push(`<span class="fact">${vegMark(d)}${d.diet.veg ? (d.diet.vegan ? 'Vegan' : 'Vegetarian') : d.diet.egg ? 'Contains egg' : 'Non-veg'}</span>`);
  if (d.spice > 0) facts.push(`<span class="fact"><span class="spice-flames">${icons.flame.repeat(d.spice)}</span>${['', 'Mild', 'Medium', 'Hot'][d.spice]}</span>`);

  // "Goes well with": the owner's pairings, or else favourites from the other side of the menu
  // (a drink suggests food, food suggests a drink). Each has its own Add button.
  let pairs = (d.pairings || []).map((p) => ({ ...p, ref: p.dishId && byId(p.dishId) }));
  if (!pairs.length) {
    const group = ctx.groupOf(d);
    const loved = (x) => (x.tags.includes('most-loved') ? 2 : 0) + (x.badges.length ? 1 : 0);
    pairs = data.dishes
      .filter((x) => x.id !== d.id && !soldOut(x) && ctx.groupOf(x) && ctx.groupOf(x) !== group && (x.thumb || x.image))
      .sort((a, b) => loved(b) - loved(a))
      .slice(0, 3)
      .map((ref) => ({ ref, kind: ctx.groupOf(ref) === 'drinks' ? 'To drink' : 'To eat' }));
  }
  const pairings = pairs.map((p) => {
    const ref = p.ref;
    const inner = `
      ${ref ? `<img src="${esc(ref.thumb || sizedImage(ref.image, 160))}" alt="" loading="lazy">` : ''}
      <span class="pair-text">
        <span class="pair-kind">${esc(p.kind || 'Pairing')}</span>
        <span class="pair-name">${esc(ref ? ref.name : p.name)}</span>
        ${p.note ? `<span class="pair-note">${esc(p.note)}</span>` : ref ? `<span class="pair-note">${esc(fmtPrice(ref.price))}</span>` : ''}
      </span>`;
    return `<li class="pair-li">${ref ? `<button type="button" class="pair" data-open="${esc(ref.id)}">${inner}</button>${addControl(ref)}` : `<div class="pair">${inner}</div>`}</li>`;
  }).join('');

  const hasVid = d.video && !failedVideos.has(d.video);
  return `
    <div class="sheet-media${hasVid ? ' has-video' : ''}${!d.image && !hasVid ? ' no-photo' : ''}">
      ${!d.image && !hasVid ? `<span aria-hidden="true">${esc(d.name.trim()[0] || '•')}</span>` : ''}
      ${d.image ? `<img class="sheet-bg" src="${esc(d.thumb || sizedImage(d.image, 320))}" alt="" aria-hidden="true" ${imgLoaded}>
        <img class="sheet-fit" src="${esc(sizedImage(d.image, 900))}" alt="${esc(d.name)}" ${imgLoaded}>` : ''}
      ${hasVid ? `
        <video src="${esc(sizedVideo(d.video, true))}" muted loop playsinline preload="auto" aria-hidden="true" tabindex="-1" style="object-position:${esc(d.focus || '50% 50%')}"></video>
        <span class="vspin" aria-hidden="true"></span>` : ''}
      <div class="badges">${d.badges.map(badgeHtml).join('')}</div>
      ${soldOut(d) ? '<span class="soldout-tag">Sold out today</span>' : ''}
    </div>
    <div class="sheet-body">
      ${cat ? `<p class="eyebrow">${esc(label(cat))}</p>` : ''}
      <div class="title-row"><h2 id="sheet-title">${esc(d.name)}</h2><span class="price">${esc(fmtPrice(d.price))}</span></div>
      <div class="facts">${facts.join('')}</div>
      <p class="lead">${esc(d.description)}</p>
      ${d.story ? `<h4>The story</h4><p class="story">${esc(d.story)}</p>` : ''}
      ${d.chefNote ? `<blockquote>“${esc(d.chefNote)}”<cite>— ${esc(data.chef || 'The Chef')}</cite></blockquote>` : ''}
      ${pairings ? `<h4>Goes well with</h4><ul class="pairings">${pairings}</ul>` : ''}
      ${d.allergens?.length ? `<p class="allergens">Contains: ${esc(d.allergens.join(', '))}. Please tell our team about any allergies.</p>` : ''}
    </div>
    ${canOrder() && !soldOut(d) ? `<div class="sheet-add">${addControl(d, true)}</div>` : ''}`;
}

/* ==========================================================
   Table ordering
   - Shown only when the owner has switched ordering on and the menu is the published (Supabase) one.
   - The cart lives in this phone (localStorage) per restaurant. Placing an order calls place_order(),
     which re-prices every item from the published menu on the server.
   - After ordering, the guest can follow the status (Received → Preparing → Ready).
   ========================================================== */
const cart = new Map(); // dishId -> qty
const canOrder = () => Boolean(data?.ordering?.enabled) && menuSource === 'supabase' && supabaseEnabled();
const cartKey = `cart:${slug}`;
const lastKey = `order:${slug}`;
const cartCount = () => [...cart.values()].reduce((a, b) => a + b, 0);
const cartTotal = () => [...cart].reduce((sum, [id, q]) => sum + (byId(id)?.price || 0) * q, 0);

function loadCart() {
  try {
    const saved = JSON.parse(pref.get(cartKey) || '{}');
    for (const [id, q] of Object.entries(saved)) if (byId(id) && !soldOut(byId(id)) && q > 0) cart.set(id, Math.min(20, q));
  } catch { /* ignore */ }
}
function saveCart() { pref.set(cartKey, JSON.stringify(Object.fromEntries(cart))); }

function addControl(d, big = false) {
  if (!canOrder() || soldOut(d)) return '';
  const q = cart.get(d.id) || 0;
  const inner = q
    ? `<button type="button" data-act="dec" aria-label="Remove one ${esc(d.name)}">−</button><span aria-live="polite">${q}</span><button type="button" data-act="inc" aria-label="Add one more ${esc(d.name)}">+</button>`
    : `<button type="button" data-act="inc" class="add-first" aria-label="Add ${esc(d.name)} to your order">${big ? `Add to order · ${esc(fmtPrice(d.price))}` : 'Add'}</button>`;
  return `<span class="add${q ? ' has' : ''}${big ? ' big' : ''}" data-add="${esc(d.id)}">${inner}</span>`;
}

function onAddClick(e, el) {
  e.stopPropagation();
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = el.dataset.add;
  const q = (cart.get(id) || 0) + (btn.dataset.act === 'inc' ? 1 : -1);
  if (q <= 0) cart.delete(id);
  else cart.set(id, Math.min(20, q));
  saveCart();
  const d = byId(id);
  for (const ctl of $$(`[data-add="${CSS.escape(id)}"]`)) ctl.outerHTML = addControl(d, ctl.classList.contains('big'));
  if ($('#sheet').dataset.kind === 'cart' && state.sheetOpen) refreshCartSheet();
  syncCartBar();
}

function lastOrder() {
  try {
    const o = JSON.parse(pref.get(lastKey) || 'null');
    return o && Date.now() - o.at < 4 * 3600e3 ? o : null; // forget after 4 hours
  } catch { return null; }
}

const STATUS = {
  new: ['Sent to the counter', 'Waiting for the team to confirm.'],
  accepted: ['Being prepared', 'The kitchen has your order.'],
  ready: ['Ready', 'Your order is on its way to your table.'],
  served: ['Served', 'Enjoy! Order again any time.'],
  cancelled: ['Cancelled', 'Please speak to our staff.'],
};

function syncCartBar() {
  const bar = $('#cartbar');
  if (!bar) return;
  const n = cartCount();
  const last = lastOrder();
  const showStatus = !n && last && !['served', 'cancelled'].includes(last.status);
  bar.hidden = !(canOrder() && (n || showStatus));
  document.body.classList.toggle('has-cart', !bar.hidden);
  if (bar.hidden) return;
  $('#open-cart').innerHTML = n
    ? `<span class="cb-count">${n}</span><span class="cb-label">${n === 1 ? 'item' : 'items'} · ${esc(fmtPrice(cartTotal()))}</span><span class="cb-go">View order ${icons.arrow}</span>`
    : `<span class="cb-label">Order #${esc(last.number)} · ${esc(STATUS[last.status]?.[0] || 'Sent')}</span><span class="cb-go">Track ${icons.arrow}</span>`;
}

function cartHtml() {
  const lines = [...cart].map(([id, q]) => ({ d: byId(id), q })).filter((x) => x.d);
  if (!lines.length) return `<div class="sheet-body cart"><h2 id="sheet-title">Your order</h2><p class="muted">Your order is empty. Tap <b>Add</b> on any item.</p></div>`;
  return `
    <div class="sheet-body cart">
      <h2 id="sheet-title">Your order</h2>
      <ul class="cart-lines">${lines.map(({ d, q }) => `
        <li><span class="cl-name">${vegMark(d)}${esc(d.name)}</span>${addControl(d)}<span class="cl-price">${esc(fmtPrice(d.price * q))}</span></li>`).join('')}
      </ul>
      <div class="cart-total"><span>Total</span><strong>${esc(fmtPrice(cartTotal()))}</strong></div>
      <label class="cart-field">Notes for the kitchen <small>(optional)</small>
        <textarea id="order-note" rows="2" maxlength="300" placeholder="Less sugar, no onion, extra hot…">${esc(state.orderNote || '')}</textarea></label>
      ${tableNo ? `<p class="cart-table">${icons.dish}Table ${esc(tableNo)}</p>` : `
        <label class="cart-field">Table number<input id="order-table" inputmode="numeric" maxlength="6" value="${esc(state.orderTable || '')}" placeholder="e.g. 7"></label>`}
      <p class="cart-err" id="order-err" role="alert"></p>
      <button type="button" class="btn place" id="place-order">Place order · ${esc(fmtPrice(cartTotal()))}</button>
      <p class="cart-foot">You'll pay at the counter. ${data.footerNote ? esc(data.footerNote) : ''}</p>
    </div>`;
}

function openCart() { openSheet(cartHtml(), { kind: 'cart' }); }
function refreshCartSheet() {
  state.orderNote = $('#order-note')?.value ?? state.orderNote;
  state.orderTable = $('#order-table')?.value ?? state.orderTable;
  const scroll = $('#sheet .sheet-scroll');
  const top = scroll.scrollTop;
  scroll.innerHTML = cartHtml();
  scroll.scrollTop = top;
}

async function placeOrder() {
  const btn = $('#place-order');
  const err = $('#order-err');
  const table = tableNo || $('#order-table')?.value.trim();
  if (!table) { err.textContent = 'Please enter your table number.'; $('#order-table')?.focus(); return; }
  btn.disabled = true;
  btn.textContent = 'Sending…';
  err.textContent = '';
  try {
    const sb = await getSupabase();
    const { data: res, error } = await sb.rpc('place_order', {
      p_slug: slug,
      p_table: table,
      p_items: [...cart].map(([id, qty]) => ({ id, qty })),
      p_note: $('#order-note')?.value || null,
    });
    if (error) throw new Error(error.message.replace(/^.*?:\s*/, '') || 'Could not send your order.');
    pref.set(lastKey, JSON.stringify({ id: res.id, number: res.number, total: res.total, status: 'new', at: Date.now() }));
    cart.clear();
    saveCart();
    state.orderNote = '';
    $$('[data-add]').forEach((ctl) => { ctl.outerHTML = addControl(byId(ctl.dataset.add), ctl.classList.contains('big')); });
    syncCartBar();
    openOrderStatus(true);
  } catch (e) {
    err.textContent = navigator.onLine === false ? "You're offline. Check your connection and try again." : e.message;
    btn.disabled = false;
    btn.textContent = `Place order · ${fmtPrice(cartTotal())}`;
  }
}

let statusTimer;
function statusHtml(o) {
  const [title, sub] = STATUS[o.status] || STATUS.new;
  const steps = ['new', 'accepted', 'ready', 'served'];
  const at = steps.indexOf(o.status);
  return `
    <div class="sheet-body order-status">
      <p class="eyebrow">Order #${esc(o.number)}${tableNo ? ` · Table ${esc(tableNo)}` : ''}</p>
      <h2 id="sheet-title">${esc(title)}</h2>
      <p class="muted">${esc(sub)}</p>
      ${o.status === 'cancelled' ? '' : `<ol class="steps">${['Sent', 'Preparing', 'Ready', 'Served'].map((l, i) => `<li class="${i <= at ? 'done' : ''}">${i <= at ? icons.check : ''}<span>${l}</span></li>`).join('')}</ol>`}
      <p class="muted small">Total ${esc(fmtPrice(o.total))} · pay at the counter</p>
      <button type="button" class="btn ghost" data-reorder>Back to the menu</button>
    </div>`;
}

function openOrderStatus(replace = false) {
  const o = lastOrder();
  if (!o) return;
  openSheet(statusHtml(o), { kind: 'status', replace });
  clearInterval(statusTimer);
  const poll = async () => {
    if (!state.sheetOpen || $('#sheet').dataset.kind !== 'status') return clearInterval(statusTimer);
    if (document.hidden) return;
    try {
      const sb = await getSupabase();
      const { data: st } = await sb.rpc('order_status', { p_id: o.id });
      if (st?.status && st.status !== o.status) {
        o.status = st.status;
        pref.set(lastKey, JSON.stringify(o));
        $('#sheet .sheet-scroll').innerHTML = statusHtml(o);
        syncCartBar();
        if (navigator.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate(120);
      }
      if (['served', 'cancelled'].includes(o.status)) clearInterval(statusTimer);
    } catch { /* try again next tick */ }
  };
  statusTimer = setInterval(poll, 8000);
  poll();
}

/* ---------- Wi-Fi details ---------- */
function openWifi() {
  const w = data.wifi;
  openSheet(`
    <div class="sheet-body wifi">
      <h2 id="sheet-title">Free Wi-Fi</h2>
      <p class="muted">Tip: the Wi-Fi code on your table card joins automatically. Scan it with your camera.</p>
      <dl>
        <div><dt>Network</dt><dd>${esc(w.ssid)}</dd><button type="button" class="btn ghost sm" data-copy="${esc(w.ssid)}">${icons.copy}Copy</button></div>
        ${w.password ? `<div><dt>Password</dt><dd>${esc(w.password)}</dd><button type="button" class="btn ghost sm" data-copy="${esc(w.password)}">${icons.copy}Copy</button></div>` : '<div><dt>Password</dt><dd>None (open network)</dd></div>'}
      </dl>
    </div>`, { kind: 'wifi' });
}
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); btn.innerHTML = `${icons.check}Copied`; } catch { btn.textContent = 'Press and hold to copy'; }
}

/* ---------- Filter sheet ---------- */
const FILTER_GROUPS = [
  { title: 'Diet', items: [['veg', 'Vegetarian'], ['vegan', 'Vegan'], ['noEgg', 'No egg'], ['nonveg', 'Non-veg']] },
  { title: 'Leave out', items: [['noDairy', 'Dairy'], ['noGluten', 'Gluten'], ['noNuts', 'Nuts'], ['noCoffee', 'Coffee']] },
  { title: 'Drinks', items: [['temp:hot', 'Hot'], ['temp:cold', 'Cold']] },
  { title: 'More', items: [['quick', 'Ready in ≤10 min'], ['notSpicy', 'Not spicy'], ['spicy', 'Spicy'], ['light', 'Light (≤400 kcal)']] },
];

function filterSheetHtml() {
  const f = state.sheetFilters;
  const on = (key) => (key.startsWith('temp:') ? f.temp === key.slice(5) : Boolean(f[key]));
  const max = f.maxPrice ?? 0;
  return `
    <div class="sheet-body filters">
      <h2 id="sheet-title">Filters</h2>
      ${FILTER_GROUPS.map((g) => `
        <fieldset>
          <legend>${g.title}</legend>
          <div class="toggles">${g.items.map(([k, l]) => `<button type="button" class="chip" data-f="${k}" aria-pressed="${on(k)}">${l}</button>`).join('')}</div>
        </fieldset>`).join('')}
      <fieldset>
        <legend>Max price <output id="price-out">${max ? fmtPrice(max) : 'Any'}</output></legend>
        <input type="range" id="price" min="0" max="500" step="25" value="${max}" aria-label="Maximum price">
      </fieldset>
      <fieldset>
        <legend>Video</legend>
        <label class="switch"><input type="checkbox" id="autoplay" ${state.autoplay ? 'checked' : ''}><span>Autoplay dish videos</span></label>
        <p class="hint">Videos are always muted and can be paused. Turn this off to save data.</p>
      </fieldset>
      <div class="filter-actions">
        <button type="button" class="link-btn" data-freset>Reset</button>
        <button type="button" class="btn" data-close id="apply">Show ${countMatches()} results</button>
      </div>
    </div>`;
}

function countMatches() {
  const { parsed, filters } = currentFilters();
  return data.dishes.filter((d) => matchDish(d, filters, ctx) && scoreDish(d, parsed.terms, ctx) > 0).length;
}

function openFilters() {
  openSheet(filterSheetHtml(), { kind: 'filters' });
}

function refreshFilterSheet() {
  $$('#sheet [data-f]').forEach((b) => {
    const k = b.dataset.f;
    b.setAttribute('aria-pressed', k.startsWith('temp:') ? state.sheetFilters.temp === k.slice(5) : Boolean(state.sheetFilters[k]));
  });
  const apply = $('#apply');
  if (apply) apply.textContent = `Show ${countMatches()} results`;
  syncChips();
}

function onFilterClick(e) {
  const b = e.target.closest('[data-f]');
  if (b) {
    const k = b.dataset.f;
    const f = state.sheetFilters;
    if (k.startsWith('temp:')) f.temp = f.temp === k.slice(5) ? undefined : k.slice(5);
    else {
      f[k] = !f[k] || undefined;
      if (k === 'veg' && f.veg) f.nonveg = undefined;
      if (k === 'nonveg' && f.nonveg) { f.veg = undefined; f.vegan = undefined; }
      if (k === 'spicy' && f.spicy) f.notSpicy = undefined;
      if (k === 'notSpicy' && f.notSpicy) f.spicy = undefined;
    }
    return refreshFilterSheet();
  }
  if (e.target.closest('[data-freset]')) {
    state.sheetFilters = {};
    $('#price').value = 0;
    $('#price-out').textContent = 'Any';
    refreshFilterSheet();
  }
}

function onFilterInput(e) {
  if (e.target.id === 'price') {
    const v = +e.target.value;
    state.sheetFilters.maxPrice = v || undefined;
    $('#price-out').textContent = v ? fmtPrice(v) : 'Any';
    refreshFilterSheet();
  }
  if (e.target.id === 'autoplay') {
    state.autoplay = e.target.checked;
    pref.set('autoplay', state.autoplay ? '1' : '0');
  }
}

init();
