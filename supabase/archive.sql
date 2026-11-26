-- NomNom: archive, restore and permanently delete a restaurant.
-- Run once in Supabase → SQL Editor, after pause-and-cleanup.sql. Safe to run again.
-- An archived restaurant leaves the active list: its menu link and every QR code show "Menu unavailable",
-- it takes no orders, and only a super admin can archive, restore or delete it.
-- Deleting is only allowed once archived, and removes the menu, partner details and orders for good.

-- 1. The flag (null = not archived) -------------------------------------------------------------
alter table public.menus add column if not exists archived_at timestamptz;

-- 2. Guests only see menus that are neither paused nor archived -----------------------------------
drop policy if exists "menus are public" on public.menus;
create policy "menus are public" on public.menus
  for select using ((not suspended and archived_at is null) or owner_id = auth.uid() or public.is_admin());

-- The guest menu asks this for every menu, so paused/archived menus stay off even for signed-in admins.
create or replace function public.menu_suspended(p_slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select suspended or archived_at is not null from public.menus where slug = p_slug), false);
$$;
revoke all on function public.menu_suspended(text) from public;
grant execute on function public.menu_suspended(text) to anon, authenticated;

-- 3. Only super admins can pause, archive or restore -----------------------------------------------
create or replace function public.menus_guard_suspended() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.suspended is distinct from old.suspended or new.archived_at is distinct from old.archived_at)
     and not public.is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only NomNom can pause, archive or restore a menu.';
  end if;
  return new;
end $$;

-- 4. No new orders on a paused or archived menu -----------------------------------------------------
create or replace function public.orders_block_suspended() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.menus where slug = new.slug and (suspended or archived_at is not null)) then
    raise exception 'This menu is not available right now. Please order with our staff.';
  end if;
  return new;
end $$;

-- 5. Partners panel: include archived_at (return type changes, so drop first) -------------------------
drop function if exists public.admin_partners();
create function public.admin_partners()
returns table (
  slug text, name text, owner_email text, owner_phone text, city text, notes text,
  owner_linked boolean, owner_last_sign_in timestamptz, invited_at timestamptz,
  items int, videos int, photos int, ordering boolean, published boolean,
  updated_at timestamptz, created_at timestamptz, suspended boolean, archived_at timestamptz
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
         m.suspended,
         m.archived_at
  from public.menus m
  left join public.partners p on p.slug = m.slug
  left join auth.users u on u.id = m.owner_id
  order by coalesce(p.created_at, m.updated_at) desc;
end $$;
revoke all on function public.admin_partners() from public;
grant execute on function public.admin_partners() to authenticated;

-- 6. Permanent delete (archived restaurants only). Partner details and orders go with the menu
--    (on delete cascade). The dashboard deletes the restaurant's photos and videos first.
--    The owner's login is kept; it simply has no restaurant any more.
create or replace function public.admin_delete_restaurant(p_slug text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.menus where slug = p_slug and archived_at is not null) then
    raise exception 'Archive the restaurant before deleting it.';
  end if;
  delete from public.menus where slug = p_slug;
end $$;
revoke all on function public.admin_delete_restaurant(text) from public;
grant execute on function public.admin_delete_restaurant(text) to authenticated;
