/* ==========================================================
   Dashboard: Orders (live), Insights (history + analytics), Tables & QR (+ Wi-Fi).
   Orders and Insights need the pilot backend (Supabase). Tables & QR works in both modes.
   ========================================================== */

const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pref = {
  get(k) { try { return localStorage.getItem(`qrdash:${k}`); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`qrdash:${k}`, v); } catch { /* private mode */ } },
};

let ctx; // { sb, slug, menu: () => menu, fmt, toast, setDirty, mode, onOrdersChange }
const orders = new Map(); // id -> order (today + anything still open)
let channel = null;
let live = 'off'; // off | connecting | live | error
let pollTimer = null;
let ringTimer = null;
let audio = null;
let wakeLock = null;
const baseTitle = () => `${ctx.menu().name} · Dashboard`;

/* ---------- Time helpers (India time for "today") ---------- */
const IST = 'Asia/Kolkata';
const dayKey = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: IST }); // YYYY-MM-DD
const hourOf = (d) => Number(new Date(d).toLocaleString('en-GB', { timeZone: IST, hour: '2-digit', hour12: false }));
function startOfDayIST(offsetDays = 0) {
  const key = dayKey(Date.now() - offsetDays * 864e5);
  return new Date(`${key}T00:00:00+05:30`);
}
const timeStr = (d) => new Date(d).toLocaleTimeString('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit' });
const ago = (d) => {
  const m = Math.round((Date.now() - new Date(d)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
};
const itemsText = (o) => o.items.map((i) => `${i.qty} × ${i.name}`).join(', ');

/* ==========================================================
   Live orders (runs app-wide in live mode so alerts fire on any tab)
   ========================================================== */
export async function startOrders(c) {
  ctx = c;
  if (ctx.mode !== 'live' || channel) return;
  await refetchOrders();
  live = 'connecting';
  channel = ctx.sb
    .channel(`orders:${ctx.slug}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `slug=eq.${ctx.slug}` }, (p) => {
      if (p.eventType === 'INSERT') { orders.set(p.new.id, p.new); onNewOrder(p.new); }
      else if (p.eventType === 'UPDATE') orders.set(p.new.id, p.new);
      changed();
    })
    .subscribe((status) => {
      live = status === 'SUBSCRIBED' ? 'live' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'error' : live;
      changed();
    });
  // Safety net in case a realtime message is missed (phone sleeps, network blips).
  pollTimer = setInterval(async () => {
    const before = new Set([...orders.values()].filter((o) => o.status === 'new').map((o) => o.id));
    await refetchOrders();
    for (const o of orders.values()) if (o.status === 'new' && !before.has(o.id) && Date.now() - new Date(o.created_at) < 15 * 60e3) onNewOrder(o);
    changed();
  }, 30000);
  ringTimer = setInterval(() => { if (newCount()) ring(); }, 15000); // keep ringing until someone accepts
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refetchOrders().then(changed); requestWakeLock(); } });
  document.addEventListener('click', unlockAudio, { once: true });
}

async function refetchOrders() {
  const since = startOfDayIST().toISOString();
  const { data, error } = await ctx.sb
    .from('orders').select('*').eq('slug', ctx.slug)
    .or(`created_at.gte.${since},status.in.(new,accepted,ready)`)
    .order('created_at', { ascending: false }).limit(500);
  if (error) { live = 'error'; return; }
  orders.clear();
  for (const o of data) orders.set(o.id, o);
}

const newCount = () => [...orders.values()].filter((o) => o.status === 'new').length;

function changed() {
  const n = newCount();
  document.title = n ? `(${n}) New order · ${baseTitle()}` : baseTitle();
  const tab = $('.tab[data-view="orders"]');
  if (tab) tab.innerHTML = `Orders${n ? `<span class="tab-badge">${n}</span>` : ''}`;
  ctx.onOrdersChange?.();
}

function onNewOrder(o) {
  ring();
  if ('Notification' in window && Notification.permission === 'granted' && (document.hidden || !document.hasFocus())) {
    try {
      new Notification(`New order #${o.number}${o.table_no ? ` · Table ${o.table_no}` : ''}`, {
        body: `${itemsText(o)} · ${ctx.fmt(o.subtotal)}`, tag: o.id, requireInteraction: true,
      });
    } catch { /* some browsers only allow notifications from a service worker */ }
  }
  ctx.toast(`New order #${o.number}${o.table_no ? ` from table ${o.table_no}` : ''}`);
}

/* Sound: browsers only allow audio after a tap, so the first click on the page unlocks it. */
function unlockAudio() {
  if (pref.get('sound') === 'off') return;
  try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch { /* no audio */ }
}
function ring() {
  if (pref.get('sound') === 'off' || !audio) return;
  const t0 = audio.currentTime;
  [0, 0.22, 0.44].forEach((dt, i) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = i === 2 ? 1320 : 880;
    gain.gain.setValueAtTime(0.0001, t0 + dt);
    gain.gain.exponentialRampToValueAtTime(0.5, t0 + dt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.2);
    osc.connect(gain).connect(audio.destination);
    osc.start(t0 + dt);
    osc.stop(t0 + dt + 0.22);
  });
}

async function requestWakeLock() {
  if (pref.get('awake') !== 'on' || !('wakeLock' in navigator) || document.hidden) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* not allowed right now */ }
}

async function setStatus(id, status) {
  const o = orders.get(id);
  const prev = o.status;
  o.status = status; // optimistic
  changed();
  const { error } = await ctx.sb.from('orders').update({ status }).eq('id', id);
  if (error) { o.status = prev; changed(); ctx.toast(`Couldn't update: ${error.message}`, true); }
}
async function setPunched(id, punched) {
  const o = orders.get(id);
  o.punched = punched;
  const { error } = await ctx.sb.from('orders').update({ punched }).eq('id', id);
  if (error) { o.punched = !punched; ctx.toast(`Couldn't update: ${error.message}`, true); }
  changed();
}

/* ---------- Orders view ---------- */
export function renderOrders(el) {
  const m = ctx.menu();
  if (ctx.mode !== 'live') {
    el.innerHTML = '<p class="banner"><strong>Orders need the pilot backend.</strong> Connect Supabase (see supabase/README.md) to take orders from tables.</p>';
    return;
  }
  const list = [...orders.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const col = (status) => list.filter((o) => o.status === status).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const done = list.filter((o) => ['served', 'cancelled'].includes(o.status) && new Date(o.created_at) >= startOfDayIST());
  const unpunched = list.filter((o) => o.status !== 'cancelled' && !o.punched).length;
  const notif = 'Notification' in window ? Notification.permission : 'unsupported';
  el.innerHTML = `
    <div class="orders-bar">
      <label class="switch-row"><input type="checkbox" id="ord-enabled" ${m.ordering?.enabled ? 'checked' : ''}>
        <span><b>Table ordering ${m.ordering?.enabled ? 'on' : 'off'}</b> <small>${m.ordering?.enabled ? 'guests can order from their table' : 'guests can only view the menu'}</small></span></label>
      <span class="live-dot ${live}">${{ live: 'Live', connecting: 'Connecting…', error: 'Reconnecting…', off: 'Off' }[live]}</span>
      <span class="spacer"></span>
      <button class="btn ghost sm" id="ord-sound">${pref.get('sound') === 'off' ? 'Sound off' : 'Sound on'}</button>
      ${notif === 'default' ? '<button class="btn ghost sm" id="ord-notif">Enable notifications</button>' : ''}
      ${'wakeLock' in navigator ? `<button class="btn ghost sm" id="ord-awake">${pref.get('awake') === 'on' ? 'Screen stays on' : 'Keep screen on'}</button>` : ''}
      <button class="btn ghost sm" id="ord-export">Export today (CSV)</button>
    </div>
    ${unpunched ? `<p class="banner punch-note"><strong>${unpunched} order${unpunched === 1 ? '' : 's'} not yet entered in your POS.</strong> Tick "Entered in POS" after punching each one in Petpooja.</p>` : ''}
    <div class="board">
      ${[['new', 'New'], ['accepted', 'Preparing'], ['ready', 'Ready to serve']].map(([s, l]) => `
        <section class="lane lane-${s}"><h3>${l} <small>${col(s).length}</small></h3>
          ${col(s).map(orderCard).join('') || '<p class="empty-note">Nothing here.</p>'}
        </section>`).join('')}
    </div>
    <details class="done-today"><summary>Completed today (${done.length})</summary>
      ${done.map(orderCard).join('') || '<p class="empty-note">No completed orders yet today.</p>'}
    </details>`;

  $('#ord-enabled', el).onchange = (e) => ctx.setOrdering(e.target.checked);
  $('#ord-sound', el).onclick = () => {
    pref.set('sound', pref.get('sound') === 'off' ? 'on' : 'off');
    unlockAudio();
    if (pref.get('sound') !== 'off') ring();
    renderOrders(el);
  };
  $('#ord-notif', el)?.addEventListener('click', async () => { await Notification.requestPermission(); renderOrders(el); });
  $('#ord-awake', el)?.addEventListener('click', async () => {
    const on = pref.get('awake') !== 'on';
    pref.set('awake', on ? 'on' : 'off');
    if (on) await requestWakeLock(); else { await wakeLock?.release(); wakeLock = null; }
    renderOrders(el);
  });
  $('#ord-export', el).onclick = () => downloadCsv(list.filter((o) => new Date(o.created_at) >= startOfDayIST()), `${ctx.slug}-orders-${dayKey(Date.now())}.csv`);
  el.onclick = (e) => {
    const b = e.target.closest('[data-status]');
    if (b) return setStatus(b.closest('[data-order]').dataset.order, b.dataset.status);
    const p = e.target.closest('[data-print]');
    if (p) return printKot(orders.get(p.closest('[data-order]').dataset.order));
  };
  el.onchange = (e) => {
    if (e.target.matches('[data-punched]')) setPunched(e.target.closest('[data-order]').dataset.order, e.target.checked);
  };
}

function orderCard(o) {
  const next = { new: [['accepted', 'Accept', '']], accepted: [['ready', 'Mark ready', '']], ready: [['served', 'Served', '']] }[o.status] || [];
  return `
    <article class="order-card st-${o.status}" data-order="${esc(o.id)}">
      <header><b>#${esc(o.number)}</b>${o.table_no ? `<span class="tbl">Table ${esc(o.table_no)}</span>` : ''}
        <span class="when" title="${esc(timeStr(o.created_at))}">${esc(ago(o.created_at))}</span></header>
      <ul>${o.items.map((i) => `<li><span class="q">${i.qty}×</span>${esc(i.name)}</li>`).join('')}</ul>
      ${o.note ? `<p class="note">“${esc(o.note)}”</p>` : ''}
      <footer>
        <span class="total">${esc(ctx.fmt(o.subtotal))}</span>
        ${o.status === 'cancelled' ? '<span class="tag">Cancelled</span>' : o.status === 'served' ? '<span class="tag">Served</span>' : ''}
        <span class="spacer"></span>
        <button class="icon-txt" data-print>Print</button>
        ${['new', 'accepted'].includes(o.status) ? '<button class="icon-txt danger" data-status="cancelled">Cancel</button>' : ''}
        ${next.map(([s, l]) => `<button class="btn sm" data-status="${s}">${l}</button>`).join('')}
      </footer>
      ${o.status !== 'cancelled' ? `<label class="punch"><input type="checkbox" data-punched ${o.punched ? 'checked' : ''}> Entered in POS</label>` : ''}
    </article>`;
}

function printKot(o) {
  const w = window.open('', '_blank', 'width=380,height=600');
  if (!w) return ctx.toast('Allow pop-ups to print tickets.', true);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>KOT #${esc(o.number)}</title>
    <style>body{font:14px/1.4 monospace;margin:0;padding:10px;width:72mm}h1{font-size:18px;margin:0}
    .r{display:flex;justify-content:space-between}hr{border:0;border-top:1px dashed #000}@page{margin:0}</style></head><body>
    <h1>${esc(ctx.menu().name)}</h1><div class="r"><b>KOT #${esc(o.number)}</b><b>${o.table_no ? `Table ${esc(o.table_no)}` : ''}</b></div>
    <div>${esc(new Date(o.created_at).toLocaleString('en-IN', { timeZone: IST }))}</div><hr>
    ${o.items.map((i) => `<div class="r"><span>${i.qty} × ${esc(i.name)}</span><span>${esc(ctx.fmt(i.price * i.qty))}</span></div>`).join('')}
    ${o.note ? `<hr><div>Note: ${esc(o.note)}</div>` : ''}<hr><div class="r"><b>Total</b><b>${esc(ctx.fmt(o.subtotal))}</b></div>
    <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}<\/script></body></html>`);
  w.document.close();
}

function downloadCsv(list, filename) {
  const rows = [['Date', 'Time', 'Order #', 'Table', 'Item', 'Qty', 'Price', 'Line total', 'Order total', 'Status', 'Entered in POS', 'Note']];
  for (const o of [...list].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))) {
    for (const i of o.items) {
      rows.push([dayKey(o.created_at), timeStr(o.created_at), o.number, o.table_no || '', i.name, i.qty, i.price, i.qty * i.price,
        o.subtotal, o.status, o.punched ? 'Yes' : 'No', o.note || '']);
    }
  }
  const csv = rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })), download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ==========================================================
   Insights: history + analytics
   ========================================================== */
const RANGES = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']];
let range = 'today';

async function fetchRange(r) {
  let from;
  let to = null;
  if (r === 'today') from = startOfDayIST();
  else if (r === 'yesterday') { from = startOfDayIST(1); to = startOfDayIST(); }
  else from = startOfDayIST(Number(r) - 1);
  const all = [];
  for (let page = 0; page < 20; page++) {
    let q = ctx.sb.from('orders').select('*').eq('slug', ctx.slug).gte('created_at', from.toISOString());
    if (to) q = q.lt('created_at', to.toISOString());
    const { data, error } = await q.order('created_at', { ascending: true }).range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) break;
  }
  return { list: all, from, to: to || new Date() };
}

export async function renderInsights(el) {
  if (ctx.mode !== 'live') {
    el.innerHTML = '<p class="banner"><strong>Insights need the pilot backend.</strong> They are built from the orders guests place from their tables.</p>';
    return;
  }
  el.innerHTML = `
    <div class="ins-bar" role="group" aria-label="Date range">
      ${RANGES.map(([v, l]) => `<button class="seg${v === range ? ' on' : ''}" data-range="${v}" aria-pressed="${v === range}">${l}</button>`).join('')}
      <span class="spacer"></span><button class="btn ghost sm" id="ins-export">Export (CSV)</button>
    </div>
    <div id="ins-body"><p class="empty-note">Loading…</p></div>`;
  $$('[data-range]', el).forEach((b) => { b.onclick = () => { range = b.dataset.range; renderInsights(el); }; });
  let res;
  try { res = await fetchRange(range); } catch (e) { $('#ins-body', el).innerHTML = `<p class="error">Couldn't load orders: ${esc(e.message)}</p>`; return; }
  $('#ins-export', el).onclick = () => downloadCsv(res.list, `${ctx.slug}-orders-${range}.csv`);
  $('#ins-body', el).innerHTML = insightsHtml(res);
  bindTooltips($('#ins-body', el));
}

function insightsHtml({ list, from, to }) {
  const m = ctx.menu();
  const ok = list.filter((o) => o.status !== 'cancelled');
  const cancelled = list.length - ok.length;
  const revenue = ok.reduce((a, o) => a + Number(o.subtotal), 0);
  const lines = ok.flatMap((o) => o.items);
  const units = lines.reduce((a, i) => a + i.qty, 0);
  if (!list.length) return '<div class="empty-ins"><p>No orders in this period yet.</p><p class="hint">Turn on table ordering in the Orders tab and Save &amp; publish. Orders guests place will show up here.</p></div>';

  // Video impact
  const vidLines = lines.filter((i) => i.video);
  const vidUnits = vidLines.reduce((a, i) => a + i.qty, 0);
  const vidRevenue = vidLines.reduce((a, i) => a + i.qty * i.price, 0);
  const menuVid = m.dishes.filter((d) => d.video).length;
  const menuPhoto = m.dishes.length - menuVid;
  const perVid = menuVid ? vidUnits / menuVid : 0;
  const perPhoto = menuPhoto ? (units - vidUnits) / menuPhoto : 0;
  const lift = perPhoto ? perVid / perPhoto : 0;

  // Prep speed: median minutes from order to ready
  const prepMins = ok.filter((o) => o.ready_at).map((o) => (new Date(o.ready_at) - new Date(o.created_at)) / 60000).sort((a, b) => a - b);
  const medPrep = prepMins.length ? prepMins[Math.floor(prepMins.length / 2)] : null;
  const unpunched = ok.filter((o) => !o.punched).length;

  // Series
  const multiDay = (to - from) > 36 * 3600e3;
  let series;
  if (multiDay) {
    const days = [];
    for (let t = new Date(from); t < to; t = new Date(t.getTime() + 864e5)) days.push(dayKey(t));
    const byDay = new Map(days.map((d) => [d, 0]));
    for (const o of ok) byDay.set(dayKey(o.created_at), (byDay.get(dayKey(o.created_at)) || 0) + Number(o.subtotal));
    series = { title: 'Revenue by day', rows: [...byDay].map(([d, v]) => ({ label: new Date(`${d}T12:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), value: v, tip: ctx.fmt(v) })) };
  } else {
    const byHour = new Map();
    for (const o of ok) byHour.set(hourOf(o.created_at), (byHour.get(hourOf(o.created_at)) || 0) + Number(o.subtotal));
    const hrs = [...byHour.keys()];
    const lo = Math.min(8, ...hrs);
    const hi = Math.max(22, ...hrs);
    series = { title: 'Revenue by hour', rows: Array.from({ length: hi - lo + 1 }, (_, i) => ({ label: hourLabel(lo + i), value: byHour.get(lo + i) || 0, tip: ctx.fmt(byHour.get(lo + i) || 0) })) };
  }
  const hours = new Map();
  for (const o of ok) hours.set(hourOf(o.created_at), (hours.get(hourOf(o.created_at)) || 0) + 1);
  const hrsK = [...hours.keys()];
  const hLo = Math.min(8, ...hrsK);
  const hHi = Math.max(22, ...hrsK);
  const busy = Array.from({ length: hHi - hLo + 1 }, (_, i) => ({ label: hourLabel(hLo + i), value: hours.get(hLo + i) || 0, tip: `${hours.get(hLo + i) || 0} orders` }));

  // Items
  const byItem = new Map();
  for (const i of lines) {
    const e = byItem.get(i.id) || { name: i.name, video: i.video, qty: 0, rev: 0, category: i.category };
    e.qty += i.qty; e.rev += i.qty * i.price;
    byItem.set(i.id, e);
  }
  const top = [...byItem.values()].sort((a, b) => b.qty - a.qty || b.rev - a.rev).slice(0, 10);
  const sold = new Set(byItem.keys());
  const neverOrdered = m.dishes.filter((d) => d.available !== false && !sold.has(d.id));
  const byCat = new Map();
  for (const i of lines) byCat.set(i.category || 'Other', (byCat.get(i.category || 'Other') || 0) + i.qty * i.price);
  const cats = [...byCat].sort((a, b) => b[1] - a[1]).map(([c, v]) => ({ label: c, value: v, tip: ctx.fmt(v) }));
  const byTable = new Map();
  for (const o of ok) if (o.table_no) byTable.set(o.table_no, (byTable.get(o.table_no) || 0) + 1);
  const tables = [...byTable].sort((a, b) => b[1] - a[1]).slice(0, 8);

  const kpi = (label, value, sub = '') => `<div class="kpi"><span class="kpi-l">${label}</span><span class="kpi-v">${value}</span>${sub ? `<span class="kpi-s">${sub}</span>` : ''}</div>`;
  return `
    <div class="kpis">
      ${kpi('Revenue', esc(ctx.fmt(revenue)), cancelled ? `${cancelled} cancelled not counted` : '')}
      ${kpi('Orders', ok.length)}
      ${kpi('Average order', esc(ctx.fmt(ok.length ? revenue / ok.length : 0)))}
      ${kpi('Items sold', units)}
      ${kpi('Time to ready', medPrep == null ? '—' : `${Math.round(medPrep)} min`, medPrep == null ? 'Mark orders ready to measure' : 'median, order → ready')}
      ${kpi('Not in POS yet', unpunched, unpunched ? 'orders not marked "Entered in POS"' : 'all entered')}
    </div>

    <section class="panel video-impact">
      <h3>Video items</h3>
      <div class="vi-grid">
        ${kpi('Share of items sold', `${units ? Math.round((vidUnits / units) * 100) : 0}%`, `${vidUnits} of ${units} items had a video`)}
        ${kpi('Revenue from video items', esc(ctx.fmt(vidRevenue)), revenue ? `${Math.round((vidRevenue / revenue) * 100)}% of revenue` : '')}
        ${kpi('Sales per item', lift ? `${lift.toFixed(1)}×` : '—', lift ? `a video item sells ${lift >= 1 ? `${lift.toFixed(1)}× as much as` : 'less than'} a photo-only item, on average` : 'Needs sales of both kinds')}
      </div>
      <p class="hint">${menuVid} of ${m.dishes.length} menu items have a video.</p>
    </section>

    <section class="panel"><h3>${series.title}</h3>${barChart(series.rows, { money: true })}</section>
    <section class="panel"><h3>Busiest hours <small>orders placed</small></h3>${barChart(busy)}</section>

    <div class="two">
      <section class="panel"><h3>Top items</h3>
        <table class="tbl"><thead><tr><th>#</th><th>Item</th><th class="n">Sold</th><th class="n">Revenue</th></tr></thead>
        <tbody>${top.map((t, i) => `<tr><td>${i + 1}</td><td>${esc(t.name)}${t.video ? ' <span class="tag vid">Video</span>' : ''}</td><td class="n">${t.qty}</td><td class="n">${esc(ctx.fmt(t.rev))}</td></tr>`).join('')}</tbody></table>
      </section>
      <section class="panel"><h3>Revenue by category</h3>${hbarChart(cats)}</section>
    </div>

    <div class="two">
      <section class="panel"><h3>Busiest tables</h3>
        ${tables.length ? `<table class="tbl"><thead><tr><th>Table</th><th class="n">Orders</th></tr></thead><tbody>${tables.map(([t, n]) => `<tr><td>${esc(t)}</td><td class="n">${n}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No table numbers yet.</p>'}
      </section>
      <section class="panel"><h3>Not ordered in this period <small>${neverOrdered.length} items</small></h3>
        <p class="hint">Candidates for a better photo, a video, a new description, or a spot in a featured list.</p>
        <p class="never">${neverOrdered.slice(0, 30).map((d) => `<span class="tag">${esc(d.name)}</span>`).join(' ')}${neverOrdered.length > 30 ? ` +${neverOrdered.length - 30} more` : ''}</p>
      </section>
    </div>

    <section class="panel"><h3>Order history <small>${list.length} orders</small></h3>
      <div class="tbl-wrap"><table class="tbl hist"><thead><tr><th>When</th><th>#</th><th>Table</th><th>Items</th><th class="n">Total</th><th>Status</th><th>POS</th></tr></thead>
      <tbody>${[...list].reverse().slice(0, 300).map((o) => `<tr class="${o.status === 'cancelled' ? 'muted' : ''}">
        <td>${esc(new Date(o.created_at).toLocaleString('en-IN', { timeZone: IST, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}</td>
        <td>${o.number}</td><td>${esc(o.table_no || '—')}</td><td>${esc(itemsText(o))}</td><td class="n">${esc(ctx.fmt(o.subtotal))}</td>
        <td>${esc(o.status)}</td><td>${o.punched ? 'Yes' : '—'}</td></tr>`).join('')}</tbody></table></div>
      ${list.length > 300 ? '<p class="hint">Showing the latest 300. Export the CSV for the full list.</p>' : ''}
    </section>`;
}

const hourLabel = (h) => `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`;

/* Single-series bar charts (one hue, no legend; the title names the series). Hover/tap shows the value. */
function barChart(rows, { money = false } = {}) {
  const W = 640;
  const H = 180;
  const pad = { l: 44, r: 8, t: 10, b: 24 };
  const max = Math.max(1, ...rows.map((r) => r.value));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const bw = iw / rows.length;
  const gap = Math.min(6, bw * 0.25);
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  const every = Math.ceil(rows.length / 12);
  const short = (v) => (money ? (v >= 1000 ? `₹${Math.round(v / 100) / 10}k` : `₹${Math.round(v)}`) : String(Math.round(v)));
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart">
    ${ticks.map((v) => { const y = pad.t + ih - (v / top) * ih; return `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/><text class="ax" x="${pad.l - 6}" y="${y + 4}" text-anchor="end">${short(v)}</text>`; }).join('')}
    ${rows.map((r, i) => {
      const h = (r.value / top) * ih;
      const x = pad.l + i * bw + gap / 2;
      const y = pad.t + ih - h;
      const w = Math.max(1, bw - gap);
      const rr = Math.min(4, w / 2, h);
      const path = h > 0 ? `M${x},${pad.t + ih} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${pad.t + ih} Z` : '';
      return `<g class="bar" data-tip="${esc(r.label)}: ${esc(r.tip)}">
        <rect class="hit" x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${ih}"/>
        ${path ? `<path d="${path}"/>` : ''}
        ${i % every === 0 ? `<text class="ax" x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${esc(r.label)}</text>` : ''}</g>`;
    }).join('')}
    <line class="base" x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}"/>
  </svg>`;
}

function hbarChart(rows) {
  if (!rows.length) return '<p class="hint">No sales yet.</p>';
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `<div class="hbars">${rows.map((r) => `
    <div class="hbar" data-tip="${esc(r.label)}: ${esc(r.tip)}"><span class="hb-l">${esc(r.label)}</span>
      <span class="hb-track"><span class="hb-fill" style="width:${Math.max(2, (r.value / max) * 100)}%"></span></span>
      <span class="hb-v">${esc(r.tip)}</span></div>`).join('')}</div>`;
}

function niceStep(max) {
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || p * 10;
}

function bindTooltips(root) {
  let tip = $('.chart-tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; document.body.append(tip); }
  const show = (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.dataset.tip;
    tip.hidden = false;
    const x = Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, e.clientX - tip.offsetWidth / 2));
    tip.style.left = `${x}px`;
    tip.style.top = `${e.clientY - tip.offsetHeight - 12}px`;
  };
  root.addEventListener('pointermove', show);
  root.addEventListener('pointerdown', show);
  root.addEventListener('pointerleave', () => { tip.hidden = true; });
}

/* ==========================================================
   Tables & QR codes (+ Wi-Fi join code)
   ========================================================== */
export function loadQrLib() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  return new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: QR_LIB, onload: () => resolve(window.qrcode), onerror: reject });
    document.head.append(s);
  });
}

export function qrSvg(text, size = 200) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const q = 2; // quiet zone in modules
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q},${r + q}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + q * 2} ${n + q * 2}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

const wifiEsc = (s) => String(s).replace(/([\\;,:"])/g, '\\$1');
const wifiString = (w) => `WIFI:T:${w.security === 'nopass' ? 'nopass' : w.security || 'WPA'};S:${wifiEsc(w.ssid)};${w.security === 'nopass' ? '' : `P:${wifiEsc(w.password || '')};`}${w.hidden ? 'H:true;' : ''};`;

export function tableLabels(spec) {
  // "12" → 1..12 ; "1-8, Patio 1, Patio 2" → as listed
  const out = [];
  for (const part of String(spec || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) for (let i = Number(range[1]); i <= Math.min(Number(range[2]), Number(range[1]) + 199); i++) out.push(String(i));
    else if (/^\d+$/.test(part) && out.length === 0 && !String(spec).includes(',')) for (let i = 1; i <= Math.min(200, Number(part)); i++) out.push(String(i));
    else out.push(part.slice(0, 12));
  }
  return [...new Set(out)];
}

export async function renderTables(el) {
  const m = ctx.menu();
  m.tables ||= { spec: '10' };
  m.wifi ||= null;
  const w = m.wifi || { ssid: '', password: '', security: 'WPA', hidden: false };
  const base = new URL('../', location.href);
  base.search = '';
  const menuUrl = (t) => `${base.href}?r=${encodeURIComponent(ctx.slug)}&t=${encodeURIComponent(t)}`;
  el.innerHTML = `
    <div class="tq-grid">
      <section class="panel">
        <h3>Tables</h3>
        <label class="field">Table numbers <small>a count ("12"), a range ("1-12"), or names separated by commas ("1-8, Patio 1, Patio 2")</small>
          <input class="input" id="tq-spec" value="${esc(m.tables.spec)}"></label>
        <p class="hint" id="tq-count"></p>
      </section>
      <section class="panel">
        <h3>Guest Wi-Fi <small>optional</small></h3>
        <p class="hint">Adds a second code to each table card that joins the Wi-Fi when scanned with the phone camera, and a Wi-Fi button on the menu.
          Use a guest network: the password is printed on the cards and shown on the menu.</p>
        <div class="row2">
          <label class="field">Network name (SSID)<input class="input" id="wf-ssid" value="${esc(w.ssid)}" autocomplete="off"></label>
          <label class="field">Password<input class="input" id="wf-pass" value="${esc(w.password)}" autocomplete="off"></label>
        </div>
        <div class="row2">
          <label class="field">Security<select class="input" id="wf-sec">
            ${[['WPA', 'WPA / WPA2 / WPA3'], ['WEP', 'WEP'], ['nopass', 'None (open)']].map(([v, l]) => `<option value="${v}" ${w.security === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field check"><input type="checkbox" id="wf-hidden" ${w.hidden ? 'checked' : ''}> Hidden network</label>
        </div>
      </section>
    </div>
    <div class="tq-actions">
      <button class="btn" id="tq-print">Print all table cards</button>
      <span class="hint">Changes to tables or Wi-Fi are saved with <b>Save &amp; publish</b>.</span>
    </div>
    <div class="cards" id="tq-cards"><p class="empty-note">Generating codes…</p></div>`;

  try { await loadQrLib(); } catch { $('#tq-cards', el).innerHTML = '<p class="error">Couldn\'t load the QR code generator. Check your connection.</p>'; return; }

  const draw = () => {
    const labels = tableLabels(m.tables.spec);
    const wifi = m.wifi?.ssid ? m.wifi : null;
    $('#tq-count', el).textContent = `${labels.length} table card${labels.length === 1 ? '' : 's'}.`;
    $('#tq-cards', el).innerHTML = labels.map((t) => tableCard(t, menuUrl(t), wifi)).join('') || '<p class="empty-note">Add table numbers above.</p>';
  };
  const save = () => {
    m.tables = { spec: $('#tq-spec', el).value.trim() || '1' };
    const ssid = $('#wf-ssid', el).value.trim();
    m.wifi = ssid ? { ssid, password: $('#wf-pass', el).value, security: $('#wf-sec', el).value, hidden: $('#wf-hidden', el).checked } : null;
    ctx.setDirty(true);
    draw();
  };
  let t;
  el.oninput = (e) => { if (e.target.closest('.tq-grid')) { clearTimeout(t); t = setTimeout(save, 300); } };
  el.onchange = (e) => { if (e.target.closest('.tq-grid')) save(); };
  el.onclick = (e) => {
    if (e.target.closest('#tq-print')) return printCards($$('.tcard', el));
    const one = e.target.closest('[data-print-card]');
    if (one) return printCards([one.closest('.tcard')]);
    const dl = e.target.closest('[data-png]');
    if (dl) downloadCardPng(dl.closest('.tcard'), dl.dataset.png);
  };
  draw();
}

function tableCard(t, url, wifi) {
  const m = ctx.menu();
  return `
    <article class="tcard" data-table="${esc(t)}">
      <div class="tc-inner">
        <div class="tc-head"><span class="tc-name">${esc(m.name)}</span><span class="tc-table">Table <b>${esc(t)}</b></span></div>
        <div class="tc-codes${wifi ? ' two' : ''}">
          ${wifi ? `<figure>${qrSvg(wifiString(wifi), 150)}<figcaption><b>1. Join Wi-Fi</b><span>${esc(wifi.ssid)}</span>${wifi.password && wifi.security !== 'nopass' ? `<span>Password: ${esc(wifi.password)}</span>` : ''}</figcaption></figure>` : ''}
          <figure>${qrSvg(url, wifi ? 150 : 190)}<figcaption><b>${wifi ? '2. ' : ''}Scan for the menu</b><span>Point your phone camera here</span></figcaption></figure>
        </div>
      </div>
      <div class="tc-tools no-print">
        <a href="${esc(url)}" target="_blank" rel="noopener" class="icon-txt">Open link</a>
        <button class="icon-txt" data-png="${esc(t)}">Download PNG</button>
        <button class="icon-txt" data-print-card>Print</button>
      </div>
    </article>`;
}

function printCards(cards) {
  const w = window.open('', '_blank');
  if (!w) return ctx.toast('Allow pop-ups to print the cards.', true);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Table cards · ${esc(ctx.menu().name)}</title>
  <style>
    *{box-sizing:border-box;margin:0}body{font-family:Inter,system-ui,sans-serif;color:#111;background:#fff}
    .sheet{display:grid;grid-template-columns:1fr 1fr;gap:8mm;padding:10mm}
    .tc-inner{border:1.5px solid #111;border-radius:6mm;padding:7mm;break-inside:avoid;height:128mm;display:flex;flex-direction:column}
    .tc-head{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid #ddd;padding-bottom:4mm}
    .tc-name{font:600 15pt Georgia,serif}.tc-table{font-size:11pt}.tc-table b{font-size:20pt}
    .tc-codes{flex:1;display:flex;justify-content:center;align-items:center;gap:6mm}
    figure{display:flex;flex-direction:column;align-items:center;gap:3mm;text-align:center}
    figure svg{width:46mm;height:46mm}.tc-codes:not(.two) figure svg{width:62mm;height:62mm}
    figcaption{display:flex;flex-direction:column;gap:1mm;font-size:9pt;color:#444}figcaption b{color:#111;font-size:11pt}
    @page{size:A4;margin:0}
  </style></head><body><div class="sheet">${cards.map((c) => `<div>${c.querySelector('.tc-inner').outerHTML}</div>`).join('')}</div>
  <script>window.onload=()=>setTimeout(()=>window.print(),200)<\/script></body></html>`);
  w.document.close();
}

async function downloadCardPng(card, t) {
  // Draw the card on a canvas: name, table, and the QR code(s) as images.
  const scale = 3;
  const W = 600;
  const H = 760;
  const c = Object.assign(document.createElement('canvas'), { width: W * scale, height: H * scale });
  const g = c.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#111'; g.lineWidth = 3; g.beginPath(); g.roundRect(12, 12, W - 24, H - 24, 28); g.stroke();
  g.fillStyle = '#111'; g.font = '600 30px Georgia, serif'; g.fillText(ctx.menu().name, 44, 80);
  g.font = '500 22px system-ui, sans-serif'; g.textAlign = 'right'; g.fillText(`Table ${t}`, W - 44, 80); g.textAlign = 'left';
  const svgs = $$('figure svg', card);
  const caps = $$('figcaption', card).map((f) => [...f.children].map((x) => x.textContent));
  const size = svgs.length === 2 ? 230 : 380;
  const gap = 40;
  let x = (W - (svgs.length * size + (svgs.length - 1) * gap)) / 2;
  for (let i = 0; i < svgs.length; i++) {
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgs[i].outerHTML)}`;
    await img.decode();
    const y = svgs.length === 2 ? 200 : 140;
    g.drawImage(img, x, y, size, size);
    g.textAlign = 'center';
    caps[i].forEach((line, j) => {
      g.font = j === 0 ? '700 22px system-ui, sans-serif' : '400 17px system-ui, sans-serif';
      g.fillStyle = j === 0 ? '#111' : '#555';
      g.fillText(line, x + size / 2, y + size + 36 + j * 26);
    });
    g.textAlign = 'left';
    x += size + gap;
  }
  const a = Object.assign(document.createElement('a'), { href: c.toDataURL('image/png'), download: `${ctx.slug}-table-${t}.png` });
  a.click();
}
