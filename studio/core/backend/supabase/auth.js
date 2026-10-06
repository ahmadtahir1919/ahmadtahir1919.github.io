// Google sign-in through Supabase Auth. Users come back as Supabase's own user object;
// core/auth.js only reads id, email and user_metadata.{full_name,name} from it.

import { db } from "./client.js";

export async function getUser() {
  const { data } = await db.auth.getUser();
  return data?.user ?? null;
}

export async function signInWithGoogle(redirectTo) {
  return db.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
}

/** [rawNonce] is the UNHASHED nonce — Supabase hashes it itself. */
export async function signInWithIdToken(credential, rawNonce) {
  const { error } = await db.auth.signInWithIdToken({ provider: "google", token: credential, nonce: rawNonce });
  if (error) throw error;
}

export async function signOut() {
  return db.auth.signOut();
}
