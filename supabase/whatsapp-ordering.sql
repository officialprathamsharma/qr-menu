-- NomNom: WhatsApp Ordering (e.g. cloud kitchens). Run once in Supabase → SQL Editor. Safe to run again.
-- The switch lives in the menu itself (menus.data.whatsappOrdering.enabled), so the guest menu can read it.
-- Only a super admin can turn it on or off (Partners → WhatsApp Ordering). When an owner publishes their menu,
-- this keeps whatever the switch was; owners can still change their WhatsApp number, UPI ID and payment QR.
create or replace function public.menus_guard_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  was jsonb := coalesce(old.data->'whatsappOrdering'->'enabled', 'false'::jsonb);
begin
  if public.is_admin() or coalesce(auth.role(), '') = 'service_role' then return new; end if;
  if coalesce(new.data->'whatsappOrdering'->'enabled', 'false'::jsonb) is distinct from was then
    if jsonb_typeof(new.data->'whatsappOrdering') = 'object' then
      new.data := jsonb_set(new.data, '{whatsappOrdering,enabled}', was);
    else
      new.data := new.data || jsonb_build_object('whatsappOrdering', jsonb_build_object('enabled', was));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists menus_guard_whatsapp on public.menus;
create trigger menus_guard_whatsapp before update on public.menus
  for each row execute function public.menus_guard_whatsapp();
