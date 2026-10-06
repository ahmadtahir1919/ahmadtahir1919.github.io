// The signed-in user's own feedback against Supabase's feedback table (schema.sql:1793), the same
// one the app writes. RLS: select own, insert one per 24h (a refused insert is Postgres 42501).
// Pure I/O: the rules live in core/feedback.js.

import { db } from "./client.js";
import { feedbackFromRow } from "./rows.js";

/** This account's past feedback, newest first. */
export async function listMyFeedback(userId) {
  const { data, error } = await db.from("feedback").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(feedbackFromRow);
}

/** Inserts one submission. Names only these columns: the reply columns can't be set by a user. */
export async function insertFeedback(userId, { rating, category, message, createdAt }) {
  const { error } = await db.from("feedback").insert({ user_id: userId, rating, category, message, created_at: createdAt });
  if (error) throw error;
}
