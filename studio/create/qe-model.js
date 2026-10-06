// What the editor shows about a question's progress — the rail's "missing" line, the card's
// step chips and the Publish checklist. Everything is derived from the real rules
// (core/validate.js validateQuestion), never a second copy of them: a question is "done"
// exactly when the server-mirroring validation passes.

import { QUESTION_TYPES as T } from "../core/models.js";
import { S, t } from "../core/strings.js";
import { validateQuestion } from "../core/validate.js";
import { fromForm, sentenceBlanks } from "./form.js";

/** The app's type order (QuestionBuilderScreen tabs): Single, Multiple, True/False, Written,
 *  Poll, Fill Blank. Keys 1–6 follow it. */
export const TYPES = [
  { id: T.SINGLE_CHOICE, name: () => S.TYPE_SINGLE, d: () => S.TYPE_SINGLE_SUB, k: "1" },
  { id: T.MULTIPLE_CORRECT, name: () => S.TYPE_MULTIPLE, d: () => S.TYPE_MULTIPLE_SUB, k: "2" },
  { id: T.TRUE_FALSE, name: () => S.TYPE_TRUE_FALSE, d: () => S.TYPE_TRUE_FALSE_SUB, k: "3" },
  { id: T.WRITTEN, name: () => S.TYPE_WRITTEN, d: () => S.TYPE_WRITTEN_SUB, k: "4" },
  { id: T.POLL, name: () => S.TYPE_POLL, d: () => S.TYPE_POLL_SUB, k: "5" },
  { id: T.FILL_BLANK, name: () => S.TYPE_FILL_BLANK, d: () => S.TYPE_FILL_BLANK_SUB, k: "6" },
];

export const typeName = (type) => TYPES.find((x) => x.id === type)?.name() ?? type;

/** Poll quick-fill sets, in the app's template order. */
export const FILLS = [
  [() => S.QE_FILL_YES_NO, ["Yes", "No"]],
  [() => S.QE_FILL_YES_NO_MAYBE, ["Yes", "No", "Maybe"]],
  [() => S.QE_FILL_AGREE, ["Agree", "Neutral", "Disagree"]],
  [() => S.QE_FILL_LIKERT, ["Strongly agree", "Agree", "Neutral", "Disagree", "Strongly disagree"]],
  [() => S.QE_FILL_DAYS, ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]],
  [() => S.QE_FILL_1_5, ["1", "2", "3", "4", "5"]],
  [() => S.QE_FILL_1_10, ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]],
];

const filled = (form) => form.items.filter((i) => i.text.trim());
const isFB = (form) => form.type === T.FILL_BLANK;

/** The question's own text — the heading for a fill-blank, which is optional. */
export function questionText(form) {
  return isFB(form) ? form.fb.title : form.text;
}

/** What the rail calls the question. */
export function railTitle(form) {
  if (isFB(form)) return (form.fb.title || form.fb.sentence.replace(/\[([^[\]]*)\]/g, "_____")).trim();
  return form.text.trim();
}

/** "Started": question text, an option text (not True/False) or an expected answer — or, for
 *  a fill-blank, a heading or sentence. A correct mark alone doesn't count: the app's new
 *  questions come with one pre-marked (QuestionFormLogic.kt defaultOptions). */
export function started(form) {
  if (isFB(form)) return !!(form.fb.title.trim() || form.fb.sentence.trim());
  return !!(form.text.trim() || (form.type !== T.TRUE_FALSE && form.items.some((i) => i.text.trim())) || form.writtenAnswer.trim());
}

function errorsOf(form, ctx) {
  return validateQuestion(fromForm(form), ctx.limits, ctx.quiz);
}

/** Done = passes the real validation. */
export function done(form, ctx) {
  return errorsOf(form, ctx).length === 0;
}

/** The first thing still missing, in the reference's short wording, or "" when done. */
export function missing(form, ctx) {
  const errors = errorsOf(form, ctx);
  if (!errors.length) return "";
  const first = errors[0];
  const map = {
    [S.ERR_QUESTION_TEXT_REQUIRED]: S.QE_MISS_WRITE,
    [S.ERR_NEED_TWO_OPTIONS]: S.QE_MISS_OPTIONS,
    [S.ERR_NO_CORRECT]: form.type === T.MULTIPLE_CORRECT ? S.QE_MISS_MARK_MULTI : S.QE_MISS_MARK,
    [S.ERR_DUPLICATE_OPTIONS]: S.QE_MISS_DUPLICATE,
    [S.ERR_WRITTEN_ANSWER_REQUIRED]: S.QE_MISS_EXPECTED,
    [S.ERR_FILL_SENTENCE_REQUIRED]: S.QE_MISS_SENTENCE,
    [S.ERR_NO_BLANKS]: S.QE_MISS_BLANK,
    [S.ERR_BLANK_ANSWER_REQUIRED]: S.QE_MISS_BLANK_ANSWER,
  };
  return map[first] ?? first;
}

/** The card footer's steps for [form]: [[label, ok], …]. They follow the real rules: a
 *  manual-marking quiz needs no right answer, Multiple correct needs one or more. */
export function steps(form, ctx) {
  const manual = ctx.quiz.manualMarkingDefault === true;
  const hasQ = !!form.text.trim();
  const two = filled(form).length >= 2;
  const right = form.items.some((i) => i.correct && i.text.trim());
  switch (form.type) {
    case T.WRITTEN:
      return manual ? [[S.QE_STEP_WRITE, hasQ]] : [[S.QE_STEP_WRITE, hasQ], [S.QE_STEP_EXPECTED, !!form.writtenAnswer.trim()]];
    case T.FILL_BLANK: {
      const blanks = sentenceBlanks(form.fb.sentence);
      const list = [[S.QE_STEP_SENTENCE, !!form.fb.sentence.trim()], [S.QE_STEP_BLANK, blanks.length > 0]];
      if (!manual) list.push([S.QE_STEP_BLANK_ANSWERS, blanks.length > 0 && blanks.every((b) => b.trim())]);
      return list;
    }
    case T.POLL:
      return [[S.QE_STEP_WRITE, hasQ], [S.QE_STEP_OPTIONS, two]];
    case T.TRUE_FALSE:
      return manual ? [[S.QE_STEP_WRITE, hasQ]] : [[S.QE_STEP_WRITE, hasQ], [S.QE_STEP_TF, right]];
    case T.MULTIPLE_CORRECT:
      return manual ? [[S.QE_STEP_WRITE, hasQ], [S.QE_STEP_OPTIONS, two]] : [[S.QE_STEP_WRITE, hasQ], [S.QE_STEP_OPTIONS, two], [S.QE_STEP_MARK_MULTI, right]];
    default:
      return manual ? [[S.QE_STEP_WRITE, hasQ], [S.QE_STEP_OPTIONS, two]] : [[S.QE_STEP_WRITE, hasQ], [S.QE_STEP_OPTIONS, two], [S.QE_STEP_MARK, right]];
  }
}

/** Seconds a question adds to "time to take": its limit, or 45s for No limit. */
export const takeSeconds = (forms) => forms.reduce((sum, f) => sum + (f.timeSec > 0 ? f.timeSec : 45), 0);

/** "30s" / "1 min" / "1m 30s" — the reference's short time label. */
export function shortTime(sec) {
  if (!(sec > 0)) return S.QE_NO_TIME_LIMIT;
  if (sec < 60) return t(S.QE_SEC_SHORT, { n: sec });
  return sec % 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : t(S.QE_MIN_SHORT, { n: sec / 60 });
}
