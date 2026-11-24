/* ==========================================================
   Menu import: CSV / Excel files and listing links (Zomato, AirMenus, EazyDiner, Swiggy Dineout).
   - readSpreadsheet(file) → rows, using the first sheet of an Excel file.
   - rowsToItems(rows) → { items, unknownColumns, missing }. Column names are matched loosely
     ("Item Name", "Dish", "Rate (₹)", "Veg/Non-Veg"…), so most existing menu sheets work as they are.
   - applyImport(menu, items, { replace }) adds the items to the menu and creates any missing
     categories, guessing Drinks/Food, hot/cold and coffee from the names.
   ========================================================== */

const SHEETJS = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';

export const TEMPLATE_CSV = [
  'Name,Category,Price,Description,Veg/Non-veg,Prep time (min),Photo URL,Video URL,Badges,Spice (0-3),Hot/Cold,Available',
  'Cappuccino,Hot Coffee,220,Espresso with steamed milk and a thick foam cap,Veg,5,,,Bestseller,0,Hot,Yes',
  'Iced Spanish Latte,Cold Coffee,290,Espresso with condensed milk over ice,Veg,5,,,,0,Cold,Yes',
  'Chicken Pesto Sandwich,Sandwiches,340,Grilled chicken with basil pesto on sourdough,Non-veg,12,,,New,1,,Yes',
].join('\n');

const FIELDS = {
  name: ['name', 'item', 'item name', 'items', 'dish', 'dish name', 'product', 'product name', 'title', 'menu item'],
  category: ['category', 'section', 'menu section', 'menu category', 'sub category', 'subcategory', 'item category', 'course'],
  group: ['group', 'menu', 'department', 'food or drink', 'drinks or food'],
  price: ['price', 'rate', 'mrp', 'cost', 'amount', 'selling price', 'price inr', 'price rs', 'price rupees'],
  description: ['description', 'desc', 'details', 'about', 'item description'],
  diet: ['veg', 'veg non veg', 'veg nonveg', 'diet', 'type', 'food type', 'dietary', 'veg or non veg', 'is veg', 'veg non veg egg'],
  prepTime: ['prep time', 'prep', 'preparation time', 'prep time min', 'prep time mins', 'time', 'minutes', 'ready in'],
  image: ['photo', 'image', 'photo url', 'image url', 'picture', 'img', 'image link', 'photo link'],
  video: ['video', 'video url', 'video link'],
  badges: ['badges', 'badge', 'tags', 'labels', 'highlight', 'tag'],
  spice: ['spice', 'spice level', 'spicy', 'spice 0 3', 'heat'],
  temp: ['hot cold', 'temperature', 'temp', 'served', 'hot or cold'],
  kcal: ['kcal', 'calories', 'cal', 'energy'],
  allergens: ['allergens', 'contains', 'allergy'],
  available: ['available', 'availability', 'in stock', 'status', 'stock'],
  vegan: ['vegan'],
  gf: ['gluten free', 'gf'],
};

const normHeader = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const HEADER_TO_FIELD = new Map();
for (const [field, names] of Object.entries(FIELDS)) for (const n of names) HEADER_TO_FIELD.set(n, field);

/* ---------- Reading files ---------- */
export async function readSpreadsheet(file) {
  const name = file.name.toLowerCase();
  if (/\.(xlsx|xlsm|xls|ods)$/.test(name)) {
    const XLSX = await import(SHEETJS);
    const wb = XLSX.read(await file.arrayBuffer());
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
  }
  if (/\.(csv|tsv|txt)$/.test(name) || file.type.startsWith('text/')) return parseCsv(await file.text());
  throw new Error('Use a .csv, .xlsx or .xls file.');
}

export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [head = [], ...body] = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/* ---------- Rows → items ---------- */
const truthy = (v) => /^(y|yes|true|1|available|in stock|on)$/i.test(String(v).trim());
const falsy = (v) => /^(n|no|false|0|sold out|out of stock|unavailable|off)$/i.test(String(v).trim());
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[₹,]|rs\.?|inr/gi, '').trim());
  return Number.isFinite(n) && String(v).trim() !== '' ? n : null;
};

function parseDiet(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/vegan/.test(s)) return { veg: true, vegan: true };
  if (/egg/.test(s)) return { veg: false, egg: true };
  if (/non|nv\b|meat|chicken|^n$|^no$|false|^0$|🔴|🟥/.test(s)) return { veg: false };
  if (/veg|^v$|^y$|yes|true|^1$|🟢|🟩/.test(s)) return { veg: true };
  return null;
}

export function rowsToItems(rows) {
  if (!rows.length) throw new Error('The file has no rows.');
  const headers = Object.keys(rows[0]);
  const map = {};
  const unknownColumns = [];
  for (const h of headers) {
    const f = HEADER_TO_FIELD.get(normHeader(h));
    if (f && !map[f]) map[f] = h;
    else if (!f && normHeader(h)) unknownColumns.push(h);
  }
  if (!map.name) throw new Error(`Couldn't find a column with item names. Name a column "Name" (found: ${headers.join(', ')}).`);
  const get = (r, f) => (map[f] ? String(r[map[f]] ?? '').trim() : '');

  const items = [];
  let lastCategory = '';
  for (const r of rows) {
    const name = get(r, 'name');
    if (!name) continue;
    const category = get(r, 'category') || lastCategory || 'Menu';
    lastCategory = category;
    const diet = parseDiet(get(r, 'diet'));
    items.push({
      name,
      category,
      group: /drink|beverage/i.test(get(r, 'group')) ? 'drinks' : /food/i.test(get(r, 'group')) ? 'food' : undefined,
      price: num(get(r, 'price')),
      description: get(r, 'description'),
      veg: diet ? diet.veg : null,
      egg: Boolean(diet?.egg),
      vegan: Boolean(diet?.vegan) || truthy(get(r, 'vegan')),
      gf: truthy(get(r, 'gf')),
      prepTime: num(get(r, 'prepTime')),
      image: /^https?:\/\//.test(get(r, 'image')) ? get(r, 'image') : '',
      video: /^https?:\/\//.test(get(r, 'video')) ? get(r, 'video') : '',
      badges: get(r, 'badges').split(/[,;|/]/).map((b) => b.trim()).filter(Boolean),
      spice: Math.max(0, Math.min(3, num(get(r, 'spice')) ?? 0)),
      temp: /cold|iced|chilled/i.test(get(r, 'temp')) ? 'cold' : /hot|warm/i.test(get(r, 'temp')) ? 'hot' : undefined,
      kcal: num(get(r, 'kcal')),
      allergens: get(r, 'allergens').split(/[,;|]/).map((a) => a.trim()).filter(Boolean),
      available: map.available ? !falsy(get(r, 'available')) : true,
    });
  }
  if (!items.length) throw new Error('No rows had an item name.');
  return { items, unknownColumns, matched: map };
}

/* ---------- Items → menu ---------- */
const DRINK_RE = /coffee|espresso|latte|cappuccino|americano|mocha|macchiato|cortado|flat white|frapp|cold brew|\btea\b|chai|matcha|shake|smoothie|juice|mojito|lemonade|soda|cooler|beverage|drink|lassi|hot chocolate|affogato|brew|iced|kombucha|mocktail|water/i;
const COLD_RE = /iced|\bice\b|cold|frapp|shake|smoothie|mojito|lemonade|cooler|soda|juice|affogato|lassi|kombucha|mocktail|tonic|chilled/i;
const COFFEE_RE = /coffee|espresso|latte|cappuccino|americano|mocha|macchiato|cortado|flat white|cold brew|affogato|frappuccino/i;
const SIDE_RE = /fries|dip\b|dips|wedges|nachos|garlic bread|side/i;

export function applyImport(menu, items, { replace = false, slugify }) {
  menu.sections ||= [];
  menu.dishes ||= [];
  menu.badges ||= {};
  if (replace) {
    menu.sections = menu.sections.filter((s) => s.type !== 'category');
    menu.dishes = [];
  }
  const cats = () => menu.sections.filter((s) => s.type === 'category');
  const stats = { added: 0, updated: 0, newCategories: 0 };

  const categoryFor = (label, groupHint, firstItemName) => {
    const found = cats().find((c) => c.label.toLowerCase() === label.toLowerCase() || c.match.toLowerCase() === label.toLowerCase());
    if (found) return found;
    let id = slugify(label);
    let n = 2;
    while (menu.sections.some((s) => s.id === id)) id = `${slugify(label)}-${n++}`;
    const group = groupHint || (DRINK_RE.test(label) || (!/food|meal|snack|bite|dessert|bake/i.test(label) && DRINK_RE.test(firstItemName)) ? 'drinks' : 'food');
    const sec = { id, label, type: 'category', match: label, group };
    // Keep drinks before food, as on the guest menu.
    const at = group === 'drinks' ? menu.sections.findIndex((s) => s.type === 'category' && s.group === 'food') : -1;
    if (at >= 0) menu.sections.splice(at, 0, sec);
    else menu.sections.push(sec);
    stats.newCategories++;
    return sec;
  };

  const badgeKey = (label) => {
    const key = Object.keys(menu.badges).find((k) => k === slugify(label) || menu.badges[k].label.toLowerCase() === label.toLowerCase());
    if (key) return key;
    const k = slugify(label);
    menu.badges[k] = { label, tone: 'neutral' };
    return k;
  };

  for (const it of items) {
    const cat = categoryFor(it.category, it.group, it.name);
    const isDrink = cat.group === 'drinks';
    const existing = menu.dishes.find((d) => d.name.toLowerCase() === it.name.toLowerCase() && d.category === cat.match);
    if (existing) {
      // Re-importing a sheet updates what the sheet says and keeps photos, videos and stories added since.
      if (it.price != null) existing.price = it.price;
      if (it.description) existing.description = it.description;
      if (it.veg != null) existing.diet = { ...existing.diet, veg: it.veg, egg: it.egg, vegan: it.vegan || existing.diet?.vegan };
      if (it.prepTime > 0) existing.prepTime = it.prepTime;
      if (it.image && !existing.image) existing.image = it.image; // never replace a photo the owner already has
      if (it.video) existing.video = it.video;
      if (it.available != null) existing.available = it.available;
      stats.updated++;
      continue;
    }
    let id = slugify(it.name);
    let n = 2;
    while (menu.dishes.some((d) => d.id === id)) id = `${slugify(it.name)}-${n++}`;
    const text = `${it.name} ${it.description || ''}`;
    menu.dishes.push({
      id,
      name: it.name,
      category: cat.match,
      price: it.price ?? 0,
      ...(it.prepTime > 0 ? { prepTime: it.prepTime } : {}), // no guessed time: guests only see one the restaurant gave
      image: it.image || '',
      ...(it.video ? { video: it.video } : {}),
      description: it.description || '',
      tags: [],
      badges: (it.badges || []).map(badgeKey),
      diet: { veg: it.veg ?? true, egg: Boolean(it.egg), vegan: Boolean(it.vegan), gf: Boolean(it.gf) },
      spice: it.spice || 0,
      ...(isDrink ? { temp: it.temp || (COLD_RE.test(text) ? 'cold' : 'hot') } : it.temp ? { temp: it.temp } : {}),
      coffee: COFFEE_RE.test(text),
      course: isDrink ? 'drink' : SIDE_RE.test(it.name) ? 'side' : 'meal',
      ...(it.kcal ? { kcal: it.kcal } : {}),
      ...(it.allergens?.length ? { allergens: it.allergens } : {}),
      available: it.available !== false,
    });
    stats.added++;
  }
  return stats;
}
