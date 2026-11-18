-- Table ordering — run once in Supabase → SQL Editor (after schema.sql). Safe to re-run.
-- Guests never write to the table directly: they call place_order(), which looks every item up in the
-- restaurant's published menu, so prices, names and availability can't be tampered with from the browser.
-- Owners read and update their own restaurant's orders (RLS) and get them live via Supabase Realtime.

create table if not exists public.orders (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null references public.menus (slug) on delete cascade,
  number       int  not null,                 -- order number, restarts at 1 every day (India time)
  table_no     text,
  items        jsonb not null,                -- [{ id, name, qty, price, category, video }]
  note         text,
  subtotal     numeric(10, 2) not null,
  status       text not null default 'new' check (status in ('new', 'accepted', 'ready', 'served', 'cancelled')),
  punched      boolean not null default false, -- entered in the POS (e.g. Petpooja)
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  ready_at     timestamptz,
  closed_at    timestamptz
);
create index if not exists orders_slug_created on public.orders (slug, created_at desc);

alter table public.orders enable row level security;

drop policy if exists "owners read orders" on public.orders;
create policy "owners read orders" on public.orders
  for select to authenticated
  using (slug in (select m.slug from public.menus m where m.owner_id = auth.uid()));

drop policy if exists "owners update orders" on public.orders;
create policy "owners update orders" on public.orders
  for update to authenticated
  using (slug in (select m.slug from public.menus m where m.owner_id = auth.uid()))
  with check (slug in (select m.slug from public.menus m where m.owner_id = auth.uid()));

-- Live updates for the dashboard's Orders screen.
do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null; end $$;

-- Guests place orders through this function only.
create or replace function public.place_order(p_slug text, p_table text, p_items jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m      jsonb;
  d      jsonb;
  it     jsonb;
  lines  jsonb := '[]'::jsonb;
  total  numeric := 0;
  q      int;
  n      int;
  tbl    text := left(nullif(trim(p_table), ''), 12);
  o      public.orders;
  day0   timestamptz := (date_trunc('day', now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata';
begin
  select data into m from public.menus where slug = p_slug;
  if m is null or jsonb_typeof(m -> 'dishes') <> 'array' then
    raise exception 'This menu is not available for ordering.';
  end if;
  if coalesce((m -> 'ordering' ->> 'enabled')::boolean, false) is not true then
    raise exception 'Ordering from the table is switched off. Please order with our staff.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 40 then
    raise exception 'Your order is empty.';
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    q := least(greatest(coalesce((it ->> 'qty')::int, 0), 0), 20);
    continue when q = 0;
    select x into d from jsonb_array_elements(m -> 'dishes') x where x ->> 'id' = it ->> 'id' limit 1;
    if d is null then raise exception 'An item in your order is no longer on the menu. Please refresh.'; end if;
    if (d ->> 'available') = 'false' then raise exception '% is sold out right now.', d ->> 'name'; end if;
    lines := lines || jsonb_build_object(
      'id', d ->> 'id', 'name', d ->> 'name', 'qty', q, 'price', coalesce((d ->> 'price')::numeric, 0),
      'category', d ->> 'category', 'video', coalesce(d ->> 'video', '') <> '');
    total := total + q * coalesce((d ->> 'price')::numeric, 0);
  end loop;
  if jsonb_array_length(lines) = 0 then raise exception 'Your order is empty.'; end if;

  -- Simple abuse guard: at most 6 orders per table every 10 minutes.
  if (select count(*) from public.orders
      where slug = p_slug and table_no is not distinct from tbl and created_at > now() - interval '10 minutes') >= 6 then
    raise exception 'Too many orders from this table. Please ask our staff.';
  end if;

  perform pg_advisory_xact_lock(hashtext('orders:' || p_slug));
  select coalesce(max(number), 0) + 1 into n from public.orders where slug = p_slug and created_at >= day0;

  insert into public.orders (slug, number, table_no, items, note, subtotal)
  values (p_slug, n, tbl, lines, left(nullif(trim(p_note), ''), 300), total)
  returning * into o;

  return jsonb_build_object('id', o.id, 'number', o.number, 'total', o.subtotal, 'items', o.items);
end $$;

-- Lets a guest's phone follow its own order (needs the order's random id).
create or replace function public.order_status(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('status', status, 'number', number) from public.orders where id = p_id;
$$;

revoke all on function public.place_order(text, text, jsonb, text) from public;
revoke all on function public.order_status(uuid) from public;
grant execute on function public.place_order(text, text, jsonb, text) to anon, authenticated;
grant execute on function public.order_status(uuid) to anon, authenticated;

-- Timestamps for status changes (used for "average time to ready" in Insights).
create or replace function public.orders_stamp()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'accepted' and new.accepted_at is null then new.accepted_at := now(); end if;
    if new.status = 'ready' and new.ready_at is null then new.ready_at := now(); end if;
    if new.status in ('served', 'cancelled') and new.closed_at is null then new.closed_at := now(); end if;
  end if;
  -- Owners may only change status and the "punched" flag, never items or prices.
  new.items := old.items; new.subtotal := old.subtotal; new.slug := old.slug; new.number := old.number;
  new.table_no := old.table_no; new.created_at := old.created_at;
  return new;
end $$;

drop trigger if exists orders_stamp on public.orders;
create trigger orders_stamp before update on public.orders for each row execute function public.orders_stamp();

select 'orders ok' as result;
