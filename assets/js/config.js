/* Pilot backend settings.
   Leave both empty to run without a backend: the guest menu reads data/<slug>.json and the
   dashboard saves to this browser only (demo mode).
   Fill them in (see supabase/README.md) to save menus, photos and videos to Supabase.
   The anon key is safe to publish: Row Level Security decides what it can do. */
export const CONFIG = {
  supabaseUrl: 'https://fjdfzjslxxbqeavbbcvb.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqZGZ6anNseHhicWVhdmJiY3ZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5MDMyMTQsImV4cCI6MjExMDQ3OTIxNH0.NFMUV0gBewjmw2R0Z616nzdiFXIDq9_GgoWdOu1jcrQ',
  mediaBucket: 'menu-media',
};
