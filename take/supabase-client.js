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
    // Quiz-wide default for hand-marking; each question can override it.
    manualMarkingDefault: row.manual_marking_default ?? false,
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

/** Latest real (non-preview) attempt this user already has for a quiz, or null.
 *  Mirrors JoinViewModel.kt's existing-attempt lookup — used to decide whether
 *  "Start Quiz" should be offered when the quiz doesn't allow retakes. */
async function fetchExistingAttempt(quizId, userId) {
  const { data, error } = await supabaseClient
    .from("attempts")
    .select("*")
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .eq("is_preview", false)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return { id: data.id, score: data.score, total: data.total, finishedAt: data.finished_at };
}

// ── Attempt submission (mirrors pushAttempt) ──────────────────────────────

/** Writes directly into the real attempts/attempt_answers tables — the web
 *  session is a genuinely authenticated Supabase user (real Google sign-in),
 *  so this satisfies the exact same RLS the Android app relies on. No
 *  separate "guest" path or reconciliation needed. */
async function submitAttempt(quizId, userId, score, total, answers) {
  const finishedAt = Date.now();

  // Retaking with the same account reuses the existing attempt entity instead of creating a
  // second one — mirrors AttemptRepository.saveAttempt's retake-reuse on the Android side, so
  // a quiz answered partly on the app and partly on the web still ends up as one row per
  // person, not two side by side in the owner's participants list.
  const existing = await fetchExistingAttempt(quizId, userId);
  const attemptId = existing ? existing.id : crypto.randomUUID();

  // upsert, not insert: on a genuinely first attempt this behaves exactly like insert: when
  // reusing an existing id, Postgres still evaluates the same RLS insert policy underneath
  // (attempt_retake_allowed in schema.sql), so a retake stays gated by "Allow Retake" exactly
  // as before — this call is what can reject the whole submission, so it runs BEFORE
  // anything destructive touches the previous answers.
  const { error: attemptErr } = await supabaseClient.from("attempts").upsert({
    id: attemptId,
    quiz_id: quizId,
    user_id: userId,
    score,
    total,
    finished_at: finishedAt,
    is_preview: false,
    // Analytics only — lets the creator see how many people answer from the browser
    // rather than the Android app. Mirrors AttemptSource in Models.kt.
    source: "WEB",
  });
  if (attemptErr) {
    if (attemptErr.code === "42501") {
      throw new Error("RETAKE_NOT_ALLOWED");
    }
    throw attemptErr;
  }

  if (existing) {
    // Only now, once the attempts row is confirmed writable — the previous run's answers
    // carry their own ids (this run's are freshly generated too), so without clearing them
    // first they'd sit alongside the new rows under the same attemptId instead of being
    // replaced by them.
    const { error: purgeErr } = await supabaseClient
      .from("attempt_answers")
      .delete()
      .eq("attempt_id", attemptId);
    if (purgeErr) throw purgeErr;
  }

  const answerRows = answers.map((a) => ({
    id: crypto.randomUUID(),
    attempt_id: attemptId,
    question_id: a.questionId,
    is_correct: a.isCorrect,
    given_answer: a.givenAnswers,
    time_taken_sec: a.timeTakenSec,
    used_hint: false,
    // Manual marking — must be written here, not left to defaults: an answer that
    // silently landed with needs_manual_marking = false would never appear in the
    // owner's marking queue, and the taker would get an auto-graded verdict for a
    // question the creator explicitly reserved for themselves.
    needs_manual_marking: a.needsManualMarking === true,
    awarded_points: a.awardedPoints ?? null,
    max_points: a.maxPoints ?? 0,
  }));
  if (answerRows.length > 0) {
    const { error: answersErr } = await supabaseClient.from("attempt_answers").insert(answerRows);
    if (answersErr) throw answersErr;
  }

  return attemptId;
}

// ── Poll (mirrors pushPollState/pushPollVote/fetchPollStates/fetchPollVotes) ─

/** Opens the poll if nobody has yet. No deadline is written: a poll stays open until its
 *  owner closes it, and the question's time limit is each taker's own countdown — see
 *  PollState.closesAt in PollModels.kt for why the shared deadline was wrong. */
async function ensurePollOpen(questionId) {
  const { data: existing } = await supabaseClient.from("poll_states").select("*").eq("question_id", questionId).maybeSingle();
  if (existing) return existing;
  const openedAt = Date.now();
  const row = { question_id: questionId, status: "OPEN", opened_at: openedAt, closes_at: null };
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
  fetchExistingAttempt,
  submitAttempt,
  ensurePollOpen,
  fetchPollVotes,
  castPollVote,
};
