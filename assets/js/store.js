/* ==========================================================
   Data layer shared by the guest menu and the dashboard.

   Sources
   - 'supabase' : live pilot backend (assets/js/config.js filled in)
   - 'local'    : this browser only (IndexedDB) — demo dashboard + preview
   - 'static'   : data/<slug>.json shipped with the site (read-only)

   Media URLs inside menu JSON are either normal https URLs or
   'idb:<key>' (a blob stored in this browser) — call resolveMedia()
   before putting them in an <img>/<video>.
   ========================================================== */
import { CONFIG } from './config.js';

const DATA_BASE = new URL('../../data/', import.meta.url);

export const supabaseEnabled = () => Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

let sbPromise = null;
export function getSupabase() {
  if (!supabaseEnabled()) return null;
  sbPromise ||= import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm').then((m) =>
    m.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey),
  );
  return sbPromise;
}

/* ---------- IndexedDB (local) ---------- */
let dbPromise = null;
function idb() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('qrmenu', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('menus');
      req.result.createObjectStore('media');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function idbDo(store, mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/* ---------- Loading ---------- */
export async function loadStatic(slug) {
  const res = await fetch(new URL(`${slug}.json`, DATA_BASE), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Menu "${slug}" not found`);
  return res.json();
}

/** Load a menu. preferred: 'local' | 'supabase' | 'static' | undefined (auto). */
export async function loadMenu(slug, preferred) {
  if (preferred === 'local') {
    const local = await idbDo('menus', 'readonly', (s) => s.get(slug)).catch(() => null);
    if (local) return { data: local, source: 'local' };
  }
  if (preferred !== 'static' && supabaseEnabled()) {
    const sb = await getSupabase();
    const { data, error } = await sb.from('menus').select('data').eq('slug', slug).maybeSingle();
    if (!error && data?.data && Object.keys(data.data).length) return { data: data.data, source: 'supabase' };
    // A paused menu is hidden from guests; never fall back to a bundled copy of it.
    if (!error && !data) {
      const { data: paused } = await sb.rpc('menu_suspended', { p_slug: slug });
      if (paused === true) { const e = new Error('This menu is paused.'); e.suspended = true; throw e; }
    }
  }
  return { data: await loadStatic(slug), source: 'static' };
}

export async function saveLocal(slug, data) {
  await idbDo('menus', 'readwrite', (s) => s.put(data, slug));
}
export async function clearLocal(slug) {
  await idbDo('menus', 'readwrite', (s) => s.delete(slug));
}

export async function saveSupabase(slug, data) {
  const sb = await getSupabase();
  const { error, count } = await sb
    .from('menus')
    .update({ data, updated_at: new Date().toISOString() }, { count: 'exact' })
    .eq('slug', slug);
  if (error) throw error;
  if (count === 0) throw new Error('This account is not allowed to edit this menu.');
}

/* ---------- Media ---------- */
const extFor = (type) =>
  ({ 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' })[type] || 'bin';

/** Store a Blob and return the URL to put in the menu JSON. */
export async function uploadMedia(slug, blob, kind, target) {
  const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${extFor(blob.type)}`;
  if (target === 'supabase') {
    const sb = await getSupabase();
    const path = `${slug}/${kind}/${name}`;
    const { error } = await sb.storage
      .from(CONFIG.mediaBucket)
      .upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false });
    if (error) throw error;
    return sb.storage.from(CONFIG.mediaBucket).getPublicUrl(path).data.publicUrl;
  }
  const key = `${slug}/${kind}/${name}`;
  await idbDo('media', 'readwrite', (s) => s.put(blob, key));
  return `idb:${key}`;
}

const objectUrls = new Map();
export async function resolveMedia(url) {
  if (!url || !url.startsWith('idb:')) return url || '';
  const key = url.slice(4);
  if (objectUrls.has(key)) return objectUrls.get(key);
  const blob = await idbDo('media', 'readonly', (s) => s.get(key)).catch(() => null);
  if (!blob) return '';
  const u = URL.createObjectURL(blob);
  objectUrls.set(key, u);
  return u;
}

/** Returns a copy of the menu with every idb: URL turned into a usable object URL. */
export async function withResolvedMedia(data) {
  const copy = structuredClone(data);
  copy.logo = await resolveMedia(copy.logo);
  await Promise.all(
    (copy.dishes || []).map(async (d) => {
      d.image = await resolveMedia(d.image);
      if (d.thumb) d.thumb = await resolveMedia(d.thumb);
      d.video = d.video ? await resolveMedia(d.video) : d.video;
    }),
  );
  return copy;
}

/**
 * After a publish: delete this restaurant's uploaded files that the new menu no longer uses.
 * A file goes when it was in the previous published menu (a replaced/removed photo or video), or when
 * it's over a day old and unused (uploads that were never published). Fresh unused uploads are kept,
 * since another device may still have them in an unsaved draft. Returns how many files were deleted.
 */
export async function cleanupMedia(slug, published, previous) {
  const sb = await getSupabase();
  const bucket = sb.storage.from(CONFIG.mediaBucket);
  const now = JSON.stringify(published || {});
  const before = JSON.stringify(previous || {});
  const dayAgo = Date.now() - 864e5;
  const doomed = [];
  for (const kind of ['videos', 'photos', 'brand']) {
    const { data: files, error } = await bucket.list(`${slug}/${kind}`, { limit: 1000 });
    if (error || !files) continue;
    for (const f of files) {
      if (!f.id) continue; // a sub-folder
      const path = `${slug}/${kind}/${f.name}`;
      if (now.includes(path)) continue;
      const old = Date.parse(f.created_at || '') < dayAgo;
      if (before.includes(path) || old) doomed.push(path);
    }
  }
  if (!doomed.length) return 0;
  const { data, error } = await bucket.remove(doomed);
  if (error) throw error;
  return data?.length || 0;
}
