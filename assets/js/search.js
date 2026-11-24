/* ==========================================================
   Menu search — keyword + structured filters, no AI.

   parseQuery("something cold without coffee")
     → { filters: { temp: 'cold', coffee: false }, terms: [], labels: ['Cold', 'No coffee'] }
   parseQuery("vegetarian meal under ₹300")
     → { filters: { veg: true, course: 'meal', maxPrice: 300 }, terms: [], labels: [...] }

   Filters from the query, the quick chips and the filter sheet are merged
   with mergeFilters() and applied with matchDish().
   ========================================================== */

const STOP = new Set(
  ('a an the some something anything any with and or for me i im want wanna would like please to of in on at ' +
    'that this is are be get give show find dish dishes item items thing things what whats got have has can could ' +
    'you your my our i\'d id need looking look nice good great best really very just only one also maybe kind sort ' +
    'rs inr price priced cost costs costing')
    .split(' '),
);

// Words that mean "not X". Order matters: longer phrases first.
const NEG = ['without', 'free of', 'no', 'not', 'non', 'avoid', 'skip', 'minus', 'zero', 'less'];

// Things a guest can exclude → filter key.
const EXCLUDABLE = [
  { words: ['coffee', 'caffeine', 'espresso', 'caffeinated'], key: 'noCoffee', label: 'No coffee' },
  { words: ['egg', 'eggs'], key: 'noEgg', label: 'No egg' },
  { words: ['dairy', 'milk', 'lactose', 'cheese', 'cream'], key: 'noDairy', label: 'No dairy' },
  { words: ['gluten', 'wheat', 'bread'], key: 'noGluten', label: 'No gluten' },
  { words: ['nut', 'nuts', 'peanut', 'peanuts'], key: 'noNuts', label: 'No nuts' },
  { words: ['meat', 'chicken'], key: 'noMeat', label: 'No meat' },
  { words: ['spice', 'spicy', 'chilli', 'chili', 'heat'], key: 'notSpicy', label: 'Not spicy' },
  { words: ['sugar', 'sweet', 'sugary'], key: 'noSugar', label: 'Less sweet' },
];

// Positive intent words → filter patch.
const POSITIVE = [
  { re: /\bnon[\s-]?veg(etarian)?\b/, patch: { nonveg: true }, label: 'Non-veg' },
  { re: /\b(vegan|plant[\s-]?based|dairy[\s-]?free and egg)\b/, patch: { vegan: true }, label: 'Vegan' },
  { re: /\b(veg|vegetarian|veggie|pure veg)\b/, patch: { veg: true }, label: 'Veg' },
  { re: /\b(eggs?|eggy|omelett?e)\b/, patch: { egg: true }, label: 'With egg' },
  { re: /\b(mild)\b/, patch: { notSpicy: true }, label: 'Not spicy' },
  { re: /\b(spicy|spice|fiery|chilli|chili)\b/, patch: { spicy: true }, label: 'Spicy' },
  { re: /\b(cold|iced|ice|chilled|cool|cooler|refreshing|frosty|summer)\b/, patch: { temp: 'cold' }, label: 'Cold' },
  { re: /\b(hot(?!\s+choc)|warm|steaming|cosy|cozy)\b/, patch: { temp: 'hot' }, label: 'Hot' },
  { re: /\b(drinks?|beverages?|sip|thirsty|to drink)\b/, patch: { group: 'drinks' }, label: 'Drinks' },
  { re: /\b(meals?|hungry|filling|lunch|dinner|brunch|main|mains)\b/, patch: { group: 'food', course: 'meal' }, label: 'Meals' },
  { re: /\b(snacks?|bites?|munch|nibbles?|sides?)\b/, patch: { group: 'food', course: 'snack' }, label: 'Snacks' },
  { re: /\b(food|eat|eats|something to eat)\b/, patch: { group: 'food' }, label: 'Food' },
  { re: /\b(quick|fast|hurry|rush|quickly)\b/, patch: { quick: true }, label: 'Ready in ≤10 min' },
  { re: /\b(light|healthy|low[\s-]?cal(orie)?s?)\b/, patch: { light: true }, label: 'Light' },
  { re: /\b(popular|bestsellers?|best[\s-]?sellers?|famous|favou?rites?|recommended|must[\s-]?try)\b/, patch: { popular: true }, label: 'Popular' },
  { re: /\b(cheap|budget|affordable|inexpensive)\b/, patch: { maxPrice: 300 }, label: 'Budget' },
];

// Keyword synonyms: query word → extra words to look for.
const SYNONYMS = {
  coffee: ['espresso', 'latte', 'cappuccino', 'americano', 'mocha', 'brew', 'macchiato'],
  tea: ['chai', 'matcha', 'hibiscus'],
  sandwich: ['toast', 'club'],
  sandwiches: ['toast', 'club'],
  shake: ['frappe'],
  milkshake: ['frappe'],
  chocolate: ['mocha', 'choc', 'cocoa'],
  noodles: ['pasta', 'spaghetti'],
  wrap: ['burrito'],
  salad: ['caesar', 'bowl'],
  chips: ['fries'],
  dip: ['hummus', 'salsa'],
};

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .replace(/&/g, ' and ');

const stem = (w) => w.replace(/(ies)$/, 'y').replace(/(es)$/, '').replace(/s$/, '');

export function parseQuery(raw) {
  const filters = {};
  const labels = [];
  const add = (patch, label) => {
    Object.assign(filters, patch);
    if (label && !labels.includes(label)) labels.push(label);
  };
  let s = ` ${norm(raw).replace(/[^\p{L}\p{N}₹<>.\s-]/gu, ' ')} `;

  // ---- Price ----
  const NUM = String.raw`(?:₹|rs\.?|inr)?\s*(\d{2,5})\s*(?:₹|rs\.?|rupees?|inr|\/-)?`;
  s = s.replace(new RegExp(String.raw`\b(?:under|below|less than|upto|up to|within|max(?:imum)?|cheaper than|not more than|at most|<)\s*${NUM}`, 'g'), (_, n) => {
    add({ maxPrice: +n }, `Under ₹${n}`);
    return ' ';
  });
  s = s.replace(new RegExp(String.raw`\b(?:over|above|more than|min(?:imum)?|at least|>)\s*${NUM}`, 'g'), (_, n) => {
    add({ minPrice: +n }, `Over ₹${n}`);
    return ' ';
  });
  s = s.replace(new RegExp(String.raw`\b(?:between|from)\s*${NUM}\s*(?:and|to|-)\s*${NUM}`, 'g'), (_, a, b) => {
    add({ minPrice: Math.min(+a, +b), maxPrice: Math.max(+a, +b) }, `₹${Math.min(a, b)}–₹${Math.max(a, b)}`);
    return ' ';
  });
  s = s.replace(/(?:₹|rs\.?\s*)(\d{2,5})\b/g, (_, n) => {
    add({ maxPrice: +n }, `Under ₹${n}`);
    return ' ';
  });

  // ---- "non veg" before negations so "non" isn't read as "not" ----
  s = s.replace(/\bnon[\s-]?veg(etarian)?\b/g, () => {
    add({ nonveg: true }, 'Non-veg');
    return ' ';
  });
  s = s.replace(/\b(caffeine|coffee|sugar|gluten|dairy|egg|nut|lactose)[\s-]?free\b/g, (_, w) => {
    const ex = EXCLUDABLE.find((e) => e.words.includes(w) || (w === 'lactose' && e.key === 'noDairy'));
    if (ex) add({ [ex.key]: true }, ex.label);
    return ' ';
  });

  // ---- Negations: "without coffee", "no egg", "not spicy", "avoid nuts" ----
  for (const neg of NEG) {
    const re = new RegExp(String.raw`\b${neg}\s+(?:any\s+|too\s+|so\s+)?([a-z]+)(?:\s+(?:or|and|nor|,)\s+([a-z]+))?`, 'g');
    s = s.replace(re, (whole, w1, w2) => {
      let hit = false;
      for (const w of [w1, w2].filter(Boolean)) {
        const ex = EXCLUDABLE.find((e) => e.words.includes(w) || e.words.includes(stem(w)));
        if (ex) {
          add({ [ex.key]: true }, ex.label);
          hit = true;
        }
      }
      return hit ? ' ' : whole;
    });
  }

  // ---- Positive intents ----
  for (const p of POSITIVE) {
    if (p.re.test(s)) {
      // "cheap" should not override an explicit price
      if (p.patch.maxPrice && filters.maxPrice) continue;
      add(p.patch, p.label);
      s = s.replace(new RegExp(p.re.source, 'g'), ' ');
    }
  }

  // ---- Remaining words are keywords ----
  const terms = s
    .split(/[\s.-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));

  return { filters, terms, labels };
}

export function mergeFilters(...parts) {
  return Object.assign({}, ...parts.filter(Boolean));
}

export function hasFilters(f, terms = []) {
  return terms.length > 0 || Object.values(f).some((v) => v !== undefined && v !== null && v !== false);
}

const has = (d, allergen) => (d.allergens || []).some((a) => norm(a).includes(allergen));

/** ctx: { groupOf(d) } */
export function matchDish(d, f, ctx) {
  const group = ctx.groupOf(d);
  const diet = d.diet || {};
  const isMeat = diet.veg === false && !diet.egg;
  const hasEgg = Boolean(diet.egg) || has(d, 'egg');

  if (f.group && group !== f.group) return false;
  if (f.course === 'meal' && d.course !== 'meal') return false;
  if (f.course === 'snack' && !['snack', 'side'].includes(d.course)) return false;
  if (f.temp) {
    if (group !== 'drinks') return false; // temperature is about drinks
    if (d.temp !== f.temp) return false;
  }
  if (f.popular && !(d.tags?.includes('most-loved') || d.tags?.includes('bestseller') || d.badges?.includes('bestseller'))) return false;
  if (f.veg && !diet.veg) return false;
  if (f.vegan && !diet.vegan) return false;
  if (f.nonveg && diet.veg !== false) return false;
  if (f.egg && !hasEgg) return false;
  if (f.noEgg && hasEgg) return false;
  if (f.noMeat && isMeat) return false;
  if (f.noDairy && (has(d, 'dairy') || has(d, 'milk'))) return false;
  if (f.noGluten && has(d, 'gluten')) return false;
  if (f.noNuts && (has(d, 'nut') || has(d, 'peanut'))) return false;
  if (f.noCoffee && d.coffee) return false;
  if (f.noSugar && /condensed|caramel|biscoff|chocolate|sweet|honey|glaze|frappe|ice cream/i.test(`${d.name} ${d.description}`)) return false;
  if (f.notSpicy && d.spice > 0) return false;
  if (f.spicy && !(d.spice > 0)) return false;
  if (f.quick && !(d.prepTime && d.prepTime <= 10)) return false;
  if (f.light && !(d.kcal && d.kcal <= 400)) return false;
  if (f.maxPrice != null && d.price > f.maxPrice) return false;
  if (f.minPrice != null && d.price < f.minPrice) return false;
  return true;
}

/** Keyword score: 0 = no match. All terms must match somewhere (AND) unless loose. */
export function scoreDish(d, terms, ctx, loose = false) {
  if (!terms.length) return 1;
  const name = norm(d.name);
  const rest = norm([d.description, ctx.categoryLabel(d), ctx.groupLabel(d), ...(d.tags || []), ...(d.badges || []), ...(d.allergens || [])].join(' '));
  let score = 0;
  let matched = 0;
  for (const t of terms) {
    const words = [t, stem(t), ...(SYNONYMS[t] || [])];
    let best = 0;
    for (const w of words) {
      if (!w || w.length < 2) continue;
      if (new RegExp(`\\b${w}`).test(name)) best = Math.max(best, w === t ? 10 : 6);
      else if (name.includes(w)) best = Math.max(best, 5);
      else if (new RegExp(`\\b${w}`).test(rest)) best = Math.max(best, w === t ? 4 : 2);
    }
    if (best) matched++;
    score += best;
  }
  if (!loose && matched < terms.length) return 0;
  return score;
}
