# Pilot backend (Supabase, free tier)

Without this, the dashboard runs in **demo mode**, where edits and uploads stay in the browser they were made in.
With it, restaurant owners sign in at `/admin/`, and their menu, photos and videos are saved online and shown to every guest.

The free tier covers a pilot comfortably: 500 MB database, 1 GB file storage, 5 GB bandwidth a month, 50 MB per file.
Videos use the most bandwidth. Ask owners for 720p clips under about 15 MB.

## One-time setup (about 10 minutes)

1. Create a project at <https://supabase.com> (free plan). Pick the region closest to your guests, e.g. **Mumbai (ap-south-1)**.
2. **SQL Editor → New query**: paste [`schema.sql`](schema.sql) and run it.
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
   `https://officialprathamsharma.github.io/qr-menu/admin/`, so password-reset emails link back to it.
5. Commit and push. GitHub Pages redeploys in about a minute.

## Onboarding a restaurant

1. **Authentication → Users → Add user**: enter the owner's email and a temporary password (or send an invite).
2. Edit and run [`add-restaurant.sql`](add-restaurant.sql) with the restaurant's slug and the owner's email.
3. The owner gets an invite email. Its link opens the dashboard, where they choose a password. They then click
   **Start from sample** (their own `data/<slug>.json` if it exists, otherwise the Arabico sample) or **Blank menu**,
   then **Save & publish**.
4. Each table's QR code: `https://<site>/?r=<slug>&t=<table number>`.

## Demo account

The `demo` store (`?r=demo`) belongs to the project owner's login and is for showing the dashboard to prospects.
Edits there never affect a real restaurant's menu.

## How data flows

- Guest menu: reads `menus.data` for the slug. If Supabase is unreachable or the row is empty, it falls back to
  `data/<slug>.json`.
- Dashboard: **Save & publish** writes the whole menu JSON. Photos are resized in the browser (max 1280 px, WebP)
  before upload. Videos upload as-is, up to 50 MB.
- Files are stored as `menu-media/<slug>/{photos,videos,brand}/…`. Owners can only write inside their own folder.
