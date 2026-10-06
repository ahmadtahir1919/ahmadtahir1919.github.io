// The grading suite's data: every owned quiz with at least one submission, loaded in one go
// (batched — one query per table, never one per attempt), shaped the way the reference's views
// read it, plus the one write path (setMarks / setOverall / undo → drafts → submitDrafts).
//
// Marks are drafts until the teacher presses Submit marks: every save_grades stamps a fresh
// graded_at and that pushes the student a notification, so marking as you go would notify a
// student once per mark. A draft is any answer (or overall note) that differs from what the
// server last confirmed (a.base / s.baseOverall); drafts are kept in localStorage per owner and
// quiz, so a reload or a closed tab loses nothing. submitDrafts sends one save_grades per
// student — whatever has been marked so far, all of it or only a few.
//
// The model, per quiz (the reference's names, real data underneath):
//   Qm = { id, title, color, ini, quiz, qs, studs, A, sids }
//   qs   — scored questions in quiz order (polls are never graded, so never here):
//          { id, type, text, pts, exp, num } — num is the position in the whole quiz
//   polls — the quiz's polls, shown beside the marking but never counted:
//          { id, text, num, options, anonymous, q }; votes = Map(pollId -> [poll_votes row])
//   studs — submitted attempts (sorted by name), then people who joined but haven't
//          submitted ("Not started"): { id, uid, attemptId, name, plat, sub, attempt }
//   A    — Map("studentId|questionId" -> answer):
//          { row, given, max, pts, fb, manual, auto, ok, adj, _open }
//
// The rules are the app's (core/scoring.js, a port of Grading.kt): an answer needs a human when
// its row says needs_manual_marking — that is every non-poll question of a quiz marked by hand,
// not only written ones — and it is pending while awarded_points is null.

import { QUESTION_TYPES as QT, themeColor } from "../core/models.js";
import { S } from "../core/strings.js";
import { listMyQuizzes, questionsFor } from "../core/quizzes.js";
import { displayNames, GradesNotSavedError, loadAnswersFor, loadAttemptsFor, loadPollVotes, participantIds, saveGradesBatch } from "../core/results.js";
import { currentMark, isOwnerAdjusted, untouchedAutoVerdict, withManualMark } from "../core/scoring.js";
import { pollTally } from "../results/csv.js";
import { ini } from "./gx-util.js";

const pollIdsOf = (questionLists) => questionLists.flatMap((list) => list.filter((q) => q.type === QT.POLL).map((q) => q.id));
/** Votes are extra: if they can't be read, the polls just show no votes. */
const votesFor = (ids) =>
  ids.length
    ? loadPollVotes(ids).catch((error) => {
        console.warn(error);
        return new Map();
      })
    : Promise.resolve(new Map());

export const store = {
  user: null,
  quizzes: [],
  byId: new Map(),
  /** Stored draft marks the last loadAll dropped because the answer was marked elsewhere after them. */
  markedElsewhere: 0,
};

const listeners = new Set();
/** fn(kind, Qm) — kind: "marks" | "reload". */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = (kind, qm) => listeners.forEach((fn) => fn(kind, qm));

// ── Loading ─────────────────────────────────────────────────────────────────

export async function loadAll(user) {
  store.user = user;
  store.markedElsewhere = 0;
  const quizzes = (await listMyQuizzes(user.id)).filter((q) => !q.isDraft);
  const ids = quizzes.map((q) => q.id);
  const [attempts, questions, people] = await Promise.all([loadAttemptsFor(ids), questionsFor(ids), participantIds(ids)]);
  const [answers, votes] = await Promise.all([loadAnswersFor(attempts.map((a) => a.id)), votesFor(pollIdsOf([...questions.values()]))]);
  const userIds = new Set(attempts.map((a) => a.user_id));
  for (const set of people.values()) for (const id of set) userIds.add(id);
  const names = await displayNames([...userIds]);

  store.quizzes = quizzes
    .map((quiz) => buildQuiz(quiz, questions.get(quiz.id) ?? [], attempts.filter((a) => a.quiz_id === quiz.id), answers, people.get(quiz.id), names, votes))
    .filter((qm) => qm.studs.some((s) => s.sub));
  store.byId = new Map(store.quizzes.map((qm) => [qm.id, qm]));
  for (const qm of store.quizzes) restoreDrafts(qm);
  pruneDrafts(new Set(quizzes.map((q) => q.id)));
  return store.quizzes;
}

/** Re-reads one quiz from the server (after save_grades said its answer sheet changed). */
export async function reloadQuiz(quizId) {
  const old = store.byId.get(quizId);
  if (!old) return;
  const [attempts, questions, people] = await Promise.all([loadAttemptsFor([quizId]), questionsFor([quizId]), participantIds([quizId])]);
  const [answers, votes] = await Promise.all([loadAnswersFor(attempts.map((a) => a.id)), votesFor(pollIdsOf([questions.get(quizId) ?? []]))]);
  const ids = new Set(attempts.map((a) => a.user_id));
  for (const id of people.get(quizId) ?? []) ids.add(id);
  const names = await displayNames([...ids]);
  const qm = buildQuiz(old.quiz, questions.get(quizId) ?? [], attempts, answers, people.get(quizId), names, votes);
  Object.assign(old, { qs: qm.qs, polls: qm.polls, votes: qm.votes, studs: qm.studs, A: qm.A });
  restoreDrafts(old);
  emit("reload", old);
}

function buildQuiz(quiz, questionList, attempts, answers, joined, names, votes) {
  const title = quiz.title?.trim() || S.UNTITLED_QUIZ;
  const numbered = questionList.map((q, i) => [q, i + 1]);
  const qs = numbered
    .filter(([q]) => q.type !== QT.POLL)
    .map(([q, num]) => ({ id: q.id, type: q.type, text: q.text ?? "", pts: q.points > 0 ? q.points : 1, exp: expectedOf(q), num, q }));
  const polls = numbered
    .filter(([q]) => q.type === QT.POLL)
    .map(([q, num]) => ({ id: q.id, text: q.text ?? "", num, options: q.options ?? [], anonymous: q.pollSettings?.anonymous === true, q }));
  const finished = attempts.filter((a) => a.finished_at != null);
  const nameOf = (uid) => names.get(uid) ?? S.ANONYMOUS;
  const studs = finished
    .map((a) => ({
      id: a.id,
      uid: a.user_id,
      attemptId: a.id,
      name: nameOf(a.user_id),
      plat: a.source === "ANDROID" ? S.GX_ANDROID : a.source === "WEB" ? S.GX_WEB : null,
      sub: a.finished_at,
      attempt: a,
      baseOverall: a.overall_feedback ?? "",
    }))
    .sort((x, y) => x.name.localeCompare(y.name));
  const submittedUsers = new Set(finished.map((a) => a.user_id));
  const waiting = [...(joined ?? [])]
    .filter((uid) => uid && !submittedUsers.has(uid) && uid !== quiz.ownerId)
    .map((uid) => ({ id: `u:${uid}`, uid, attemptId: null, name: nameOf(uid), plat: null, sub: null, attempt: null }))
    .sort((x, y) => x.name.localeCompare(y.name));

  const rowsByAttempt = new Map();
  for (const row of answers) {
    if (!rowsByAttempt.has(row.attempt_id)) rowsByAttempt.set(row.attempt_id, new Map());
    rowsByAttempt.get(row.attempt_id).set(row.question_id, row);
  }
  const A = new Map();
  for (const s of studs) {
    const rows = rowsByAttempt.get(s.attemptId);
    for (const q of qs) {
      const row = rows?.get(q.id);
      if (row) A.set(`${s.id}|${q.id}`, answerOf(row, q));
    }
  }
  return {
    id: quiz.id,
    title,
    color: themeColor(quiz.themeColorName),
    ini: ini(title.replace(/—.*/, "")),
    quiz,
    qs,
    polls,
    votes: new Map(polls.map((p) => [p.id, votes?.get(p.id) ?? []])),
    studs: [...studs, ...waiting],
    A,
  };
}

/** The answer key as one line: the written answer, each blank's first accepted answer, or the
 *  correct option(s). */
function expectedOf(q) {
  if (q.type === QT.WRITTEN) return q.writtenAnswer ?? "";
  if (q.type === QT.FILL_BLANK) {
    const content = q.fillBlank ?? {};
    const byId = new Map((content.blanks ?? []).map((b) => [b.id, b]));
    const order = [...String(content.template ?? "").matchAll(/\[\[([^[\]]*)\]\]/g)].map((m) => byId.get(m[1])).filter(Boolean);
    return (order.length ? order : content.blanks ?? []).map((b) => (b.acceptedAnswers ?? [])[0] ?? "").join(" · ");
  }
  return (q.correct ?? []).join(", ");
}

function givenOf(row, q) {
  const given = row.given_answer ?? [];
  const list = (Array.isArray(given) ? given : [given]).map((v) => String(v ?? ""));
  return list.join(q.type === QT.FILL_BLANK ? " · " : ", ");
}

function answerOf(row, q) {
  const a = { row, base: pickDraft(row), given: givenOf(row, q), _open: false };
  derive(a);
  a.ok = row.is_correct === true; // the verdict it loaded with
  return a;
}

/** Recomputes the read-side fields from the row. */
function derive(a) {
  const row = a.row;
  a.max = (row.max_points ?? 0) > 0 ? row.max_points : 1;
  a.pts = currentMark(row);
  a.fb = row.feedback ?? "";
  a.manual = row.needs_manual_marking === true;
  a.auto = !a.manual;
  a.adj = isOwnerAdjusted(row);
}

// ── Selectors (the reference's) ─────────────────────────────────────────────

export const subs = (qm) => qm.studs.filter((s) => s.sub);
export const ansOf = (qm, sid, qid) => qm.A.get(`${sid}|${qid}`);
/** Manual answers on submitted attempts: the progress total. */
export const manualKeys = (qm) => [...qm.A].filter(([, a]) => a.manual).map(([k]) => k);
export const pendingOf = (qm) => [...qm.A.values()].filter((a) => a.manual && a.pts == null).length;
export const pendingTotal = () => store.quizzes.reduce((n, qm) => n + pendingOf(qm), 0);
export const needCount = (qm, s) => qm.qs.filter((q) => {
  const a = ansOf(qm, s.id, q.id);
  return a && a.manual && a.pts == null;
}).length;
/** "none" (not submitted) | "need" (something to mark) | "done". */
export const stuStatus = (qm, s) => (!s.sub ? "none" : needCount(qm, s) ? "need" : "done");
/** [awarded, max] over the questions this student answered. */
export function stuScore(qm, s) {
  let g = 0;
  let m = 0;
  for (const q of qm.qs) {
    const a = ansOf(qm, s.id, q.id);
    if (!a) continue;
    m += a.max;
    if (a.pts != null) g += a.pts;
  }
  return [g, m];
}
/** { g, m, p, pct } — awarded, max, pending count, whole percent. */
export function qScore(qm, s) {
  const [g, m] = stuScore(qm, s);
  return { g, m, p: needCount(qm, s), pct: m ? Math.round((g / m) * 100) : 0 };
}
export const studentOfKey = (qm, key) => qm.studs.find((s) => s.id === key.split("|")[0]);

/** Nothing to mark at all: every question is a poll. */
export const pollOnly = (qm) => !qm.qs.length && qm.polls.length > 0;
/** This student's vote on a poll — null when the poll is anonymous or they didn't vote. */
export const voteOf = (qm, poll, s) => (poll.anonymous || !s.uid ? null : (qm.votes.get(poll.id) ?? []).find((v) => v.participant_id === s.uid) ?? null);
/** { voters, options:[{label,count,percent}], other, otherEntries } — the Results page's tally. */
export const tallyOf = (qm, poll) => pollTally(poll.q, qm.votes.get(poll.id) ?? []);

// ── Writes ──────────────────────────────────────────────────────────────────

const undoStacks = new Map(); // quizId -> entries
const MAX_UNDO = 200;
export const undoStack = (qm) => {
  if (!undoStacks.has(qm.id)) undoStacks.set(qm.id, []);
  return undoStacks.get(qm.id);
};
export const clearUndo = (qm) => undoStacks.delete(qm.id);

/**
 * Marks and/or notes on these answers, applied now and queued for save_grades. One call = one
 * undo entry. pts undefined leaves the mark; opt.fb undefined leaves the note.
 */
export function setMarks(qm, keys, pts, opt = {}) {
  const items = [];
  for (const key of keys) {
    const a = qm.A.get(key);
    if (!a) continue;
    items.push({ key, prev: { row: a.row } });
    let row = a.row;
    if (pts !== undefined) row = withManualMark(row, Math.max(0, Math.min(a.max, Math.round(pts))), row.max_points ?? 0);
    if (opt.fb !== undefined) row = { ...row, feedback: String(opt.fb).trim().slice(0, 500) || null };
    a.row = row;
    derive(a);
  }
  const entry = { items, ctx: opt.ctx ?? null };
  if (opt.undoable !== false && items.length) {
    const stack = undoStack(qm);
    stack.push(entry);
    if (stack.length > MAX_UNDO) stack.shift();
  }
  persistDrafts(qm);
  emit("marks", qm);
  return entry;
}

/** Pops the last entry and puts every answer in it back as it was. Returns the entry or null. */
export function undo(qm) {
  const entry = undoStack(qm).pop();
  if (!entry) return null;
  for (const { key, prev } of entry.items) {
    const a = qm.A.get(key);
    if (!a) continue;
    a.row = prev.row;
    derive(a);
  }
  persistDrafts(qm);
  emit("marks", qm);
  return entry;
}

/** The whole-quiz note for one student (attempts.overall_feedback). */
export function setOverall(qm, s, text) {
  if (!s.attempt) return;
  s.attempt = { ...s.attempt, overall_feedback: String(text).slice(0, 500) };
  persistDrafts(qm);
  emit("marks", qm);
}

// ── Drafts ──────────────────────────────────────────────────────────────────

// The row fields a mark or note changes (withManualMark + feedback).
const DRAFT_FIELDS = ["max_points", "awarded_points", "is_correct", "graded_at", "feedback"];
const pickDraft = (row) => Object.fromEntries(DRAFT_FIELDS.map((f) => [f, row[f] ?? null]));
const markDiffers = (a) =>
  (a.row.awarded_points ?? null) !== (a.base.awarded_points ?? null) ||
  (a.row.is_correct === true) !== (a.base.is_correct === true) ||
  (a.row.graded_at == null) !== (a.base.graded_at == null);
const fbDiffers = (a) => (a.row.feedback ?? "") !== (a.base.feedback ?? "");
const overallDiffers = (s) => !!s.attempt && (s.attempt.overall_feedback ?? "") !== s.baseOverall;

/** Answers changed since the server last confirmed them. */
export const draftKeys = (qm) => [...qm.A].filter(([, a]) => markDiffers(a) || fbDiffers(a)).map(([k]) => k);
/** Students with anything to submit (marks, notes or the overall note). */
export function draftStudents(qm) {
  const ids = new Set(draftKeys(qm).map((k) => k.split("|")[0]));
  for (const s of qm.studs) if (overallDiffers(s)) ids.add(s.id);
  return qm.studs.filter((s) => ids.has(s.id));
}
/** What the Submit button counts: changed answers plus changed overall notes. */
export const draftCount = (qm) => draftKeys(qm).length + qm.studs.filter(overallDiffers).length;
export const isDraft = (a) => !!a && (markDiffers(a) || fbDiffers(a));

const draftsKey = (quizId) => `gx-drafts:${store.user?.id}:${quizId}`;
const DRAFTS_PREFIX = () => `gx-drafts:${store.user?.id}:`;

/** A stored draft answer made at [at] loses to a server mark made after it ([serverGradedAt]); a draft
 *  stored before drafts had a time ([at] missing) is kept. */
export const draftMarkedElsewhere = (at, serverGradedAt) => at != null && (serverGradedAt ?? 0) > at;

const sameDraft = (a, b) => DRAFT_FIELDS.every((f) => (a[f] ?? null) === (b[f] ?? null));

/** A stored overall note: { text, at }, or a bare string from before notes had a time (kept). */
export const storedOverall = (entry) => (typeof entry === "string" ? { text: entry, at: null } : entry);

function storedDrafts(quizId) {
  try {
    return JSON.parse(localStorage.getItem(draftsKey(quizId)) ?? "null");
  } catch {
    return null;
  }
}

function persistDrafts(qm) {
  // Each answer and overall note keeps the time it was last changed here (`at`), so a mark made elsewhere later wins on
  // restore. An unchanged one keeps its old time; drafts stored before this have none and stay kept.
  const stored = storedDrafts(qm.id);
  const before = stored?.answers ?? {};
  const answers = {};
  for (const key of draftKeys(qm)) {
    const fields = pickDraft(qm.A.get(key).row);
    const old = before[key];
    answers[key] = { ...fields, at: old && sameDraft(old, fields) ? old.at : Date.now() };
  }
  const overall = {};
  for (const s of qm.studs) {
    if (!overallDiffers(s)) continue;
    const text = s.attempt.overall_feedback ?? "";
    const old = stored?.overall?.[s.attemptId] != null ? storedOverall(stored.overall[s.attemptId]) : null;
    overall[s.attemptId] = { text, at: old && old.text === text ? old.at : Date.now() };
  }
  try {
    if (Object.keys(answers).length || Object.keys(overall).length) localStorage.setItem(draftsKey(qm.id), JSON.stringify({ answers, overall }));
    else localStorage.removeItem(draftsKey(qm.id));
  } catch (error) {
    console.warn(error); // storage full or blocked: the drafts still live on the page
  }
}

/** Lays this quiz's stored drafts over the rows just loaded; drops any whose answer is gone. */
function restoreDrafts(qm) {
  const saved = storedDrafts(qm.id);
  if (!saved) return;
  for (const [key, { at, ...fields }] of Object.entries(saved.answers ?? {})) {
    const a = qm.A.get(key);
    if (!a) continue;
    // Marked elsewhere (the app, another tab) after this draft was made: the newer server mark wins.
    if (draftMarkedElsewhere(at, a.row.graded_at)) {
      store.markedElsewhere++;
      continue;
    }
    a.row = { ...a.row, ...fields };
    derive(a);
  }
  for (const [attemptId, entry] of Object.entries(saved.overall ?? {})) {
    const s = qm.studs.find((x) => x.attemptId === attemptId);
    if (!s?.attempt) continue;
    const { text, at } = storedOverall(entry);
    // Same rule as an answer: marked elsewhere after this note was written, the server's note wins.
    if (draftMarkedElsewhere(at, s.attempt.graded_at)) {
      store.markedElsewhere++;
      continue;
    }
    s.attempt = { ...s.attempt, overall_feedback: text };
  }
  persistDrafts(qm);
}

/** Drafts for quizzes this owner no longer has are deleted, not left behind. */
function pruneDrafts(quizIds) {
  try {
    const prefix = DRAFTS_PREFIX();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix) && !quizIds.has(k.slice(prefix.length))) localStorage.removeItem(k);
    }
  } catch (error) {
    console.warn(error);
  }
}

/** Puts every draft on this quiz back to what the server has. */
export function discardDrafts(qm) {
  for (const key of draftKeys(qm)) {
    const a = qm.A.get(key);
    a.row = { ...a.row, ...a.base };
    derive(a);
  }
  for (const s of qm.studs) if (overallDiffers(s)) s.attempt = { ...s.attempt, overall_feedback: s.baseOverall };
  clearUndo(qm);
  persistDrafts(qm);
  emit("marks", qm);
}

/** What save_grades gets for one student: only the questions that changed. */
function entryFor(qm, s) {
  const marks = new Map();
  const restore = new Map();
  const questionFeedback = new Map();
  for (const q of qm.qs) {
    const a = qm.A.get(`${s.id}|${q.id}`);
    if (!a) continue;
    if (markDiffers(a)) {
      const verdict = untouchedAutoVerdict(a.row);
      if (verdict) restore.set(q.id, verdict);
      else marks.set(q.id, { mark: a.row.awarded_points ?? null, maxPoints: a.row.max_points ?? 0 });
    }
    if (fbDiffers(a)) questionFeedback.set(q.id, a.row.feedback ?? "");
  }
  const entry = { attemptId: s.attemptId, marks, restore, questionFeedback };
  if (overallDiffers(s)) entry.overallFeedback = s.attempt.overall_feedback ?? "";
  return entry;
}

/**
 * Sends every draft on this quiz: one save_grades per student, so each gets one notification.
 * Resolves { sent, failed, rejected } in students. Sent students' drafts become the new base;
 * failed ones stay drafts to try again; rejected ones (the student retook, the sheet changed)
 * are dropped and the quiz is re-read.
 */
export async function submitDrafts(qm) {
  const studs = draftStudents(qm);
  if (!studs.length) return { sent: 0, failed: 0, rejected: 0 };
  let results;
  try {
    results = await saveGradesBatch(qm.id, studs.map((s) => entryFor(qm, s)));
  } catch (error) {
    console.warn(error); // offline or a dropped request: everything stays a draft
    return { sent: 0, failed: studs.length, rejected: 0 };
  }
  let sent = 0;
  let failed = 0;
  let rejected = 0;
  for (const r of results) {
    const s = studs.find((x) => x.attemptId === r.attemptId);
    if (!s) continue;
    if (r.ok) {
      sent++;
      for (const q of qm.qs) {
        const a = qm.A.get(`${s.id}|${q.id}`);
        if (a) a.base = pickDraft(a.row);
      }
      s.baseOverall = s.attempt?.overall_feedback ?? "";
    } else if (r.error instanceof GradesNotSavedError) {
      rejected++;
      for (const q of qm.qs) {
        const a = qm.A.get(`${s.id}|${q.id}`);
        if (a) a.row = { ...a.row, ...a.base };
      }
      if (s.attempt) s.attempt = { ...s.attempt, overall_feedback: s.baseOverall };
    } else {
      console.warn(r.error);
      failed++;
    }
  }
  persistDrafts(qm);
  emit("marks", qm);
  if (rejected) reloadQuiz(qm.id);
  return { sent, failed, rejected };
}
