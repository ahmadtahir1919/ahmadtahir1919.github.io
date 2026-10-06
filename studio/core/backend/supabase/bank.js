// Question Bank reads and writes against Supabase's bank_questions (schema.sql:802). Owner-only
// RLS; the bank's cap is a limit (my_limits.max_bank_questions_per_user) that core/bank.js
// checks before writing. Pure I/O: the rules live in core/bank.js.

import { db } from "./client.js";
import { bankQuestionFromRow, bankQuestionToRow } from "./rows.js";

/** The user's bank, newest first. */
export async function listBank(userId) {
  const { data, error } = await db
    .from("bank_questions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(bankQuestionFromRow);
}

export async function loadBankQuestion(id) {
  const { data, error } = await db.from("bank_questions").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? bankQuestionFromRow(data) : null;
}

/** How many entries the user has. Only the count travels. */
export async function countBank(userId) {
  const { count, error } = await db
    .from("bank_questions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw error;
  return count ?? 0;
}

/** Insert or replace by id. Each entry carries its own createdAt / updatedAt. */
export async function upsertBankQuestions(userId, entries) {
  if (!entries.length) return;
  const rows = entries.map((entry) => bankQuestionToRow(entry, userId));
  const { error } = await db.from("bank_questions").upsert(rows);
  if (error) throw error;
}

export async function deleteBankQuestions(ids) {
  if (!ids.length) return;
  const { error } = await db.from("bank_questions").delete().in("id", ids);
  if (error) throw error;
}
