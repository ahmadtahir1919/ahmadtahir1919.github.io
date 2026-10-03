// Supabase client + Google auth for the v2 creator pages.
//
// Mirrors deploy/take/supabase-client.js's connection and auth shape on purpose: both talk
// to the same project with the same public anon key, so a quiz created here is the same row
// the take page and the Android app read. See web-v2/README.md for why this is a separate
// file rather than an import from deploy/take/.
//
// Loaded as an ES module, unlike take/'s plain script — the v2 pages are new, so they can
// use modules without the take page's constraint of running as one flat bundle.

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

/** Same fallback chain as AuthRepository.kt's toDomainUser() and the take page's
 *  resolveDisplayName(), so one person shows up under one name everywhere. */
export function displayNameOf(user) {
  const meta = user?.user_metadata || {};
  return meta.full_name || meta.name || user?.email || "";
}

export async function currentUser() {
  const { data } = await db.auth.getUser();
  return data?.user ?? null;
}

export async function signInWithGoogle(redirectTo = window.location.href) {
  return db.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
}

/** The live site's preferred path (same call as deploy/take/supabase-client.js): the browser
 *  already holds Google's ID token from the site's /google-signin.js button, so there is no
 *  redirect. [rawNonce] is the UNHASHED nonce — Supabase hashes it itself. */
export async function signInWithIdToken(credential, rawNonce) {
  const { error } = await db.auth.signInWithIdToken({ provider: "google", token: credential, nonce: rawNonce });
  if (error) throw error;
}

export async function signOut() {
  return db.auth.signOut();
}

/** Every v2 page is creator-only, so each one calls this first. Returns the signed-in user,
 *  or null after handing control to the caller's signed-out UI — the pages render a sign-in
 *  prompt rather than redirecting, so a shared link doesn't bounce someone somewhere
 *  confusing before they've had a chance to sign in. */
export async function requireUser() {
  return currentUser();
}

/** Server-enforced caps (app_limits, optionally overridden per user) — my_limits RPC,
 *  schema.sql:384, which returns one row of max_* columns plus the admin kill switches.
 *  Read so the UI can disable a button before the user hits a raw RLS rejection; the
 *  server stays the real enforcer either way.
 *
 *  Defaults match app_limits' own column defaults, and are used if the call fails so a
 *  network blip degrades to "the UI lets you try and the server decides" rather than
 *  blocking creation outright.
 *
 *  createQuizEnabled is the admin maintenance switch that quizzes_insert_own also checks
 *  server-side (schema.sql:596) — when it is off, saving will be rejected, so the UI says
 *  so up front instead of letting someone build a whole quiz that cannot be saved. */
export async function fetchLimits() {
  const fallback = {
    maxQuizzes: 10,
    maxQuestions: 20,
    maxOptions: 30,
    maxFillBlanks: 20,
    maxFillBlankAnswers: 10,
    maxQuizTitleChars: 50,
    maxQuestionTextChars: 250,
    maxHintChars: 250,
    maxReasonChars: 250,
    maxOptionTextChars: 100,
    maxAnswerTextChars: 250,
    createQuizEnabled: true,
  };
  try {
    const { data, error } = await db.rpc("my_limits");
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) return fallback;
    return {
      maxQuizzes: row.max_quizzes_per_user ?? fallback.maxQuizzes,
      maxQuestions: row.max_questions_per_quiz ?? fallback.maxQuestions,
      maxOptions: row.max_options_per_question ?? fallback.maxOptions,
      maxFillBlanks: row.max_fill_blanks_per_question ?? fallback.maxFillBlanks,
      maxFillBlankAnswers:
        row.max_fill_blank_answers_per_blank ?? fallback.maxFillBlankAnswers,
      maxQuizTitleChars: row.max_quiz_title_chars ?? fallback.maxQuizTitleChars,
      maxQuestionTextChars: row.max_question_text_chars ?? fallback.maxQuestionTextChars,
      maxHintChars: row.max_hint_chars ?? fallback.maxHintChars,
      maxReasonChars: row.max_reason_chars ?? fallback.maxReasonChars,
      maxOptionTextChars: row.max_option_text_chars ?? fallback.maxOptionTextChars,
      maxAnswerTextChars: row.max_answer_text_chars ?? fallback.maxAnswerTextChars,
      createQuizEnabled: row.create_quiz_enabled !== false,
    };
  } catch {
    return fallback;
  }
}
