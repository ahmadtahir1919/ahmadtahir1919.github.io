// Quiz builder (/create/ new, /create/?id= edit).
//
// Three panes on desktop: outline (left), the selected question (centre), and a side panel with
// Question / Quiz tabs (right). Drafts autosave ~1.5s after the last change; a published quiz
// saves only on Save, so a half-typed edit never goes live. A published quiz that people have
// joined or taken opens read-only (QuizRepository.isLockedForEditing), with Duplicate offered.
//
// Rendering: regions are re-rendered only when their structure changes. Typing updates state
// silently (plus the outline, status and error list), so focus and caret are never lost.

import { DEFAULT_PREVIEW_SEC, newQuiz } from "../core/models.js";
import {
  QuizLockedError,
  duplicateQuiz,
  generateUniqueShareCode,
  isLockedForEditing,
  listMyQuizzes,
  loadQuestions,
  loadQuiz,
  saveQuiz,
} from "../core/quizzes.js";
import { createHistory } from "../core/store.js";
import { S, t } from "../core/strings.js";
import { fetchLimits, requireUser } from "../core/supabase.js";
import { exceedsLimits, normalizeQuestion, validateQuiz } from "../core/validate.js";
import {
  banner,
  button,
  confirmDialog,
  copyText,
  counter,
  el,
  emptyState,
  errorBlock,
  loadingBlock,
  openDialog,
  pill,
  renderSignInGate,
  renderSpinner,
  swap,
  timeAgo,
  toast,
  updateCounter,
} from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { confetti, flip } from "../ui/motion.js";
import { mountShell } from "../ui/shell.js";
import { joinLink, themeColor } from "../core/models.js";
import { editorPane, emptyEditor, fillErrors } from "./editor-pane.js";
import { cloneForm, convertType, fromForm, newForm, toForm } from "./form.js";
import { TYPE_META, renderOutline, typeGrid } from "./outline.js";
import { questionPanel } from "./question-panel.js";
import { settingsPanel } from "./settings-panel.js";
import { QUESTION_TYPE_ORDER } from "../core/models.js";
import { route } from "../core/paths.js";

const AUTOSAVE_MS = 1500;
const root = document.getElementById("root");
const params = new URLSearchParams(window.location.search);

const state = {
  user: null,
  limits: null,
  quiz: null,
  forms: [],
  selectedId: null,
  isNew: true,
  isLocked: false,
  /** null | "quota" | "maintenance" — a new quiz that can't be saved at all. */
  blocked: null,
  version: 0,
  savedVersion: 0,
  saving: false,
  saveQueued: false,
  saveError: null,
  lastSavedAt: null,
  showErrors: params.get("check") === "1",
  panelTab: "question",
  lastPreviewSec: DEFAULT_PREVIEW_SEC,
};

const history = createHistory();
let shell = null;
let autosaveTimer = null;
const regions = {};
let qErrorsNode = null;

const isDirty = () => state.version !== state.savedVersion;
const readOnly = () => state.isLocked;
const selected = () => state.forms.find((f) => f.id === state.selectedId) ?? null;
const persisted = () => state.forms.map(fromForm);

// ── Start ───────────────────────────────────────────────────────────────────

async function start() {
  renderSpinner(root);
  state.user = await requireUser();
  if (!state.user) {
    renderSignInGate(root);
    return;
  }
  const editing = params.get("id");
  shell = mountShell(root, {
    user: state.user,
    active: editing ? "dashboard" : "create",
    title: editing ? S.EDIT_QUIZ_TITLE : S.NEW_QUIZ_TITLE,
    crumbs: [{ label: S.MY_QUIZZES, href: route("") }, { label: editing ? S.EDIT_QUIZ_TITLE : S.NEW_QUIZ_TITLE }],
    backHref: route(""),
    width: "wide",
  });
  shell.content.replaceChildren(loadingBlock());
  await load(editing);
}

async function load(editing) {
  try {
    state.limits = await fetchLimits();
    if (editing) {
      const quiz = await loadQuiz(editing);
      if (!quiz || quiz.ownerId !== state.user.id) {
        shell.content.replaceChildren(
          el("div", { class: "card" }, [
            emptyState({
              art: "quizzes",
              title: S.ERR_NOT_FOUND,
              body: S.ERR_NOT_FOUND_BODY,
              actions: [button({ label: S.BACK_TO_QUIZZES, icon: "arrow-left", href: route("") })],
            }),
          ])
        );
        return;
      }
      const [questions, locked] = await Promise.all([loadQuestions(quiz.id), isLockedForEditing(quiz)]);
      state.quiz = quiz;
      state.forms = questions.map(toForm);
      state.isNew = false;
      state.isLocked = locked;
    } else {
      state.quiz = { ...newQuiz(), ownerId: state.user.id };
      if (!state.limits.createQuizEnabled) state.blocked = "maintenance";
      else if ((await listMyQuizzes(state.user.id)).length >= state.limits.maxQuizzes) state.blocked = "quota";
    }
    if (state.quiz.questionPreviewSec > 0) state.lastPreviewSec = state.quiz.questionPreviewSec;
    state.selectedId = state.forms[0]?.id ?? null;
    buildLayout();
    renderAll();
    if (state.isNew) regions.head.querySelector(".title-input")?.focus();
    else if (state.showErrors) jumpToFirstError();
  } catch (error) {
    console.error(error);
    shell.content.replaceChildren(errorBlock(S.ERR_LOAD_FAILED, () => load(editing)));
  }
}

function buildLayout() {
  regions.head = el("div", { class: "builder-head" });
  regions.banners = el("div", { class: "stack builder-banners" });
  regions.outline = el("aside", { class: "builder-outline", "aria-label": S.QUESTIONS });
  regions.editor = el("section", { class: "builder-editor", "aria-label": S.QUESTION_EDITOR });
  regions.panel = el("aside", { class: "builder-panel card", "aria-label": S.SETTINGS });
  shell.content.classList.add("builder-page");
  shell.content.replaceChildren(
    regions.head,
    regions.banners,
    el("div", { class: "builder" }, [regions.outline, regions.editor, regions.panel])
  );
  shell.content.style.setProperty("--accent", themeColor(state.quiz.themeColorName));
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderAll() {
  renderHead();
  renderBanners();
  renderOutlineRegion();
  renderEditor();
  renderPanel();
  renderActions();
}

function validation() {
  const result = validateQuiz(state.quiz, persisted(), state.limits);
  const { startAt, endAt } = state.quiz;
  if (startAt && endAt && endAt <= startAt) {
    result.quiz.push(S.SCHEDULE_END_BEFORE_START);
    result.ok = false;
  }
  return result;
}

function renderHead() {
  const max = state.limits.maxQuizTitleChars;
  const count = counter((state.quiz.title ?? "").length, max);
  const title = el("input", {
    class: "title-input",
    type: "text",
    dir: "auto",
    value: state.quiz.title ?? "",
    placeholder: S.QUIZ_TITLE_PLACEHOLDER,
    "aria-label": S.QUIZ_TITLE_LABEL,
    disabled: readOnly(),
    "data-fk": "quiz-title",
  });
  title.addEventListener("input", () => {
    updateCounter(count, title.value.length, max);
    changeQuiz("title", (q) => (q.title = title.value));
  });
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (state.forms.length) document.querySelector('[data-fk="question-text"], [data-fk="fb-title"]')?.focus();
    }
  });

  const status = state.isLocked
    ? pill(S.STATUS_READ_ONLY, "archived", { iconName: "lock" })
    : state.quiz.isDraft
      ? pill(S.STATUS_DRAFT, "draft", { dot: true })
      : pill(S.STATUS_PUBLISHED, "live", { dot: true });

  swap(
    regions.head,
    el("div", { class: "builder-title-row" }, [
      el("span", { class: "builder-accent" }),
      el("div", { class: "grow stack-sm" }, [title, el("div", { class: "row row-wrap builder-meta" }, [status, count])]),
    ])
  );
}

function renderBanners() {
  const items = [];
  if (state.isLocked) {
    items.push(
      banner(S.LOCKED_BODY, {
        tone: "warn",
        title: S.LOCKED_TITLE,
        iconName: "lock",
        actions: [
          button({ label: S.VIEW_RESULTS, icon: "chart", variant: "secondary", size: "sm", href: route(`results/?id=${encodeURIComponent(state.quiz.id)}`) }),
          button({ label: S.DUPLICATE, icon: "copy", variant: "primary", size: "sm", onClick: duplicateLocked }),
        ],
      })
    );
  }
  if (state.blocked === "maintenance") items.push(banner(S.CREATE_DISABLED, { tone: "warn" }));
  if (state.blocked === "quota") {
    items.push(
      banner(t(S.LIMIT_REACHED_QUIZZES, { n: state.limits.maxQuizzes }), {
        tone: "error",
        actions: [button({ label: S.BACK_TO_QUIZZES, size: "sm", href: route("") })],
      })
    );
  }
  if (state.showErrors && !readOnly()) {
    const v = validation();
    if (v.quiz.length) items.push(banner(null, { tone: "error", title: S.ERR_SUMMARY_TITLE, actions: [] }));
    if (v.quiz.length) items[items.length - 1].querySelector(".grow").appendChild(el("ul", { class: "error-list" }, v.quiz.map((m) => el("li", { text: m }))));
    const bad = state.forms.filter((f) => v.questions.has(f.id)).length;
    if (bad) {
      items.push(
        banner(t(bad === 1 ? S.QUESTIONS_NEED_ATTENTION_ONE : S.QUESTIONS_NEED_ATTENTION, { n: bad }), {
          tone: "error",
          actions: [button({ label: S.SHOW_ME, size: "sm", variant: "secondary", onClick: jumpToFirstError })],
        })
      );
    }
  }
  regions.banners.replaceChildren(...items);
}

function renderOutlineRegion() {
  const v = state.showErrors ? validation() : null;
  swap(
    regions.outline,
    renderOutline({
      forms: state.forms,
      selectedId: state.selectedId,
      errors: v?.questions ?? null,
      readOnly: readOnly(),
      maxQuestions: state.limits.maxQuestions,
      onSelect: select,
      onMove: (from, to) => moveQuestion(from, to),
      onAdd: addQuestion,
    })
  );
}

function formCtx(id) {
  return {
    get: () => state.forms.find((f) => f.id === id),
    update: (key, change, opts) => changeForm(id, key, change, opts),
    limits: state.limits,
    quiz: state.quiz,
  };
}

function renderEditor() {
  const form = selected();
  if (!form) {
    qErrorsNode = null;
    swap(regions.editor, readOnly() ? emptyEditor(el("p", { class: "muted", text: S.NO_QUESTIONS_LOCKED })) : emptyEditor(typeGrid(addQuestion)));
    return;
  }
  const index = state.forms.indexOf(form);
  const v = state.showErrors ? validation() : null;
  const { node, errorsNode } = editorPane({
    ctx: formCtx(form.id),
    index,
    total: state.forms.length,
    readOnly: readOnly(),
    errors: v?.questions.get(form.id) ?? [],
    canAdd: state.forms.length < state.limits.maxQuestions,
    onChangeType: (type) => changeType(form.id, type),
    onDuplicate: () => duplicateQuestion(form.id),
    onMove: (delta) => moveQuestion(index, index + delta),
    onDelete: () => deleteQuestion(form.id),
  });
  qErrorsNode = errorsNode;
  swap(regions.editor, node);
}

function renderPanel() {
  const tabs = el("div", { class: "tabs panel-tabs", role: "tablist" }, [
    ["question", S.TAB_QUESTION],
    ["quiz", S.TAB_QUIZ],
  ].map(([key, label]) =>
    el("button", {
      type: "button",
      role: "tab",
      class: `tab ${state.panelTab === key ? "is-active" : ""}`,
      "aria-selected": state.panelTab === key ? "true" : "false",
      text: label,
      onclick: () => {
        state.panelTab = key;
        renderPanel();
      },
    })
  ));

  let body;
  if (state.panelTab === "question") {
    const form = selected();
    body = form ? questionPanel(formCtx(form.id)) : el("p", { class: "muted small", text: S.SELECT_A_QUESTION });
  } else {
    body = settingsPanel({
      quiz: () => state.quiz,
      questions: persisted,
      setQuiz: changeQuiz,
      limits: state.limits,
      lastPreviewSec: () => state.lastPreviewSec,
      resetShareCode,
    });
  }
  swap(regions.panel, tabs, el("fieldset", { class: "panel-body", disabled: readOnly() }, [body]));
}

function renderActions() {
  const nodes = [];
  if (!readOnly() && !state.blocked) nodes.push(saveStatus());
  nodes.push(
    button({ label: S.UNDO, icon: "undo", variant: "ghost", iconOnly: true, cls: "hide-phone", disabled: readOnly() || !history.canUndo, title: `${S.UNDO} (Ctrl+Z)`, onClick: undo }),
    button({ label: S.REDO, icon: "redo", variant: "ghost", iconOnly: true, cls: "hide-phone", disabled: readOnly() || !history.canRedo, title: `${S.REDO} (Ctrl+Shift+Z)`, onClick: redo }),
    button({ label: S.SHORTCUTS, icon: "keyboard", variant: "ghost", iconOnly: true, cls: "hide-phone", onClick: showShortcuts })
  );
  if (!state.isNew && !state.quiz.isDraft) {
    nodes.push(button({ label: S.VIEW_RESULTS, icon: "chart", variant: "secondary", cls: "hide-phone", href: route(`results/?id=${encodeURIComponent(state.quiz.id)}`) }));
  }
  if (state.isLocked) {
    nodes.push(button({ label: S.DUPLICATE, icon: "copy", variant: "primary", onClick: duplicateLocked }));
  } else if (!state.blocked) {
    if (state.quiz.isDraft) {
      nodes.push(button({ label: S.PUBLISH, icon: "send", variant: "primary", onClick: publish }));
    } else {
      nodes.push(button({ label: S.SAVE_CHANGES, icon: "save", variant: "primary", disabled: !isDirty() || state.saving, kbd: "Ctrl S", cls: "save-btn", onClick: () => save("manual") }));
    }
  }
  shell.setActions(nodes);
}

function saveStatus() {
  let content;
  if (state.saving) content = [el("span", { class: "dot-spinner" }), S.SAVING];
  else if (state.saveError) {
    return el("span", { class: "save-status is-error", role: "status" }, [
      icon("alert", "icon icon-sm"),
      el("span", { class: "hide-phone", text: state.saveError }),
      el("button", { type: "button", class: "link-btn", text: S.RETRY, onclick: () => save("manual") }),
    ]);
  } else if (isDirty()) content = [el("span", { class: "dot is-warn" }), state.quiz.isDraft ? S.UNSAVED_DRAFT : S.UNSAVED_CHANGES];
  else if (state.lastSavedAt) content = [icon("check", "icon icon-sm"), t(S.SAVED_AGO, { when: timeAgo(state.lastSavedAt) })];
  else if (!state.isNew) content = [icon("check", "icon icon-sm"), S.ALL_SAVED];
  else return null;
  return el("span", { class: `save-status ${isDirty() ? "is-dirty" : ""}`, role: "status", "aria-live": "polite" }, content);
}

/** Cheap refresh after any change: outline labels, status, error list. */
function refreshLight() {
  renderOutlineRegion();
  renderActions();
  if (state.showErrors) {
    renderBanners();
    const form = selected();
    if (qErrorsNode && form) fillErrors(qErrorsNode, validation().questions.get(form.id) ?? []);
  }
}

// ── Changes ─────────────────────────────────────────────────────────────────

const snapshot = () => ({ quiz: state.quiz, forms: state.forms, selectedId: state.selectedId });

function touched(structural) {
  state.version++;
  state.saveError = null;
  if (state.quiz.questionPreviewSec > 0) state.lastPreviewSec = state.quiz.questionPreviewSec;
  if (structural) {
    renderEditor();
    renderPanel();
  }
  refreshLight();
  scheduleAutosave();
}

function changeQuiz(key, change, { structural = false } = {}) {
  if (readOnly()) return;
  history.checkpoint(`quiz-${key}`, snapshot());
  change(state.quiz);
  if (key === "theme") shell.content.style.setProperty("--accent", themeColor(state.quiz.themeColorName));
  touched(structural);
}

function changeForm(id, key, change, { structural = false } = {}) {
  if (readOnly()) return;
  const form = state.forms.find((f) => f.id === id);
  if (!form) return;
  history.checkpoint(`${id}-${key}`, snapshot());
  change(form);
  touched(structural);
}

function changeForms(key, change) {
  if (readOnly()) return;
  history.checkpoint(key, snapshot());
  history.breakChain();
  change();
  touched(true);
}

function select(id) {
  if (state.selectedId === id) return;
  state.selectedId = id;
  history.breakChain();
  renderOutlineRegion();
  renderEditor();
  if (state.panelTab === "question") renderPanel();
  regions.editor.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
}

function addQuestion(type) {
  if (readOnly() || state.blocked) return;
  if (state.forms.length >= state.limits.maxQuestions) {
    toast(t(S.QUESTION_LIMIT_REACHED, { n: state.limits.maxQuestions }), { tone: "error" });
    return;
  }
  const form = newForm(type, { timeSec: state.quiz.defaultTimeSec ?? 30 });
  changeForms(`add-${form.id}`, () => {
    const at = state.forms.findIndex((f) => f.id === state.selectedId);
    state.forms.splice(at >= 0 ? at + 1 : state.forms.length, 0, form);
    state.selectedId = form.id;
  });
  focusFirstField();
}

function duplicateQuestion(id) {
  if (state.forms.length >= state.limits.maxQuestions) {
    toast(t(S.QUESTION_LIMIT_REACHED, { n: state.limits.maxQuestions }), { tone: "error" });
    return;
  }
  const at = state.forms.findIndex((f) => f.id === id);
  if (at < 0) return;
  const copy = cloneForm(state.forms[at]);
  changeForms(`dup-${id}`, () => {
    state.forms.splice(at + 1, 0, copy);
    state.selectedId = copy.id;
  });
  toast(S.QUESTION_DUPLICATED, { tone: "success" });
}

function deleteQuestion(id) {
  const at = state.forms.findIndex((f) => f.id === id);
  if (at < 0) return;
  changeForms(`del-${id}`, () => {
    state.forms.splice(at, 1);
    state.selectedId = state.forms[Math.min(at, state.forms.length - 1)]?.id ?? null;
  });
  toast(S.QUESTION_DELETED, { action: { label: S.UNDO, onClick: undo } });
}

function moveQuestion(from, to) {
  if (to < 0 || to >= state.forms.length || from === to) return;
  const list = regions.outline.querySelector(".outline-list");
  flip(list?.parentElement ?? regions.outline, () =>
    changeForms(`move-${state.forms[from].id}`, () => {
      const [form] = state.forms.splice(from, 1);
      state.forms.splice(to, 0, form);
    })
  );
}

async function changeType(id, type) {
  const form = state.forms.find((f) => f.id === id);
  if (!form || form.type === type) return;
  const { form: next, losesContent } = convertType(form, type);
  if (losesContent) {
    const ok = await confirmDialog({
      title: S.CHANGE_TYPE_TITLE,
      body: t(S.CHANGE_TYPE_BODY, { type: TYPE_META[type].label() }),
      confirmLabel: S.CHANGE_TYPE_CONFIRM,
      danger: false,
    });
    if (!ok) {
      renderEditor();
      return;
    }
  }
  changeForms(`type-${id}`, () => {
    const at = state.forms.findIndex((f) => f.id === id);
    state.forms[at] = next;
  });
}

async function resetShareCode() {
  try {
    const code = await generateUniqueShareCode(state.quiz.id);
    changeQuiz("share-code", (q) => (q.shareCode = code), { structural: true });
    toast(S.CODE_RESET, { tone: "success" });
  } catch (error) {
    console.error(error);
    toast(S.ERR_GENERIC, { tone: "error" });
  }
}

function undo() {
  if (readOnly()) return;
  const snap = history.undo(snapshot());
  if (snap) restore(snap);
}

function redo() {
  if (readOnly()) return;
  const snap = history.redo(snapshot());
  if (snap) restore(snap);
}

function restore(snap) {
  state.quiz = snap.quiz;
  state.forms = snap.forms;
  state.selectedId = state.forms.some((f) => f.id === snap.selectedId) ? snap.selectedId : state.forms[0]?.id ?? null;
  state.version++;
  shell.content.style.setProperty("--accent", themeColor(state.quiz.themeColorName));
  renderAll();
  scheduleAutosave();
}

function focusFirstField() {
  requestAnimationFrame(() => regions.editor.querySelector('[data-fk="question-text"], [data-fk="fb-title"]')?.focus());
}

function jumpToFirstError() {
  const v = validation();
  const first = state.forms.find((f) => v.questions.has(f.id));
  if (first) {
    select(first.id);
    renderEditor();
  } else if (v.quiz.length) {
    regions.head.querySelector(".title-input")?.focus();
  }
}

// ── Saving ──────────────────────────────────────────────────────────────────

function scheduleAutosave(delay = AUTOSAVE_MS) {
  clearTimeout(autosaveTimer);
  if (readOnly() || state.blocked || !state.quiz.isDraft || !isDirty()) return;
  autosaveTimer = setTimeout(() => save("auto"), delay);
}

/** reason: "auto" (draft autosave), "manual" (Save / Ctrl+S), "publish". */
async function save(reason) {
  clearTimeout(autosaveTimer);
  if (readOnly() || state.blocked) return false;
  if (state.saving) {
    state.saveQueued = true;
    return false;
  }
  const publishing = reason === "publish";
  const questions = persisted();

  if (publishing || !state.quiz.isDraft) {
    if (!validation().ok) {
      state.showErrors = true;
      renderAll();
      jumpToFirstError();
      toast(publishing ? S.FIX_BEFORE_PUBLISH : S.FIX_BEFORE_SAVE, { tone: "error" });
      return false;
    }
  } else if (exceedsLimits(state.quiz, questions, state.limits)) {
    state.saveError = S.ERR_TOO_LONG_TO_SAVE;
    renderActions();
    return false;
  }
  // Nothing typed yet — don't create an empty quiz row just because the page opened.
  if (state.isNew && reason === "auto" && !state.quiz.title.trim() && !state.forms.length) return false;

  state.saving = true;
  renderActions();
  const version = state.version;
  try {
    if (!state.quiz.shareCode) state.quiz.shareCode = await generateUniqueShareCode(state.quiz.id);
    const quiz = { ...state.quiz, isDraft: publishing ? false : state.quiz.isDraft };
    await saveQuiz(quiz, questions.map(normalizeQuestion), state.user.id, { checkLock: !state.isNew });
    state.quiz.isDraft = quiz.isDraft;
    if (state.isNew) {
      state.isNew = false;
      window.history.replaceState(null, "", route(`create/?id=${encodeURIComponent(state.quiz.id)}`));
      shell.setTitle(S.EDIT_QUIZ_TITLE);
      shell.setCrumbs([{ label: S.MY_QUIZZES, href: route("") }, { label: S.EDIT_QUIZ_TITLE }]);
    }
    state.savedVersion = version;
    state.lastSavedAt = Date.now();
    state.saveError = null;
    if (reason === "manual" && !state.quiz.isDraft) toast(S.CHANGES_SAVED, { tone: "success" });
    return true;
  } catch (error) {
    console.error(error);
    if (error instanceof QuizLockedError) {
      state.isLocked = true;
      renderAll();
      toast(S.QUIZ_NOW_LOCKED, { tone: "error" });
    } else {
      state.saveError = S.ERR_SAVE_FAILED_SHORT;
    }
    return false;
  } finally {
    state.saving = false;
    renderActions();
    if (state.saveQueued) {
      state.saveQueued = false;
      scheduleAutosave(200);
    }
  }
}

async function publish() {
  if (!validation().ok) {
    await save("publish"); // shows the problems
    return;
  }
  const ok = await confirmDialog({
    title: S.CONFIRM_PUBLISH_TITLE,
    body: S.CONFIRM_PUBLISH_BODY,
    confirmLabel: S.PUBLISH,
    danger: false,
  });
  if (!ok) return;
  if (await save("publish")) {
    renderAll();
    confetti();
    toast(S.QUIZ_PUBLISHED, {
      tone: "success",
      duration: 7000,
      action: { label: S.COPY_LINK, onClick: () => copyText(joinLink(state.quiz.shareCode), S.LINK_COPIED) },
    });
  }
}

async function duplicateLocked() {
  try {
    if ((await listMyQuizzes(state.user.id)).length >= state.limits.maxQuizzes) {
      toast(t(S.LIMIT_REACHED_QUIZZES, { n: state.limits.maxQuizzes }), { tone: "error" });
      return;
    }
    const copy = await duplicateQuiz(state.quiz.id, state.user.id, { suffix: S.COPY_SUFFIX, maxTitleChars: state.limits.maxQuizTitleChars });
    window.location.href = route(`create/?id=${encodeURIComponent(copy.id)}`);
  } catch (error) {
    console.error(error);
    toast(S.ERR_SAVE_FAILED, { tone: "error" });
  }
}

// ── Keyboard ────────────────────────────────────────────────────────────────

const SHORTCUTS = [
  ["Ctrl S", () => S.KEY_SAVE],
  ["Ctrl Enter", () => S.KEY_NEW_QUESTION],
  ["Ctrl D", () => S.KEY_DUPLICATE],
  ["Alt ↑ / ↓", () => S.KEY_MOVE],
  ["Ctrl ↑ / ↓", () => S.KEY_PREV_NEXT],
  ["Ctrl Z", () => S.KEY_UNDO],
  ["Ctrl Shift Z", () => S.KEY_REDO],
  ["1 – 6", () => S.KEY_PICK_TYPE],
  ["?", () => S.KEY_HELP],
];

function showShortcuts() {
  const dlg = openDialog({
    title: S.SHORTCUTS,
    content: [
      el(
        "div",
        { class: "shortcut-list" },
        SHORTCUTS.map(([keys, label]) =>
          el("div", { class: "shortcut-row" }, [
            el("span", { text: label() }),
            el("span", { class: "row" }, keys.split(" ").map((k) => (k === "/" || k === "–" ? el("span", { class: "faint", text: k }) : el("kbd", { class: "kbd", text: k })))),
          ])
        )
      ),
    ],
    actions: [button({ label: S.CLOSE, variant: "primary", onClick: () => dlg.close() })],
  });
}

function inTextField(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

document.addEventListener("keydown", (e) => {
  if (!state.quiz || document.querySelector(".overlay")) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  const index = state.forms.findIndex((f) => f.id === state.selectedId);

  if (mod && key === "s") {
    e.preventDefault();
    if (state.quiz.isDraft) save("manual");
    else if (isDirty()) save("manual");
    return;
  }
  if (readOnly()) return;
  if (mod && key === "enter") {
    e.preventDefault();
    addQuestion(selected()?.type ?? QUESTION_TYPE_ORDER[0]);
  } else if (mod && key === "d") {
    e.preventDefault();
    if (selected()) duplicateQuestion(state.selectedId);
  } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && index >= 0) {
    e.preventDefault();
    moveQuestion(index, index + (e.key === "ArrowUp" ? -1 : 1));
  } else if (mod && (e.key === "ArrowUp" || e.key === "ArrowDown") && index >= 0) {
    e.preventDefault();
    const next = state.forms[index + (e.key === "ArrowUp" ? -1 : 1)];
    if (next) select(next.id);
  } else if (!inTextField(e.target)) {
    if (mod && key === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (mod && ((key === "z" && e.shiftKey) || key === "y")) {
      e.preventDefault();
      redo();
    } else if (e.key === "?") {
      e.preventDefault();
      showShortcuts();
    } else if (!state.forms.length && /^[1-6]$/.test(e.key) && !mod) {
      addQuestion(QUESTION_TYPE_ORDER[Number(e.key) - 1]);
    }
  }
});

window.addEventListener("beforeunload", (e) => {
  if (state.quiz && isDirty() && !readOnly() && !state.blocked) {
    // Drafts get one last save attempt; either way the browser asks before leaving.
    if (state.quiz.isDraft) save("auto");
    e.preventDefault();
    e.returnValue = "";
  }
});

// Keep "Saved · 2 min ago" honest while the page sits open.
setInterval(() => {
  if (state.quiz && !state.saving) renderActions();
}, 30000);

start();
