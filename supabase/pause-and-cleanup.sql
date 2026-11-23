-- NomNom: pause a restaurant (e.g. unpaid) + clean up replaced media.
-- Run once in Supabase → SQL Editor, after admin.sql. Safe to run again.
-- A paused menu is hidden from guests (link and every QR code show "menu unavailable"), takes no orders,
-- and only a super admin can pause or resume it. The owner can still sign in and edit.

-- 1. The flag ---------------------------------------------------------------------------
alter table public.menus add column if not exists suspended boolean not null default false;

-- 2. Guests only see menus that aren't paused; owners and admins always see theirs ------------
drop policy if exists "menus are public" on public.menus;
create policy "menus are public" on public.menus
  for select using (not suspended or owner_id = auth.uid() or public.is_admin());

-- Lets the guest menu tell "paused" apart from "doesn't exist" without revealing the menu.
create or replace function public.menu_suspended(p_slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select suspended from public.menus where slug = p_slug), false);
$$;
revoke all on function public.menu_suspended(text) from public;
grant execute on function public.menu_suspended(text) to anon, authenticated;

-- 3. Only super admins can change the flag (owners can still update their menu data) ----------
create or replace function public.menus_guard_suspended() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.suspended is distinct from old.suspended and not public.is_admin()
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only NomNom can pause or resume a menu.';
  end if;
  return new;
end $$;
drop trigger if exists menus_guard_suspended on public.menus;
create trigger menus_guard_suspended before update on public.menus
  for each row execute function public.menus_guard_suspended();

-- 4. No new orders on a paused menu ----------------------------------------------------------
create or replace function public.orders_block_suspended() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.menus where slug = new.slug and suspended) then
    raise exception 'This menu is not available right now. Please order with our staff.';
  end if;
  return new;
end $$;
drop trigger if exists orders_block_suspended on public.orders;
create trigger orders_block_suspended before insert on public.orders
  for each row execute function public.orders_block_suspended();

-- 5. Partners panel: include the flag (return type changes, so drop first) ----------------------
drop function if exists public.admin_partners();
create function public.admin_partners()
returns table (
  slug text, name text, owner_email text, owner_phone text, city text, notes text,
  owner_linked boolean, owner_last_sign_in timestamptz, invited_at timestamptz,
  items int, videos int, photos int, ordering boolean, published boolean,
  updated_at timestamptz, created_at timestamptz, suspended boolean
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
         case when u.email_confirmed_at is not null then u.last_sign_in_at end,
         p.invited_at,
         coalesce(jsonb_array_length(m.data->'dishes'), 0),
         (select count(*)::int from jsonb_array_elements(coalesce(m.data->'dishes', '[]')) d where coalesce(d->>'video', '') <> ''),
         (select count(*)::int from jsonb_array_elements(coalesce(m.data->'dishes', '[]')) d where coalesce(d->>'image', '') <> ''),
         coalesce((m.data->'ordering'->>'enabled')::boolean, false),
         m.data <> '{}'::jsonb,
         m.updated_at,
         p.created_at,
         m.suspended
  from public.menus m
  left join public.partners p on p.slug = m.slug
  left join auth.users u on u.id = m.owner_id
  order by coalesce(p.created_at, m.updated_at) desc;
end $$;
revoke all on function public.admin_partners() from public;
grant execute on function public.admin_partners() to authenticated;

-- 6. Media clean-up: owners (their folder) and admins can list files, so Save & publish can delete
--    photos/videos the menu no longer uses. Files stay publicly downloadable by URL as before.
drop policy if exists "owners list media" on storage.objects;
create policy "owners list media" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'menu-media'
    and ((storage.foldername(name))[1] in (select slug from public.menus where owner_id = auth.uid())
         or public.is_admin())
  );
