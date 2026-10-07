// /import/ — bring questions in from a .txt / .csv file. A port of the app's Import screen
// (ui/questionimport/ImportQuestionsViewModel.kt + ImportQuestionsScreen.kt):
//   /import/            → a new draft quiz is created from the file (title asked for)
//   /import/?quiz=<id>  → the questions are added to the end of that quiz
//   /import/?target=bank → the questions are saved to the Question Bank (the app's toBank mode:
//                         no title, no quiz, the bank's own cap)
// Step 1 chooses the file (or pasted text) and offers the cheat sheet + starter template;
// step 2 previews, reorders, edits and removes before anything is written.

import { DEFAULT_POINTS, QUESTION_TYPES, newQuiz, themeColor } from "../core/models.js";
import { route } from "../core/paths.js";
import { MAX_FILE_BYTES, SAMPLE_FORMATS, SAMPLE_QUESTION_TYPES, buildSample, detectType, issueOf, parse, parseTxt, sampleFileName, toQuestion } from "../core/question-file.js";
import { QuizLockedError, generateUniqueShareCode, isLockedForEditing, listMyQuizzes, loadQuestions, loadQuiz, saveQuiz } from "../core/quizzes.js";
import { S, t } from "../core/strings.js";
import { requireUser } from "../core/auth.js";
import { dedupeForBank, listMyBank, saveAllToBank } from "../core/bank.js";
import { fetchLimits } from "../core/limits.js";
import { normalizeQuestion } from "../core/validate.js";
import { button, confirmDialog, copyText, el, emptyState, errorBlock, loadingBlock, openDialog, renderSignInGate, renderSpinner, swap, toast } from "../ui/components.js";
import { mountShell } from "../ui/shell.js";
import { importResult } from "../bank/bank-dialogs.js";
import * as V from "./import-views.js";
import { track } from "../core/analytics.js";

const { TRUE_FALSE } = QUESTION_TYPES;
const root = document.getElementById("root");
const params = new URLSearchParams(window.location.search);
const quizId = params.get("quiz");
const toBank = !quizId && params.get("target") === "bank";

const state = {
  user: null,
  limits: null,
  /** The quiz being imported into (null = a new one is created). */
  quiz: null,
  isNew: !quizId && !toBank,
  step: "choose", // "choose" | "review"
  title: "",
  titleError: false,
  titleEditing: false,
  fileName: null,
  /** { questions, skipped } once a file or text has been read. */
  parsed: null,
  reading: false,
  readError: false,
  tooLarge: false,
  dragging: false,
  sampleTypes: [...SAMPLE_QUESTION_TYPES],
  sampleFormat: SAMPLE_FORMATS.TXT,
  /** The question card being edited inline: { sourceLine, type, text, options, error }. */
  draft: null,
  importing: false,
};

let shell = null;

/** A hand-marked quiz that never shows results doesn't need correct answers (the app's rule). */
const allowNoCorrect = () => !!state.quiz && state.quiz.manualMarkingDefault && !state.quiz.showResult;
const parserLimits = () => ({ maxQuestionChars: state.limits.maxQuestionTextChars, maxOptionChars: state.limits.maxOptionTextChars, maxOptions: state.limits.maxOptions });
const backHref = () => (toBank ? route("bank/") : state.quiz ? route(`create/?id=${encodeURIComponent(state.quiz.id)}`) : route(""));

// ── Start ───────────────────────────────────────────────────────────────────

async function start() {
  renderSpinner(root);
  state.user = await requireUser();
  if (!state.user) {
    renderSignInGate(root);
    return;
  }
  shell = mountShell(root, {
    user: state.user,
    active: toBank ? "bank" : state.isNew ? "import" : "dashboard",
    title: toBank ? S.IMP_BANK_TITLE : S.IMP_TITLE,
    crumbs: toBank
      ? [{ label: S.BANK_TITLE, href: route("bank/") }, { label: S.IMP_BANK_TITLE }]
      : [{ label: S.NAV_DASHBOARD, href: route("") }, { label: S.IMP_TITLE }],
    // No shell back arrow: step 1 has Cancel and step 2 Back (to step 1), like the app.
    width: "import",
  });
  shell.content.replaceChildren(loadingBlock());
  try {
    state.limits = await fetchLimits();
    if (quizId) {
      const quiz = await loadQuiz(quizId);
      if (!quiz || quiz.ownerId !== state.user.id) {
        shell.content.replaceChildren(
          el("div", { class: "card" }, [
            emptyState({ art: "quizzes", title: S.ERR_NOT_FOUND, body: S.ERR_NOT_FOUND_BODY, actions: [button({ label: S.BACK_TO_QUIZZES, icon: "arrow-left", href: route("") })] }),
          ])
        );
        return;
      }
      state.quiz = quiz;
      state.title = quiz.title ?? "";
      shell.setCrumbs([{ label: S.NAV_DASHBOARD, href: route("") }, { label: quiz.title?.trim() || S.UNTITLED_QUIZ, href: backHref() }, { label: S.IMP_TITLE }]);
    }
    render();
  } catch (error) {
    console.error(error);
    shell.content.replaceChildren(errorBlock(S.ERR_LOAD_FAILED, start));
  }
}

// ── Render ──────────────────────────────────────────────────────────────────

function render() {
  const review = state.step === "review";
  const ready = state.parsed?.questions.length ?? 0;
  shell.setTitle(review ? S.IMP_REVIEW_TITLE : toBank ? S.IMP_BANK_TITLE : S.IMP_TITLE);
  shell.setActions([
    review
      ? button({ label: S.BACK, icon: "arrow-left", variant: "ghost", onClick: backToChoose })
      : button({ label: S.IMP_CANCEL, variant: "ghost", href: backHref() }),
  ]);

  const accent = themeColor(state.quiz?.themeColorName ?? newQuiz().themeColorName);
  const body = review ? reviewView() : chooseView();
  const bar = V.bottomBar({
    label: review ? (ready === 1 ? S.IMP_IMPORT_ONE : t(S.IMP_IMPORT_MANY, { n: ready })) : S.IMP_CONTINUE,
    disabled: !ready || state.reading || state.importing || !!state.draft,
    busy: state.importing,
    onClick: review ? doImport : toReview,
  });
  swap(shell.content, el("div", { class: `imp ${review ? "imp-review" : "imp-choose"}`, vars: { "imp-accent": accent } }, [...body, bar]));
}

function chooseView() {
  return [
    el("p", { class: "imp-step", text: S.IMP_STEP_1 }),
    el("div", { class: "imp-grid" }, [
      el("div", { class: "imp-col" }, [state.isNew ? V.draftsBanner() : null, state.isNew ? V.titleCard(state, handlers) : null, V.uploadCard(state, handlers)]),
      el("div", { class: "imp-col" }, [V.cheatSheetCard(state, handlers), V.templateCard(state, handlers)]),
    ]),
  ];
}

function reviewView() {
  const parsed = state.parsed;
  const list = parsed.questions;
  return [
    el("p", { class: "imp-step", text: S.IMP_REVIEW_STEP }),
    el("p", { class: "imp-intro", text: toBank ? S.IMP_REVIEW_INTRO_BANK : state.isNew ? S.IMP_REVIEW_INTRO_NEW : S.IMP_REVIEW_INTRO_EXISTING }),
    state.isNew ? V.reviewTitleCard(state, handlers) : null,
    V.fileRow(state, handlers),
    V.summaryRow(parsed),
    parsed.skipped.length ? V.skippedCard(parsed.skipped) : null,
    ...list.map((q, i) => (state.draft?.sourceLine === q.sourceLine ? V.editableCard(state.draft, handlers) : V.questionCard(q, i, list.length, handlers))),
  ];
}

// ── Handlers ────────────────────────────────────────────────────────────────

const handlers = {
  onTitle(value) {
    state.title = value.slice(0, state.limits.maxQuizTitleChars);
    state.titleError = false;
  },
  onTitleEditing(on) {
    if (!on && !state.title.trim()) {
      state.titleError = true;
    } else {
      state.titleError = false;
      state.titleEditing = on;
    }
    render();
    if (state.titleEditing || state.titleError) shell.content.querySelector('[data-fk="imp-review-title"]')?.focus();
  },
  onFile: readFile,
  onDrag(on) {
    state.dragging = on;
    render();
  },
  onClearFile: clearFile,
  onPaste: openPaste,
  onFormat(format) {
    state.sampleFormat = format;
    render();
  },
  onSampleType(type) {
    const on = state.sampleTypes.includes(type);
    // Never drop to zero — an empty sample file would be useless.
    if (on && state.sampleTypes.length === 1) return;
    state.sampleTypes = on ? state.sampleTypes.filter((x) => x !== type) : SAMPLE_QUESTION_TYPES.filter((x) => x === type || state.sampleTypes.includes(x));
    render();
  },
  onCopySample: (text) => copyText(text, S.IMP_SAMPLE_COPIED),
  onDownloadSample: downloadSample,
  onRemoveFile() {
    clearFile();
    backToChoose();
  },
  onMove(sourceLine, by) {
    const list = state.parsed.questions;
    const from = list.findIndex((q) => q.sourceLine === sourceLine);
    const to = from + by;
    if (from < 0 || to < 0 || to >= list.length) return;
    list.splice(to, 0, list.splice(from, 1)[0]);
    render();
  },
  async onDelete(sourceLine) {
    const ok = await confirmDialog({ title: S.IMP_DELETE_TITLE, body: S.IMP_DELETE_BODY, confirmLabel: S.IMP_DELETE_CONFIRM, cancelLabel: S.IMP_DELETE_KEEP, badge: S.IMP_DELETE_BADGE });
    if (!ok) return;
    state.parsed.questions = state.parsed.questions.filter((q) => q.sourceLine !== sourceLine);
    if (state.draft?.sourceLine === sourceLine) state.draft = null;
    if (!state.parsed.questions.length) backToChoose();
    else render();
  },
  onEdit(sourceLine) {
    const q = state.parsed.questions.find((x) => x.sourceLine === sourceLine);
    if (!q) return;
    state.draft = { sourceLine, type: q.type, text: q.text, options: q.options.map((o) => ({ ...o })), error: null };
    render();
    shell.content.querySelector('[data-fk="imp-edit-text"]')?.focus();
  },
  onDraftText(value) {
    state.draft.text = value;
    state.draft.error = null;
  },
  onDraftOption(key, value) {
    // True/False labels are fixed — the type depends on them.
    if (state.draft.type === TRUE_FALSE) return;
    state.draft.options = state.draft.options.map((o) => (o.key === key ? { ...o, text: value } : o));
    state.draft.error = null;
  },
  onDraftToggle(key) {
    const draft = state.draft;
    if (draft.type === TRUE_FALSE) {
      // True/False stays a radio.
      draft.options = draft.options.map((o) => ({ ...o, correct: o.key === key }));
    } else {
      // Checkbox semantics, so ticking a second option makes Single into Multiple (and back).
      draft.options = draft.options.map((o) => (o.key === key ? { ...o, correct: !o.correct } : o));
      draft.type = detectType(draft.options);
    }
    draft.error = null;
    render();
  },
  onEditCancel() {
    state.draft = null;
    render();
  },
  onEditSave() {
    const draft = state.draft;
    const type = draft.type === TRUE_FALSE ? TRUE_FALSE : detectType(draft.options);
    const issue = issueOf(type, draft.text, draft.options, allowNoCorrect());
    if (issue) {
      draft.error = issue;
      render();
      return;
    }
    state.parsed.questions = state.parsed.questions.map((q) =>
      q.sourceLine === draft.sourceLine ? { ...q, type, text: draft.text.trim(), options: draft.options.map((o) => ({ ...o, text: o.text.trim() })) } : q
    );
    state.draft = null;
    render();
  },
};

// ── File, paste, sample ────────────────────────────────────────────────────

async function readFile(file) {
  state.dragging = false;
  state.readError = false;
  state.tooLarge = false;
  if (file.size > MAX_FILE_BYTES) {
    Object.assign(state, { fileName: null, parsed: null, tooLarge: true });
    render();
    return;
  }
  state.reading = true;
  render();
  try {
    const text = await file.text();
    state.parsed = parse(file.name, text, { allowNoCorrect: allowNoCorrect(), limits: parserLimits() });
    state.fileName = file.name;
  } catch (error) {
    console.error(error);
    Object.assign(state, { fileName: null, parsed: null, readError: true });
  }
  state.reading = false;
  render();
}

function clearFile() {
  Object.assign(state, { fileName: null, parsed: null, readError: false, tooLarge: false, draft: null });
  render();
}

/** "Paste text directly" — same .txt rules as a file. */
function openPaste() {
  const area = el("textarea", { class: "input imp-paste", rows: "10", placeholder: S.IMP_FORMAT_TXT_EXAMPLE, "aria-label": S.IMP_PASTE_TITLE });
  const use = button({
    label: S.IMP_PASTE_CONFIRM,
    variant: "primary",
    onClick: () => {
      const text = area.value;
      if (!text.trim()) return;
      dlg.close("confirm");
      state.parsed = parseTxt(text.replace(/^﻿/, ""), { allowNoCorrect: allowNoCorrect(), limits: parserLimits() });
      Object.assign(state, { fileName: S.IMP_PASTED_NAME, readError: false, tooLarge: false });
      render();
    },
  });
  const dlg = openDialog({
    title: S.IMP_PASTE_TITLE,
    wide: true,
    content: [el("p", { class: "dialog-body", text: S.IMP_PASTE_HINT }), area],
    actions: [button({ label: S.CANCEL, variant: "secondary", onClick: () => dlg.close("cancel") }), use],
    initialFocus: () => area,
  });
}

/** The starter template, written exactly like the app's SampleFileBuilder. */
function downloadSample() {
  const format = state.sampleFormat;
  const blob = new Blob([buildSample(state.sampleTypes, format)], { type: format === SAMPLE_FORMATS.CSV ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: sampleFileName(format), hidden: true });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(S.IMP_SAMPLE_SAVED, { tone: "success" });
}

// ── Steps ───────────────────────────────────────────────────────────────────

/** Step 1 → 2. The title is checked here so nobody is sent forward only to be bounced back. */
function toReview() {
  if (state.isNew && !state.title.trim()) {
    state.titleError = true;
    render();
    shell.content.querySelector('[data-fk="imp-title"]')?.focus();
    return;
  }
  if (!state.parsed?.questions.length) return;
  state.step = "review";
  render();
  window.scrollTo({ top: 0 });
}

function backToChoose() {
  state.step = "choose";
  state.draft = null;
  state.titleEditing = false;
  render();
}

// ── Import ──────────────────────────────────────────────────────────────────

function limitDialog(badge, title, body) {
  const dlg = openDialog({
    badge,
    title,
    content: [el("p", { class: "dialog-body", text: body })],
    actions: [button({ label: S.IMP_LIMIT_OK, variant: "primary", onClick: () => dlg.close("ok") })],
  });
}

/** Appends every reviewed question to the quiz (creating it first for a new import). Timing
 *  and points are quiz-wide — the file never carries them — like the app's onImportClicked. */
async function doImport() {
  const parsed = state.parsed?.questions ?? [];
  if (!parsed.length || state.importing) return;
  if (state.isNew && !state.title.trim()) {
    state.titleError = true;
    render();
    return;
  }
  state.importing = true;
  render();
  if (toBank) {
    await importToBank(parsed);
    return;
  }
  try {
    let quiz;
    let existing = [];
    if (state.isNew) {
      if (!state.limits.createQuizEnabled) {
        toast(S.CREATE_DISABLED, { tone: "error" });
        return;
      }
      if ((await listMyQuizzes(state.user.id)).length >= state.limits.maxQuizzes) {
        limitDialog(S.IMP_LIMIT_QUIZZES_BADGE, S.IMP_LIMIT_QUIZZES_TITLE, S.IMP_LIMIT_QUIZZES_BODY);
        return;
      }
      quiz = { ...newQuiz(), ownerId: state.user.id, title: state.title.trim() };
      quiz.shareCode = await generateUniqueShareCode(quiz.id);
    } else {
      quiz = (await loadQuiz(state.quiz.id)) ?? state.quiz;
      // People may have joined since this page opened.
      if (await isLockedForEditing(quiz)) {
        toast(S.IMP_QUIZ_LOCKED, { tone: "error" });
        return;
      }
      existing = await loadQuestions(quiz.id);
    }
    if (existing.length + parsed.length > state.limits.maxQuestions) {
      limitDialog(S.IMP_LIMIT_QUESTIONS_BADGE, S.IMP_LIMIT_QUESTIONS_TITLE, t(S.IMP_LIMIT_QUESTIONS_BODY, { n: state.limits.maxQuestions }));
      return;
    }
    const timeSec = quiz.showTimers ? quiz.defaultTimeSec : 0;
    const imported = parsed.map((p, i) => normalizeQuestion({ ...toQuestion(p, { timeSec, orderIndex: existing.length + i }), points: DEFAULT_POINTS }));
    await saveQuiz(quiz, [...existing, ...imported], state.user.id, { checkLock: !state.isNew });
    window.location.href = route(`create/?id=${encodeURIComponent(quiz.id)}&imported=${imported.length}`);
  } catch (error) {
    console.error(error);
    toast(error instanceof QuizLockedError ? S.IMP_QUIZ_LOCKED : S.ERR_SAVE_FAILED, { tone: "error" });
  } finally {
    state.importing = false;
    if (document.visibilityState !== "hidden") render();
  }
}

/** Bank mode (ImportQuestionsViewModel.importToBank): the same parsed questions with the same
 *  defaults a new quiz would give them, saved to the Question Bank — all or nothing against
 *  its cap. Back on /bank/, ?imported=n says how many arrived. */
async function importToBank(parsed) {
  try {
    const timeSec = newQuiz().defaultTimeSec;
    const questions = parsed.map((p) => normalizeQuestion({ ...toQuestion(p, { timeSec, orderIndex: 0 }), points: DEFAULT_POINTS }));
    // Questions already in the bank are left out, as on every bulk save (the app's importToBank too).
    const { toImport, skippedTexts } = dedupeForBank(await listMyBank(state.user.id), questions);
    const result = await saveAllToBank(state.user.id, toImport, state.limits);
    if (result?.saved || result?.ok) track("questions_imported", { count: toImport.length });
    if (result.atCap) {
      limitDialog(S.IMP_LIMIT_BANK_BADGE, S.BANK_FULL_TITLE, t(S.BANK_FULL_IMPORT_BODY, { n: result.atCap }));
      return;
    }
    const toBank = () => (window.location.href = route(`bank/?imported=${result.saved}`));
    // Some were already there: say which first, like "Import from quizzes", then go to the bank.
    if (skippedTexts.length) importResult(result.saved, skippedTexts, toBank);
    else toBank();
  } catch (error) {
    console.error(error);
    toast(S.ERR_SAVE_FAILED, { tone: "error" });
  } finally {
    state.importing = false;
    if (document.visibilityState !== "hidden") render();
  }
}

start();
