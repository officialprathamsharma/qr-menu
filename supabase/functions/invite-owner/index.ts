// Supabase Edge Function: invite-owner
// Called from the Partners panel by a NomNom super admin.
//   POST { slug }  →  { status: 'invited' | 'linked', email, welcome_url, expires, email_sent }
// - Reads the owner's email from public.partners.
// - Makes a 7-day welcome link (menu.heynomnom.in/admin/?welcome=<token>, see welcome-links.sql and the
//   welcome-link function). Supabase's own email links can't last longer than a day, so the emails link here instead.
// - New email: creates the login and sends the "Invite user" email.
// - Email that already has a login: links it to the restaurant and sends the "Magic link" email (used only for this),
//   which also carries the welcome link.
// - Both email templates use {{ .Data.welcome_url }} and {{ .Data.welcome_expires }}.
// - Re-sending replaces the restaurant's earlier welcome links.
// - Links the login to the menu (menus.owner_id) and stamps partners.invited_at.
// Deploy: Supabase dashboard → Edge Functions → invite-owner → Code, paste this file, Deploy.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const DASHBOARD = 'https://menu.heynomnom.in/admin/';
const MENU = 'https://menu.heynomnom.in/';
const VALID_DAYS = 7;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sha256(text: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

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

  // The 7-day welcome link.
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = new Date(Date.now() + VALID_DAYS * 86400e3);
  const expires = expiresAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const welcomeUrl = `${DASHBOARD}?welcome=${token}`;
  const meta = {
    restaurant: partner.name, slug, menu_url: `${MENU}?r=${slug}`, dashboard_url: DASHBOARD,
    welcome_url: welcomeUrl, welcome_expires: expires, welcome_days: VALID_DAYS,
  };

  let userId = '';
  let status: 'invited' | 'linked' = 'invited';
  let emailSent = true;
  // Supabase allows one email per address per minute: then still make the link (to copy), just without the email.
  const limited = (m: string) => /only request this after|rate limit|too many/i.test(m);
  const inv = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: DASHBOARD, data: meta });
  if (inv.error) {
    if (!/already|registered|exists/i.test(inv.error.message) && !limited(inv.error.message)) return json({ error: inv.error.message }, 502);
    // Existing login: find it, put the welcome link on it, link it to the restaurant and email it.
    const found = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (found.error || !found.data.user) return json({ error: found.error?.message || 'Could not find that login.' }, 502);
    userId = found.data.user.id;
    status = 'linked';
    const upd = await admin.auth.admin.updateUserById(userId, { user_metadata: { ...(found.data.user.user_metadata || {}), ...meta } });
    if (upd.error) return json({ error: upd.error.message }, 502);
    if (limited(inv.error.message)) emailSent = false;
    else {
      const sent = await admin.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: DASHBOARD } });
      if (sent.error && !limited(sent.error.message)) return json({ error: sent.error.message }, 502);
      if (sent.error) emailSent = false;
    }
  } else {
    userId = inv.data.user.id;
  }

  await admin.from('welcome_links').delete().eq('slug', slug);
  const { error: wlErr } = await admin.from('welcome_links').insert({
    token_hash: await sha256(token), slug, email, user_id: userId, expires_at: expiresAt.toISOString(),
  });
  if (wlErr) return json({ error: `Run supabase/welcome-links.sql first (${wlErr.message})` }, 500);

  const { error: linkErr } = await admin.from('menus').update({ owner_id: userId }).eq('slug', slug);
  if (linkErr) return json({ error: linkErr.message }, 500);
  await admin.from('partners').update({ invited_at: new Date().toISOString() }).eq('slug', slug);
  return json({ status, email, welcome_url: welcomeUrl, expires, email_sent: emailSent });
});
