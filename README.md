# QR Menu: interactive restaurant menu (pilot MVP)

Guests scan a QR code on the table and get a dark, video-first menu built for phones.
Restaurant owners manage items, photos and videos from a simple dashboard.

There's **no build step and no dependencies**. It's plain HTML/CSS/JS hosted free on GitHub Pages. The pilot backend is
Supabase's free tier (optional; see [supabase/README.md](supabase/README.md)).

- Guest menu: `/?r=arabico&t=12`
- Dashboard: `/admin/?r=arabico`
- Live: <https://officialprathamsharma.github.io/qr-menu/?r=arabico&t=7>

## Run locally

```bash
cd ~/Pratham/qr-menu
python3 -m http.server 5173
```

Open <http://localhost:5173/?r=arabico&t=12> for the menu, or <http://localhost:5173/admin/> for the dashboard.
A desktop browser shows the "scan with your phone" screen; click **Preview on this screen**.

## Guest menu

- **Featured video rails** ("Most loved at Arabico", "Barista's Picks"): large cards, about 1.3 visible so the next one peeks in.
- **The full menu** uses compact rows: name, 2-line description, price, and pills for prep time, hot/cold, spice and
  vegan, with a 108 px photo on the right. That fits about 4–5 items per phone screen.
  Why: NN/g and Baymard research says lists with cropped thumbnails let people compare quickly, and large cards
  should be kept for a few featured items.
- **Category overview** of Drinks and Food. Tap a category to jump to it. Each category is an expandable heading
  showing its item count and a peek of 3 photos.
- **Quick filters**: Popular · Veg · Drinks · Food. The ⚙ button in the search bar opens the full filters:
  Vegetarian / Vegan / No egg / Non-veg; leave out Dairy / Gluten / Nuts / Coffee; Hot / Cold;
  ready in ≤10 min, spicy or not, light (≤400 kcal); max price; and an autoplay on/off switch.
- **Plain-language search** with keywords and rules, no AI ([assets/js/search.js](assets/js/search.js)):
  - "something cold without coffee" → Cold · No coffee
  - "vegetarian meal under ₹300" → Veg · Meals · Under ₹300
  - Also understands "no egg", "not spicy", "quick snack", "between 200 and 300", "non veg wrap", "hot drink",
    "cheap", "light"…
  - The results header shows what it understood ("Showing: Cold · No coffee"). A query that matches a dish name
    ("cold brew") ranks that dish first. If no item matches every word, it falls back to the closest matches.
- **Video**:
  - Only one video plays at a time: the topmost one that's mostly on screen, always muted.
  - A **tap** toggles play/pause. Scrolling over a video never starts it, because there's no `touchstart` trigger.
  - Every video has a visible, labelled play/pause button (WCAG 2.2.2).
  - Autoplay is off by default for *reduce motion*, *data saver* and 2G users, and guests can switch it off.
  - A video that errors or hasn't started within 8 s is dropped and the photo stays.
- **Sold-out items** are greyed out with a "Sold out" tag and listed last in search results.

## Dashboard (`/admin/`)

- **Items**: search, filter by category, available/sold-out toggle, move up/down, add, edit, duplicate, delete.
- **Item editor**:
  - Photo upload (resized to WebP in the browser), plus tap-to-set focus point so crops keep the dish in view.
  - Video upload (≤50 MB, with a warning above 20 MB), plus **Use frame as photo**. Uploading a video with no
    photo creates the cover automatically.
  - Price, prep time, kcal, category, description, veg/egg/non-veg, vegan, gluten-free, contains coffee, spice,
    hot/cold, type (drink/meal/snack/side), allergens, badges, featured lists, story and chef note.
- **Categories**: rename, subtitle, Drinks/Food group, reorder, add, delete (only when empty); edit featured-list titles.
- **Branding** (owner-only): name, tagline, logo, currency, footer note, primary/secondary colours with a live
  preview. The background always stays black.
- **Modes**:
  - *Demo* (no backend): saved in this browser. **Preview** opens the menu with `?source=local`.
  - *Live* (Supabase): owner sign-in, and **Save & publish** updates the menu for every guest.
- Export/import the menu as JSON.

## URL format

| Part | Example | Meaning |
|---|---|---|
| `r` | `?r=arabico` | Restaurant slug |
| `t` | `&t=12` | Table number shown in the header (optional) |
| `#cat-<id>` | `#cat-hot` | Opens and scrolls to a category |
| `preview` | `&preview` | Skips the desktop "use your phone" screen |
| `source=local` | `&source=local` | Shows the dashboard's demo-mode draft from this browser |

## Menu data

Each restaurant's menu is one JSON document: `data/<slug>.json` on the static site, or `menus.data` in Supabase.

- `groups`: `[{id:'drinks',label:'Drinks'}, {id:'food',label:'Food'}]`
- `sections`:
  - `type:"category"` sections have `match` (the dish category) and `group`.
  - `type:"tag"` sections are the featured rails (dishes whose `tags` include `match`, with optional curated `order`).
- `dishes`: `id, name, category, price, prepTime, image, focus?, video?, description, tags, badges,
  diet {veg, egg, vegan, gf}, spice 0–3, temp hot|cold, coffee, course drink|meal|snack|side, kcal?, allergens?,
  story?, chefNote?, pairings?, available`

> **About the Arabico demo data:** item names, sections and prices follow Arabico's public Zomato listing (Nov 2026).
> Most descriptions, prep times, badges, kcal and pairings are **placeholders**, and the photos and videos are free
> stock (Unsplash and Mixkit). Confirm everything with the owner, who can replace it from the dashboard.
> `tools/build-demo-data.py` regenerates `data/arabico.json`.

## Project layout

```
index.html                 guest menu shell
assets/css/styles.css      guest styles (dark theme, rows, rails, sheets)
assets/js/app.js           guest app: browse, search, filters, video engine, dish sheet
assets/js/search.js        query parser + filtering/scoring (no AI)
assets/js/store.js         data layer: Supabase | this browser (IndexedDB) | static JSON
assets/js/config.js        Supabase URL + anon key (empty = demo mode)
admin/                     restaurant dashboard
supabase/                  schema, onboarding SQL, setup guide
data/arabico.json          demo restaurant
tools/build-demo-data.py   regenerates the demo data
TODO.md                    roadmap
```
