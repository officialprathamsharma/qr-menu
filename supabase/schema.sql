-- QR Menu pilot backend — run once in Supabase → SQL Editor.
-- One row per restaurant holds the whole menu as JSON (simple and fast for a pilot).
-- Photos/videos live in the public "menu-media" bucket under <slug>/...

create table if not exists public.menus (
  slug        text primary key check (slug ~ '^[a-z0-9-]{2,60}$'),
  owner_id    uuid references auth.users (id) on delete set null,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.menus enable row level security;

-- Guests (anyone with the link) can read menus.
drop policy if exists "menus are public" on public.menus;
create policy "menus are public" on public.menus
  for select using (true);

-- Only the linked owner can change their menu. Rows are created by us (see add-restaurant.sql).
drop policy if exists "owners update their menu" on public.menus;
create policy "owners update their menu" on public.menus
  for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Media bucket: public read, 50 MB per file (Supabase free-tier maximum), images + videos only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-media', 'menu-media', true, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Owners may upload/replace/delete files only inside their own restaurant's folder.
drop policy if exists "owners upload media" on storage.objects;
create policy "owners upload media" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'menu-media'
    and (storage.foldername(name))[1] in (select slug from public.menus where owner_id = auth.uid())
  );

drop policy if exists "owners update media" on storage.objects;
create policy "owners update media" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'menu-media'
    and (storage.foldername(name))[1] in (select slug from public.menus where owner_id = auth.uid())
  );

drop policy if exists "owners delete media" on storage.objects;
create policy "owners delete media" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'menu-media'
    and (storage.foldername(name))[1] in (select slug from public.menus where owner_id = auth.uid())
  );
