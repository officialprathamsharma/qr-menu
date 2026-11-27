// Supabase Edge Function: welcome-link
// Opened from the dashboard when an owner follows their 7-day welcome link (menu.heynomnom.in/admin/?welcome=<token>).
//   POST { token }             →  { email, restaurant, type, token_hash }   (a fresh one-time Supabase token)
//                                  or { error: 'invalid' | 'used' | 'expired', email?, expires? }
//   POST { token, done: true } →  { ok: true }   (called after the owner has set a password; the link stops working)
// The dashboard only uses token_hash when the owner submits their new password, so link scanners that open the page
// can't use anything up. Only a SHA-256 hash of each welcome token is stored (public.welcome_links).
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → Via editor, name "welcome-link", paste this file.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
async function sha256(text: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  let body: { token?: string; done?: boolean } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const token = String(body.token || '');
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(token)) return json({ error: 'invalid' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const hash = await sha256(token);
  const { data: row } = await admin.from('welcome_links').select('*').eq('token_hash', hash).maybeSingle();
  if (!row) return json({ error: 'invalid' }, 404);

  if (body.done) {
    await admin.from('welcome_links').update({ used_at: new Date().toISOString() }).eq('token_hash', hash).is('used_at', null);
    return json({ ok: true });
  }
  const expires = new Date(row.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  if (row.used_at) return json({ error: 'used', email: row.email }, 410);
  if (new Date(row.expires_at).getTime() < Date.now()) return json({ error: 'expired', email: row.email, expires }, 410);

  const { data: partner } = await admin.from('partners').select('name').eq('slug', row.slug).maybeSingle();
  // A login that hasn't confirmed its email yet takes an invite token; a confirmed one a recovery token.
  let confirmed = true;
  if (row.user_id) {
    const u = await admin.auth.admin.getUserById(row.user_id);
    confirmed = Boolean(u.data.user?.email_confirmed_at);
  }
  const order = confirmed ? ['recovery', 'magiclink'] : ['invite', 'recovery', 'magiclink'];
  for (const type of order) {
    const link = await admin.auth.admin.generateLink({ type: type as 'recovery' | 'invite' | 'magiclink', email: row.email });
    if (!link.error && link.data?.properties?.hashed_token) {
      // verifyOtp takes 'email' for magic-link tokens.
      return json({ email: row.email, restaurant: partner?.name || row.slug, type: type === 'magiclink' ? 'email' : type, token_hash: link.data.properties.hashed_token, expires });
    }
  }
  return json({ error: 'Could not open this link. Ask NomNom for a new one.' }, 502);
});
