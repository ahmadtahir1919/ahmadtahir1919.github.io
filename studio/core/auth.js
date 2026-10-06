// Google sign-in for the creator pages. The backend does the work; this file holds the
// rules every page shares.

import * as backend from "./backend/index.js";

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
  return backend.signInWithIdToken(credential, rawNonce);
}

export async function signOut() {
  return backend.signOut();
}

/** Every v2 page is creator-only, so each one calls this first. Returns the signed-in user,
 *  or null after handing control to the caller's signed-out UI — the pages render a sign-in
 *  prompt rather than redirecting, so a shared link doesn't bounce someone somewhere
 *  confusing before they've had a chance to sign in. */
export async function requireUser() {
  return currentUser();
}
