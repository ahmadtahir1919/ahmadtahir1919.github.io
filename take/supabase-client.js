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
  if (!window.supabase) throw new Error(window.S.ERR_SUPABASE_CDN);
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      // Every read here (quiz settings, questions, existing attempt, poll state...) needs
      // to reflect what the owner just changed — a participant who was removed and rejoins,
      // or a quiz whose settings were edited seconds ago, must never see a browser-cached
      // response. Without this, GET requests to PostgREST are ordinary HTTP GETs and can be
      // served from the browser's disk cache under normal navigation — even a hard reload
      // (Ctrl+Shift+R) only guarantees static <script>/<link> subresources revalidate, not
      // every fetch() a script issues afterward. `cache: "no-store"` forces every Supabase
      // request to hit the network fresh, every time, no exceptions.
      fetch: (url, options = {}) => fetch(url, { ...options, cache: "no-store" }),
    },
  });
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
    // Creator-written "why this is correct" — shown on the result review only (Models.kt's
    // Question.reason); never during the attempt.
    reason: row.reason ?? null,
    answerRule: row.answer_rule ?? null, // jsonb, already an object (not a JSON string like the Kotlin column)
    pollSettings: row.poll_settings ?? null,
    fillBlankContent: row.fill_blank ?? null,
    // Multiple: "any one correct is enough" (Question.acceptAnyCorrect). Missing column =
    // the original all-or-nothing rule.
    acceptAnyCorrect: row.accept_any_correct ?? false,
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
    // These three columns were only recently added to the schema — ?? false/true (not ||)
    // so an explicit false from the DB is never overridden, only a genuinely missing
    // column (an unmigrated project) falls back to the client default.
    showCorrectnessInstantly: row.show_correctness_instantly ?? false,
    showQuestionNumbers: row.show_question_numbers ?? true,
    showTimers: row.show_timers ?? true,
    splitPointsAcrossChoices: row.split_points_across_choices ?? false,
    timeWeightageEnabled: row.time_weightage_enabled ?? false,
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

/** Same "Starts in 2h 15m" style label as countdownUntil() in Models.kt — shared by
 *  every screen that shows a Scheduled quiz's countdown. */
function countdownUntil(targetMillis, now) {
  now = now ?? Date.now();
  const diffSec = Math.max(0, Math.floor((targetMillis - now) / 1000));
  const h = Math.floor(diffSec / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  const s = diffSec % 60;
  const remaining = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  return `Starts in ${remaining}`;
}

/**
 * Loads a quiz from its share code.
 *
 * Goes through the quiz_by_share_code / questions_by_share_code RPCs rather than reading
 * the tables directly: the quizzes/questions tables are only selectable for quizzes you
 * own or have already joined, so a plain `.from("quizzes").eq("share_code", …)` returns
 * nothing for a visitor arriving on a share link. (It used to work because every
 * published quiz was readable by anyone holding the anon key — which also meant the whole
 * table, answer keys included, could be downloaded. See schema.sql's quiz_is_visible.)
 *
 * The RPCs return exactly one quiz for an exact code, and are granted to anon so this
 * still works before the visitor signs in.
 */
async function fetchQuizByShareCode(code) {
  const { data: quizRows, error } = await supabaseClient
    .rpc("quiz_by_share_code", { p_code: code });
  if (error) return null;
  const quizRow = Array.isArray(quizRows) ? quizRows[0] : quizRows;
  if (!quizRow) return null;

  const { data: questionRows, error: qErr } = await supabaseClient
    .rpc("questions_by_share_code", { p_code: code });
  if (qErr) return null;

  return quizFromRow(quizRow, (questionRows || []).map(questionFromRow));
}

/** Admin maintenance switches (app_limits.create_quiz_enabled / join_quiz_enabled — see
 *  schema.sql). Web only ever needs the join one; create isn't a thing this page does.
 *  Fails OPEN on any error — a network hiccup or a stale/missing RPC must never look like
 *  a maintenance outage to a visitor who otherwise could have joined just fine. Granted to
 *  anon, same as quiz_by_share_code, so this resolves before the visitor signs in. */
async function fetchFeatureFlags() {
  try {
    const { data, error } = await supabaseClient.rpc("public_feature_flags");
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("public_feature_flags: no row");
    return { joinQuizEnabled: row.join_quiz_enabled !== false };
  } catch (e) {
    return { joinQuizEnabled: true };
  }
}

/** Checked right before a real submission lands — mirrors QuizPreviewViewModel.
 *  finishPreview's own re-check on Android. The landing/Start-Quiz screen's status check
 *  only ever ran once, when the taker opened the quiz; it has no way to know the owner
 *  ended it (manually, or its own schedule ran out) sometime after that, while this
 *  taker was still mid-quiz. Null on failure/offline — a network hiccup here must never
 *  itself block a legitimate submission. */
async function fetchQuizStatus(quizId) {
  // Also carries every setting finishQuiz() actually scores with (manual marking,
  // split-points, time-weightage, show-timers) — state.quiz itself is only ever fetched
  // once at page load (boot()) and never refreshed, so without re-fetching these here too,
  // an owner flipping one of these settings mid-quiz would silently score a submission
  // under whatever was current when the tab first loaded, not the live value. Mirrors
  // QuizPreviewViewModel.finishPreview's identical re-fetch on Android.
  // Via RPC for the same reason as fetchQuizByShareCode above: a taker who has not joined
  // yet cannot select this quiz's row directly. quiz_status_by_id returns only the
  // scoring/schedule flags — never questions, never answers.
  const { data: rows, error } = await supabaseClient
    .rpc("quiz_status_by_id", { p_quiz_id: quizId });
  if (error) return null;
  const data = Array.isArray(rows) ? rows[0] : rows;
  if (!data) return null;
  return {
    startAt: data.start_at,
    endAt: data.end_at,
    isArchived: data.is_archived,
    manualMarkingDefault: data.manual_marking_default ?? false,
    splitPointsAcrossChoices: data.split_points_across_choices ?? false,
    timeWeightageEnabled: data.time_weightage_enabled ?? false,
    showTimers: data.show_timers ?? true,
  };
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

/** Full per-question answers for an already-completed attempt — same shape finishQuiz's
 *  own `answers` array carries, so it can be handed straight to renderResult. Used when a
 *  taker without retake access reopens the quiz link: they should land on the real result
 *  screen (score breakdown, review cards) exactly like right after finishing, not just a
 *  one-line "you've already completed this" blurb with no way to actually see it again. */
async function fetchAttemptAnswers(attemptId) {
  const { data, error } = await supabaseClient
    .from("attempt_answers")
    .select("*")
    .eq("attempt_id", attemptId);
  if (error || !data) return [];
  return data.map((row) => ({
    questionId: row.question_id,
    isCorrect: row.is_correct,
    givenAnswers: row.given_answer ?? [],
    timeTakenSec: row.time_taken_sec,
    usedHint: row.used_hint === true,
    needsManualMarking: row.needs_manual_marking === true,
    awardedPoints: row.awarded_points,
    maxPoints: row.max_points,
    // Not persisted anywhere (see finishQuiz's own comment on this same field) — a
    // reopened result just won't have the word-by-word WRITTEN breakdown, same
    // limitation as reloading the page right after finishing would already have.
    evaluationResult: null,
  }));
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
    used_hint: a.usedHint === true,
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
/** Records membership — mirrors QuizRepository.joinQuiz()/pushJoinQuiz() on Android. Lets
 *  the quiz owner's Participants tab show this person as "joined" even before (or without)
 *  ever completing an attempt, same as joining by code in the app. Upsert: re-joining
 *  (revisiting the link) just refreshes joined_at rather than erroring on a duplicate row. */
async function joinQuiz(userId, quizId) {
  const { error } = await supabaseClient.from("joined_quizzes").upsert({
    user_id: userId,
    quiz_id: quizId,
    joined_at: Date.now(),
  });
  if (error) throw error;
}

/** This account's last real start on a quiz (epoch ms), or null if never started / not
 *  joined — mirrors JoinedQuizDao.getLastStartedAt on Android. With no completed attempt,
 *  a non-null value means "started, then left without submitting": Retake if the quiz
 *  allows it, otherwise locked (see renderLanding). Null on failure too — a read hiccup
 *  must never lock someone out. */
async function fetchLastStartedAt(quizId, userId) {
  const { data, error } = await supabaseClient
    .from("joined_quizzes")
    .select("last_started_at")
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data.last_started_at ?? null;
}

/** Stamps a real start — mirrors QuizRepository.markQuizStarted()/pushQuizStarted() on
 *  Android (same column, so the owner's "X started your quiz" notification fires for web
 *  takers too). An update, not an upsert: Start is only reachable after Join created the
 *  row, and joined_at must stay the real join time. */
async function markQuizStarted(userId, quizId) {
  const { error } = await supabaseClient
    .from("joined_quizzes")
    .update({ last_started_at: Date.now() })
    .eq("user_id", userId)
    .eq("quiz_id", quizId);
  if (error) throw error;
}

/** Checked right before a real submission lands — mirrors QuizRepository.isJoinedRemote()
 *  on Android. An owner's remove-participant action deletes this row remotely, but the
 *  removed taker's own tab has no way to find out short of asking here. Null (not false)
 *  on failure — a network hiccup must never itself block a legitimate submission; only a
 *  confirmed "no" (an actual empty result) does. */
async function isJoined(quizId, userId) {
  const { data, error } = await supabaseClient
    .from("joined_quizzes")
    .select("user_id")
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .limit(1);
  if (error) return null;
  return (data || []).length > 0;
}

async function ensurePollOpen(questionId) {
  const { data: existing } = await supabaseClient.from("poll_states").select("*").eq("question_id", questionId).maybeSingle();
  if (existing) return existing;
  const openedAt = Date.now();
  const row = { question_id: questionId, status: "OPEN", opened_at: openedAt, closes_at: null };
  const { error } = await supabaseClient.from("poll_states").upsert(row);
  if (error) throw error;
  return row;
}

/** Read-only batch fetch of poll_states — mirrors SupabaseSyncRepository.fetchPollStates.
 *  Unlike ensurePollOpen it never creates a row, so it's safe to call before deciding
 *  whether to even show a poll. Returns { [questionId]: { status, opened_at, closes_at } };
 *  an empty object on any error or when nothing is passed (fail-safe → caller treats a
 *  missing entry as OPEN). */
async function fetchPollStates(questionIds) {
  if (!questionIds || questionIds.length === 0) return {};
  const { data, error } = await supabaseClient.from("poll_states").select("*").in("question_id", questionIds);
  if (error) return {};
  const map = {};
  (data || []).forEach((r) => {
    map[r.question_id] = { status: r.status, opened_at: r.opened_at, closes_at: r.closes_at };
  });
  return map;
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
  fetchFeatureFlags,
  fetchQuizStatus,
  effectiveStatus,
  countdownUntil,
  joinQuiz,
  isJoined,
  fetchLastStartedAt,
  markQuizStarted,
  fetchExistingAttempt,
  fetchAttemptAnswers,
  submitAttempt,
  ensurePollOpen,
  fetchPollStates,
  fetchPollVotes,
  castPollVote,
};
