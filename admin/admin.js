/* ==========================================================
   QR Menu — restaurant dashboard (pilot)
   - Live mode (assets/js/config.js filled in): owner signs in, edits are saved to Supabase.
   - Demo mode (no config): edits are saved in this browser only (IndexedDB).
   URL: /admin/?r=<slug>  (demo mode; live mode uses the menu linked to the account)
   ========================================================== */
import {
  supabaseEnabled, getSupabase, loadMenu, loadStatic, saveLocal, clearLocal, saveSupabase, uploadMedia, resolveMedia,
  cleanupMedia,
} from '../assets/js/store.js';
import { readSpreadsheet, rowsToItems, applyImport, TEMPLATE_CSV } from './importer.js';
import { startOrders, renderOrders, renderInsights, renderTables } from './ops.js';
import { makePhotoSet, compressVideo, canCompressVideo, videoDuration, MAX_VIDEO_SECONDS } from './media.js';
import { CONFIG } from '../assets/js/config.js';
import { renderPartners, partnerFor, invite, setPartnerCtx } from './partners.js';
import { confirmDialog, openDialog } from './dialog.js';

const root = document.getElementById('admin');
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'item';

const MODE = supabaseEnabled() ? 'live' : 'demo';
const params = new URLSearchParams(location.search);
let menuPaused = false; // set by NomNom (super admin), e.g. unpaid
let slug = (params.get('r') || 'demo').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'demo';

let menu = null;
// NomNom super admin: sees every restaurant (Partners panel) and can edit any menu, with confirmations.
let isAdmin = false;
let adminEditing = false; // an admin editing a restaurant that isn't their own
let partner = null; // that restaurant's partner row (name, owner email, invited_at…)
// Invite and password-reset emails land here with "#…&type=invite|recovery" in the URL.
// Read it before supabase-js consumes the hash, so we can ask the owner to choose a password.
const authLink = new URLSearchParams(location.hash.slice(1));
const linkType = authLink.get('type');
const linkError = authLink.get('error_description');
// Welcome and reset emails link here with ?token_hash=…&type=invite|recovery. The one-time token is only used when
// the owner submits a new password, so email link scanners that open the page can't use it up.
const tokenHash = params.get('token_hash');
const tokenType = params.get('type') === 'recovery' ? 'recovery' : 'invite';
let dirty = false;
let view = supabaseEnabled() ? 'orders' : 'items';
let itemSearch = '';
let itemCat = 'all';
let editing = null; // { draft, isNew }

const MAX_VIDEO_MB = 300; // the original file the owner picks; it's compressed before upload
const MAX_UNCOMPRESSED_MB = 8; // if this browser can't compress, only small files are accepted as-is

/* ---------- Icons ---------- */
const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const I = {
  up: svg('<path d="m6 15 6-6 6 6"/>'),
  down: svg('<path d="m6 9 6 6 6-6"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  more: svg('<circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>'),
  video: svg('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>'),
  ext: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  upload: svg('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
};

/* ---------- Helpers ---------- */
function toast(msg, isErr = false) {
  $('.toast')?.remove();
  const t = document.createElement('div');
  t.className = `toast${isErr ? ' err' : ''}`;
  t.setAttribute('role', isErr ? 'alert' : 'status');
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), isErr ? 6000 : 3000);
}
function setDirty(v = true) {
  dirty = v;
  const btn = $('#publish');
  if (btn) {
    btn.disabled = !dirty;
    btn.innerHTML = dirty ? '<span class="dirty-dot"></span>Save &amp; publish' : 'All changes saved';
  }
}
addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

function applyTheme() {
  const p = /^#[0-9a-f]{6}$/i.test(menu?.theme?.primary || '') ? menu.theme.primary : '#d4a373';
  document.documentElement.style.setProperty('--primary', p);
  const [r, g, b] = p.slice(1).match(/.{2}/g).map((x) => parseInt(x, 16) / 255);
  document.documentElement.style.setProperty('--on-primary', 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#0b0b0b' : '#ffffff');
}

/** Fill <img data-media> / <video data-media> once idb: URLs are resolved. */
async function hydrate(rootEl) {
  await Promise.all(
    $$('[data-media]', rootEl).map(async (el) => {
      const url = await resolveMedia(el.dataset.media);
      if (url) el.src = url;
      else el.removeAttribute('src');
    }),
  );
}

const fmt = (n) => {
  try {
    return new Intl.NumberFormat(menu.locale || 'en-IN', { style: 'currency', currency: menu.currency || 'INR', maximumFractionDigits: 0 }).format(n);
  } catch { return `₹${n}`; }
};
/* Dark or light text for a background colour (same rule as the guest menu). */
function readableInk(hex) {
  const [r, g, b] = hex.slice(1).match(/.{2}/g).map((x) => {
    const c = parseInt(x, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.36 ? '#221c17' : '#f6f1ea';
}
const categories = () => (menu.sections || []).filter((s) => s.type === 'category');
const rails = () => (menu.sections || []).filter((s) => s.type === 'tag');
const vegKind = (d) => (d.diet?.veg ? 'veg' : d.diet?.egg ? 'egg' : 'nonveg');

/* ---------- Image processing ---------- */
async function compressImage(file, maxSide = 1280) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return canvasToBlob(canvas);
}
async function canvasToBlob(canvas) {
  const webp = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.82));
  if (webp && webp.type === 'image/webp') return webp;
  return new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
}

async function savePhotoSet(d, full, thumb) {
  const target = MODE === 'live' ? 'supabase' : 'local';
  const [img, th] = await Promise.all([uploadMedia(slug, full, 'photos', target), uploadMedia(slug, thumb, 'photos', target)]);
  d.image = img;
  d.thumb = th;
}

/* ==========================================================
   Boot
   ========================================================== */
async function boot() {
  if (MODE === 'live') {
    const sb = await getSupabase();
    if (tokenHash) return renderSetPassword(tokenType, '', tokenHash);
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return renderLogin(linkError ? `That link didn't work: ${linkError}. Ask for a new one below.` : '');
    if (linkType === 'invite' || linkType === 'recovery') return renderSetPassword(linkType, session.user.email);
    try { isAdmin = Boolean((await sb.rpc('is_admin')).data); } catch { isAdmin = false; }
    const adminCtx = { sb, root, toast, signOut, userId: session.user.id };
    if (isAdmin) {
      setPartnerCtx(adminCtx);
      if (!params.has('r')) return renderPartners(adminCtx);
      const { data: row, error } = await sb.from('menus').select('*').eq('slug', slug).maybeSingle();
      menuPaused = Boolean(row?.suspended);
      if (error) return fatal(`Couldn't load that restaurant: ${error.message}`);
      if (!row) return fatal(`There's no restaurant with the link name "${slug}".`, true);
      adminEditing = row.owner_id !== session.user.id;
      partner = adminEditing ? await partnerFor(sb, slug) : null;
      menu = row.data && Object.keys(row.data).length ? row.data : null;
      // Opening someone else's live menu always asks first (the Partners panel asks before linking here).
      if (adminEditing && menu && !params.has('confirmed')) {
        const ok = await confirmDialog({
          title: `Edit ${partner?.name || menu.name}'s menu?`,
          body: 'This is a live menu. Guests see your changes as soon as you press <b>Save &amp; publish</b>, and you\'ll be asked to confirm again before anything goes live.',
          confirm: 'Open editor', cancel: 'Back to partners',
        });
        if (!ok) { location.href = location.pathname; return; }
      }
      if (params.has('confirmed')) { params.delete('confirmed'); history.replaceState(null, '', `${location.pathname}?${params}${location.hash}`); }
      if (!menu) return renderStart();
      normalize();
      renderApp();
      return;
    }
    const { data: rows, error } = await sb.from('menus').select('slug').eq('owner_id', session.user.id).order('slug');
    if (error) return fatal(`Couldn't load your restaurant: ${error.message}`);
    if (!rows?.length) return fatal('This account is not linked to a restaurant yet. Please contact NomNom at contact@heynomnom.in.', true);
    slug = rows.find((r) => r.slug === slug)?.slug || rows[0].slug;
    const { data: row } = await sb.from('menus').select('*').eq('slug', slug).single();
    menuPaused = Boolean(row?.suspended);
    menu = row?.data && Object.keys(row.data).length ? row.data : null;
    if (!menu) return renderStart();
  } else {
    try {
      menu = (await loadMenu(slug, 'local')).data;
    } catch {
      return renderStart();
    }
  }
  normalize();
  renderApp();
}

function normalize() {
  menu.sections ||= [];
  menu.dishes ||= [];
  menu.groups ||= [{ id: 'drinks', label: 'Drinks' }, { id: 'food', label: 'Food' }];
  menu.badges ||= { bestseller: { label: 'Bestseller', tone: 'primary' }, new: { label: 'New', tone: 'neutral' } };
  menu.theme ||= { primary: '#d4a373', secondary: '#6b8f4e' };
  for (const d of menu.dishes) { d.diet ||= { veg: true }; d.tags ||= []; d.badges ||= []; }
}

function fatal(msg, withSignOut = false) {
  root.innerHTML = `<div class="login"><div><h1>Dashboard</h1><p>${esc(msg)}</p>${withSignOut ? '<p style="margin-top:14px"><button class="btn ghost" id="signout">Sign out</button></p>' : ''}</div></div>`;
  $('#signout')?.addEventListener('click', signOut);
}

function renderSetPassword(type, email, hash = '') {
  history.replaceState(null, '', location.pathname);
  root.innerHTML = `
    <div class="login">
      <form id="setpw" novalidate>
        <h1>${type === 'invite' ? 'Welcome' : 'Reset password'}</h1>
        <p>Choose a password${email ? ` for <b>${esc(email)}</b>` : ''}. You'll use it with your email to sign in to your dashboard.</p>
        <label class="field">New password<input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
        <label class="field">Confirm password<input type="password" name="confirm" autocomplete="new-password" minlength="8" required></label>
        <p class="error" id="setpw-err" role="alert"></p>
        <button class="btn" type="submit">Save password</button>
      </form>
    </div>`;
  const form = $('#setpw');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#setpw-err');
    const pw = form.password.value;
    if (pw.length < 8) { err.textContent = 'Use at least 8 characters.'; return; }
    if (pw !== form.confirm.value) { err.textContent = "The passwords don't match."; return; }
    const sb = await getSupabase();
    if (hash) {
      const { error: vErr } = await sb.auth.verifyOtp({ token_hash: hash, type });
      if (vErr) {
        err.textContent = `This link has expired or was already used. Ask NomNom for a new welcome email, or use "Email me a reset link" on the sign-in page. (${vErr.message})`;
        return;
      }
    }
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) { err.textContent = error.message; return; }
    root.innerHTML = '<div class="boot"><span></span></div>';
    location.reload();
  });
}

function renderLogin(notice = '') {
  root.innerHTML = `
    <div class="login">
      <form id="login" novalidate>
        <h1>Menu dashboard</h1>
        <p>Sign in to manage your menu, photos and videos.</p>
        <label class="field">Email<input type="email" name="email" autocomplete="username" required></label>
        <label class="field">Password<input type="password" name="password" autocomplete="current-password" required></label>
        <p class="error" id="login-err" role="alert">${esc(notice)}</p>
        <button class="btn" type="submit">Sign in</button>
        <button class="btn ghost" type="button" id="forgot">Email me a reset link</button>
      </form>
    </div>`;
  const form = $('#login');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sb = await getSupabase();
    const { error } = await sb.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value });
    if (error) { $('#login-err').textContent = error.message; return; }
    root.innerHTML = '<div class="boot"><span></span></div>';
    boot();
  });
  $('#forgot').onclick = async () => {
    const email = form.email.value.trim();
    if (!email) { $('#login-err').textContent = 'Enter your email first.'; return; }
    const sb = await getSupabase();
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href });
    $('#login-err').textContent = error ? error.message : 'Check your inbox for a reset link.';
  };
}

async function signOut() {
  if (dirty && !confirm('You have unsaved changes. Sign out anyway?')) return;
  dirty = false;
  const sb = await getSupabase();
  await sb.auth.signOut();
  location.reload();
}

function renderStart() {
  root.innerHTML = `
    <div class="login"><div style="max-width:420px">
      ${isAdmin ? '<p style="margin-bottom:12px"><a class="btn ghost sm" href="./">← Partners</a></p>' : ''}
      <h1>${partner ? `Set up ${esc(partner.name)}'s menu` : 'Set up your menu'}</h1>
      <p>Your menu is empty. Start from a sample menu (a full café menu with photos and videos you can edit), or from a blank menu.</p>
      <p style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
        <button class="btn" id="from-sample">Start from sample</button>
        <button class="btn ghost" id="import-start">Import a menu (Excel, CSV, Zomato or AirMenus link)</button>
        <button class="btn ghost" id="blank">Blank menu</button>
      </p>
      <p class="error" id="start-err"></p>
    </div></div>`;
  $('#from-sample').onclick = async () => {
    // This restaurant's own starter file if we prepared one, otherwise the neutral demo café (data/demo.json).
    try { menu = await loadStatic(slug); } catch {
      try { menu = { ...(await loadStatic('demo')), id: slug, ...(partner?.name ? { name: partner.name } : {}) }; } catch { $('#start-err').textContent = "Couldn't load the sample menu. Check your connection and try again."; return; }
    }
    normalize(); renderApp(); setDirty(true);
  };
  const blank = () => {
    menu = { id: slug, name: partner?.name || slug, tagline: '', currency: 'INR', locale: 'en-IN', groups: [{ id: 'drinks', label: 'Drinks' }, { id: 'food', label: 'Food' }], sections: [], dishes: [] };
    normalize(); renderApp(); setDirty(true);
  };
  $('#blank').onclick = blank;
  $('#import-start').onclick = () => { blank(); openImport(); };
}

/* ==========================================================
   App shell
   ========================================================== */
function previewUrl() {
  const u = new URL('../', location.href);
  u.searchParams.set('r', slug);
  u.searchParams.set('preview', '');
  if (MODE === 'demo') u.searchParams.set('source', 'local');
  return u.href.replace('preview=&', 'preview&').replace(/preview=$/, 'preview');
}

function renderApp() {
  applyTheme();
  document.title = `${menu.name} · Dashboard`;
  root.innerHTML = `
    <header class="top">
      ${isAdmin ? '<a class="btn ghost sm" href="./" id="to-partners">← Partners</a>' : ''}
      <span class="product">NomNom <span>Dashboard</span></span>
      <span class="rest">${esc(menu.name)}</span>
      <span class="mode ${MODE === 'live' ? 'live' : ''}">${MODE === 'live' ? 'Live' : 'Demo · saved in this browser'}</span>
      <label class="order-switch" title="On: guests can order from their table. Off: guests can only view the menu.">
        <input type="checkbox" id="ordering-toggle" role="switch" ${menu.ordering?.enabled ? 'checked' : ''}>
        <span class="os-track" aria-hidden="true"></span>
        <span class="os-label">Table ordering <b>${menu.ordering?.enabled ? 'On' : 'Off'}</b></span>
      </label>
      <div class="top-actions">
        <a class="btn ghost sm" id="preview-link" href="${esc(previewUrl())}" target="_blank" rel="noopener">${I.ext}Preview</a>
        <button class="btn sm" id="publish" disabled>All changes saved</button>
        <button class="icon-btn" id="more" aria-haspopup="menu" aria-expanded="false" aria-label="More actions">${I.more}</button>
        <div class="menu-pop" id="more-pop" role="menu" hidden>
          <button role="menuitem" data-act="export">Export menu (JSON)</button>
          <label role="menuitem">Import menu (JSON)<input type="file" accept="application/json,.json" id="import" class="sr-only"></label>
          ${MODE === 'demo' ? '<button role="menuitem" data-act="reset">Reset to sample data</button>' : '<button role="menuitem" data-act="signout">Sign out</button>'}
        </div>
      </div>
    </header>
    <nav class="tabs" role="tablist">
      ${[['orders', 'Orders'], ['items', 'Items'], ['categories', 'Categories'], ['branding', 'Branding'], ['insights', 'Insights'], ['tables', 'Tables & QR']]
        .map(([id, l]) => `<button class="tab" role="tab" data-view="${id}" aria-selected="${view === id}">${l}</button>`).join('')}
    </nav>
    ${menuPaused ? `<div class="admin-strip paused" role="note">${adminEditing ? 'This menu is <b>paused</b>: guests see “Menu unavailable”. Resume it from Partners.' : 'Your menu is <b>paused</b>, so guests see “Menu unavailable”. Please contact NomNom at <a href="mailto:contact@heynomnom.in">contact@heynomnom.in</a>.'}</div>` : ''}
    ${adminEditing ? `<div class="admin-strip" role="note">Super admin: you're editing <b>${esc(menu.name)}</b>'s menu. Changes go live for their guests when you publish.</div>` : ''}
    <main class="view" id="view"></main>`;

  $('#publish').onclick = publish;
  $('#to-partners')?.addEventListener('click', (e) => { if (dirty && !confirm('You have unsaved changes. Leave without publishing?')) e.preventDefault(); else dirty = false; });
  $('#ordering-toggle').onchange = (e) => setOrdering(e.target.checked);
  $('.tabs').onclick = (e) => {
    const t = e.target.closest('[data-view]');
    if (!t) return;
    view = t.dataset.view;
    $$('.tab').forEach((x) => x.setAttribute('aria-selected', x.dataset.view === view));
    renderView();
  };
  const more = $('#more');
  const pop = $('#more-pop');
  more.onclick = () => { pop.hidden = !pop.hidden; more.setAttribute('aria-expanded', !pop.hidden); };
  document.addEventListener('click', (e) => { if (!e.target.closest('.top-actions')) { pop.hidden = true; more.setAttribute('aria-expanded', 'false'); } });
  pop.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'export') exportJson();
    if (act === 'reset') {
      if (!confirm('Discard all changes made in this browser and go back to the sample menu?')) return;
      await clearLocal(slug);
      dirty = false;
      location.reload();
    }
    if (act === 'signout') signOut();
  });
  $('#import').onchange = importJson;
  setDirty(dirty);
  initOps().then(() => renderView());
}

function renderView() {
  const v = $('#view');
  v.onclick = null; v.onchange = null; v.oninput = null; // the ops views attach their own handlers
  if (view === 'orders') renderOrders(v);
  else if (view === 'items') renderItems();
  else if (view === 'categories') renderCategories();
  else if (view === 'insights') renderInsights(v);
  else if (view === 'tables') renderTables(v);
  else renderBranding();
}

/* Table ordering on/off. Takes effect immediately: only this one setting is changed in the published menu,
   so other unpublished edits stay as drafts. Off = guests can only view the menu. */
async function setOrdering(on) {
  const input = $('#ordering-toggle');
  if (adminEditing) {
    const ok = await confirmDialog({
      title: `Turn table ordering ${on ? 'on' : 'off'} for ${menu.name}?`,
      body: on ? `Guests at <b>${esc(menu.name)}</b> will be able to order from their table right away.` : `Guests at <b>${esc(menu.name)}</b> will only be able to view the menu.`,
      confirm: on ? 'Turn on' : 'Turn off',
    });
    if (!ok) {
      input.checked = !on;
      if (view === 'orders') renderView(); // redraw the Orders tab's own switch
      return;
    }
  }
  input.disabled = true;
  try {
    if (MODE === 'live') {
      const sb = await getSupabase();
      const { data: row, error } = await sb.from('menus').select('data').eq('slug', slug).single();
      if (error) throw error;
      const published = row?.data && Object.keys(row.data).length ? row.data : structuredClone(menu);
      published.ordering = { ...(published.ordering || {}), enabled: on };
      await saveSupabase(slug, published);
    }
    menu.ordering = { ...(menu.ordering || {}), enabled: on };
    if (MODE !== 'live') setDirty(true);
    toast(on ? 'Table ordering is ON. Guests can order from their table.' : 'Table ordering is OFF. Guests can only view the menu.');
  } catch (err) {
    input.checked = !on;
    toast(`Couldn't change ordering: ${err.message || err}`, true);
  } finally {
    input.disabled = false;
    $('.os-label b').textContent = menu.ordering?.enabled ? 'On' : 'Off';
    if (view === 'orders') renderView();
  }
}

// Live orders keep running on every tab, so new orders ring and notify wherever the owner is.
let opsStarted = false;
async function initOps() {
  const ctx = {
    sb: MODE === 'live' ? await getSupabase() : null,
    slug,
    mode: MODE,
    menu: () => menu,
    fmt,
    toast,
    setDirty,
    setOrdering: (on) => { const t = $('#ordering-toggle'); t.checked = on; return setOrdering(on); },
    onOrdersChange: () => { if (view === 'orders' && !$('.drawer')) renderOrders($('#view')); },
  };
  if (!opsStarted) { opsStarted = true; await startOrders(ctx); }
}

async function publish() {
  const btn = $('#publish');
  if (adminEditing) {
    const ok = await confirmDialog({
      title: `Publish ${menu.name}'s menu?`,
      body: `Guests scanning <b>${esc(menu.name)}</b>'s QR codes will see these changes immediately.`,
      confirm: 'Publish now',
    });
    if (!ok) return;
  }
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    let previous = null;
    if (MODE === 'live') {
      previous = (await (await getSupabase()).from('menus').select('data').eq('slug', slug).maybeSingle()).data?.data || null;
      await saveSupabase(slug, menu);
    } else await saveLocal(slug, menu);
    setDirty(false);
    toast(MODE === 'live' ? 'Published — guests see the new menu now.' : 'Saved in this browser. Use Preview to see it.');
    // Remove photos/videos the published menu no longer uses (replaced or deleted items). Never blocks publishing.
    if (MODE === 'live') cleanupMedia(slug, menu, previous).catch((err) => console.warn('Media clean-up skipped:', err));
    // First publish of a new partner's menu: offer to send the owner their welcome email.
    if (adminEditing && partner && !partner.invited_at && partner.owner_email) {
      partner = { ...partner, published: true };
      if (await invite(partner, { afterPublish: true })) partner.invited_at = new Date().toISOString();
    }
  } catch (err) {
    setDirty(true);
    toast(`Couldn't save: ${err.message || err}`, true);
  }
}

function exportJson() {
  const hasLocal = JSON.stringify(menu).includes('"idb:');
  const blob = new Blob([JSON.stringify(menu, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${slug}-menu.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  if (hasLocal) toast('Exported. Note: photos/videos uploaded in demo mode only exist in this browser.');
}

async function importJson(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed.dishes) || !Array.isArray(parsed.sections)) throw new Error('This file is not a menu export.');
    if (!confirm(`Replace the current menu with "${parsed.name || file.name}" (${parsed.dishes.length} items)?`)) return;
    menu = parsed;
    normalize();
    renderApp();
    setDirty(true);
    toast('Imported. Review it, then Save & publish.');
  } catch (err) {
    toast(`Import failed: ${err.message}`, true);
  }
}

/* ==========================================================
   Import: CSV / Excel file, or a Zomato / AirMenus / EazyDiner / Dineout link
   ========================================================== */
function openImport() {
  const back = document.createElement('div');
  back.className = 'drawer-back';
  const drawer = document.createElement('aside');
  drawer.className = 'drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-labelledby', 'imp-title');
  drawer.innerHTML = `
    <div class="drawer-head">
      <h2 id="imp-title">Import menu items</h2>
      <button class="icon-btn" data-close aria-label="Close">${I.close}</button>
    </div>
    <div class="drawer-body" id="imp-body">
      <section class="imp-step">
        <h3>From a spreadsheet</h3>
        <p class="hint">Excel (.xlsx, .xls) or CSV. One row per item. Columns like Name, Category, Price, Description,
          Veg/Non-veg, Prep time and Photo URL are recognised automatically; only Name is required.</p>
        <div class="imp-actions">
          <label class="btn">${I.upload}Choose file<input type="file" id="imp-file" class="sr-only"
            accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm,.ods,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"></label>
          <button class="btn ghost" id="imp-template">Download template</button>
        </div>
      </section>
      <section class="imp-step">
        <h3>From a listing link</h3>
        <p class="hint">Paste the restaurant's Zomato, AirMenus, EazyDiner or Swiggy Dineout page. AirMenus and Zomato give
          the full item list with photos (Zomato only when the restaurant takes online orders). EazyDiner and Dineout only
          show photos of the printed menu.</p>
        <form class="imp-actions" id="imp-link-form">
          <input class="input" type="url" id="imp-url" placeholder="https://www.zomato.com/… or https://airmenus.in/…" required>
          <button class="btn" type="submit" id="imp-go">Fetch menu</button>
        </form>
      </section>
      <div id="imp-result" aria-live="polite"></div>
    </div>
    <div class="drawer-foot" id="imp-foot" hidden>
      <fieldset class="imp-mode">
        <label><input type="radio" name="imp-mode" value="add" checked> Add to my menu <small>(items with the same name are updated)</small></label>
        <label><input type="radio" name="imp-mode" value="replace"> Replace all items <small>(branding stays)</small></label>
      </fieldset>
      <span class="spacer"></span>
      <button class="btn ghost" data-close>Cancel</button>
      <button class="btn" id="imp-apply">Import</button>
    </div>`;
  document.body.append(back, drawer);
  document.documentElement.classList.add('lock');
  let pending = null;
  const close = () => { back.remove(); drawer.remove(); document.documentElement.classList.remove('lock'); };
  back.onclick = close;
  drawer.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  drawer.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  $('#imp-url', drawer).focus();

  const result = $('#imp-result', drawer);
  const foot = $('#imp-foot', drawer);
  const show = (items, note = '', images = []) => {
    pending = items;
    const cats = [...new Set(items.map((i) => i.category))];
    const known = new Set(categories().map((c) => c.label.toLowerCase()));
    const newCats = cats.filter((c) => !known.has(c.toLowerCase()));
    const noPrice = items.filter((i) => i.price == null).length;
    const noDiet = items.filter((i) => i.veg == null).length;
    result.innerHTML = `
      ${items.length ? `
        <div class="imp-summary">
          <p><b>${items.length}</b> items in <b>${cats.length}</b> categories${newCats.length ? ` · ${newCats.length} new: ${esc(newCats.slice(0, 6).join(', '))}${newCats.length > 6 ? '…' : ''}` : ''}</p>
          ${noPrice ? `<p class="warn">${noPrice} without a price (they'll show ₹0 until you edit them).</p>` : ''}
          ${noDiet ? `<p class="hint">${noDiet} without a veg/non-veg mark; they'll be marked veg. Change any non-veg ones in the editor.</p>` : ''}
          ${note ? `<p class="hint">${note}</p>` : ''}
          ${items.some((i) => i.image) ? `<p class="hint"><b>${items.filter((i) => i.image).length}</b> item photos will be copied into your own storage (optimised). Items that already have a photo keep it.</p>` : `<p class="hint">Photos and videos aren't included; add them per item after importing.</p>`}
          ${(() => { const b = [...new Set(items.flatMap((i) => i.badges || []))]; return b.length ? `<p class="hint">Badges: ${esc(b.join(', '))}. Rename or delete them later under Categories → Badges.</p>` : ''; })()}
          ${items.some((i) => i.available === false) ? `<p class="hint">${items.filter((i) => i.available === false).length} marked out of stock there; they'll be imported as unavailable.</p>` : ''}
        </div>
        <div class="imp-table-wrap"><table class="imp-table">
          <thead><tr><th>Item</th><th>Category</th><th>Price</th><th>Diet</th></tr></thead>
          <tbody>${items.slice(0, 200).map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.category)}</td>
            <td>${i.price == null ? '—' : esc(fmt(i.price))}</td><td>${i.veg == null ? '—' : i.veg ? 'Veg' : i.egg ? 'Egg' : 'Non-veg'}</td></tr>`).join('')}</tbody>
        </table></div>` : ''}
      ${images.length ? `
        <div class="imp-summary"><p>This page only has <b>photos of the printed menu</b> (${images.length}). Open them, type the items into the
          template, and upload it above.</p></div>
        <div class="imp-photos">${images.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Menu page" loading="lazy"></a>`).join('')}</div>` : ''}`;
    foot.hidden = !items.length;
    $('#imp-apply', drawer).textContent = `Import ${items.length} items`;
  };
  const fail = (msg) => { pending = null; foot.hidden = true; result.innerHTML = `<p class="error">${esc(msg)}</p>`; };

  $('#imp-template', drawer).onclick = () => {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: 'text/csv' })), download: 'menu-template.csv' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  $('#imp-file', drawer).onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    result.innerHTML = '<p class="hint">Reading…</p>';
    try {
      const { items, unknownColumns } = rowsToItems(await readSpreadsheet(file));
      show(items, unknownColumns.length ? `Ignored columns: ${esc(unknownColumns.join(', '))}.` : '');
    } catch (err) {
      fail(err.message);
    }
  };

  $('#imp-link-form', drawer).onsubmit = async (e) => {
    e.preventDefault();
    if (!supabaseEnabled()) return fail('Importing from a link needs the pilot backend (Supabase). Use a spreadsheet in demo mode.');
    const btn = $('#imp-go', drawer);
    btn.disabled = true;
    btn.textContent = 'Fetching…';
    result.innerHTML = '<p class="hint">Reading the page. This can take up to 20 seconds.</p>';
    try {
      const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/import-menu`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: CONFIG.supabaseAnonKey, Authorization: `Bearer ${await accessToken()}` },
        body: JSON.stringify({ url: $('#imp-url', drawer).value.trim() }),
      });
      const out = await res.json().catch(() => ({ error: `Unexpected reply (${res.status}).` }));
      if (out.error) return fail(out.error);
      if (!out.items.length && !out.menuImages.length) return fail("Couldn't find a menu on that page. For Zomato, use the restaurant's page (it should have an Order Online tab); for AirMenus, the restaurant's menu link.");
      show(out.items, out.items.length ? `From ${esc(out.source)}${out.name ? ` · ${esc(out.name)}` : ''}.${out.source.includes('zomato') ? ' Descriptions are often empty on Zomato.' : ''}` : '', out.menuImages);
    } catch (err) {
      fail(`Couldn't fetch the menu: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Fetch menu';
    }
  };

  $('#imp-apply', drawer).onclick = async () => {
    if (!pending?.length) return;
    const replace = $('input[name=imp-mode]:checked', drawer).value === 'replace';
    if (replace && menu.dishes.length && !confirm(`Replace all ${menu.dishes.length} current items with ${pending.length} imported items?`)) return;
    const stats = applyImport(menu, pending, { replace, slugify });
    close();
    view = 'items';
    itemCat = 'all';
    renderApp();
    setDirty(true);
    const summary = `Imported: ${stats.added} added${stats.updated ? `, ${stats.updated} updated` : ''}${stats.newCategories ? `, ${stats.newCategories} new categories` : ''}.`;
    if (!menu.dishes.some(isListingPhoto)) return toast(`${summary} Review, then Save & publish.`);
    toast(`${summary} Copying photos…`);
    const { copied, failed } = await copyListingPhotos((done, total) => toast(`Copying photos ${done}/${total}…`));
    renderApp();
    toast(`${summary} ${copied} photos copied${failed ? `; ${failed} couldn't be copied, add those by hand` : ''}. Review, then Save & publish.`, failed > 0);
  };
}

/* Photos from a listing (Zomato, AirMenus) are copied into the restaurant's own storage, resized like any upload, so
   the menu never depends on their servers. The import-menu function fetches them (browsers can't, no CORS). */
const isListingPhoto = (d) => /^https:\/\/(([^/]+\.)?zmtcdn\.com|airmenusimages\.[a-z0-9]+\.cdn\.digitaloceanspaces\.com)\//.test(d.image || '');

async function copyListingPhotos(onProgress) {
  const todo = menu.dishes.filter(isListingPhoto);
  const token = await accessToken();
  let done = 0;
  let copied = 0;
  let failed = 0;
  const copyOne = async (d) => {
    const src = d.image;
    try {
      const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/import-menu`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: CONFIG.supabaseAnonKey, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image: src }),
      });
      const blob = await res.blob();
      if (!res.ok || !blob.type.startsWith('image/')) throw new Error(`status ${res.status}`);
      const { full, thumb } = await makePhotoSet(blob);
      await savePhotoSet(d, full, thumb);
      d.focus = '50% 50%';
      copied++;
    } catch (err) {
      console.warn('Photo copy failed', d.name, err);
      if (d.image === src) { d.image = ''; delete d.thumb; }
      failed++;
    }
    onProgress?.(++done, todo.length);
  };
  const queue = [...todo];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) await copyOne(queue.shift());
  }));
  setDirty(true);
  return { copied, failed };
}

async function accessToken() {
  const sb = await getSupabase();
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || CONFIG.supabaseAnonKey;
}

/* ==========================================================
   Items
   ========================================================== */
function renderItems() {
  const v = $('#view');
  const cats = categories();
  const total = menu.dishes.length;
  const videos = menu.dishes.filter((d) => d.video).length;
  const off = menu.dishes.filter((d) => d.available === false).length;
  const noPhoto = menu.dishes.filter((d) => !d.image).length;
  v.innerHTML = `
    ${MODE === 'demo' ? '<p class="banner"><strong>Demo mode.</strong> Changes and uploads are saved in this browser only. Connect the pilot backend (see supabase/README.md) to save them for real and share with guests.</p>' : ''}
    <div class="items-toolbar">
      <input class="input" type="search" id="item-q" placeholder="Search items" value="${esc(itemSearch)}" aria-label="Search items">
      <select class="input" id="item-cat" aria-label="Filter by category">
        <option value="all">All categories</option>
        ${cats.map((c) => `<option value="${esc(c.match)}" ${itemCat === c.match ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
      </select>
      <button class="btn ghost" id="import-items">${I.upload}Import</button>
      <button class="btn" id="add-item">${I.plus}Add item</button>
    </div>
    <div class="stats">
      <span><b>${total}</b> items</span><span><b>${videos}</b> with video</span>
      <span class="${off ? 'warn' : ''}"><b>${off}</b> unavailable</span>
      ${noPhoto ? `<span class="warn"><b>${noPhoto}</b> missing a photo</span>` : ''}
    </div>
    <div id="item-lists"></div>`;
  $('#item-q').oninput = (e) => { itemSearch = e.target.value; renderItemLists(); };
  $('#item-cat').onchange = (e) => { itemCat = e.target.value; renderItemLists(); };
  $('#add-item').onclick = () => openEditor(null);
  $('#import-items').onclick = openImport;
  $('#item-lists').addEventListener('click', onItemListClick);
  $('#item-lists').addEventListener('change', onItemListChange);
  renderItemLists();
}

function renderItemLists() {
  const q = itemSearch.trim().toLowerCase();
  const cats = categories().filter((c) => itemCat === 'all' || c.match === itemCat);
  const orphan = menu.dishes.filter((d) => !categories().some((c) => c.match === d.category));
  const blocks = cats.map((c) => ({ label: c.label, list: menu.dishes.filter((d) => d.category === c.match) }));
  if (orphan.length && itemCat === 'all') blocks.push({ label: 'No category', list: orphan });

  const html = blocks.map(({ label, list }) => {
    const shown = q ? list.filter((d) => `${d.name} ${d.description}`.toLowerCase().includes(q)) : list;
    if (!shown.length) return '';
    return `<section class="cat-sec"><h3>${esc(label)} <small>${list.length}</small></h3><ul class="item-list">${shown.map((d) => itemRow(d, list)).join('')}</ul></section>`;
  }).join('');
  $('#item-lists').innerHTML = html || '<p class="empty-note">No items match.</p>';
  hydrate($('#item-lists'));
}

function itemRow(d, siblings) {
  const i = siblings.indexOf(d);
  const badges = (d.badges || []).map((b) => `<span class="tag">${esc(menu.badges?.[b]?.label || b)}</span>`).join('');
  return `
    <li class="item${d.available === false ? ' off' : ''}" data-id="${esc(d.id)}">
      ${d.image ? `<img class="thumb" data-media="${esc(d.image)}" alt="">` : '<div class="thumb missing">No photo</div>'}
      <div class="item-main">
        <div class="item-name"><span class="vnv ${vegKind(d)}" aria-hidden="true"></span>${esc(d.name)}</div>
        <div class="item-sub">${fmt(d.price)}${d.prepTime ? ` · ${d.prepTime} min` : ''}
          ${d.video ? `<span class="tag vid">${I.video}Video</span>` : ''}${badges}</div>
      </div>
      <div class="tools">
        <label class="toggle"><input type="checkbox" data-avail ${d.available === false ? '' : 'checked'} aria-label="${esc(d.name)} available">${d.available === false ? 'Sold out' : 'Available'}</label>
        <span class="reorder">
          <button class="icon-btn" data-move="-1" aria-label="Move ${esc(d.name)} up" ${i <= 0 ? 'disabled' : ''}>${I.up}</button>
          <button class="icon-btn" data-move="1" aria-label="Move ${esc(d.name)} down" ${i >= siblings.length - 1 ? 'disabled' : ''}>${I.down}</button>
        </span>
      </div>
      <button class="btn ghost sm edit" data-edit>Edit</button>
    </li>`;
}

function onItemListClick(e) {
  const li = e.target.closest('.item');
  if (!li) return;
  const d = menu.dishes.find((x) => x.id === li.dataset.id);
  if (e.target.closest('[data-edit]')) return openEditor(d);
  const mv = e.target.closest('[data-move]');
  if (mv) {
    const siblings = menu.dishes.filter((x) => x.category === d.category);
    const j = siblings.indexOf(d) + Number(mv.dataset.move);
    if (j < 0 || j >= siblings.length) return;
    const a = menu.dishes.indexOf(d);
    const b = menu.dishes.indexOf(siblings[j]);
    [menu.dishes[a], menu.dishes[b]] = [menu.dishes[b], menu.dishes[a]];
    setDirty();
    renderItemLists();
    $(`.item[data-id="${CSS.escape(d.id)}"] [data-move="${mv.dataset.move}"]`)?.focus();
  }
}
function onItemListChange(e) {
  if (!e.target.matches('[data-avail]')) return;
  const d = menu.dishes.find((x) => x.id === e.target.closest('.item').dataset.id);
  d.available = e.target.checked;
  setDirty();
  renderItemLists();
}

/* ---------- Item editor ---------- */
function blankDish() {
  const cat = itemCat !== 'all' ? itemCat : categories()[0]?.match || '';
  const group = categories().find((c) => c.match === cat)?.group;
  return {
    id: '', name: '', category: cat, price: 0, image: '', description: '', tags: [], badges: [],
    diet: { veg: true, egg: false, vegan: false, gf: false }, spice: 0, course: group === 'drinks' ? 'drink' : 'meal',
    coffee: false, available: true,
  };
}

function openEditor(dish) {
  editing = { draft: structuredClone(dish || blankDish()), isNew: !dish, originalId: dish?.id };
  const d = editing.draft;
  const cats = categories();
  const group = () => cats.find((c) => c.match === d.category)?.group;
  const back = document.createElement('div');
  back.className = 'drawer-back';
  const drawer = document.createElement('aside');
  drawer.className = 'drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-labelledby', 'ed-title');
  drawer.innerHTML = `
    <div class="drawer-head">
      <h2 id="ed-title">${editing.isNew ? 'New item' : `Edit · ${esc(d.name)}`}</h2>
      <button class="icon-btn" data-close aria-label="Close editor">${I.close}</button>
    </div>
    <form class="drawer-body" id="ed" novalidate>
      <fieldset class="fs">
        <legend>Photo & video</legend>
        <div class="media-grid">
          <div class="media-card">
            <h4>Photo <span class="hint">Tap to set focus</span></h4>
            <div class="photo-box" id="photo-box">${photoInner(d)}</div>
            <div class="media-actions">
              <label class="btn ghost sm">Upload<input type="file" accept="image/*" id="photo-file" class="sr-only"></label>
              <button type="button" class="btn ghost sm" id="photo-remove" ${d.image ? '' : 'disabled'}>Remove</button>
            </div>
            <p class="progress" id="photo-progress" aria-live="polite"></p>
          </div>
          <div class="media-card">
            <h4>Video <span class="hint">Optional · up to 15 s, compressed to 480p</span></h4>
            <div class="video-box" id="video-box">${videoInner(d)}</div>
            <div class="media-actions">
              <label class="btn ghost sm">${d.video ? 'Replace' : 'Upload'}<input type="file" accept="video/mp4,video/webm,video/quicktime" id="video-file" class="sr-only"></label>
              <button type="button" class="btn ghost sm" id="frame" ${d.video ? '' : 'disabled'}>Use frame as photo</button>
              <button type="button" class="btn ghost sm" id="video-remove" ${d.video ? '' : 'disabled'}>Remove</button>
            </div>
            <p class="progress" id="video-progress" aria-live="polite"></p>
          </div>
        </div>
        <p class="hint">Best results: landscape 4:3 or 16:9, bright, the dish in the centre. Videos: any phone clip up to 15 seconds. It's shrunk here to a 480p silent loop (about 1–2 MB) before uploading, so it loads fast on mobile data.</p>
      </fieldset>

      <fieldset class="fs">
        <legend>Details</legend>
        <label class="field">Name *<input name="name" required maxlength="80" value="${esc(d.name)}"></label>
        <div class="grid-3">
          <label class="field">Price (${esc(menu.currency || 'INR')}) *<input name="price" type="number" min="0" step="1" required value="${esc(d.price)}"></label>
          <label class="field">Prep time (min)<input name="prepTime" type="number" min="0" max="180" value="${esc(d.prepTime ?? '')}"></label>
          <label class="field">Calories<input name="kcal" type="number" min="0" max="5000" value="${esc(d.kcal ?? '')}"></label>
        </div>
        <label class="field">Category *
          <select name="category" required>${cats.map((c) => `<option value="${esc(c.match)}" ${c.match === d.category ? 'selected' : ''}>${esc(c.label)}${c.group ? ` (${esc(menu.groups.find((g) => g.id === c.group)?.label || c.group)})` : ''}</option>`).join('')}</select>
        </label>
        <label class="field">Short description <small>Shown on the menu card (about 1–2 lines)</small><textarea name="description" maxlength="220">${esc(d.description)}</textarea></label>
      </fieldset>

      <fieldset class="fs">
        <legend>Diet & type</legend>
        <div class="seg" role="radiogroup" aria-label="Veg or non-veg">
          ${[['veg', 'Veg'], ['egg', 'Egg'], ['nonveg', 'Non-veg']].map(([k, l]) => `<label><input type="radio" name="vegKind" value="${k}" ${vegKind(d) === k ? 'checked' : ''}>${l}</label>`).join('')}
        </div>
        <div class="row-wrap">
          <label class="check"><input type="checkbox" name="vegan" ${d.diet?.vegan ? 'checked' : ''}>Vegan</label>
          <label class="check"><input type="checkbox" name="gf" ${d.diet?.gf ? 'checked' : ''}>Gluten-free</label>
          <label class="check"><input type="checkbox" name="coffee" ${d.coffee ? 'checked' : ''}>Contains coffee</label>
        </div>
        <div class="grid-3">
          <label class="field">Spice<select name="spice">${['None', 'Mild', 'Medium', 'Hot'].map((l, i) => `<option value="${i}" ${Number(d.spice || 0) === i ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field">Served<select name="temp"><option value="">—</option><option value="hot" ${d.temp === 'hot' ? 'selected' : ''}>Hot</option><option value="cold" ${d.temp === 'cold' ? 'selected' : ''}>Cold</option></select></label>
          <label class="field">Type<select name="course">${[['drink', 'Drink'], ['meal', 'Meal'], ['snack', 'Snack'], ['side', 'Side / dip']].map(([k, l]) => `<option value="${k}" ${d.course === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <label class="field">Allergens <small>Comma separated, e.g. dairy, gluten, nuts</small><input name="allergens" value="${esc((d.allergens || []).join(', '))}"></label>
      </fieldset>

      <fieldset class="fs">
        <legend>Highlights</legend>
        <div class="row-wrap">
          ${Object.entries(menu.badges || {}).map(([k, b]) => `<label class="check"><input type="checkbox" name="badge" value="${esc(k)}" ${d.badges.includes(k) ? 'checked' : ''}>Badge: ${esc(b.label)}</label>`).join('')}
        </div>
        <div class="row-wrap">
          ${rails().map((r) => `<label class="check"><input type="checkbox" name="tag" value="${esc(r.match)}" ${d.tags.includes(r.match) ? 'checked' : ''}>Show in “${esc(r.label.replaceAll('{name}', menu.name))}”</label>`).join('')}
        </div>
      </fieldset>

      <fieldset class="fs">
        <legend>Story (optional)</legend>
        <label class="field">The story<textarea name="story" maxlength="600">${esc(d.story || '')}</textarea></label>
        <label class="field">Chef / barista note<textarea name="chefNote" maxlength="300">${esc(d.chefNote || '')}</textarea></label>
      </fieldset>
    </form>
    <div class="drawer-foot">
      ${editing.isNew ? '' : '<button class="btn danger sm" data-delete>Delete</button><button class="btn ghost sm" data-duplicate>Duplicate</button>'}
      <span class="spacer"></span>
      <button class="btn ghost" data-close>Cancel</button>
      <button class="btn" data-done>${editing.isNew ? 'Add item' : 'Done'}</button>
    </div>`;
  document.body.append(back, drawer);
  document.documentElement.style.overflow = 'hidden';
  hydrate(drawer);

  const close = () => {
    back.remove(); drawer.remove(); editing = null;
    document.documentElement.style.overflow = '';
    removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', onKey);
  back.onclick = close;
  $$('[data-close]', drawer).forEach((b) => (b.onclick = close));
  $('input[name=name]', drawer).focus();

  // Category change → sensible defaults for type
  $('select[name=category]', drawer).onchange = (e) => {
    d.category = e.target.value;
    if (group() === 'drinks') $('select[name=course]', drawer).value = 'drink';
    else if ($('select[name=course]', drawer).value === 'drink') $('select[name=course]', drawer).value = 'meal';
  };

  // ---- Photo ----
  $('#photo-box', drawer).onclick = (e) => {
    if (!d.image) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 100);
    const y = Math.round(((e.clientY - r.top) / r.height) * 100);
    d.focus = `${x}% ${y}%`;
    refreshPhoto();
  };
  const refreshPhoto = () => {
    $('#photo-box', drawer).innerHTML = photoInner(d);
    $('#photo-remove', drawer).disabled = !d.image;
    hydrate($('#photo-box', drawer));
  };
  $('#photo-file', drawer).onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Please choose an image file.', true);
    const p = $('#photo-progress', drawer);
    try {
      p.textContent = 'Optimising photo…';
      const { full, thumb } = await makePhotoSet(file);
      p.textContent = `Uploading (${Math.round(full.size / 1024)} KB + ${Math.round(thumb.size / 1024)} KB card copy)…`;
      await savePhotoSet(d, full, thumb);
      d.focus = '50% 50%';
      p.textContent = `Photo ready · card copy ${Math.round(thumb.size / 1024)} KB.`;
      refreshPhoto();
    } catch (err) {
      p.textContent = '';
      toast(`Photo upload failed: ${err.message || err}`, true);
    }
  };
  $('#photo-remove', drawer).onclick = () => { d.image = ''; delete d.thumb; delete d.focus; refreshPhoto(); };

  // ---- Video ----
  const refreshVideo = () => {
    $('#video-box', drawer).innerHTML = videoInner(d);
    $('#frame', drawer).disabled = !d.video;
    $('#video-remove', drawer).disabled = !d.video;
    hydrate($('#video-box', drawer));
  };
  $('#video-file', drawer).onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!/^video\//.test(file.type)) return toast('Please choose a video file (MP4 or MOV from your phone works).', true);
    const mb = file.size / 1048576;
    if (mb > MAX_VIDEO_MB) return toast(`That video is ${mb.toFixed(0)} MB. Please trim it to a short clip (under ${MAX_VIDEO_MB} MB).`, true);
    const p = $('#video-progress', drawer);
    const secs = await videoDuration(file);
    if (secs > MAX_VIDEO_SECONDS + 0.5) {
      return toast(`That video is ${Math.round(secs)} seconds. Item videos can be up to ${MAX_VIDEO_SECONDS} seconds: please trim it on your phone (Edit → trim) and upload again.`, true);
    }
    try {
      let upload = file;
      if (canCompressVideo()) {
        // Shrink it for phones before it leaves this computer: 480p, no sound.
        p.textContent = 'Compressing for phones… 0%';
        const out = await compressVideo(file, { onProgress: (f) => { p.textContent = `Compressing for phones… ${Math.round(f * 100)}% · keep this tab open`; } });
        upload = out.blob;
        p.textContent = `Compressed ${mb.toFixed(1)} MB → ${(upload.size / 1048576).toFixed(1)} MB (${out.width}×${out.height}, ${out.seconds} s). Uploading…`;
      } else if (mb > MAX_UNCOMPRESSED_MB) {
        p.textContent = '';
        return toast(`This browser can't compress video. Open the dashboard in Chrome, Edge or Safari, or upload a clip under ${MAX_UNCOMPRESSED_MB} MB.`, true);
      } else {
        p.textContent = `Uploading ${mb.toFixed(1)} MB…`;
      }
      d.video = await uploadMedia(slug, upload, 'videos', MODE === 'live' ? 'supabase' : 'local');
      p.textContent = upload === file ? 'Video ready.' : `Video ready · ${(upload.size / 1048576).toFixed(1)} MB (was ${mb.toFixed(1)} MB).`;
      refreshVideo();
      if (!d.image) {
        // Auto-create a cover photo from the video.
        const v = $('#video-box video', drawer);
        await new Promise((r) => { if (v.readyState >= 2) r(); else v.addEventListener('loadeddata', r, { once: true }); });
        v.currentTime = Math.min(1, (v.duration || 2) / 2);
        await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
        await useFrame();
      }
    } catch (err) {
      p.textContent = '';
      toast(`Video upload failed: ${err.message || err}`, true);
    }
  };
  const useFrame = async () => {
    const v = $('#video-box video', drawer);
    if (!v) return;
    try {
      v.pause();
      const { full, thumb } = await makePhotoSet(v); // throws SecurityError for videos hosted without CORS
      $('#photo-progress', drawer).textContent = 'Saving frame as photo…';
      await savePhotoSet(d, full, thumb);
      d.focus = '50% 50%';
      $('#photo-progress', drawer).textContent = 'Photo taken from the video.';
      refreshPhoto();
    } catch (err) {
      toast(err?.name === 'SecurityError'
        ? 'This video is hosted elsewhere, so a frame can’t be captured. Upload the video file here to use this.'
        : `Couldn’t capture a frame: ${err.message || err}`, true);
    }
  };
  $('#frame', drawer).onclick = useFrame;
  $('#video-remove', drawer).onclick = () => { delete d.video; refreshVideo(); };

  // ---- Footer ----
  $('[data-done]', drawer).onclick = () => {
    const form = $('#ed', drawer);
    const f = new FormData(form);
    const name = String(f.get('name') || '').trim();
    const price = Number(f.get('price'));
    if (!name) { form.name.focus(); return toast('Please give the item a name.', true); }
    if (!(price >= 0) || f.get('price') === '') { form.price.focus(); return toast('Please enter a price.', true); }
    if (!f.get('category')) return toast('Please choose a category (add one under Categories).', true);
    const num = (k) => (f.get(k) === '' || f.get(k) == null ? undefined : Number(f.get(k)));
    const kind = f.get('vegKind');
    Object.assign(d, {
      name, price, category: f.get('category'),
      prepTime: num('prepTime') > 0 ? num('prepTime') : undefined, kcal: num('kcal'),
      description: String(f.get('description') || '').trim(),
      diet: { veg: kind === 'veg', egg: kind === 'egg', vegan: kind === 'veg' && f.has('vegan'), gf: f.has('gf') },
      coffee: f.has('coffee'), spice: Number(f.get('spice') || 0),
      temp: f.get('temp') || undefined, course: f.get('course'),
      allergens: String(f.get('allergens') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      badges: f.getAll('badge'),
      tags: [...(d.tags || []).filter((t) => !rails().some((r) => r.match === t)), ...f.getAll('tag')],
      story: String(f.get('story') || '').trim() || undefined,
      chefNote: String(f.get('chefNote') || '').trim() || undefined,
    });
    if (editing.isNew) {
      let id = slugify(name);
      let n = 2;
      while (menu.dishes.some((x) => x.id === id)) id = `${slugify(name)}-${n++}`;
      d.id = id;
      menu.dishes.push(d);
    } else {
      const i = menu.dishes.findIndex((x) => x.id === editing.originalId);
      menu.dishes[i] = d;
    }
    const wasNew = editing.isNew;
    close();
    setDirty();
    renderItems();
    toast(wasNew ? `Added “${name}”. Remember to Save & publish.` : `Updated “${name}”.`);
  };
  $('[data-delete]', drawer)?.addEventListener('click', () => {
    if (!confirm(`Delete “${d.name}” from the menu?`)) return;
    menu.dishes = menu.dishes.filter((x) => x.id !== editing.originalId);
    for (const x of menu.dishes) if (x.pairings) x.pairings = x.pairings.filter((p) => p.dishId !== editing.originalId);
    close();
    setDirty();
    renderItems();
    toast('Item deleted.');
  });
  $('[data-duplicate]', drawer)?.addEventListener('click', () => {
    const copy = structuredClone(menu.dishes.find((x) => x.id === editing.originalId));
    copy.name = `${copy.name} (copy)`;
    copy.id = '';
    close();
    openEditorFromDraft(copy);
  });
}

function openEditorFromDraft(draft) {
  openEditor(draft);
  editing.isNew = true;
  editing.originalId = undefined;
  $('#ed-title').textContent = 'New item (copy)';
  $('[data-delete]')?.remove();
  $('[data-duplicate]')?.remove();
  $('[data-done]').textContent = 'Add item';
}

function photoInner(d) {
  if (!d.image) return '<div class="media-empty">No photo yet.<br>Upload one, or upload a video and use a frame.</div>';
  const [x, y] = (d.focus || '50% 50%').split(' ');
  return `<img data-media="${esc(d.image)}" alt="Photo of ${esc(d.name)}" style="object-position:${esc(d.focus || '50% 50%')}"><span class="focus-dot" style="left:${esc(x)};top:${esc(y)}"></span>`;
}
function videoInner(d) {
  if (!d.video) return '<div class="media-empty">No video. Up to 15 seconds; short 8–15 s loops work best.</div>';
  return `<video data-media="${esc(d.video)}" controls muted playsinline loop preload="metadata" crossorigin="anonymous"></video>`;
}

/* ==========================================================
   Categories & featured lists
   ========================================================== */
const BADGE_TONES = [['primary', 'Primary colour'], ['secondary', 'Secondary colour'], ['neutral', 'Plain']];

function renderCategories() {
  const v = $('#view');
  const cats = categories();
  v.innerHTML = `
    <div class="panel">
      <h3>Categories</h3>
      <p>Grouped under ${menu.groups.map((g) => `<b>${esc(g.label)}</b>`).join(' and ')} on the guest menu. Order here is the order guests see.</p>
      ${cats.map((c, i) => `
        <div class="cat-row" data-sec="${esc(c.id)}">
          <label class="field">Name<input value="${esc(c.label)}" data-k="label"></label>
          <label class="field">Subtitle<input value="${esc(c.eyebrow || '')}" data-k="eyebrow" placeholder="e.g. Fresh from the oven"></label>
          <label class="field">Group<select data-k="group">${menu.groups.map((g) => `<option value="${esc(g.id)}" ${c.group === g.id ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}</select></label>
          <span class="count">${menu.dishes.filter((d) => d.category === c.match).length} items</span>
          <span class="reorder">
            <button class="icon-btn" data-smove="-1" aria-label="Move ${esc(c.label)} up" ${i === 0 ? 'disabled' : ''}>${I.up}</button>
            <button class="icon-btn" data-smove="1" aria-label="Move ${esc(c.label)} down" ${i === cats.length - 1 ? 'disabled' : ''}>${I.down}</button>
            <button class="icon-btn" data-sdel aria-label="Delete ${esc(c.label)}" ${menu.dishes.some((d) => d.category === c.match) ? 'disabled title="Move or delete its items first"' : ''}>${I.close}</button>
          </span>
        </div>`).join('')}
      <form id="add-cat" style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <input class="input" name="label" placeholder="New category name" required style="flex:1;min-width:180px">
        <select class="input" name="group" style="flex:0 0 140px">${menu.groups.map((g) => `<option value="${esc(g.id)}">${esc(g.label)}</option>`).join('')}</select>
        <button class="btn" type="submit">${I.plus}Add</button>
      </form>
    </div>
    <div class="panel">
      <h3>Featured lists</h3>
      <p>The large swipeable rails at the top of the menu, e.g. “Most loved” or “Chef’s picks”. Items with a video look best. Use {name} for your restaurant name.</p>
      ${rails().length ? '' : '<p class="hint">No featured lists yet. Add one below.</p>'}
      ${rails().map((r, i, all) => {
        const items = railItems(r);
        return `
        <div class="rail-edit" data-sec="${esc(r.id)}">
          <div class="cat-row">
            <label class="field">Title<input value="${esc(r.label)}" data-k="label"></label>
            <label class="field">Subtitle<input value="${esc(r.eyebrow || '')}" data-k="eyebrow" placeholder="e.g. Guest favourites"></label>
            <span></span>
            <span class="count">${items.length} item${items.length === 1 ? '' : 's'}</span>
            <span class="reorder">
              <button class="icon-btn" data-smove="-1" aria-label="Move ${esc(r.label)} up" ${i === 0 ? 'disabled' : ''}>${I.up}</button>
              <button class="icon-btn" data-smove="1" aria-label="Move ${esc(r.label)} down" ${i === all.length - 1 ? 'disabled' : ''}>${I.down}</button>
              <button class="icon-btn" data-rdel aria-label="Delete ${esc(r.label)}">${I.close}</button>
            </span>
          </div>
          <ol class="rail-items">
            ${items.map((d, j) => `
              <li data-dish="${esc(d.id)}">
                <span class="ri-name">${esc(d.name)}${d.video ? ' <small class="ri-tag">video</small>' : ''}</span>
                <span class="reorder">
                  <button class="icon-btn sm" data-imove="-1" aria-label="Move ${esc(d.name)} earlier" ${j === 0 ? 'disabled' : ''}>${I.up}</button>
                  <button class="icon-btn sm" data-imove="1" aria-label="Move ${esc(d.name)} later" ${j === items.length - 1 ? 'disabled' : ''}>${I.down}</button>
                  <button class="icon-btn sm" data-iremove aria-label="Remove ${esc(d.name)} from this list">${I.close}</button>
                </span>
              </li>`).join('')}
          </ol>
          <button class="btn ghost sm" data-rpick>${I.plus}${items.length ? 'Add or remove items' : 'Choose items'}</button>
        </div>`;
      }).join('')}
      <form id="add-rail" style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <input class="input" name="label" placeholder="New list title, e.g. Chef’s picks" required style="flex:1;min-width:180px">
        <input class="input" name="eyebrow" placeholder="Subtitle (optional)" style="flex:1;min-width:160px">
        <button class="btn" type="submit">${I.plus}Add list</button>
      </form>
    </div>
    <div class="panel" id="badges-panel">
      <h3>Badges</h3>
      <p>Small labels on an item, e.g. “Bestseller” or “Chef’s special”. Tick them per item in the item editor.</p>
      ${Object.keys(menu.badges || {}).length ? '' : '<p class="hint">No badges yet. Add one below.</p>'}
      ${Object.entries(menu.badges || {}).map(([k, b]) => {
        const n = menu.dishes.filter((d) => (d.badges || []).includes(k)).length;
        return `
        <div class="cat-row badge-row" data-badge="${esc(k)}">
          <label class="field">Label<input value="${esc(b.label)}" data-bk="label" maxlength="24"></label>
          <label class="field">Style<select data-bk="tone">${BADGE_TONES.map(([t, l]) => `<option value="${t}" ${(b.tone || 'neutral') === t ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <span></span>
          <span class="count">${n} item${n === 1 ? '' : 's'}</span>
          <span class="reorder"><button class="icon-btn" data-bdel aria-label="Delete badge ${esc(b.label)}">${I.close}</button></span>
        </div>`;
      }).join('')}
      <form id="add-badge" style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <input class="input" name="label" placeholder="New badge, e.g. Chef’s special" required maxlength="24" style="flex:1;min-width:180px">
        <select class="input" name="tone" style="flex:0 0 170px">${BADGE_TONES.map(([t, l]) => `<option value="${t}">${l}</option>`).join('')}</select>
        <button class="btn" type="submit">${I.plus}Add badge</button>
      </form>
    </div>`;

  const bp = $('#badges-panel');
  bp.addEventListener('input', (e) => {
    const row = e.target.closest('[data-badge]');
    const k = e.target.dataset.bk;
    if (!row || !k) return;
    const b = menu.badges[row.dataset.badge];
    b[k] = k === 'label' ? e.target.value.trim() || b.label : e.target.value;
    setDirty();
  });
  bp.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-badge]');
    if (!row || !e.target.closest('[data-bdel]')) return;
    const key = row.dataset.badge;
    const n = menu.dishes.filter((d) => (d.badges || []).includes(key)).length;
    const ok = await confirmDialog({
      title: `Delete the “${menu.badges[key].label}” badge?`,
      body: `${n ? `It's removed from ${n} item${n === 1 ? '' : 's'}; the items stay on the menu. ` : ''}Takes effect when you Save & publish.`,
      confirm: 'Delete badge', danger: true,
    });
    if (!ok) return;
    delete menu.badges[key];
    for (const d of menu.dishes) d.badges = (d.badges || []).filter((b) => b !== key);
    setDirty();
    renderCategories();
  });
  $('#add-badge').onsubmit = (e) => {
    e.preventDefault();
    const label = e.target.elements.label.value.trim();
    if (!label) return;
    menu.badges ||= {};
    if (Object.values(menu.badges).some((b) => b.label.toLowerCase() === label.toLowerCase())) return toast(`There's already a “${label}” badge.`, true);
    const base = slugify(label) || 'badge';
    let key = base;
    let n = 2;
    while (menu.badges[key]) key = `${base}-${n++}`;
    menu.badges[key] = { label, tone: e.target.elements.tone.value };
    setDirty();
    renderCategories();
    toast(`Added the “${label}” badge. Tick it on items in the item editor.`);
  };

  v.oninput = (e) => {
    const row = e.target.closest('[data-sec]');
    const k = e.target.dataset.k;
    if (!row || !k) return;
    const sec = menu.sections.find((s) => s.id === row.dataset.sec);
    sec[k] = e.target.value;
    setDirty();
  };
  v.onclick = async (e) => {
    const row = e.target.closest('[data-sec]');
    const mv = e.target.closest('[data-smove]');
    const sec = row && menu.sections.find((s) => s.id === row.dataset.sec);
    if (sec?.type === 'tag') {
      if (mv) {
        const list = rails();
        const other = list[list.indexOf(sec) + Number(mv.dataset.smove)];
        if (!other) return;
        const a = menu.sections.indexOf(sec);
        const b = menu.sections.indexOf(other);
        [menu.sections[a], menu.sections[b]] = [menu.sections[b], menu.sections[a]];
        setDirty();
        return renderCategories();
      }
      const li = e.target.closest('[data-dish]');
      if (li && e.target.closest('[data-imove]')) {
        const ids = railItems(sec).map((d) => d.id);
        const i = ids.indexOf(li.dataset.dish);
        const j = i + Number(e.target.closest('[data-imove]').dataset.imove);
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        sec.order = ids;
        setDirty();
        return renderCategories();
      }
      if (li && e.target.closest('[data-iremove]')) {
        const d = menu.dishes.find((x) => x.id === li.dataset.dish);
        if (d) d.tags = d.tags.filter((t) => t !== sec.match);
        sec.order = (sec.order || []).filter((id) => id !== li.dataset.dish);
        setDirty();
        return renderCategories();
      }
      if (e.target.closest('[data-rpick]')) return pickRailItems(sec);
      if (e.target.closest('[data-rdel]')) {
        const n = railItems(sec).length;
        const ok = await confirmDialog({
          title: `Delete “${sec.label.replaceAll('{name}', menu.name)}”?`,
          body: `The list disappears from the menu${n ? ` and its ${n} item${n === 1 ? '' : 's'} stay on the menu as usual` : ''}. Takes effect when you Save & publish.`,
          confirm: 'Delete list', danger: true,
        });
        if (!ok) return;
        if (sec.match !== 'bestseller') for (const d of menu.dishes) d.tags = (d.tags || []).filter((t) => t !== sec.match);
        menu.sections = menu.sections.filter((s) => s !== sec);
        setDirty();
        return renderCategories();
      }
      return;
    }
    if (row && mv) {
      const list = categories();
      const c = list.find((s) => s.id === row.dataset.sec);
      const other = list[list.indexOf(c) + Number(mv.dataset.smove)];
      if (!other) return;
      const a = menu.sections.indexOf(c);
      const b = menu.sections.indexOf(other);
      [menu.sections[a], menu.sections[b]] = [menu.sections[b], menu.sections[a]];
      setDirty();
      renderCategories();
    }
    if (row && e.target.closest('[data-sdel]')) {
      menu.sections = menu.sections.filter((s) => s.id !== row.dataset.sec);
      setDirty();
      renderCategories();
    }
  };
  $('#add-cat').onsubmit = (e) => {
    e.preventDefault();
    const label = e.target.label.value.trim();
    if (!label) return;
    let id = slugify(label);
    let n = 2;
    while (menu.sections.some((s) => s.id === id)) id = `${slugify(label)}-${n++}`;
    menu.sections.push({ id, label, type: 'category', match: id, group: e.target.group.value });
    setDirty();
    renderCategories();
    toast(`Added “${label}”.`);
  };
  $('#add-rail').onsubmit = (e) => {
    e.preventDefault();
    const label = e.target.elements.label.value.trim();
    if (!label) return;
    const base = slugify(label) || 'featured';
    let id = base;
    let n = 2;
    while (id === 'bestseller' || menu.sections.some((s) => s.id === id || s.match === id)) id = `${base}-${n++}`;
    const sec = { id, label, type: 'tag', match: id, eyebrow: e.target.elements.eyebrow.value.trim(), order: [] };
    // New lists go after the existing featured lists.
    const last = rails().at(-1);
    menu.sections.splice(last ? menu.sections.indexOf(last) + 1 : 0, 0, sec);
    setDirty();
    renderCategories();
    pickRailItems(sec);
  };
}

/* Items in a featured list, in the order guests see them. */
function railItems(r) {
  const list = menu.dishes.filter((d) => d.tags?.includes(r.match));
  const rank = (d) => { const i = (r.order || []).indexOf(d.id); return i < 0 ? 1e9 : i; };
  return list.sort((a, b) => rank(a) - rank(b));
}

/* Tick which items belong in a featured list. */
async function pickRailItems(sec) {
  const title = sec.label.replaceAll('{name}', menu.name);
  const groups = categories().map((c) => [c.label, menu.dishes.filter((d) => d.category === c.match)])
    .concat([['Other', menu.dishes.filter((d) => !categories().some((c) => c.match === d.category))]])
    .filter(([, list]) => list.length);
  let picks = [];
  const v = await openDialog({
    title: `Items in “${title}”`,
    wide: true,
    body: `
      <input class="input" type="search" placeholder="Search items" data-pick-search style="width:100%;margin-bottom:10px">
      ${menu.dishes.length ? groups.map(([label, list]) => `
        <div class="pick-group"><p class="pick-head">${esc(label)}</p>
          ${list.map((d) => `<label class="check pick-item" data-name="${esc(d.name.toLowerCase())}"><input type="checkbox" value="${esc(d.id)}" ${d.tags?.includes(sec.match) ? 'checked' : ''}>${esc(d.name)}${d.video ? ' <small class="ri-tag">video</small>' : ''}</label>`).join('')}
        </div>`).join('') : '<p class="hint">Add some items to your menu first.</p>'}`,
    buttons: [{ label: 'Cancel', value: 'no', kind: 'ghost' }, { label: 'Done', value: 'yes', submit: true }],
    onOpen: (d) => {
      d.querySelector('[data-pick-search]').oninput = (e) => {
        const q = e.target.value.trim().toLowerCase();
        for (const el of d.querySelectorAll('.pick-item')) el.hidden = Boolean(q) && !el.dataset.name.includes(q);
        for (const g of d.querySelectorAll('.pick-group')) g.hidden = ![...g.querySelectorAll('.pick-item')].some((el) => !el.hidden);
      };
      d.addEventListener('submit', () => {
        picks = [...d.querySelectorAll('.pick-item input:checked')].map((i) => i.value);
      });
    },
  });
  if (v !== 'yes') return;
  const picked = new Set(picks);
  const before = railItems(sec).map((d) => d.id);
  for (const d of menu.dishes) {
    const has = d.tags?.includes(sec.match);
    if (picked.has(d.id) && !has) d.tags = [...(d.tags || []), sec.match];
    if (!picked.has(d.id) && has) d.tags = d.tags.filter((t) => t !== sec.match);
  }
  sec.order = before.filter((id) => picked.has(id)).concat([...picked].filter((id) => !before.includes(id)));
  setDirty();
  renderCategories();
  toast(`“${title}” now has ${picked.size} item${picked.size === 1 ? '' : 's'}.`);
}

/* ==========================================================
   Branding (owner-only theme)
   ========================================================== */
function renderBranding() {
  const v = $('#view');
  const t = menu.theme || {};
  v.innerHTML = `
    <div class="panel">
      <h3>Restaurant</h3>
      <div class="brand-grid" style="margin-top:12px">
        <label class="field">Name<input data-b="name" value="${esc(menu.name)}"></label>
        <label class="field">Tagline<input data-b="tagline" value="${esc(menu.tagline || '')}" placeholder="e.g. Specialty coffee · Janakpuri"></label>
        <label class="field">Who signs the notes<input data-b="chef" value="${esc(menu.chef || '')}" placeholder="e.g. Chef Karim"></label>
        <label class="field">Currency<select data-b="currency">${['INR', 'AED', 'USD', 'EUR', 'GBP'].map((c) => `<option ${menu.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      </div>
      <label class="field" style="margin-top:12px">Footer note<input data-b="footerNote" value="${esc(menu.footerNote || '')}"></label>
    </div>
    <div class="panel">
      <h3>Logo</h3>
      <div class="logo-edit" style="margin-top:10px">
        ${menu.logo ? `<img data-media="${esc(menu.logo)}" alt="Logo">` : `<div class="mono" style="background:${esc(t.primary)};color:#0b0b0b">${esc((menu.name || '?')[0])}</div>`}
        <label class="btn ghost sm">Upload logo<input type="file" accept="image/*" id="logo-file" class="sr-only"></label>
        ${menu.logo ? '<button class="btn ghost sm" id="logo-remove">Remove</button>' : ''}
      </div>
      <p class="hint" style="margin-top:8px">Square image, at least 256×256. Without a logo we show your first letter.</p>
    </div>
    <div class="panel">
      <h3>Colours</h3>
      <p>Background is the whole menu page; text switches to light or dark automatically so it stays readable. Primary is used for buttons, the Add control and active filters; secondary for badges.</p>
      <div class="brand-grid">
        <label class="field">Page background<span class="color-field"><input type="color" data-c="background" value="${esc(t.background || '#fbf6ef')}"><input class="input" data-ch="background" value="${esc(t.background || '#fbf6ef')}" maxlength="7"></span>
          ${t.background ? '<button type="button" class="btn ghost sm" id="bg-reset" style="margin-top:6px;align-self:flex-start">Use default cream</button>' : ''}</label>
        <label class="field">Primary<span class="color-field"><input type="color" data-c="primary" value="${esc(t.primary || '#d4a373')}"><input class="input" data-ch="primary" value="${esc(t.primary || '#d4a373')}" maxlength="7"></span></label>
        <label class="field">Secondary<span class="color-field"><input type="color" data-c="secondary" value="${esc(t.secondary || '#6b8f4e')}"><input class="input" data-ch="secondary" value="${esc(t.secondary || '#6b8f4e')}" maxlength="7"></span></label>
      </div>
      <div class="preview-strip" style="margin-top:14px" id="pv"></div>
    </div>
    <div class="panel">
      <h3>Spotlight video</h3>
      <p>A full-width video of one signature dish at the top of the menu, with its price and an Add button. Off by default.</p>
      <label class="order-switch">
        <input type="checkbox" id="hero-on" role="switch" ${menu.hero?.enabled ? 'checked' : ''}>
        <span class="os-track" aria-hidden="true"></span>
        <span class="os-label">Spotlight <b>${menu.hero?.enabled ? 'On' : 'Off'}</b></span>
      </label>
      <div class="brand-grid" style="margin-top:12px">
        <label class="field">Dish
          <select id="hero-dish" ${menu.hero?.enabled ? '' : 'disabled'}>
            <option value="">Automatic: first video in your featured list</option>
            ${menu.dishes.filter((d) => d.video || d.image).map((d) => `<option value="${esc(d.id)}" ${menu.hero?.dishId === d.id ? 'selected' : ''}>${esc(d.name)}${d.video ? ' · video' : ' · photo'}</option>`).join('')}
          </select>
        </label>
        <label class="field">Heading <small>(optional)</small>
          <input id="hero-label" value="${esc(menu.hero?.label || '')}" placeholder="Tonight’s spotlight" maxlength="40" ${menu.hero?.enabled ? '' : 'disabled'}>
        </label>
      </div>
      <p class="hint" style="margin-top:8px">Changes go live when you Save &amp; publish. Sold-out dishes are skipped automatically.</p>
    </div>
    <div class="panel">
      <h3>Reviews &amp; Instagram</h3>
      <p>Shown as two buttons at the bottom of the menu. Leave a box empty to hide its button.</p>
      <div class="brand-grid" style="margin-top:12px">
        <label class="field">Google review link
          <input data-link="google" type="url" inputmode="url" value="${esc(menu.links?.google || '')}" placeholder="https://g.page/r/…/review">
        </label>
        <label class="field">Instagram
          <input data-link="instagram" inputmode="url" value="${esc(menu.links?.instagram || '')}" placeholder="@yourcafe or instagram.com/yourcafe">
        </label>
      </div>
      <p class="hint link-err" id="link-err" role="alert" style="margin-top:8px">Google review link: open your Google Business Profile, choose “Ask for reviews” and copy the link.</p>
    </div>`;
  hydrate(v);
  // Links are checked here and again in the guest app; only https links to Google / Instagram are kept.
  const LINK_HINT = $('#link-err').textContent;
  $$('[data-link]', v).forEach((input) => {
    input.addEventListener('input', (e) => {
      e.stopPropagation();
      const key = input.dataset.link;
      const val = input.value.trim();
      const clean = key === 'google' ? cleanGoogleLink(val) : cleanInstagram(val);
      const err = $('#link-err');
      if (val && !clean) {
        err.textContent = key === 'google' ? 'That doesn’t look like a Google review link (it should start with https:// and be on google.com or g.page).' : 'Enter an Instagram handle like @yourcafe or an instagram.com link.';
        err.classList.add('bad');
        return;
      }
      err.textContent = LINK_HINT;
      err.classList.remove('bad');
      menu.links = { ...(menu.links || {}), [key]: clean || undefined };
      if (!menu.links.google && !menu.links.instagram) delete menu.links;
      setDirty();
    });
  });
  const setHero = (patch) => {
    menu.hero = { ...(menu.hero || {}), ...patch };
    if (!menu.hero.dishId) delete menu.hero.dishId;
    if (!menu.hero.label) delete menu.hero.label;
    setDirty();
  };
  $('#hero-on').onchange = (e) => {
    setHero({ enabled: e.target.checked });
    $('#hero-on').closest('.panel').querySelector('.os-label b').textContent = e.target.checked ? 'On' : 'Off';
    $('#hero-dish').disabled = !e.target.checked;
    $('#hero-label').disabled = !e.target.checked;
  };
  $('#hero-dish').onchange = (e) => setHero({ dishId: e.target.value });
  $('#hero-label').oninput = (e) => { e.stopPropagation(); setHero({ label: e.target.value.trim() }); };
  const paintPreview = () => {
    const p = menu.theme.primary; const s = menu.theme.secondary;
    const bg = menu.theme.background || '#fbf6ef';
    const ink = readableInk(bg);
    $('#pv').style.cssText = `margin-top:14px;background:${esc(bg)};color:${ink};padding:14px;border-radius:12px;border:1px solid rgba(127,127,127,.25)`;
    $('#pv').innerHTML = `
      <span class="pv-chip" style="background:${esc(p)};color:${readableInk(p)}">Popular</span>
      <span class="pv-chip" style="background:transparent;color:${ink};border:1px solid currentColor;opacity:.8">Veg</span>
      <span style="color:${ink};font-weight:600">₹329</span>
      <span style="color:${ink};opacity:.7;font-size:13px">Menu text</span>
      <span class="pv-chip" style="background:${esc(s)};color:${readableInk(s)};height:24px;font-size:11px">Signature</span>`;
  };
  paintPreview();
  v.oninput = (e) => {
    const b = e.target.dataset.b;
    if (b) { menu[b] = e.target.value; setDirty(); if (b === 'name') $('.rest').textContent = e.target.value; return; }
    const c = e.target.dataset.c || e.target.dataset.ch;
    if (c) {
      const val = e.target.value.trim();
      if (!/^#[0-9a-f]{6}$/i.test(val)) return;
      menu.theme[c] = val;
      $(`[data-c=${c}]`).value = val;
      $(`[data-ch=${c}]`).value = val;
      applyTheme();
      paintPreview();
      setDirty();
    }
  };
  const bgReset = $('#bg-reset');
  if (bgReset) bgReset.onclick = () => { delete menu.theme.background; setDirty(); renderBranding(); };
  v.onchange = (e) => { if (e.target.dataset.b === 'currency') { menu.currency = e.target.value; setDirty(); } };
  $('#logo-file').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const blob = await compressImage(file, 512);
      menu.logo = await uploadMedia(slug, blob, 'brand', MODE === 'live' ? 'supabase' : 'local');
      setDirty();
      renderBranding();
    } catch (err) { toast(`Logo upload failed: ${err.message || err}`, true); }
  };
  $('#logo-remove')?.addEventListener('click', () => { menu.logo = null; setDirty(); renderBranding(); });
}

function cleanGoogleLink(v) {
  try {
    const u = new URL(v);
    const host = u.hostname.replace(/^www\./, '');
    const ok = u.protocol === 'https:' && (host === 'g.page' || host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'search.google.com' || /^google\.[a-z.]+$/.test(host) || host === 'maps.google.com');
    return ok ? u.href : '';
  } catch { return ''; }
}
function cleanInstagram(v) {
  const handle = v.replace(/^@/, '').match(/^[A-Za-z0-9._]{1,30}$/);
  if (handle) return `https://www.instagram.com/${handle[0]}/`;
  try {
    const u = new URL(/^https?:/i.test(v) ? v : `https://${v}`);
    const name = u.pathname.split('/').filter(Boolean)[0] || '';
    return /(^|\.)instagram\.com$/.test(u.hostname) && /^[A-Za-z0-9._]{1,30}$/.test(name) ? `https://www.instagram.com/${name}/` : '';
  } catch { return ''; }
}

boot().catch((err) => fatal(`Something went wrong: ${err.message || err}`));
