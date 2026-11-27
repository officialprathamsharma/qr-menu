-- NomNom: 7-day welcome links for new restaurant owners.
-- Run once in Supabase → SQL Editor. Safe to run again.
-- Supabase's own email links expire within 24 hours at most, so the welcome email links to
-- menu.heynomnom.in/admin/?welcome=<token> instead. The welcome-link Edge Function swaps a valid token for a fresh
-- one-time Supabase token when the owner opens it. Only a SHA-256 hash of each token is stored.
create table if not exists public.welcome_links (
  token_hash  text primary key,
  slug        text not null references public.menus (slug) on delete cascade,
  email       text not null,
  user_id     uuid,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists welcome_links_slug on public.welcome_links (slug);
-- Service role only (the Edge Functions); no policies, so the browser can't read or write it.
alter table public.welcome_links enable row level security;
