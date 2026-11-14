/* ==========================================================
   QR Menu — app
   URL:  /?r=<restaurant-slug>&t=<table>   (#<section-id> optional)
   Data: data/<restaurant-slug>.json
   Flags: ?preview → skip desktop gate
   ========================================================== */

const params = new URLSearchParams(location.search);
const slug = (params.get('r') || 'arabico').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'arabico';
const tableNo = (params.get('t') || '').replace(/[^\w-]/g, '').slice(0, 8);
const lowMotion =
  matchMedia('(prefers-reduced-motion: reduce)').matches || navigator.connection?.saveData === true;

const app = document.getElementById('app');
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let data;
let fmtPrice = (n) => String(n);
const state = { soundOn: false, active: null, manual: null, sheetOpen: false };

/* ---------- Icons ---------- */
const svg = (p, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${p}</svg>`;
const icons = {
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  play: svg('<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>'),
  mute: svg('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>'),
  sound: svg('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  dish: svg('<path d="M3 17h18M5 17a7 7 0 0 1 14 0M12 7V5M10 5h4"/>'),
  flame: svg('<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.8 2.5-5 .3 1.6 1 2.6 2 3 0-3-1-5.5.5-8z" fill="currentColor" stroke="none"/>'),
  bolt: svg('<path d="M13 3 5 13h6l-1 8 8-10h-6z"/>'),
};

/* ---------- Theme ---------- */
function normHex(hex) {
  let h = String(hex || '').trim().replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(h) ? `#${h}` : null;
}
function readableOn(hex) {
  const h = normHex(hex);
  if (!h) return '#0b0b0b';
  const [r, g, b] = h.slice(1).match(/.{2}/g).map((x) => {
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
const isDesktop = () => matchMedia('(hover: hover) and (pointer: fine)').matches && innerWidth > 820;

async function init() {
  try {
    const res = await fetch(`data/${slug}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch {
    app.innerHTML = `<div class="gate"><div class="gate-card"><h1>Menu not found</h1><p>Please ask a member of staff for help.</p></div></div>`;
    return;
  }
  applyTheme(data.theme);
  document.title = `${data.name} · Menu`;
  try {
    fmtPrice = new Intl.NumberFormat(data.locale || 'en-IN', {
      style: 'currency', currency: data.currency || 'INR', maximumFractionDigits: 0,
    }).format;
  } catch { /* keep plain numbers */ }

  if (isDesktop() && !params.has('preview')) renderGate();
  else renderMenu();
}

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
      <small>Videos, dish stories and chef notes play best on mobile.</small>
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
const sectionLabel = (s) => s.label.replaceAll('{name}', data.name);

/* ---------- Menu shell ---------- */
function renderMenu() {
  app.innerHTML = `
    <header class="masthead">
      <div class="brand">${logoHtml()}<div class="brand-text"><h1>${esc(data.name)}</h1>${data.tagline ? `<p>${esc(data.tagline)}</p>` : ''}</div></div>
      ${tableNo ? `<span class="table-chip">${icons.dish}Table ${esc(tableNo)}</span>` : ''}
    </header>
    <nav class="tabs" aria-label="Menu sections">
      <div class="tabs-track" role="tablist">
        ${data.sections.map((s) => `<button class="tab" role="tab" data-tab="${esc(s.id)}" aria-selected="false">${esc(sectionLabel(s))}</button>`).join('')}
      </div>
    </nav>
    <main id="feed" class="feed" role="tabpanel"></main>
    <footer class="foot">
      ${data.footerNote ? `${esc(data.footerNote)}<br>` : ''}
      Powered by <strong>QR Menu</strong>
    </footer>
    <div class="sheet" id="sheet" aria-hidden="true">
      <div class="sheet-backdrop" data-close></div>
      <div class="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div class="sheet-grab"><span></span></div>
        <button class="sheet-close glass" data-close aria-label="Close">${icons.close}</button>
        <div class="sheet-scroll"></div>
      </div>
    </div>`;

  $('.tabs-track').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) selectTab(btn.dataset.tab);
  });
  $('#feed').addEventListener('click', onFeedClick);
  $('#feed').addEventListener('keydown', (e) => {
    const card = e.target.closest('.card');
    if (card && (e.key === 'Enter' || e.key === ' ') && e.target === card) {
      e.preventDefault();
      openSheet(card.dataset.id);
    }
  });
  bindSheet();

  addEventListener('hashchange', () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (data.sections.some((s) => s.id === id)) selectTab(id);
  });
  const initial = decodeURIComponent(location.hash.slice(1));
  selectTab(data.sections.some((s) => s.id === initial) ? initial : data.sections[0].id, true);
}

function dishesFor(section) {
  let list = data.dishes;
  if (section.type === 'tag') list = list.filter((d) => d.tags?.includes(section.match));
  else if (section.type === 'category') list = list.filter((d) => d.category === section.match);
  // Optional curated order: section.order = [dishId, ...]; unlisted dishes keep their place after.
  if (section.order?.length) {
    const rank = (d) => { const i = section.order.indexOf(d.id); return i < 0 ? Infinity : i; };
    list = [...list].sort((a, b) => rank(a) - rank(b));
  }
  return list;
}

function selectTab(id, initial = false) {
  const section = data.sections.find((s) => s.id === id) || data.sections[0];
  const track = $('.tabs-track');
  let activeBtn;
  $$('.tab', track).forEach((b) => {
    const on = b.dataset.tab === section.id;
    b.setAttribute('aria-selected', on);
    if (on) activeBtn = b;
  });
  track.scrollTo({
    left: activeBtn.offsetLeft - (track.clientWidth - activeBtn.offsetWidth) / 2,
    behavior: initial ? 'auto' : 'smooth',
  });
  history.replaceState(history.state, '', `${location.pathname}${location.search}#${section.id}`);
  renderFeed(section);

  if (!initial) {
    const headerH = $('.masthead').offsetHeight;
    if (scrollY > headerH) scrollTo({ top: headerH, behavior: 'auto' });
  }
}

/* ---------- Feed ---------- */
function renderFeed(section) {
  const list = dishesFor(section);
  const feed = $('#feed');
  feed.innerHTML = `
    <section class="intro">
      ${section.eyebrow ? `<p class="eyebrow">${esc(section.eyebrow)}</p>` : ''}
      <h2>${esc(sectionLabel(section))}</h2>
      ${section.description ? `<p class="lede">${esc(section.description)}</p>` : ''}
      <p class="count">${list.length} ${list.length === 1 ? 'dish' : 'dishes'}</p>
    </section>
    ${list.length ? list.map(cardHtml).join('') : `<p class="empty">Nothing here just yet.</p>`}`;
  bindVideos(feed);
}

function badgeHtml(key) {
  const b = data.badges?.[key] || { label: key, tone: 'neutral' };
  return `<span class="badge ${esc(b.tone || 'neutral')}">${esc(b.label)}</span>`;
}

function vegMark(d) {
  if (d.diet?.veg == null) return '';
  const kind = d.diet.veg ? 'veg' : d.diet.egg ? 'egg' : 'nonveg';
  const label = { veg: 'Vegetarian', egg: 'Contains egg', nonveg: 'Non-vegetarian' }[kind];
  return `<span class="vnv ${kind}" role="img" aria-label="${label}"></span>`;
}

function dietPills(d) {
  const out = [];
  if (d.diet?.vegan) out.push('<span class="pill">Vegan</span>');
  if (d.diet?.gf) out.push('<span class="pill">GF</span>');
  if (d.spice > 0) out.push(`<span class="pill spice" aria-label="Spice level ${d.spice} of 3">${icons.flame.repeat(d.spice)}</span>`);
  return out.join('');
}

function cardHtml(d, i) {
  const price = fmtPrice(d.price);
  return `
  <article class="card" data-id="${esc(d.id)}" style="--i:${Math.min(i, 6)}" tabindex="0" aria-label="${esc(d.name)}, ${esc(price)}. Open details">
    <div class="media${d.video ? ' has-video' : ''}">
      <img src="${esc(d.image)}" alt="" loading="${i < 2 ? 'eager' : 'lazy'}" decoding="async">
      ${d.video ? `
        <video muted loop playsinline preload="none" data-src="${esc(d.video)}" aria-hidden="true"></video>
        <span class="vid-flag glass">${icons.play}</span>
        <button class="sound glass" aria-label="Turn sound on">${icons.mute}</button>` : ''}
      <div class="badges">${(d.badges || []).map(badgeHtml).join('')}</div>
      ${d.prepTime ? `<span class="time-chip glass">${icons.clock}${d.prepTime} min</span>` : ''}
    </div>
    <div class="card-body">
      <div class="title-row">
        <div class="name">${vegMark(d)}<h3>${esc(d.name)}</h3></div>
        <span class="price">${esc(price)}</span>
      </div>
      <p class="desc">${esc(d.description)}</p>
      <div class="meta">${dietPills(d)}<span class="more">Details ${icons.arrow}</span></div>
    </div>
  </article>`;
}

function onFeedClick(e) {
  const soundBtn = e.target.closest('.sound');
  if (soundBtn) {
    e.stopPropagation();
    toggleSound($('video', soundBtn.parentElement));
    return;
  }
  const card = e.target.closest('.card');
  if (card) openSheet(card.dataset.id);
}

/* ==========================================================
   Video engine
   - Lazy-loads the source ~400px before a video scrolls in.
   - Auto-plays the TOPMOST video that is ≥60% visible; pauses all others.
   - Touching (or mouse-hovering) a video makes it the active one.
   - Respects reduced-motion / data-saver: then only plays on touch.
   ========================================================== */
let playIO, loadIO;
const ratios = new Map();

function bindVideos(root) {
  playIO?.disconnect();
  loadIO?.disconnect();
  ratios.clear();
  state.active?.pause();
  state.active = null;
  state.manual = null;

  loadIO = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (e.isIntersecting) { loadSrc(e.target); loadIO.unobserve(e.target); }
    }),
    { rootMargin: '400px 0px' },
  );
  playIO = new IntersectionObserver(
    (entries) => { entries.forEach((e) => ratios.set(e.target, e.intersectionRatio)); pickActive(); },
    { threshold: [0, 0.2, 0.35, 0.5, 0.6, 0.75, 0.9, 1] },
  );

  $$('video', root).forEach((v) => {
    loadIO.observe(v);
    playIO.observe(v);
    const media = v.parentElement;
    media.addEventListener('touchstart', () => setManual(v), { passive: true });
    media.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') setManual(v); });
    v.addEventListener('playing', () => media.classList.add('playing'));
    v.addEventListener('pause', () => media.classList.remove('playing'));
  });
}

function loadSrc(v) {
  if (!v.getAttribute('src') && v.dataset.src) {
    v.src = v.dataset.src;
    v.preload = 'metadata';
  }
}

function pickActive() {
  if (state.sheetOpen || document.hidden) return;
  if (state.manual && (ratios.get(state.manual) || 0) >= 0.35) return play(state.manual);
  state.manual = null;
  if (lowMotion) return play(null);
  const candidates = [...ratios.entries()].filter(([, r]) => r >= 0.6).map(([v]) => v);
  candidates.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  play(candidates[0] || null);
}

function setManual(v) {
  state.manual = v;
  play(v);
}

function play(v) {
  if (state.active && state.active !== v) state.active.pause();
  state.active = v;
  if (!v) return;
  loadSrc(v);
  v.muted = !state.soundOn;
  v.play()?.catch(() => {
    // Autoplay with sound can be blocked — fall back to muted.
    if (!v.muted) { v.muted = true; state.soundOn = false; syncSoundButtons(); v.play()?.catch(() => {}); }
  });
}

function toggleSound(v) {
  state.soundOn = !state.soundOn;
  if (v && v !== state.active) setManual(v);
  if (state.active) state.active.muted = !state.soundOn;
  syncSoundButtons();
}

function syncSoundButtons() {
  $$('.sound').forEach((b) => {
    b.innerHTML = state.soundOn ? icons.sound : icons.mute;
    b.setAttribute('aria-label', state.soundOn ? 'Mute' : 'Turn sound on');
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) state.active?.pause();
  else pickActive();
});

/* ---------- Dish sheet ---------- */
const byId = (id) => data.dishes.find((d) => d.id === id);

function sheetHtml(d) {
  const cat = data.sections.find((s) => s.type === 'category' && s.match === d.category);
  const facts = [];
  if (d.prepTime) facts.push(`<span class="fact">${icons.clock}Ready in ~${d.prepTime} min</span>`);
  if (d.kcal) facts.push(`<span class="fact">${icons.bolt}${d.kcal} kcal</span>`);
  if (d.diet?.veg != null) facts.push(`<span class="fact">${vegMark(d)}${d.diet.veg ? (d.diet.vegan ? 'Vegan' : 'Vegetarian') : d.diet.egg ? 'Contains egg' : 'Non-veg'}</span>`);
  if (d.diet?.gf) facts.push(`<span class="fact">Gluten-free</span>`);
  if (d.spice > 0) facts.push(`<span class="fact" style="color:#f87171">${icons.flame.repeat(d.spice)}<span style="color:var(--text)">${['', 'Mild', 'Medium', 'Hot'][d.spice]}</span></span>`);

  const pairings = (d.pairings || []).map((p) => {
    const ref = p.dishId && byId(p.dishId);
    const name = ref ? ref.name : p.name;
    const inner = `
      ${ref ? `<img src="${esc(ref.image)}" alt="" loading="lazy">` : ''}
      <span class="pair-text">
        <span class="pair-kind">${esc(p.kind || 'Pairing')}</span>
        <span class="pair-name" style="display:block">${esc(name)}</span>
        ${p.note ? `<span class="pair-note">${esc(p.note)}</span>` : ''}
      </span>
      ${ref ? icons.arrow : ''}`;
    return `<li>${ref ? `<button class="pair" data-open="${esc(ref.id)}">${inner}</button>` : `<div class="pair">${inner}</div>`}</li>`;
  }).join('');

  return `
    <div class="sheet-media">
      ${d.video
        ? `<video src="${esc(d.video)}" poster="${esc(d.image)}" muted loop playsinline autoplay></video>`
        : `<img src="${esc(d.image)}" alt="${esc(d.name)}">`}
      <div class="badges">${(d.badges || []).map(badgeHtml).join('')}</div>
    </div>
    <div class="sheet-body">
      ${cat ? `<p class="eyebrow">${esc(sectionLabel(cat))}</p>` : ''}
      <div class="title-row"><h2 id="sheet-title">${esc(d.name)}</h2><span class="price">${esc(fmtPrice(d.price))}</span></div>
      <div class="facts">${facts.join('')}</div>
      <p class="lead">${esc(d.description)}</p>
      ${d.story ? `<h4>The story</h4><p class="story">${esc(d.story)}</p>` : ''}
      ${d.chefNote ? `<blockquote>“${esc(d.chefNote)}”<cite>— ${esc(data.chef || 'The Chef')}</cite></blockquote>` : ''}
      ${pairings ? `<h4>Pairs well with</h4><ul class="pairings">${pairings}</ul>` : ''}
      ${d.allergens?.length ? `<p class="allergens">Contains: ${esc(d.allergens.join(', '))}. Please tell our team about any allergies.</p>` : ''}
    </div>`;
}

function openSheet(id, replace = false) {
  const d = byId(id);
  if (!d) return;
  const sheet = $('#sheet');
  const scroll = $('.sheet-scroll', sheet);
  stopSheetVideo();
  state.active?.pause();
  state.sheetOpen = true;
  scroll.innerHTML = sheetHtml(d);
  scroll.scrollTop = 0;
  const v = $('video', scroll);
  if (v) { v.muted = !state.soundOn; v.play()?.catch(() => { v.muted = true; v.play()?.catch(() => {}); }); }
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  document.documentElement.classList.add('lock');
  if (replace) history.replaceState({ sheet: id }, '');
  else history.pushState({ sheet: id }, '');
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
  setTimeout(pickActive, 60);
}

function bindSheet() {
  const sheet = $('#sheet');
  const panel = $('.sheet-panel', sheet);
  const scroll = $('.sheet-scroll', sheet);

  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closeSheet();
    const pair = e.target.closest('[data-open]');
    if (pair) openSheet(pair.dataset.open, true);
  });
  addEventListener('popstate', () => { if (state.sheetOpen) closeSheet(true); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  // Swipe down to dismiss (from the grab bar, or anywhere when scrolled to top).
  let startY = null, dy = 0;
  panel.addEventListener('touchstart', (e) => {
    if (scroll.scrollTop > 0 && !e.target.closest('.sheet-grab')) return;
    startY = e.touches[0].clientY; dy = 0;
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

init();
