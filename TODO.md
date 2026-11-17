# Roadmap / TODO

## Done in the MVP
- [x] Dark, mobile-first card menu (black background, customer primary/secondary colours)
- [x] Top tabs as the only navigation: curated tabs ("Most loved at {name}", "Chef's Picks") + categories
- [x] Video autoplay for the topmost visible video, touch-to-play, lazy loading, data-saver aware
- [x] Prep time, badges, veg/non-veg mark, vegan/GF, spice level, kcal, allergens
- [x] Dish detail sheet: story, chef's note, tappable pairings; closes with swipe or back button
- [x] Desktop gate ("scan with your phone") with a preview option
- [x] Per-restaurant JSON config (colours + logo); real Arabico Janakpuri menu as the demo
- [x] Egg / veg / non-veg marks; curated section order
- [x] Compact list rows (~4–5 per screen) + featured video rails; prep-time / hot-cold / spice pills on every item
- [x] Search with plain-language rules (no AI), quick filters (Popular, Veg, Drinks, Food), full diet filters
- [x] Category overview + Drinks/Food groups with expandable category headings
- [x] Tap-to-play (no touchstart), visible play/pause, autoplay switch, 8 s loading fallback to the photo
- [x] Restaurant dashboard: items, photos/videos (resize, focus point, frame-as-photo), availability, order, categories, branding
- [x] Supabase pilot backend: schema + RLS + media bucket (setup in supabase/README.md)

## Next: branch lock with geolocation (multi-branch restaurants)
Goal: a licence bought for one branch only works at that branch.

- [ ] Add `branches[]` with `{ id, lat, lng, radiusM }` (field already in the JSON) and a `b=<branchId>` URL param on each QR
- [ ] On load, call `navigator.geolocation.getCurrentPosition` (HTTPS only) and check the guest is within `radiusM` (haversine distance)
- [ ] Outside the radius or permission denied: show a friendly "This menu is available at <branch>" screen
      (decide a policy: block, or allow with a soft warning, since GPS indoors can be off by 50–100 m)
- [ ] **Real enforcement has to happen on a server.** Client-side checks are easy to bypass. Licence = (restaurant, branch);
      a backend issues/validates the menu data only for licensed branch IDs, and the dashboard limits how many branches can be created
- [ ] Optional: rotating signed table tokens in the QR (`?k=<signed>`) so screenshots of the QR expire

## Pilot next steps
- [x] Create the Supabase project, fill in assets/js/config.js
- [x] Demo store (`demo`, Little Bean Café) linked to the project owner's login
- [x] Import menus from Excel/CSV and Zomato links (EazyDiner/Dineout: menu photos only)
- [ ] Onboard Arabico's owner (invite + add-restaurant.sql)
- [ ] Optional: read EazyDiner/Dineout menu photos into items (OCR or an AI vision model)
- [ ] Guest ordering: cart → "send to kitchen" with table number → live order inbox in the dashboard (Supabase Realtime)
- [ ] Delete orphaned media from storage when a photo/video is replaced
- [ ] Optional AI search for questions the rules can't parse (send only the query + menu, never guest data)

## Product
- [ ] Replace Arabico's placeholder descriptions/prep times/badges with the owner's real ones; shoot their own dish videos
- [ ] Media pipeline: compress uploads to ~720p H.264 + poster frame (Cloudinary/Bunny free tiers, or ffmpeg in a function)
- [ ] QR generator in the dashboard (per table, printable PDF table tents)
- [ ] "My picks" list a guest can show the waiter → later: ordering / call waiter / bill
- [ ] Mark dishes as sold out / time-limited (breakfast, happy hour)
- [ ] Multi-language menus (English + Arabic/Hindi), RTL support
- [ ] Analytics: most-viewed dishes, video watch time, scans per table
- [ ] PWA manifest + offline caching of the menu shell
- [ ] Custom domains per restaurant (menu.arabico.com)

## Tech debt
- [ ] Replace the hot-linked demo media (Unsplash/Mixkit) with self-hosted files
- [ ] The desktop gate QR uses api.qrserver.com; generate it locally instead
- [ ] Add a small test page for the JSON schema (validate required fields)
