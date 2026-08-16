// ============================================================================
// Thin Supabase wrapper — mirrors data/sync/SupabaseSyncRepository.kt's shape
// (same table/column names, same snake_case DTO fields) so this reads/writes
// exactly the same rows the Android app does. The anon key here is the same
// one already embedded in the compiled APK via BuildConfig — public by design.
// ============================================================================

const SUPABASE_URL = "https://zorkzqyazigqucskseyp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_wD6qD3zEVnyYV1-TROtMgQ_XlQK9uT9";

// A failure here (e.g. the CDN script blocked/slow, so window.supabase never
// showed up) used to leave the whole page blank with no clue why — app.js's
// very first lines destructure window.SupabaseClient, which would silently
// throw. Catching it here and exposing the error lets app.js show it on
// screen instead of a dead white page.
let supabaseClient = null;
let initError = null;
try {
  if (!window.supabase) throw new Error("Supabase library failed to load from CDN.");
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
  initError = e;
}

/** Same fallback chain as AuthRepository.kt's toDomainUser(): full_name metadata,
 *  then name metadata, then email. */
function resolveDisplayName(user) {
  const meta = user.user_metadata || {};
  return meta.full_name || meta.name || user.email || "";
}

async function getCurrentUser() {
  const { data } = await supabaseClient.auth.getUser();
  return data?.user ?? null;
}

async function signInWithGoogle(redirectTo) {
  return supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
}

async function signOut() {
  return supabaseClient.auth.signOut();
}

/** False only once a genuinely new signup hasn't confirmed their name yet —
 *  see profiles.name_confirmed in schema.sql. Fails open (true) on any error
 *  so a network hiccup here never blocks someone from taking the quiz. */
async function fetchNameConfirmed(userId) {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("name_confirmed")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return true;
  return data.name_confirmed !== false;
}

/** Mirrors AuthRepository.kt's confirmDisplayName: updates both the auth user's
 *  metadata (what resolveDisplayName reads back locally) and profiles.display_name
 *  (what everyone else sees for this person as a quiz owner/participant), then
 *  marks the name confirmed so this is only ever asked once. */
async function confirmDisplayName(userId, name) {
  const trimmed = name.trim();
  const { error: authErr } = await supabaseClient.auth.updateUser({
    data: { full_name: trimmed, name: trimmed },
  });
  if (authErr) throw authErr;
  const { error: profileErr } = await supabaseClient
    .from("profiles")
    .update({ display_name: trimmed, name_confirmed: true })
    .eq("id", userId);
  if (profileErr) throw profileErr;
}

// ── Quiz + questions (mirrors fetchQuizByShareCode) ──────────────────────

/** QuestionDto -> the same shape app.js/evaluator.js expect (camelCase, matching
 *  the Kotlin domain Question, not the wire snake_case). */
function questionFromRow(row) {
  return {
    id: row.id,
    quizId: row.quiz_id,
    type: row.type,
    text: row.text,
    options: row.options ?? null,
    correctAnswers: row.correct ?? null,
    writtenAnswer: row.written_answer ?? null,
    timeSec: row.time_sec,
    points: row.points,
    orderIndex: row.order_index,
    hint: row.hint ?? null,
    answerRule: row.answer_rule ?? null, // jsonb, already an object (not a JSON string like the Kotlin column)
    pollSettings: row.poll_settings ?? null,
    fillBlankContent: row.fill_blank ?? null,
  };
}

function quizFromRow(row, questions) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    groupName: row.group_name,
    shareCode: row.share_code,
    defaultTimeSec: row.default_time_sec,
    isDraft: row.is_draft,
    isArchived: row.is_archived,
    startAt: row.start_at,
    endAt: row.end_at,
    allowRetake: row.allow_retake,
    showResult: row.show_result,
    showAnswers: row.show_answers,
    themeColorName: row.theme_color_name,
    createdAt: row.created_at,
    questions: questions.sort((a, b) => a.orderIndex - b.orderIndex),
  };
}

/** Same "SCHEDULED / ACTIVE / ENDED" rule as Quiz.effectiveStatus() in Models.kt. */
function effectiveStatus(quiz, now) {
  now = now ?? Date.now();
  if (quiz.startAt != null && now < quiz.startAt) return "SCHEDULED";
  if (quiz.endAt != null && now >= quiz.endAt) return "ENDED";
  return "ACTIVE";
}

async function fetchQuizByShareCode(code) {
  const { data: quizRow, error } = await supabaseClient
    .from("quizzes")
    .select("*")
    .eq("share_code", code)
    .maybeSingle();
  if (error || !quizRow) return null;

  const { data: questionRows, error: qErr } = await supabaseClient
    .from("questions")
    .select("*")
    .eq("quiz_id", quizRow.id);
  if (qErr) return null;

  return quizFromRow(quizRow, (questionRows || []).map(questionFromRow));
}

// ── Attempt submission (mirrors pushAttempt) ──────────────────────────────

/** Writes directly into the real attempts/attempt_answers tables — the web
 *  session is a genuinely authenticated Supabase user (real Google sign-in),
 *  so this satisfies the exact same RLS the Android app relies on. No
 *  separate "guest" path or reconciliation needed. */
async function submitAttempt(quizId, userId, score, total, answers) {
  const attemptId = crypto.randomUUID();
  const finishedAt = Date.now();

  const { error: attemptErr } = await supabaseClient.from("attempts").insert({
    id: attemptId,
    quiz_id: quizId,
    user_id: userId,
    score,
    total,
    finished_at: finishedAt,
    is_preview: false,
  });
  if (attemptErr) throw attemptErr;

  const answerRows = answers.map((a) => ({
    id: crypto.randomUUID(),
    attempt_id: attemptId,
    question_id: a.questionId,
    is_correct: a.isCorrect,
    given_answer: a.givenAnswers,
    time_taken_sec: a.timeTakenSec,
    used_hint: false,
  }));
  if (answerRows.length > 0) {
    const { error: answersErr } = await supabaseClient.from("attempt_answers").insert(answerRows);
    if (answersErr) throw answersErr;
  }

  return attemptId;
}

// ── Poll (mirrors pushPollState/pushPollVote/fetchPollStates/fetchPollVotes) ─

async function ensurePollOpen(questionId, timeSec, noTimeLimit) {
  const { data: existing } = await supabaseClient.from("poll_states").select("*").eq("question_id", questionId).maybeSingle();
  if (existing) return existing;
  const openedAt = Date.now();
  const closesAt = noTimeLimit || timeSec <= 0 ? null : openedAt + timeSec * 1000;
  const row = { question_id: questionId, status: "OPEN", opened_at: openedAt, closes_at: closesAt };
  const { error } = await supabaseClient.from("poll_states").upsert(row);
  if (error) throw error;
  return row;
}

async function fetchPollVotes(questionId) {
  const { data, error } = await supabaseClient.from("poll_votes").select("*").eq("question_id", questionId);
  if (error) return [];
  return (data || []).map((r) => ({
    questionId: r.question_id,
    voterKey: r.voter_key,
    selectedOptionIndices: r.selected,
    otherText: r.other_text,
    reason: r.reason,
    updatedAt: r.updated_at,
    participantId: r.participant_id,
  }));
}

async function castPollVote(vote) {
  const row = {
    question_id: vote.questionId,
    voter_key: vote.voterKey,
    selected: vote.selectedOptionIndices,
    other_text: vote.otherText,
    reason: vote.reason,
    updated_at: Date.now(),
    participant_id: vote.participantId,
  };
  const { error } = await supabaseClient.from("poll_votes").upsert(row);
  if (error) throw error;
}

window.SupabaseClient = {
  supabase: supabaseClient,
  initError,
  getCurrentUser,
  resolveDisplayName,
  signInWithGoogle,
  signOut,
  fetchNameConfirmed,
  confirmDisplayName,
  fetchQuizByShareCode,
  effectiveStatus,
  submitAttempt,
  ensurePollOpen,
  fetchPollVotes,
  castPollVote,
};
