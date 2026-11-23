// Supabase Edge Function: invite-owner
// Called from the Partners panel by a NomNom super admin.
//   POST { slug }  →  { status: 'invited' | 'linked', email }
// - Reads the owner's email from public.partners.
// - New email: creates the login and sends the invite email (sender = the project's SMTP settings,
//   e.g. info@heynomnom.in through Zoho), with a link to the dashboard where they choose a password.
// - Email that already has a login: links it to the restaurant and sends a password-reset email instead.
// - Links the login to the menu (menus.owner_id) and stamps partners.invited_at.
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → Via editor, name "invite-owner",
// paste this file. SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const DASHBOARD = 'https://menu.heynomnom.in/admin/';
const MENU = 'https://menu.heynomnom.in/';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  // The caller's own session: only super admins may invite.
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
  });
  const { data: isAdmin, error: adminErr } = await asCaller.rpc('is_admin');
  if (adminErr || !isAdmin) return json({ error: 'Only NomNom admins can send invites.' }, 403);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  let slug = '';
  try { slug = String((await req.json()).slug || ''); } catch { /* handled below */ }
  const { data: partner } = await admin.from('partners').select('name, owner_email').eq('slug', slug).maybeSingle();
  if (!partner) return json({ error: 'No partner with that link name.' }, 404);
  const email = String(partner.owner_email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Add the owner's email first." }, 400);

  const meta = { restaurant: partner.name, slug, menu_url: `${MENU}?r=${slug}`, dashboard_url: DASHBOARD };
  let userId = '';
  let status: 'invited' | 'linked' = 'invited';
  const inv = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: DASHBOARD, data: meta });
  if (inv.error) {
    if (!/already|registered|exists/i.test(inv.error.message)) return json({ error: inv.error.message }, 502);
    // Existing login: find it, link it, and send a password-reset email so they can get in.
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error || !link.data.user) return json({ error: link.error?.message || 'Could not find that login.' }, 502);
    userId = link.data.user.id;
    status = 'linked';
    const reset = await admin.auth.resetPasswordForEmail(email, { redirectTo: DASHBOARD });
    if (reset.error) return json({ error: reset.error.message }, 502);
  } else {
    userId = inv.data.user.id;
  }

  const { error: linkErr } = await admin.from('menus').update({ owner_id: userId }).eq('slug', slug);
  if (linkErr) return json({ error: linkErr.message }, 500);
  await admin.from('partners').update({ invited_at: new Date().toISOString() }).eq('slug', slug);
  return json({ status, email });
});
