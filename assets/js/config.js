/* Pilot backend settings.
   Leave both empty to run without a backend: the guest menu reads data/<slug>.json and the
   dashboard saves to this browser only (demo mode).
   Fill them in (see supabase/README.md) to save menus, photos and videos to Supabase.
   The anon key is safe to publish: Row Level Security decides what it can do. */
export const CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  mediaBucket: 'menu-media',
};
