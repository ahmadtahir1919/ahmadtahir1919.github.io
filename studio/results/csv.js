// Whole-quiz CSV — a port of the app's ResultCsvGenerator.wholeQuizRows: one row per person
// (ranked, unmarked attempts last), per-question answer/result/marks columns, then the question
// key and the poll tallies. UTF-8 with a BOM so Excel reads Urdu text correctly; cells that
// would run as a spreadsheet formula get a leading ' (csvField).

import { QUESTION_TYPES } from "../core/models.js";
import { isPendingMarking, isSkipped } from "../core/scoring.js";

const PLAIN_NUMBER = /^[-+]?\d+(\.\d+)?$/;

export function csvField(raw) {
  const value = String(raw ?? "");
  const guarded = value && "=+-@\t\r".includes(value[0]) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
  return /[,"\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

function orderedBlanks(content) {
  const byId = new Map((content?.blanks ?? []).map((b) => [b.id, b]));
  const out = [];
  const re = /\[\[([^[\]]*)\]\]/g;
  let match;
  while ((match = re.exec(content?.template ?? "")) !== null) if (byId.has(match[1])) out.push(byId.get(match[1]));
  return out;
}

function stripMarkdown(text) {
  return String(text ?? "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1");
}

export function plainQuestionText(q) {
  if (q.type === QUESTION_TYPES.FILL_BLANK && q.fillBlank) {
    if (q.fillBlank.title?.trim()) return stripMarkdown(q.fillBlank.title);
    let n = 0;
    const byId = new Set((q.fillBlank.blanks ?? []).map((b) => b.id));
    return stripMarkdown(String(q.fillBlank.template ?? "").replace(/\[\[([^[\]]*)\]\]/g, (m, id) => (byId.has(id) ? `[${++n}]` : m)));
  }
  return stripMarkdown(q.text);
}

export function correctAnswerText(q) {
  let text;
  if (q.type === QUESTION_TYPES.WRITTEN) text = q.writtenAnswer ?? "";
  else if (q.type === QUESTION_TYPES.FILL_BLANK) text = orderedBlanks(q.fillBlank).map((b, i) => `${i + 1}: ${b.acceptedAnswers?.[0]?.trim() || "—"}`).join("   ");
  else text = (q.correct ?? []).join(", ");
  return text.trim() ? text : "—";
}

export function givenAnswerText(q, answer) {
  const given = Array.isArray(answer.given_answer) ? answer.given_answer : [answer.given_answer];
  if (q.type === QUESTION_TYPES.FILL_BLANK && q.fillBlank) {
    return orderedBlanks(q.fillBlank).map((_, i) => `${i + 1}: ${String(given[i] ?? "").trim() || "(no answer)"}`).join("   ");
  }
  return given.filter((g) => g != null).join(", ").trim() || "—";
}

function resultLabel(answer) {
  if (isPendingMarking(answer)) return "Pending";
  if (isSkipped(answer)) return "Skipped";
  return answer.is_correct === true ? "Correct" : "Wrong";
}

function stamp(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * quiz, questions (all, in order), rows: [{ attempt, answers, name, breakdown, pending }],
 * pollVotes: Map(questionId -> [vote rows])
 */
export function buildCsv({ quiz, questions, rows, pollVotes }) {
  const scored = questions.filter((q) => q.type !== QUESTION_TYPES.POLL);
  const polls = questions.filter((q) => q.type === QUESTION_TYPES.POLL);
  const percent = (r) => (r.attempt.total > 0 ? Math.floor((r.attempt.score * 100) / r.attempt.total) : 0);
  const ranked = [...rows].sort(
    (a, b) => Number(a.pending > 0) - Number(b.pending > 0) || percent(b) - percent(a) || a.attempt.finished_at - b.attempt.finished_at
  );
  const hasMarks = ranked.some((r) => r.breakdown.marksTotal > 0);
  const hints = scored.some((q) => q.hint?.trim());
  const out = [];

  out.push([
    "Rank", "Name", "Score", "Total", "Percent", "Correct", "Wrong",
    ...(hasMarks ? ["Marks awarded", "Marks total"] : []),
    ...(quiz.showTimers ? ["Time (s)"] : []),
    ...(hints ? ["Hints used"] : []),
    "Submitted at", "Source", "Retakes", "Pending marking", "Owner feedback",
    ...scored.flatMap((_, i) => [`Q${i + 1} answer`, `Q${i + 1} result`, ...(hasMarks ? [`Q${i + 1} marks`] : [])]),
  ]);

  ranked.forEach((r, index) => {
    const byQuestion = new Map(r.answers.map((a) => [a.question_id, a]));
    out.push([
      index + 1, r.name, r.attempt.score, r.attempt.total, percent(r), r.breakdown.totalCorrect, r.breakdown.totalWrong,
      ...(hasMarks ? [r.breakdown.marksAwarded, r.breakdown.marksTotal] : []),
      ...(quiz.showTimers ? [r.answers.reduce((s, a) => s + (a.time_taken_sec ?? 0), 0)] : []),
      ...(hints ? [r.answers.filter((a) => a.used_hint).length] : []),
      stamp(r.attempt.finished_at),
      r.attempt.source === "ANDROID" ? "Android" : r.attempt.source === "WEB" ? "Web" : "",
      r.attempt.retake_count ?? 0,
      r.pending,
      r.attempt.overall_feedback ?? "",
      ...scored.flatMap((q) => {
        const a = byQuestion.get(q.id);
        return [
          a ? givenAnswerText(q, a) : "",
          a ? resultLabel(a) : "",
          ...(hasMarks ? [a && (a.max_points ?? 0) > 0 && a.awarded_points != null ? a.awarded_points : ""] : []),
        ];
      }),
    ]);
  });

  if (scored.length) {
    out.push([""], ["Question key"], ["#", "Question", "Correct answer", "Points"]);
    scored.forEach((q, i) => out.push([`Q${i + 1}`, plainQuestionText(q), correctAnswerText(q), q.points]));
  }

  if (polls.length) {
    out.push([""], ["Poll results"], ["Question", "Option", "Votes", "Percent"]);
    for (const q of polls) {
      const tally = pollTally(q, pollVotes.get(q.id) ?? []);
      const text = plainQuestionText(q);
      if (!tally.voters) {
        out.push([text, "", 0, 0]);
        continue;
      }
      tally.options.forEach((o) => out.push([text, o.label, o.count, o.percent]));
      if (tally.other.count) {
        out.push([text, "Other", tally.other.count, tally.other.percent]);
        tally.otherEntries.forEach((e) => out.push([text, `Other: ${e.text}`, e.count, ""]));
      }
    }
  }

  return "﻿" + out.map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/** Option counts for one poll. selected is a JSON array of option indexes; -1 = "Other". */
export function pollTally(question, votes) {
  const options = (question.options ?? []).map((label) => ({ label, count: 0, percent: 0 }));
  const other = { count: 0, percent: 0 };
  const otherTexts = new Map();
  for (const vote of votes) {
    for (const index of Array.isArray(vote.selected) ? vote.selected : []) {
      if (index === -1) {
        other.count++;
        const text = String(vote.other_text ?? "").trim();
        if (text) otherTexts.set(text, (otherTexts.get(text) ?? 0) + 1);
      } else if (options[index]) options[index].count++;
    }
  }
  const voters = votes.length;
  const pct = (n) => (voters ? Math.round((n * 100) / voters) : 0);
  options.forEach((o) => (o.percent = pct(o.count)));
  other.percent = pct(other.count);
  return { voters, options, other, otherEntries: [...otherTexts].map(([text, count]) => ({ text, count })) };
}

export function downloadCsv(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
