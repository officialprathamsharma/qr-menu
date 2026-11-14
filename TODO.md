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

## Next: branch lock with geolocation (multi-branch restaurants)
Goal: a licence bought for one branch only works at that branch.

- [ ] Add `branches[]` with `{ id, lat, lng, radiusM }` (field already in the JSON) and a `b=<branchId>` URL param on each QR
- [ ] On load, call `navigator.geolocation.getCurrentPosition` (HTTPS only) and check the guest is within `radiusM` (haversine distance)
- [ ] Outside the radius or permission denied: show a friendly "This menu is available at <branch>" screen
      (decide a policy: block, or allow with a soft warning, since GPS indoors can be off by 50–100 m)
- [ ] **Real enforcement has to happen on a server.** Client-side checks are easy to bypass. Licence = (restaurant, branch);
      a backend issues/validates the menu data only for licensed branch IDs, and the dashboard limits how many branches can be created
- [ ] Optional: rotating signed table tokens in the QR (`?k=<signed>`) so screenshots of the QR expire

## Product
- [ ] Admin dashboard (owner-only): restaurant login, edit dishes/sections, upload photos/videos, pick colours + logo
- [ ] Replace Arabico's placeholder descriptions/prep times/badges with the owner's real ones; shoot their own dish videos
- [ ] Backend on a free tier (Supabase: Postgres + Auth + Storage), replacing the static JSON
- [ ] Media pipeline: compress uploads to ~720p H.264 + poster frame (Cloudinary/Bunny free tiers, or ffmpeg in a function)
- [ ] QR generator in the dashboard (per table, printable PDF table tents)
- [ ] Search + dietary filters (veg only, GF, no nuts)
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
