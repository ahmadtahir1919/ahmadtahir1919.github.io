// Google sign-in for the creator pages. The backend does the work; this file holds the
// rules every page shares.

import * as backend from "./backend/index.js";
import * as analytics from "./analytics.js";

/** Same fallback chain as AuthRepository.kt's toDomainUser() and the take page's
 *  resolveDisplayName(), so one person shows up under one name everywhere. */
export function displayNameOf(user) {
  const meta = user?.user_metadata || {};
  return meta.full_name || meta.name || user?.email || "";
}

export async function currentUser() {
  return backend.getUser();
}

export async function signInWithGoogle(redirectTo = window.location.href) {
  return backend.signInWithGoogle(redirectTo);
}

/** The live site's preferred path (same call as deploy/take/supabase-client.js): the browser
 *  already holds Google's ID token from the site's /google-signin.js button, so there is no
 *  redirect. [rawNonce] is the UNHASHED nonce. */
export async function signInWithIdToken(credential, rawNonce) {
  const result = await backend.signInWithIdToken(credential, rawNonce);
  analytics.track("signed_in", { method: "google_id_token" });
  return result;
}

export async function signOut() {
  analytics.track("signed_out");
  const result = await backend.signOut();
  analytics.reset();
  return result;
}

/** Every v2 page is creator-only, so each one calls this first. Returns the signed-in user,
 *  or null after handing control to the caller's signed-out UI — the pages render a sign-in
 *  prompt rather than redirecting, so a shared link doesn't bounce someone somewhere
 *  confusing before they've had a chance to sign in. */
export async function requireUser() {
  const user = await currentUser();
  // The one call every Studio page makes on load: the page view and, when signed in, who it is.
  if (user) analytics.identify(user.id);
  analytics.screen(analytics.currentPageName(), { signed_in: !!user });
  return user;
}
