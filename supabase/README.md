# Pilot backend (Supabase, free tier)

Without this, the dashboard runs in **demo mode**, where edits and uploads stay in the browser they were made in.
With it, restaurant owners sign in at `/admin/`, and their menu, photos and videos are saved online and shown to every guest.

The free tier covers a pilot comfortably: 500 MB database, 1 GB file storage, 5 GB bandwidth a month, 50 MB per file.
Videos use the most bandwidth. Ask owners for 720p clips under about 15 MB.

## One-time setup (about 10 minutes)

1. Create a project at <https://supabase.com> (free plan). Pick the region closest to your guests, e.g. **Mumbai (ap-south-1)**.
2. **SQL Editor → New query**: paste [`schema.sql`](schema.sql) and run it. Then do the same with
   [`orders.sql`](orders.sql) (table ordering: orders table, `place_order` function, live updates).
3. **Project Settings → API**: copy the **Project URL** and the **anon public** key into
   [`assets/js/config.js`](../assets/js/config.js):
   ```js
   export const CONFIG = {
     supabaseUrl: 'https://xxxx.supabase.co',
     supabaseAnonKey: 'eyJ…',
     mediaBucket: 'menu-media',
   };
   ```
   The anon key is meant to be public. Row Level Security in `schema.sql` controls what it can do.
   **Never** put the `service_role` key in the site.
4. **Authentication → URL Configuration**: set the Site URL to your dashboard, e.g.
   `https://menu.heynomnom.in/admin/`, so password-reset emails link back to it.
5. Commit and push. GitHub Pages redeploys in about a minute.

## Onboarding a restaurant (super admin)

One-time: run [`admin.sql`](admin.sql) (makes the login that owns the `demo` menu a super admin) and deploy
[`functions/invite-owner`](functions/invite-owner/index.ts) as an Edge Function.

1. Sign in at `https://menu.heynomnom.in/admin/`. Super admins land on **Partners**: every restaurant with its status,
   dish/video/photo counts, owner contact and last sign-in, menu link and main QR code (PNG poster or SVG).
2. **Add restaurant**: name, link name (the `?r=` slug), owner's email, phone and city.
3. Build the menu: **Import a menu** (Excel, CSV or a Zomato link), **Start from sample** (`data/<slug>.json` if it
   exists, otherwise `data/demo.json`) or **Blank menu**, then **Save & publish** (you're asked to confirm).
4. After the first publish the dashboard offers to send the owner's **welcome email** (also on each partner card).
   It's sent from info@heynomnom.in and links to `/admin/?token_hash=…`; the one-time token is only used when the
   owner submits their new password, so email link scanners can't use it up.
5. Main QR: `https://menu.heynomnom.in/?r=<slug>`. Table QR cards: open the menu → **Tables & QR**
   (`?r=<slug>&t=<table number>`).

**Pause menu** (on each partner card, e.g. when a restaurant hasn't paid): after you confirm, the menu link and every
QR code (main and table cards) show "Menu unavailable" and table ordering stops. Nothing is deleted. The owner can still
sign in and sees a "paused" banner. **Resume menu** turns everything back on. Needs
[`pause-and-cleanup.sql`](pause-and-cleanup.sql) (run once).

Editing a partner's menu always asks first, shows a banner while you edit, and asks again before publishing or
switching table ordering. Owners still only see their own restaurant.

### Email (Authentication → Emails)
- **SMTP Settings**: host `smtp.zoho.in`, port 465, username `pratham@heynomnom.in` (a Zoho app password),
  sender `info@heynomnom.in`, name NomNom.
- **Templates → Invite user / Reset password**: NomNom-branded; buttons link to
  `https://menu.heynomnom.in/admin/?token_hash={{ .TokenHash }}&type=invite` (or `type=recovery`).

## Demo account

The `demo` store (`?r=demo`, "Little Bean Café", 21 items) belongs to the project owner's login and is for showing
the dashboard to prospects. Edits there never affect a real restaurant's menu.

## Import from a link (Edge Function)

`functions/import-menu/index.ts` powers the dashboard's **Import → From a listing link**. It is deployed as the
`import-menu` Edge Function (Supabase dashboard → Edge Functions → Deploy a new function → Via editor, then paste the
file). It only fetches Zomato, EazyDiner and Swiggy Dineout pages.

- **Zomato**: the full item list (name, category, price, description, veg/non-veg) and item photos, for restaurants
  with online ordering. When the import is applied, each photo is downloaded through the same function (its
  `{ image }` mode, Zomato image servers only), resized in the browser like any upload (≤1280 px WebP plus a small card
  copy) and saved in the restaurant's own `photos/` folder, so the menu never loads images from Zomato. Items that
  already have a photo keep it, and photos that can't be copied are left empty to add by hand.
- **EazyDiner / Dineout**: these sites only publish photos of the printed menu, so the dashboard shows those photos for
  the owner to copy into the spreadsheet template.
- Only import a restaurant's listing with that restaurant's permission, and expect these sites to change their pages
  or block requests now and then; the spreadsheet import always works.

## How data flows

- Guest menu: reads `menus.data` for the slug. If Supabase is unreachable or the row is empty, it falls back to
  `data/<slug>.json`.
- Dashboard: **Save & publish** writes the whole menu JSON. Photos are resized in the browser (max 1280 px, WebP)
  before upload. Videos upload as-is, up to 50 MB.
- Files are stored as `menu-media/<slug>/{photos,videos,brand}/…`. Owners can only write inside their own folder.
- Item videos can be up to 15 seconds; longer clips are refused at upload with a note to trim them.
- Clean-up: after each **Save & publish**, files in `<slug>/` that the published menu no longer uses are deleted
  (a replaced or removed photo/video goes straight away; unused uploads that were never published go after a day).
