// Supabase Edge Function: import-menu
// Reads a restaurant's public listing page and returns its menu for the dashboard's "Import from a link".
//   POST { url }    →  { source, name, items: [{ name, category, price, description, veg, egg, image }], menuImages: [url] }
//   POST { image }  →  the image's bytes, so the dashboard can copy an item photo into the restaurant's own storage
//                      (Zomato's image servers don't allow browsers to download them directly). Zomato images only.
// - Zomato (pages with online ordering): full item list from the page's embedded data.
// - AirMenus (airmenus.in/<restaurant>/...): full item list with photos, veg/egg, tags and stock, from its public
//   menu API (the same calls its own menu page makes).
// - EazyDiner / Swiggy Dineout: these only publish PHOTOS of the printed menu, so we return those photos
//   (plus any schema.org menu items the page happens to include).
// Only these sites are allowed, so the function can't be used as a general web proxy.
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → Via editor, name "import-menu", paste this file.

const ALLOWED = [/(^|\.)zomato\.com$/, /(^|\.)airmenus\.in$/, /(^|\.)eazydiner\.com$/, /(^|\.)swiggy\.com$/, /(^|\.)dineout\.co\.in$/];
const IMAGE_HOSTS = [/(^|\.)zmtcdn\.com$/, /^airmenusimages\.[a-z0-9]+\.cdn\.digitaloceanspaces\.com$/];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Item = { name: string; category: string; price: number | null; description: string; veg: boolean | null; egg: boolean; image?: string; badges?: string[]; available?: boolean };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  let body: { url?: string; image?: string };
  try { body = await req.json(); } catch { return json({ error: 'Send JSON' }, 400); }
  if (body.image) return proxyImage(String(body.image));

  let url: URL;
  try {
    url = new URL(String(body.url || '').trim());
  } catch {
    return json({ error: 'Paste the full link, starting with https://' }, 400);
  }
  if (url.protocol !== 'https:' || !ALLOWED.some((re) => re.test(url.hostname))) {
    return json({ error: 'Only Zomato, AirMenus, EazyDiner and Swiggy Dineout links are supported.' }, 400);
  }

  if (/airmenus\.in$/.test(url.hostname)) {
    try {
      return json(await fetchAirMenus(url));
    } catch (e) {
      return json({ error: `Couldn't read the AirMenus menu (${(e as Error).message}).` }, 502);
    }
  }

  // Zomato's menu lives on the /order page.
  if (/zomato\.com$/.test(url.hostname) && !/\/order\/?$/.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/(info|menu|reviews|photos)?\/?$/, '') + '/order';
  }

  let html: string;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-IN,en;q=0.9', Accept: 'text/html' }, redirect: 'follow' });
    if (!res.ok) return json({ error: `The site answered ${res.status}. It may be blocking automated requests; try again later or use a spreadsheet.` }, 502);
    html = await res.text();
  } catch (e) {
    return json({ error: `Couldn't reach that page (${(e as Error).message}).` }, 502);
  }

  const out = { source: url.hostname.replace(/^www\./, ''), name: '', items: [] as Item[], menuImages: [] as string[] };
  try {
    if (/zomato\.com$/.test(url.hostname)) parseZomato(html, out);
    else if (/eazydiner\.com$/.test(url.hostname)) parseNextData(html, out);
    parseJsonLd(html, out);
  } catch (e) {
    return json({ error: `Couldn't read the menu on that page (${(e as Error).message}).` }, 422);
  }
  out.menuImages = [...new Set(out.menuImages)].slice(0, 40);
  return json(out);
});

async function proxyImage(raw: string) {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return json({ error: 'Bad image link' }, 400); }
  if (url.protocol !== 'https:' || !IMAGE_HOSTS.some((re) => re.test(url.hostname))) {
    return json({ error: 'Only Zomato and AirMenus item photos can be copied.' }, 400);
  }
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/*' }, redirect: 'follow' });
    const type = res.headers.get('content-type') || '';
    if (!IMAGE_HOSTS.some((re) => re.test(new URL(res.url).hostname))) return json({ error: 'Image moved to another site.' }, 502);
    if (!res.ok || !type.startsWith('image/')) return json({ error: `Image not available (${res.status}).` }, 502);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) return json({ error: 'Image is too large.' }, 413);
    return new Response(bytes, { headers: { ...cors, 'Content-Type': type, 'Cache-Control': 'no-store' } });
  } catch (e) {
    return json({ error: `Couldn't download the image (${(e as Error).message}).` }, 502);
  }
}

// AirMenus: restaurant → outlet → menu types (dine-in, takeaway, delivery) → top sections → categories → items.
async function fetchAirMenus(url: URL) {
  const [rest, outletName] = url.pathname.split('/').filter(Boolean);
  if (!rest) throw new Error('use the restaurant\'s menu link, e.g. airmenus.in/<restaurant>/order');
  const api = 'https://apis.airmenus.in/api';
  const get = async (path: string) => {
    const res = await fetch(`${api}${path}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`AirMenus answered ${res.status}`);
    return res.json();
  };
  const info = await get(`/restaurant/details/?rest_short_name=${encodeURIComponent(rest)}`);
  const outlets: any[] = info?.outlets || [];
  const outlet = outlets.find((o) => o.short_name === outletName) || outlets[0];
  if (!outlet) throw new Error('restaurant not found');
  const out = { source: 'airmenus.in', name: String(info.name || outlet.name || ''), items: [] as Item[], menuImages: [] as string[] };
  const seen = new Set<string>();
  const pref = url.pathname.toLowerCase().includes('take') ? ['takeaway', 'dinein', 'delivery'] : ['dinein', 'takeaway', 'delivery'];
  for (const type of pref) {
    const tops: any[] = await get(`/menu/details/?outlet_id=${outlet.id}&level=1&menu_type=${type}&parent_id=-1&only_active=YES`).catch(() => []);
    if (!Array.isArray(tops) || !tops.length) continue;
    for (const top of tops) {
      const cats: any[] = await get(`/menu/details/full/?outlet_id=${outlet.id}&super_category=${encodeURIComponent(top.item_name)}&menu_type=${type}&super_category_id=${top.id}&only_active=YES`);
      const walk = (c: any, prefix: string) => {
        const category = [tops.length > 1 ? top.item_name : '', prefix, c.item_name].filter(Boolean).join(' · ');
        for (const it of c.items || []) addAirItem(it, category, out.items, seen);
        for (const sub of c.subCategories || []) walk(sub, c.item_name);
      };
      for (const c of Array.isArray(cats) ? cats : []) walk(c, '');
    }
    if (out.items.length) break; // one menu type is enough; the others repeat the same dishes
  }
  return out;
}

function addAirItem(it: any, category: string, items: Item[], seen: Set<string>) {
  const name = String(it?.item_name || '').trim();
  if (!name || it.active === false) return;
  // Some places list a dish in two categories; keep the first.
  const opts = (it.variations || []).flatMap((v: any) => v.childrens || []).filter((o: any) => o.active !== false && o.variation_name);
  const optPrices = opts.map((o: any) => Number(o.variation_price)).filter((n: number) => n > 0);
  const sale = it.sale_price?.use && Number(it.sale_price.price) > 0 ? Number(it.sale_price.price) : 0;
  const price = sale || Number(it.price) || (optPrices.length ? Math.min(...optPrices) : 0) || null;
  const key = `${name.toLowerCase()}|${price}`;
  if (seen.has(key)) return;
  seen.add(key);
  let description = String(it.description || '').replace(/\s*\n\s*/g, ' · ').trim();
  if (opts.length) description = [description, opts.map((o: any) => `${o.variation_name}${Number(o.variation_price) > 0 ? ` ₹${Number(o.variation_price)}` : ''}`).join(', ')].filter(Boolean).join(' · ');
  const type = String(it.item_type || '').toUpperCase();
  const tag = String(it.special_tags || '').trim();
  items.push({
    name,
    category: category || 'Menu',
    price,
    description,
    veg: /^(VEGETARIAN|VEGAN)$/.test(type) ? true : /EGG|NON/.test(type) ? false : null,
    egg: /EGG/.test(type),
    image: it.img || it.images?.[0]?.url || undefined,
    badges: tag ? [tag.toLowerCase().replace(/!+$/, '').replace(/(^|[\s'’-])\p{L}/gu, (m) => m.toUpperCase()).replace(/'S\b/g, "'s")] : [],
    available: it.in_stock !== false,
  });
}

function parseZomato(html: string, out: { name: string; items: Item[] }) {
  const m = html.match(/window\.__PRELOADED_STATE__\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\);/);
  if (!m) return;
  const state = JSON.parse(JSON.parse(m[1]));
  const r: any = Object.values(state?.pages?.restaurant || {})[0];
  if (!r) return;
  out.name = r?.sections?.SECTION_BASIC_INFO?.name || '';
  for (const menu of r?.order?.menuList?.menus || []) {
    const top = menu.menu?.name || '';
    for (const c of menu.menu?.categories || []) {
      const sub = c.category?.name || '';
      const category = sub && sub !== top ? `${top} · ${sub}`.replace(/^ · /, '') : top || sub;
      for (const { item: it } of c.category?.items || []) {
        if (!it?.name) continue;
        const slugs: string[] = [...(it.dietary_slugs || []), ...(it.tag_slugs || [])];
        const veg = slugs.includes('veg') ? true : slugs.includes('non-veg') || slugs.includes('egg') ? false : null;
        out.items.push({
          name: String(it.name).trim(),
          category,
          price: Number(it.display_price ?? it.price ?? it.default_price) || null,
          description: String(it.desc || '').trim(),
          veg,
          egg: slugs.includes('egg'),
          image: it.item_image_url || it.media?.[0]?.image?.url || undefined,
        });
      }
    }
  }
}

function parseNextData(html: string, out: { name: string; menuImages: string[] }) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return;
  const p = JSON.parse(m[1])?.props?.pageProps || {};
  const d = p.detailPageDataV2 || {};
  out.name ||= d.name || p.metaData?.jsonSchema?.mainEntity?.name || '';
  for (const tab of d.menus || []) for (const c of tab.content || []) if (c.image) out.menuImages.push(c.image);
}

// schema.org data many listing sites embed: Restaurant → hasMenu → hasMenuSection → hasMenuItem / image.
function parseJsonLd(html: string, out: { name: string; items: Item[]; menuImages: string[] }) {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    let data: any;
    try { data = JSON.parse(m[1]); } catch { continue; }
    const nodes: any[] = [];
    const walk = (o: any) => {
      if (Array.isArray(o)) return o.forEach(walk);
      if (o && typeof o === 'object') { nodes.push(o); Object.values(o).forEach(walk); }
    };
    walk(data);
    for (const n of nodes) {
      if (!out.name && /Restaurant|FoodEstablishment|CafeOrCoffeeShop/.test(String(n['@type'])) && n.name) out.name = n.name;
      if (n['@type'] !== 'MenuSection') continue;
      const imgs = Array.isArray(n.image) ? n.image : n.image ? [n.image] : [];
      out.menuImages.push(...imgs.map((x: any) => (typeof x === 'string' ? x : x?.url)).filter(Boolean));
      const items = Array.isArray(n.hasMenuItem) ? n.hasMenuItem : n.hasMenuItem ? [n.hasMenuItem] : [];
      if (out.items.length) continue; // already have a better source
      for (const it of items) {
        const offer = Array.isArray(it.offers) ? it.offers[0] : it.offers;
        const diet = String(it.suitableForDiet || '');
        out.items.push({
          name: String(it.name || '').trim(),
          category: n.name || 'Menu',
          price: Number(offer?.price) || null,
          description: String(it.description || '').trim(),
          veg: /Vegetarian|Vegan/i.test(diet) ? true : null,
          egg: false,
        });
      }
    }
  }
  out.items = out.items.filter((i) => i.name);
}
