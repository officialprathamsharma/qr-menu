-- Onboard a pilot restaurant.
-- 1. Supabase → Authentication → Users → "Add user" (or "Invite") with the owner's email.
-- 2. Edit the two values below and run this in the SQL Editor.
-- 3. The owner signs in at https://<your-site>/admin/ and clicks "Start from sample"
--    (if data/<slug>.json exists) or "Blank menu", then "Save & publish".

insert into public.menus (slug, owner_id)
select 'arabico', id                       -- ← restaurant slug (used in the QR link: ?r=arabico)
from auth.users
where email = 'owner@example.com'          -- ← owner's login email
on conflict (slug) do update set owner_id = excluded.owner_id;
