/* ==========================================================
   NomNom super admin: Partners panel
   - Every restaurant with its status, owner, counts, menu link and main QR code
   - Add a restaurant (creates its menu row + partner details), then build its menu
   - Send / resend the owner's welcome email (Edge Function invite-owner)
   Needs supabase/admin.sql.
   ========================================================== */
import { openDialog, confirmDialog } from './dialog.js';
import { loadQrLib, qrSvg } from './ops.js';
import { CONFIG } from '../assets/js/config.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

let ctx; // { sb, root, toast, signOut, userId }
let list = [];

// Links and QR codes always point at the public menu site, wherever this dashboard is opened from.
const menuBase = () => 'https://menu.heynomnom.in/';
export const menuUrl = (slug) => `${menuBase()}?r=${encodeURIComponent(slug)}`;
const editUrl = (slug) => `?r=${encodeURIComponent(slug)}`;

function ago(ts) {
  if (!ts) return 'never';
  const s = (Date.now() - new Date(ts)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function status(p) {
  if (p.archived_at) return ['paused', `Archived ${ago(p.archived_at)} · menu & QR off`];
  if (p.suspended) return ['paused', 'Paused · menu & QR off'];
  if (!p.published) return ['draft', 'Menu not published'];
  if (p.owner_last_sign_in) return ['live', 'Live · owner active'];
  if (p.invited_at) return ['invited', 'Live · owner invited'];
  if (p.owner_linked) return ['live', 'Live'];
  return ['live', 'Live · owner not invited'];
}

export async function renderPartners(c) {
  ctx = c;
  document.title = 'Partners · NomNom';
  ctx.root.innerHTML = `
    <header class="top">
      <span class="product">NomNom <span>Super admin</span></span>
      <span class="rest">Partners</span>
      <div class="top-actions">
        <button class="btn sm" id="p-add">+ Add restaurant</button>
        <button class="btn ghost sm" id="p-signout">Sign out</button>
      </div>
    </header>
    <main class="view wide" id="p-view"><p class="empty-note">Loading partners…</p></main>`;
  $('#p-add').onclick = addRestaurant;
  $('#p-signout').onclick = ctx.signOut;
  await load();
}

async function load() {
  const view = $('#p-view');
  const { data, error } = await ctx.sb.rpc('admin_partners');
  if (error) {
    view.innerHTML = `<p class="error">Couldn't load partners: ${esc(error.message)}</p>`;
    return;
  }
  list = data || [];
  // WhatsApp Ordering lives in each menu's data (see supabase/whatsapp-ordering.sql).
  const { data: wa } = await ctx.sb.from('menus').select('slug, wa:data->whatsappOrdering');
  const waBySlug = new Map((wa || []).map((r) => [r.slug, r.wa || {}]));
  list.forEach((p) => { p.wa = waBySlug.get(p.slug) || {}; });
  try { await loadQrLib(); } catch { /* QR thumbnails stay empty; the dialog shows the error */ }
  const current = list.filter((p) => !p.archived_at);
  const live = current.filter((p) => p.published && !p.suspended).length;
  const paused = current.filter((p) => p.suspended).length;
  const active = current.filter((p) => p.owner_last_sign_in).length;
  view.innerHTML = `
    <div class="p-kpis">
      <div class="kpi"><span>Active restaurants</span><b>${current.length - paused}</b></div>
      <div class="kpi"><span>Menus live</span><b>${live}</b></div>
      <div class="kpi"><span>Owners signed in</span><b>${active}</b></div>
      <div class="kpi"><span>Paused</span><b>${paused}</b></div>
    </div>
    <div class="p-tools"><input class="input" id="p-search" type="search" placeholder="Search by name, link, owner or city" aria-label="Search partners"></div>
    <div class="p-list" id="p-list"></div>`;
  $('#p-search').oninput = (e) => drawList(e.target.value);
  drawList('');
}

function drawList(q) {
  const el = $('#p-list');
  const needle = q.trim().toLowerCase();
  const rows = list.filter((p) => !needle || [p.name, p.slug, p.owner_email, p.owner_phone, p.city].some((v) => String(v || '').toLowerCase().includes(needle)));
  if (!rows.length) { el.innerHTML = `<p class="empty-note">${list.length ? 'No match.' : 'No restaurants yet. Use “Add restaurant”.'}</p>`; return; }
  // Paused, then archived restaurants live in their own sections below the active ones.
  const activeRows = rows.filter((p) => !p.suspended && !p.archived_at);
  const pausedRows = rows.filter((p) => p.suspended && !p.archived_at);
  const archivedRows = rows.filter((p) => p.archived_at);
  const split = pausedRows.length || archivedRows.length;
  el.innerHTML = `
    ${split ? `<h2 class="p-sec first">Active <small>${activeRows.length}</small></h2>` : ''}
    ${activeRows.length ? activeRows.map(card).join('') : '<p class="empty-note">No active restaurants match.</p>'}
    ${pausedRows.length ? `<h2 class="p-sec">Paused <small>${pausedRows.length} · menu link and QR codes are off</small></h2>${pausedRows.map(card).join('')}` : ''}
    ${archivedRows.length ? `<h2 class="p-sec">Archived <small>${archivedRows.length} · menu link and QR codes are off · restore or delete for good</small></h2>${archivedRows.map(card).join('')}` : ''}`;
  el.onclick = onListClick;
}

function card(p) {
    const [tone, label] = status(p);
    const url = menuUrl(p.slug);
    let qr = '';
    try { qr = window.qrcode ? qrSvg(url, 92) : ''; } catch { /* ignore */ }
    return `
    <article class="p-card${p.suspended || p.archived_at ? ' is-paused' : ''}${p.archived_at ? ' is-archived' : ''}" data-slug="${esc(p.slug)}">
      <button class="p-qr" data-act="qr" aria-label="Main QR code for ${esc(p.name)}">${qr}</button>
      <div class="p-main">
        <div class="p-head"><h3>${esc(p.name)}</h3><span class="pill ${tone}">${label}</span></div>
        <p class="p-link"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url.replace(/^https?:\/\//, ''))}</a>
          <button class="link-btn" data-act="copy">Copy</button></p>
        <p class="p-meta">${p.items} dishes · ${p.videos} videos · ${p.photos} photos · table ordering ${p.ordering ? 'on' : 'off'} · updated ${ago(p.updated_at)}</p>
        <p class="p-meta">${p.owner_email ? esc(p.owner_email) : '<i>no owner email</i>'}${p.owner_phone ? ` · ${esc(p.owner_phone)}` : ''}${p.city ? ` · ${esc(p.city)}` : ''}
          · owner last signed in ${ago(p.owner_last_sign_in)}${p.invited_at ? ` · invited ${ago(p.invited_at)}` : ''}</p>
        ${p.archived_at ? '' : `<label class="p-wa" title="Guests add dishes to a cart, enter name, phone and address, and send the order to the restaurant on WhatsApp.">
          <input type="checkbox" role="switch" data-act="wa" ${p.wa.enabled ? 'checked' : ''}>
          <span><b>WhatsApp Ordering ${p.wa.enabled ? 'on' : 'off'}</b>${p.wa.enabled ? ` <small>orders go to ${esc(p.wa.phone || 'no number yet: add it in the menu’s Orders tab')}</small>` : ''}</span></label>`}
      </div>
      <div class="p-actions">${p.archived_at ? `
        <button class="btn sm" data-act="restore">Restore</button>
        <button class="btn ghost sm" data-act="details">Details</button>
        <button class="btn danger sm" data-act="delete">Delete for good</button>` : `
        <button class="btn sm" data-act="edit">Edit menu</button>
        <button class="btn ghost sm" data-act="qr">QR code</button>
        <button class="btn ghost sm" data-act="invite">${p.invited_at ? 'Resend welcome email' : 'Send welcome email'}</button>
        <button class="btn ghost sm" data-act="details">Details</button>
        <button class="btn ${p.suspended ? 'sm' : 'danger sm'}" data-act="pause">${p.suspended ? 'Resume menu' : 'Pause menu'}</button>
        <button class="btn ghost sm" data-act="archive">Archive</button>`}
      </div>
    </article>`;
}

async function onListClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const p = list.find((x) => x.slug === b.closest('[data-slug]').dataset.slug);
    const act = b.dataset.act;
    if (act === 'copy') { await navigator.clipboard.writeText(menuUrl(p.slug)).catch(() => {}); ctx.toast('Menu link copied.'); }
    if (act === 'qr') showQr(p);
    if (act === 'edit') editMenu(p);
    if (act === 'invite') invite(p);
    if (act === 'details') details(p);
    if (act === 'pause') setPaused(p, !p.suspended);
    if (act === 'archive') archive(p);
    if (act === 'restore') restore(p);
    if (act === 'delete') removeForGood(p);
    if (act === 'wa') setWhatsapp(p, b.checked, b);
}

/* ---------- WhatsApp Ordering (e.g. cloud kitchens): guests send their cart to the restaurant on WhatsApp ---------- */
const waDigits = (phone) => String(phone || '').replace(/\D/g, '').replace(/^0+/, '').replace(/^(?=\d{10}$)/, '91');
async function setWhatsapp(p, on, input) {
  const phone = p.wa.phone || (p.owner_phone ? waDigits(p.owner_phone) : '');
  const ok = await confirmDialog({
    title: `Turn WhatsApp Ordering ${on ? 'on' : 'off'} for ${p.name}?`,
    body: on
      ? `Guests on <b>${esc(p.name)}</b>'s menu can add dishes to a cart, enter their name, phone and address, and send the order on WhatsApp
        to <b>${esc(phone ? `+${phone}` : 'the restaurant')}</b>. At checkout they can also see the restaurant's UPI payment QR.
        ${phone ? '' : '<br><br>There\'s no WhatsApp number yet: add it in the menu\'s <b>Orders</b> tab (or the owner\'s phone in Details) before guests can order.'}
        ${p.wa.phone ? '' : p.owner_phone ? `<br><br>Orders go to the owner's phone from Details. The owner can change it in their <b>Orders</b> tab, and add a UPI ID or payment QR.` : ''}`
      : `Guests on <b>${esc(p.name)}</b>'s menu won't be able to order on WhatsApp any more. Their number, UPI ID and QR are kept.`,
    confirm: on ? 'Turn on' : 'Turn off',
  });
  if (!ok) { input.checked = !on; return; }
  input.disabled = true;
  const { data: row, error } = await ctx.sb.from('menus').select('data').eq('slug', p.slug).single();
  if (!error && !(row?.data && Object.keys(row.data).length)) {
    input.checked = !on; input.disabled = false;
    ctx.toast('Publish the menu first, then turn on WhatsApp Ordering.', true);
    return;
  }
  const next = row?.data ? { ...row.data, whatsappOrdering: { ...(row.data.whatsappOrdering || {}), enabled: on, ...(on && !row.data.whatsappOrdering?.phone && phone ? { phone } : {}) } } : null;
  const res = error ? { error } : await ctx.sb.from('menus').update({ data: next }, { count: 'exact' }).eq('slug', p.slug);
  input.disabled = false;
  if (res.error || res.count === 0) {
    input.checked = !on;
    ctx.toast(`Couldn't change WhatsApp Ordering: ${res.error?.message || 'not allowed'}`, true);
    return;
  }
  ctx.toast(on ? `WhatsApp Ordering is ON for ${p.name}.` : `WhatsApp Ordering is OFF for ${p.name}.`);
  load();
}

const needsSql = (msg) => /archived_at|admin_delete_restaurant/.test(msg || '');

/* ---------- Archive: off the active list, menu and QR codes off, nothing deleted yet ---------- */
async function archive(p) {
  const ok = await confirmDialog({
    title: `Archive ${p.name}?`,
    body: `It moves to <b>Archived</b> at the bottom of this list. Its menu link and every QR code show “Menu unavailable”, and table ordering stops.
      Nothing is deleted: you can restore it, or delete it for good from the Archived section.`,
    confirm: 'Archive',
    danger: true,
  });
  if (!ok) return;
  const { error, count } = await ctx.sb.from('menus').update({ archived_at: new Date().toISOString() }, { count: 'exact' }).eq('slug', p.slug);
  if (error || count === 0) {
    const msg = error?.message || 'not allowed';
    ctx.toast(needsSql(msg) ? 'Run supabase/archive.sql in Supabase first.' : `Couldn't archive: ${msg}`, true);
    return;
  }
  ctx.toast(`${p.name} is archived. Its menu and QR codes now show “Menu unavailable”.`);
  load();
}

async function restore(p) {
  const ok = await confirmDialog({
    title: `Restore ${p.name}?`,
    body: `It goes back to the active list, and its menu link, all QR codes and table ordering (if switched on) work again right away.`,
    confirm: 'Restore',
  });
  if (!ok) return;
  const { error, count } = await ctx.sb.from('menus').update({ archived_at: null, suspended: false }, { count: 'exact' }).eq('slug', p.slug);
  if (error || count === 0) { ctx.toast(`Couldn't restore: ${error?.message || 'not allowed'}`, true); return; }
  ctx.toast(`${p.name} is live again.`);
  load();
}

/* ---------- Delete for good (archived only): menu, details, orders, photos and videos ---------- */
async function removeForGood(p) {
  const v = await openDialog({
    title: `Delete ${p.name} for good?`,
    body: `<p>This permanently deletes the menu, its photos and videos, partner details and every order. It can't be undone.
      The owner's login stays, but has no restaurant any more.</p>
      <label class="field">Type <b>${esc(p.slug)}</b> to confirm<input class="input" name="confirm" autocomplete="off" spellcheck="false"></label>
      <p class="error" id="dlg-err" role="alert"></p>`,
    buttons: [{ label: 'Cancel', value: 'no', kind: 'ghost' }, {
      label: 'Delete for good', value: 'yes', kind: 'danger', submit: true,
      check: (d) => {
        const ok = d.querySelector('[name=confirm]').value.trim().toLowerCase() === p.slug;
        if (!ok) $('#dlg-err', d).textContent = `Type ${p.slug} exactly.`;
        return ok;
      },
    }],
    onOpen: (d) => d.querySelector('[name=confirm]').focus(),
  });
  if (v !== 'yes') return;
  ctx.toast(`Deleting ${p.name}…`);
  let mediaErr = '';
  try { await deleteMedia(p.slug); } catch (e) { mediaErr = e.message || String(e); }
  const { error } = await ctx.sb.rpc('admin_delete_restaurant', { p_slug: p.slug });
  if (error) {
    ctx.toast(needsSql(error.message) ? 'Run supabase/archive.sql in Supabase first.' : `Couldn't delete: ${error.message}`, true);
    return;
  }
  ctx.toast(mediaErr ? `${p.name} is deleted, but some files couldn't be removed: ${mediaErr}` : `${p.name} is deleted.`, Boolean(mediaErr));
  load();
}

/** Remove every file under <slug>/ in the media bucket (folders are listed one level at a time). */
async function deleteMedia(slug) {
  const bucket = ctx.sb.storage.from(CONFIG.mediaBucket);
  const files = [];
  const walk = async (dir) => {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await bucket.list(dir, { limit: 1000, offset });
      if (error) throw error;
      for (const f of data || []) {
        if (f.id) files.push(`${dir}/${f.name}`);
        else await walk(`${dir}/${f.name}`); // a folder
      }
      if (!data || data.length < 1000) break;
    }
  };
  await walk(slug);
  for (let i = 0; i < files.length; i += 100) {
    const { error } = await bucket.remove(files.slice(i, i + 100));
    if (error) throw error;
  }
}

/* ---------- Pause / resume (e.g. unpaid): the link and every QR code stop working ---------- */
async function setPaused(p, pause) {
  const ok = await confirmDialog({
    title: pause ? `Pause ${p.name}'s menu?` : `Resume ${p.name}'s menu?`,
    body: pause
      ? `Guests opening <b>${esc(menuUrl(p.slug).replace(/^https?:\/\//, ''))}</b> or scanning any of its QR codes (main and table cards) will see “Menu unavailable”, and table ordering stops. The owner can still sign in. Nothing is deleted; you can resume any time.`
      : `The menu link, all QR codes and table ordering (if switched on) work again right away.`,
    confirm: pause ? 'Pause menu' : 'Resume menu',
    danger: pause,
  });
  if (!ok) return;
  const { error, count } = await ctx.sb.from('menus').update({ suspended: pause }, { count: 'exact' }).eq('slug', p.slug);
  if (error || count === 0) {
    const msg = error?.message || 'not allowed';
    ctx.toast(/suspended/.test(msg) ? 'Run supabase/pause-and-cleanup.sql in Supabase first.' : `Couldn't ${pause ? 'pause' : 'resume'}: ${msg}`, true);
    return;
  }
  ctx.toast(pause ? `${p.name} is paused. Its menu and QR codes now show “Menu unavailable”.` : `${p.name} is live again.`);
  load();
}

/* ---------- Edit a partner's menu: always ask first ---------- */
export async function editMenu(p) {
  const ok = await confirmDialog({
    title: `Edit ${p.name}'s menu?`,
    body: p.published
      ? `This is a live menu. Guests at <b>${esc(p.name)}</b> see your changes as soon as you press <b>Save &amp; publish</b>, and you'll be asked to confirm again before anything goes live.`
      : `The menu isn't live yet. Build it from a spreadsheet, a Zomato link or from scratch, then press <b>Save &amp; publish</b>.`,
    confirm: 'Open editor',
  });
  if (ok) location.href = `${editUrl(p.slug)}&confirmed`;
}

/* ---------- Main QR code (whole restaurant, no table number) ---------- */
async function showQr(p) {
  try { await loadQrLib(); } catch { ctx.toast("Couldn't load the QR code generator. Check your connection.", true); return; }
  const url = menuUrl(p.slug);
  const v = await openDialog({
    title: `${p.name} · main QR code`,
    body: `<div class="qr-big">${qrSvg(url, 260)}</div><p class="hint" style="text-align:center;word-break:break-all">${esc(url)}</p>
      <p class="hint" style="text-align:center">For table cards with table numbers, open the menu and use <b>Tables &amp; QR</b>.</p>`,
    buttons: [{ label: 'Close', value: 'close', kind: 'ghost' }, { label: 'Download SVG', value: 'svg', kind: 'ghost' }, { label: 'Download PNG', value: 'png' }],
  });
  if (v === 'svg') download(new Blob([qrSvg(url, 1024)], { type: 'image/svg+xml' }), `${p.slug}-menu-qr.svg`);
  if (v === 'png') download(await qrPoster(p.name, url), `${p.slug}-menu-qr.png`);
}

async function qrPoster(name, url) {
  const W = 1200; const H = 1500;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#111'; g.textAlign = 'center';
  g.font = '700 72px system-ui, sans-serif'; g.fillText(name, W / 2, 170, W - 120);
  g.font = '500 40px system-ui, sans-serif'; g.fillStyle = '#555'; g.fillText('Scan for the menu', W / 2, 250);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(url, 900))}`;
  await img.decode();
  g.drawImage(img, 150, 320, 900, 900);
  g.font = '500 34px system-ui, sans-serif'; g.fillStyle = '#777';
  g.fillText(url.replace(/^https?:\/\//, ''), W / 2, 1300, W - 120);
  g.font = '600 30px system-ui, sans-serif'; g.fillStyle = '#ff6a00'; g.fillText('menu powered by NomNom', W / 2, 1410);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

function download(blob, filename) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- Welcome email ---------- */
export async function invite(p, { afterPublish = false } = {}) {
  if (!p.owner_email) {
    ctx.toast("Add the owner's email first (Details).", true);
    if (!afterPublish) details(p);
    return false;
  }
  const ok = await confirmDialog({
    title: afterPublish ? 'Menu is live. Email the owner?' : `${p.invited_at ? 'Resend' : 'Send'} the welcome email?`,
    body: `NomNom will email <b>${esc(p.owner_email)}</b> from info@heynomnom.in with a link to set their password and manage
      <b>${esc(p.name)}</b>'s menu. The link works for 7 days.${p.invited_at ? ' Any earlier link stops working.' : ''} Their menu link: ${esc(menuUrl(p.slug))}`,
    confirm: 'Send email',
    cancel: afterPublish ? 'Not now' : 'Cancel',
  });
  if (!ok) return false;
  const { data, error } = await ctx.sb.functions.invoke('invite-owner', { body: { slug: p.slug } });
  let msg = error?.message;
  if (error?.context?.json) { try { msg = (await error.context.json()).error || msg; } catch { /* keep msg */ } }
  if (error) { ctx.toast(`Couldn't send the email: ${msg}`, true); return false; }
  if ($('#p-list')) load();
  if (data.welcome_url) {
    // Also hand the link over, so it can go on WhatsApp too.
    const wa = p.owner_phone ? `https://wa.me/${String(p.owner_phone).replace(/\D/g, '').replace(/^0+/, '').replace(/^(?=\d{10}$)/, '91')}?text=${encodeURIComponent(`Hi! Your NomNom dashboard for ${p.name} is ready. Set your password here (link works until ${data.expires}): ${data.welcome_url}`)}` : '';
    const v = await openDialog({
      title: data.email_sent === false ? 'New welcome link ready' : 'Welcome email sent',
      body: `<p>${data.email_sent === false ? `An email went to ${esc(p.owner_email)} less than a minute ago, so no new email was sent. Send this new link yourself (it replaces the earlier one).` : data.status === 'linked' ? `${esc(p.owner_email)} already had a login, so it's now linked to <b>${esc(p.name)}</b>.` : `Sent to <b>${esc(p.owner_email)}</b>.`}
        The link in it works for 7 days, until <b>${esc(data.expires)}</b>. Any earlier welcome link for ${esc(p.name)} no longer works.</p>
        <p class="hint" style="margin-top:10px">You can also send the same link yourself:</p>
        <input class="input" readonly value="${esc(data.welcome_url)}" style="width:100%;margin-top:6px;font-size:13px" onclick="this.select()">`,
      buttons: [{ label: 'Close', value: 'close', kind: 'ghost' }, ...(wa ? [{ label: 'Send on WhatsApp', value: 'wa', kind: 'ghost' }] : []), { label: 'Copy link', value: 'copy' }],
    });
    if (v === 'copy') { await navigator.clipboard.writeText(data.welcome_url).catch(() => {}); ctx.toast('Welcome link copied.'); }
    if (v === 'wa') window.open(wa, '_blank', 'noopener');
  } else {
    ctx.toast(`Welcome email sent to ${p.owner_email}.`);
  }
  return true;
}

/* ---------- Add / edit partner details ---------- */
function detailsForm(p = {}, isNew = false) {
  return `
    <div class="dlg-grid">
      <label class="field">Restaurant name<input class="input" name="name" required maxlength="80" value="${esc(p.name || '')}" autocomplete="off"></label>
      <label class="field">Menu link name <small>${isNew ? 'lowercase letters, numbers and dashes' : 'can\'t be changed'}</small>
        <input class="input" name="slug" required pattern="[a-z0-9-]{2,60}" value="${esc(p.slug || '')}" ${isNew ? '' : 'readonly'} autocomplete="off"></label>
      <p class="hint" id="slug-url">${esc(menuUrl(p.slug || 'your-cafe'))}</p>
      <label class="field">Owner's email <small>for their dashboard login</small><input class="input" type="email" name="email" value="${esc(p.owner_email || '')}" autocomplete="off"></label>
      <div class="grid-2">
        <label class="field">Owner's phone<input class="input" type="tel" name="phone" value="${esc(p.owner_phone || '')}" autocomplete="off"></label>
        <label class="field">City / area<input class="input" name="city" value="${esc(p.city || '')}" autocomplete="off"></label>
      </div>
      <label class="field">Notes <small>only admins see these</small><textarea class="input" name="notes" rows="2">${esc(p.notes || '')}</textarea></label>
      <p class="error" id="dlg-err" role="alert"></p>
    </div>`;
}

function readForm(d) {
  const f = d.querySelector('form');
  return {
    name: f.elements.name.value.trim(), slug: f.elements.slug.value.trim(), owner_email: f.elements.email.value.trim().toLowerCase() || null,
    owner_phone: f.elements.phone.value.trim() || null, city: f.elements.city.value.trim() || null, notes: f.elements.notes.value.trim() || null,
  };
}

function wireForm(d, isNew) {
  const f = d.querySelector('form');
  let touched = false;
  const sync = () => { $('#slug-url', d).textContent = menuUrl(f.elements.slug.value || 'your-cafe'); };
  if (isNew) {
    f.elements.name.addEventListener('input', () => { if (!touched) { f.elements.slug.value = slugify(f.elements.name.value); sync(); } });
    f.elements.slug.addEventListener('input', () => { touched = true; f.elements.slug.value = slugify(f.elements.slug.value); sync(); });
  }
  f.elements.name.focus();
}

const checkEmail = (d) => {
  const v = readForm(d);
  if (v.owner_email && !EMAIL_RE.test(v.owner_email)) { $('#dlg-err', d).textContent = 'That email doesn\'t look right.'; return false; }
  return true;
};

async function addRestaurant() {
  let values;
  const v = await openDialog({
    title: 'Add a restaurant',
    body: detailsForm({}, true),
    buttons: [{ label: 'Cancel', value: 'no', kind: 'ghost' }, { label: 'Create restaurant', value: 'yes', submit: true, check: (d) => { values = readForm(d); return checkEmail(d); } }],
    onOpen: (d) => wireForm(d, true),
  });
  if (v !== 'yes') return;
  if (list.some((p) => p.slug === values.slug)) { ctx.toast(`The link name "${values.slug}" is taken. Pick another.`, true); return; }
  const { error: e1 } = await ctx.sb.from('menus').insert({ slug: values.slug, data: {} });
  if (e1) { ctx.toast(`Couldn't create it: ${e1.message}`, true); return; }
  const { error: e2 } = await ctx.sb.from('partners').insert(values);
  if (e2) { ctx.toast(`Created the menu, but couldn't save the details: ${e2.message}`, true); }
  ctx.toast(`${values.name} added. Now build its menu.`);
  location.href = `${editUrl(values.slug)}&confirmed`;
}

async function details(p) {
  let values;
  const v = await openDialog({
    title: `${p.name} · details`,
    body: detailsForm(p, false),
    buttons: [{ label: 'Cancel', value: 'no', kind: 'ghost' }, { label: 'Save details', value: 'yes', submit: true, check: (d) => { values = readForm(d); return checkEmail(d); } }],
    onOpen: (d) => wireForm(d, false),
  });
  if (v !== 'yes') return;
  const { error } = await ctx.sb.from('partners').upsert({ ...values, slug: p.slug });
  if (error) { ctx.toast(`Couldn't save: ${error.message}`, true); return; }
  ctx.toast('Details saved.');
  load();
}

/** Partner row for one slug (used by the menu editor in admin mode). */
export async function partnerFor(sb, slug) {
  const { data } = await sb.rpc('admin_partners');
  return (data || []).find((p) => p.slug === slug) || null;
}
export function setPartnerCtx(c) { ctx = c; }
