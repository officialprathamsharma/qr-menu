-- NomNom super admin — run once in Supabase → SQL Editor (after schema.sql and orders.sql).
-- Adds: an admins list, a private partners table (owner contact details), admin rights over every menu,
-- its media and its orders, and admin_partners() for the Partners panel in /admin/.

-- 1. Who is a super admin ------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
drop policy if exists "admins see themselves" on public.admins;
create policy "admins see themselves" on public.admins
  for select to authenticated using (user_id = auth.uid());

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- 2. Partner details (private: only admins can read or write) ------------------------
create table if not exists public.partners (
  slug        text primary key references public.menus (slug) on delete cascade,
  name        text not null,
  owner_email text,
  owner_phone text,
  city        text,
  notes       text,
  invited_at  timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.partners enable row level security;
drop policy if exists "admins manage partners" on public.partners;
create policy "admins manage partners" on public.partners
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 3. Admins can create and edit any menu (owners keep editing only their own) ---------
drop policy if exists "admins insert menus" on public.menus;
create policy "admins insert menus" on public.menus
  for insert to authenticated with check (public.is_admin());
drop policy if exists "admins update menus" on public.menus;
create policy "admins update menus" on public.menus
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- 4. ...and any restaurant's photos and videos ----------------------------------------
drop policy if exists "admins upload media" on storage.objects;
create policy "admins upload media" on storage.objects
  for insert to authenticated with check (bucket_id = 'menu-media' and public.is_admin());
drop policy if exists "admins update media" on storage.objects;
create policy "admins update media" on storage.objects
  for update to authenticated using (bucket_id = 'menu-media' and public.is_admin());
drop policy if exists "admins delete media" on storage.objects;
create policy "admins delete media" on storage.objects
  for delete to authenticated using (bucket_id = 'menu-media' and public.is_admin());

-- 5. ...and see orders (read only) ------------------------------------------------------
drop policy if exists "admins read orders" on public.orders;
create policy "admins read orders" on public.orders
  for select to authenticated using (public.is_admin());

-- 6. Everything the Partners panel shows, in one call -----------------------------------
create or replace function public.admin_partners()
returns table (
  slug text, name text, owner_email text, owner_phone text, city text, notes text,
  owner_linked boolean, owner_last_sign_in timestamptz, invited_at timestamptz,
  items int, videos int, photos int, ordering boolean, published boolean,
  updated_at timestamptz, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return query
  select m.slug,
         coalesce(p.name, m.data->>'name', m.slug),
         coalesce(p.owner_email, u.email::text),
         p.owner_phone, p.city, p.notes,
         m.owner_id is not null,
         case when u.email_confirmed_at is not null then u.last_sign_in_at end, -- invites stamp a sign-in time; count it only once accepted
         p.invited_at,
         coalesce(jsonb_array_length(m.data->'dishes'), 0),
         (select count(*)::int from jsonb_array_elements(coalesce(m.data->'dishes', '[]')) d where coalesce(d->>'video', '') <> ''),
         (select count(*)::int from jsonb_array_elements(coalesce(m.data->'dishes', '[]')) d where coalesce(d->>'image', '') <> ''),
         coalesce((m.data->'ordering'->>'enabled')::boolean, false),
         m.data <> '{}'::jsonb,
         m.updated_at,
         p.created_at
  from public.menus m
  left join public.partners p on p.slug = m.slug
  left join auth.users u on u.id = m.owner_id
  order by coalesce(p.created_at, m.updated_at) desc;
end $$;
revoke all on function public.admin_partners() from public;
grant execute on function public.admin_partners() to authenticated;

-- 7. Make the NomNom founder account a super admin (the login that owns the demo menu) --
insert into public.admins (user_id)
select owner_id from public.menus where slug = 'demo' and owner_id is not null
on conflict do nothing;
