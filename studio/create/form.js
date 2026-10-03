// The builder's editing model ("form") for one question, and conversion to and from the stored
// question shape (core/models.js).
//
// Why a separate model: the database stores correct answers as option TEXT, so editing an
// option's text while it is marked correct would silently un-mark it. Like the app's
// OptionItem(text, isCorrect), the form keeps a flag per option row and only turns it back
// into text at save time. Fill-in-the-blank sentences are edited as plain text with each
// answer in square brackets — "The capital of Pakistan is [Islamabad]." — and converted to the
// stored [[blankId]] template + blanks array on save, keeping blank ids stable by position.

import {
  FILL_BLANK_CHECKING,
  QUESTION_TYPES,
  defaultAnswerRule,
  defaultPollSettings,
  newBlank,
  newId,
  newQuestion,
} from "../core/models.js";

const CHOICE = new Set([QUESTION_TYPES.SINGLE_CHOICE, QUESTION_TYPES.MULTIPLE_CORRECT, QUESTION_TYPES.TRUE_FALSE]);
export const HAS_OPTIONS = new Set([...CHOICE, QUESTION_TYPES.POLL]);
export const isChoice = (type) => CHOICE.has(type);

/** Answers in the editable sentence: [answer]. */
const BRACKET = /\[([^[\]]*)\]/g;
const MARKER = /\[\[([^[\]]*)\]\]/g;

let rowSeq = 0;
export const rowKey = () => `r${++rowSeq}`;

export function item(text = "", correct = false) {
  return { key: rowKey(), text, correct };
}

/** Stored question → form. */
export function toForm(q) {
  const form = {
    id: q.id,
    type: q.type,
    text: q.text ?? "",
    timeSec: q.timeSec ?? 30,
    points: q.points ?? 10,
    hint: q.hint ?? "",
    reason: q.reason ?? "",
    rapidBonus: q.rapidBonus ?? null,
    acceptAnyCorrect: q.acceptAnyCorrect === true,
    items: [],
    writtenAnswer: q.writtenAnswer ?? "",
    answerRule: q.answerRule ? { ...defaultAnswerRule(), ...q.answerRule } : defaultAnswerRule(),
    pollSettings: q.pollSettings ? { ...defaultPollSettings(), ...q.pollSettings } : defaultPollSettings(),
    fb: { sentence: "", title: "", ids: [], alts: [], points: [], checking: FILL_BLANK_CHECKING.FLEXIBLE, extra: {} },
  };

  if (HAS_OPTIONS.has(q.type)) {
    const correct = new Set(q.correct ?? []);
    form.items = (q.options ?? []).map((text) => item(text, isChoice(q.type) && correct.has(text)));
  }

  if (q.type === QUESTION_TYPES.FILL_BLANK && q.fillBlank) {
    const { template = "", blanks = [], checking, title, ...extra } = q.fillBlank;
    const byId = new Map(blanks.map((b) => [b.id, b]));
    const ids = [];
    const alts = [];
    const points = [];
    const sentence = template.replace(MARKER, (_, id) => {
      const blank = byId.get(id);
      ids.push(id);
      alts.push((blank?.acceptedAnswers ?? []).slice(1));
      points.push(blank?.points ?? null);
      return `[${blank?.acceptedAnswers?.[0] ?? ""}]`;
    });
    form.fb = {
      sentence,
      // An app-made question carries its heading in fill_blank.title; questions.text is only
      // the sentence's plain rendering, so it is not a heading.
      title: title ?? "",
      ids,
      alts,
      points,
      checking: checking ?? FILL_BLANK_CHECKING.FLEXIBLE,
      extra,
    };
    form.text = "";
  }
  return form;
}

/** Form → stored question shape (before normalizeQuestion trims and strips it). */
export function fromForm(form) {
  const q = {
    id: form.id,
    type: form.type,
    text: form.text,
    options: null,
    correct: null,
    writtenAnswer: null,
    timeSec: form.timeSec,
    points: form.points,
    hint: form.hint,
    reason: form.reason,
    answerRule: null,
    pollSettings: null,
    fillBlank: null,
    acceptAnyCorrect: form.acceptAnyCorrect,
    rapidBonus: form.rapidBonus,
  };
  if (HAS_OPTIONS.has(form.type)) {
    q.options = form.items.map((i) => i.text);
    q.correct = isChoice(form.type) ? form.items.filter((i) => i.correct).map((i) => i.text) : null;
  }
  if (form.type === QUESTION_TYPES.WRITTEN) {
    q.writtenAnswer = form.writtenAnswer;
    q.answerRule = form.answerRule;
  }
  if (form.type === QUESTION_TYPES.POLL) q.pollSettings = form.pollSettings;
  if (form.type === QUESTION_TYPES.FILL_BLANK) {
    const parsed = parseSentence(form.fb);
    q.fillBlank = {
      ...form.fb.extra,
      template: parsed.template,
      blanks: parsed.blanks,
      checking: form.fb.checking,
      title: form.fb.title,
    };
    q.text = "";
  }
  return q;
}

/** The sentence's bracketed answers, in order. */
export function sentenceBlanks(sentence) {
  BRACKET.lastIndex = 0;
  const out = [];
  let match;
  while ((match = BRACKET.exec(sentence ?? "")) !== null) out.push(match[1]);
  return out;
}

/** [answer] → [[id]] template plus blanks; the k-th blank keeps the k-th id it had. */
export function parseSentence(fb) {
  const blanks = [];
  let k = 0;
  const template = String(fb.sentence ?? "").replace(BRACKET, (_, answer) => {
    const id = fb.ids[k] ?? newBlank().id;
    fb.ids[k] = id;
    blanks.push({
      id,
      acceptedAnswers: [answer, ...(fb.alts[k] ?? [])],
      points: fb.points[k] ?? null,
    });
    k++;
    return `[[${id}]]`;
  });
  return { template, blanks };
}

/** The sentence as a taker would see it, blanks shown as rules — for the outline. */
export function sentencePreview(sentence) {
  return String(sentence ?? "").replace(BRACKET, "_____");
}

/** A fresh form of [type]. */
export function newForm(type, { timeSec = 30 } = {}) {
  const form = toForm(newQuestion(type, { timeSec }));
  // Same starting rows as the app (QuestionFormLogic.kt defaultOptions / defaultMultipleOptions
  // / defaultPollOptions): two slots, the first pre-marked correct for Single, both for Multiple.
  if (type === QUESTION_TYPES.SINGLE_CHOICE) form.items = [item("", true), item()];
  if (type === QUESTION_TYPES.MULTIPLE_CORRECT) form.items = [item("", true), item("", true)];
  if (type === QUESTION_TYPES.POLL) form.items = [item(), item()];
  return form;
}

/** A copy with fresh ids (question and blanks). */
export function cloneForm(form) {
  const copy = structuredClone(form);
  copy.id = newId();
  copy.items = copy.items.map((i) => ({ ...i, key: rowKey() }));
  copy.fb.ids = [];
  return copy;
}

/**
 * Switches a form to [type], carrying over what still makes sense — a port of optionsForType
 * (QuestionFormLogic.kt). Returns { form, losesContent } so the caller can warn first.
 */
export function convertType(form, type) {
  const next = structuredClone(form);
  const fromType = form.type;
  next.type = type;
  const hadOptionText = form.items.some((i) => i.text.trim());
  let losesContent = false;

  if (type === QUESTION_TYPES.WRITTEN || type === QUESTION_TYPES.FILL_BLANK) {
    losesContent = HAS_OPTIONS.has(fromType) && hadOptionText;
    next.items = [];
  } else if (type === QUESTION_TYPES.TRUE_FALSE) {
    if (fromType !== QUESTION_TYPES.TRUE_FALSE) {
      losesContent = HAS_OPTIONS.has(fromType) && hadOptionText;
      next.items = [item("True", true), item("False", false)];
    }
  } else if (type === QUESTION_TYPES.SINGLE_CHOICE) {
    next.items = form.items.length && fromType !== QUESTION_TYPES.TRUE_FALSE ? form.items.map((i) => ({ ...i })) : [item(), item()];
    const first = next.items.findIndex((i) => i.correct);
    next.items.forEach((i, idx) => (i.correct = idx === (first >= 0 ? first : -1)));
  } else if (type === QUESTION_TYPES.MULTIPLE_CORRECT) {
    next.items = form.items.length && fromType !== QUESTION_TYPES.TRUE_FALSE ? form.items.map((i) => ({ ...i })) : [item(), item()];
  } else if (type === QUESTION_TYPES.POLL) {
    next.items = (form.items.length >= 2 && fromType !== QUESTION_TYPES.TRUE_FALSE ? form.items : [item(), item()]).map((i) => ({
      ...i,
      correct: false,
    }));
  }

  if (fromType === QUESTION_TYPES.WRITTEN && type !== QUESTION_TYPES.WRITTEN && form.writtenAnswer.trim()) losesContent = true;
  if (fromType === QUESTION_TYPES.FILL_BLANK && type !== QUESTION_TYPES.FILL_BLANK && form.fb.sentence.trim()) losesContent = true;

  // The heading of a fill-blank question and the text of any other type are the same field
  // in the app's builder (questionText), so it moves across.
  if (type === QUESTION_TYPES.FILL_BLANK && fromType !== QUESTION_TYPES.FILL_BLANK) {
    next.fb.title = form.text;
    next.text = "";
  } else if (fromType === QUESTION_TYPES.FILL_BLANK && type !== QUESTION_TYPES.FILL_BLANK) {
    next.text = form.fb.title || sentencePreview(form.fb.sentence);
  }

  if (type === QUESTION_TYPES.POLL) next.points = 0;
  else if (fromType === QUESTION_TYPES.POLL && !next.points) next.points = 10;
  if (type !== QUESTION_TYPES.MULTIPLE_CORRECT) next.acceptAnyCorrect = false;
  return { form: next, losesContent };
}
