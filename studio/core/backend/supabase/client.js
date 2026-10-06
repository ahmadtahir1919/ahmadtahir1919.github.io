// The Supabase client — the one place the project URL and anon key live in Studio.
//
// Mirrors deploy/take/supabase-client.js's connection on purpose: both talk to the same
// project with the same public anon key, so a quiz created here is the same row the take
// page and the Android app read. See web-v2/README.md for why this is a separate file
// rather than an import from deploy/take/.

// Same public key the APK ships in BuildConfig. Public by design: every read and write it
// can reach is gated by row-level security on the user's session, not by this string.
const SUPABASE_URL = "https://zorkzqyazigqucskseyp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_wD6qD3zEVnyYV1-TROtMgQ_XlQK9uT9";

if (!window.supabase) {
  throw new Error("Supabase JS failed to load — check the CDN <script> tag.");
}

export const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: {
    // Same reasoning as the take page: a creator who just saved a change must never be
    // shown a browser-cached copy of the old row on the next read.
    fetch: (url, options = {}) => fetch(url, { ...options, cache: "no-store" }),
  },
});
