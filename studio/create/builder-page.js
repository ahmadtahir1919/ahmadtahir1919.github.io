// Quiz builder (/create/ new, /create/?id= edit) — the editor from design-reference/editor.html.
//
// Layout: sidebar · top bar · title + meta · question rail (left) · question card with its
// settings below (centre) · quiz settings (right). The quiz and question settings are the
// app's, in the app's order; the look is the reference's.
//
// Saving is unchanged: drafts autosave ~1.5s after the last change; a published quiz saves only
// on Save, so a half-typed edit never goes live. A published quiz that people have joined or
// taken opens read-only (isLockedForEditing), with Duplicate offered. Undo is core/store.js.
//
// Rendering: typing updates state silently plus the light bits (rail, steps, top bar), so focus
// and caret are never lost; regions re-render only when their structure changes, through the
// motion helpers (ui/motion.js) so nothing appears or disappears instantly.

import { DEFAULT_PREVIEW_SEC, QUESTION_TYPES as T, newQuiz, themeColor } from "../core/models.js";
import { QuizChangedError, QuizLockedError, duplicateQuiz, generateUniqueShareCode, isLockedForEditing, listMyQuizzes, loadQuestions, loadQuiz, saveQuiz, saveTitleAndTheme } from "../core/quizzes.js";
import { createHistory } from "../core/store.js";
import { S, t } from "../core/strings.js";
import { requireUser } from "../core/auth.js";
import { fetchLimits } from "../core/limits.js";
import { exceedsLimits, normalizeQuestion, validateQuiz } from "../core/validate.js";
import { confirmDialog, el, renderSignInGate, renderSpinner } from "../ui/components.js";
import { animateOut, confettiCanvas, flipKeyed, prefersReducedMotion, reveal } from "../ui/motion.js";
import "../ui/theme.js";
import { route } from "../core/paths.js";
import { copyForQuiz } from "../core/bank.js";
import { openBankPicker } from "../bank/bank-picker.js";
import { cloneForm, convertType, fromForm, newForm, toForm } from "./form.js";
import { buildTemplate } from "./templates.js";
import { G, TYPE_ICON, svg } from "./qe-icons.js";
import { TYPES, done, missing, questionText, railTitle, started, steps, takeSeconds, typeName } from "./qe-model.js";
import { applyLimits, ataText, blankPointsMode, nudgeCard, renderCard as paintCard, renderQset, runTry, syncBlankPoints, wireSmartPaste } from "./qe-card.js";
import { buildPanel, schedChip } from "./qe-panel.js";
import { markMyself } from "./qe-presets.js";
import { reviewQuizSetup, setupSettings } from "../core/rules.js";
import { showSetupReview } from "../ui/setup-review.js";
import { buildSidebar } from "../ui/sidebar.js";
import { openPreview } from "./qe-preview.js";
import { track } from "../core/analytics.js";

const AUTOSAVE_MS = 1500;
const NOSET_KEY = "qz-noset";
const RAIL_TOP = 80;
const RAIL_GAP = 16;
const root = document.getElementById("root");
const params = new URLSearchParams(window.location.search);
const reduce = () => prefersReducedMotion();

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
  /** null | "stale" | "deleted" | "has_answers" — a save was refused because the quiz changed elsewhere
   *  (the server copy wins); nothing saves until the page is reloaded. */
  conflict: null,
  /** The settings the questions were last saved under (the setup review compares against them); null = never saved. */
  savedSettings: null,
  version: 0,
  savedVersion: 0,
  saving: false,
  saveQueued: false,
  saveError: null,
  lastSavedAt: null,
  /** After a locked Publish click, every incomplete question in the rail turns red. */
  pubTried: params.get("check") === "1",
  lastPreviewSec: DEFAULT_PREVIEW_SEC,
  sched: { mins: 30 },
  justAdded: null,
};

const history = createHistory(60);
const R = {}; // DOM regions
let autosaveTimer = null;
let panelApi = null;
let lastCard = { id: null, type: null };
let lastUntimed = null;
let pageLoadedAt = Date.now();

const isDirty = () => state.version !== state.savedVersion;
const readOnly = () => state.isLocked || !!state.blocked;
const selected = () => state.forms.find((f) => f.id === state.selectedId) ?? state.forms[0];
const index = () => Math.max(0, state.forms.findIndex((f) => f.id === selected()?.id));
const persisted = () => state.forms.map(fromForm);
const ctx = () => ({ limits: state.limits, quiz: state.quiz });

// ── Start ───────────────────────────────────────────────────────────────────

async function start() {
  renderSpinner(root, "editor");
  state.user = await requireUser();
  if (!state.user) {
    renderSignInGate(root);
    return;
  }
  try {
    await load(params.get("id"));
  } catch (error) {
    console.error(error);
    root.replaceChildren(el("div", { class: "bare" }, [el("p", { text: S.ERR_LOAD_FAILED })]));
  }
}

async function load(editing) {
  state.limits = await fetchLimits();
  let fromTemplate = false;
  if (editing) {
    const quiz = await loadQuiz(editing);
    if (!quiz || quiz.ownerId !== state.user.id) {
      root.replaceChildren(el("div", { class: "bare" }, [el("div", { class: "gate-card" }, [el("h1", { text: S.ERR_NOT_FOUND }), el("p", { text: S.ERR_NOT_FOUND_BODY }), el("a", { class: "btn btn-primary", href: route(""), text: S.BACK_TO_QUIZZES })])]));
      return;
    }
    const [questions, locked] = await Promise.all([loadQuestions(quiz.id), isLockedForEditing(quiz)]);
    state.quiz = quiz;
    state.forms = questions.map(toForm);
    state.isNew = false;
    state.isLocked = locked;
    state.savedSettings = setupSettings(quiz);
  } else {
    state.quiz = { ...newQuiz(), ownerId: state.user.id };
    if (!state.limits.createQuizEnabled) state.blocked = "maintenance";
    else if ((await listMyQuizzes(state.user.id)).length >= state.limits.maxQuizzes) state.blocked = "quota";
    const template = state.blocked ? null : buildTemplate(params.get("template"));
    if (template) {
      state.quiz.title = template.title;
      state.quiz.groupName = template.groupName;
      state.forms = template.questions.map(toForm);
      fromTemplate = true;
    }
  }
  // The editor always has a question on screen; an empty one is only saved once touched.
  if (!state.forms.length) state.forms = [newForm(T.SINGLE_CHOICE, { timeSec: state.quiz.defaultTimeSec ?? 30 })];
  if (state.quiz.questionPreviewSec > 0) state.lastPreviewSec = state.quiz.questionPreviewSec;
  state.selectedId = state.forms[0].id;

  buildLayout();
  renderAll();
  if (fromTemplate) touched();
  const imported = Number(params.get("imported"));
  if (imported > 0) {
    toast(imported === 1 ? S.IMP_IMPORTED_ONE : t(S.IMP_IMPORTED_MANY, { n: imported }));
    window.history.replaceState(null, "", route(`create/?id=${encodeURIComponent(state.quiz.id)}`));
  } else if (state.pubTried) jumpToFirstIncomplete();
  if (state.isNew && !readOnly()) setTimeout(() => R.title.focus(), 300);
}

// ── Layout ──────────────────────────────────────────────────────────────────

function buildLayout() {
  document.documentElement.dataset.page = "editor";
  const nav = buildSidebar({ user: state.user, active: "create" });

  // Top bar
  R.barTitle = el("span", { class: "bar-title" });
  R.draft = el("span", { class: "cb-draft" });
  R.savedTxt = el("span");
  R.savedTip = el("span", { class: "svtip", role: "tooltip" });
  R.retry = el("button", { type: "button", text: S.RETRY, hidden: true, onclick: () => save("manual") });
  R.saved = el("span", { class: "saved", role: "status", "aria-live": "polite" }, [svg(G.check14), el("i"), R.savedTxt, R.retry, R.savedTip]);
  R.saved.addEventListener("mouseenter", () => (R.savedTip.textContent = t(S.QE_SAVED_TIP, { when: relTime(state.lastSavedAt ?? pageLoadedAt) })));
  R.undo = el("button", { type: "button", title: S.QE_UNDO_TITLE, "aria-label": S.UNDO, disabled: true, onclick: undo }, [svg(G.undo)]);
  R.redo = el("button", { type: "button", title: S.QE_REDO_TITLE, "aria-label": S.REDO, disabled: true, onclick: redo }, [svg(G.redo)]);
  R.pubChecks = el("ul");
  R.pubLabel = el("span");
  R.pubIcon = el("span", { class: "pico" });
  const tipLink = el("u", { text: S.QE_SAFE_TIP_U });
  tipLink.addEventListener("click", (e) => {
    e.stopPropagation();
    onPreviewClick();
  });
  R.pubTip = el("span", { class: "pubtip", role: "tooltip" }, [el("b", { text: S.QE_ALMOST }), R.pubChecks, el("span", { class: "ptsafe" }, [svg(G.shield), el("span", {}, [S.QE_SAFE, S.QE_SAFE_TIP_A, tipLink, S.QE_SAFE_TIP_B])])]);
  R.prev = el("button", { class: "ghost bd prev", type: "button", onclick: onPreviewClick }, [
    svg(G.eye),
    el("span", { class: "lbl", text: S.QE_PREVIEW }),
    el("span", { class: "prtip", role: "tooltip" }, [el("b", { text: S.QE_PREV_LOCK_T }), S.QE_PREV_LOCK_B]),
  ]);
  R.pub = el("button", { class: "pub", type: "button", onclick: onPublishClick }, [R.pubIcon, R.pubLabel, R.pubTip]);
  R.importBtn = el("button", { class: "ghost bd import-btn", type: "button", onclick: importFromFile }, [svg(G.importIcon), el("span", { class: "lbl", text: S.QE_IMPORT })]);
  R.resultsBtn = el("a", { class: "ghost bd", href: route(`results/?id=${encodeURIComponent(state.quiz.id)}`) }, [svg(G.results), el("span", { class: "lbl", text: S.QE_RESULTS })]);
  const kb = shortcutsPopover();
  R.kb = kb;
  const bar = el("div", { class: "bar" }, [
    el("nav", { class: "qcrumbs", "aria-label": S.BREADCRUMB }, [
      el("a", { href: route(""), class: "cb-home" }, [svg(G.back), S.QE_DASHBOARD]),
      el("span", { class: "cb-sep", text: "/" }),
      el("span", { class: "cb-cur" }, [el("span", { class: "qdot" }), R.barTitle]),
      R.draft,
    ]),
    R.saved,
    el("div", { class: "sp" }),
    el("div", { class: "ur", role: "group", "aria-label": S.QE_HISTORY }, [R.undo, R.redo]),
    kb.node,
    readOnly() ? null : R.importBtn,
    state.quiz.isDraft || state.isNew ? null : R.resultsBtn,
    R.prev,
    state.blocked ? null : R.pub,
  ]);

  // Title + ideas + meta
  R.title = el("input", { class: "qtitle", id: "qe-title", dir: "auto", placeholder: S.QE_TITLE_PH, "aria-label": S.QUIZ_TITLE_LABEL, "data-max": String(state.limits.maxQuizTitleChars), readonly: state.blocked ? true : undefined });
  R.title.value = state.quiz.title ?? "";
  R.ideas = el("div", { class: "tideas", hidden: true });
  R.metaPill = el("span", { class: "dpill" });
  R.metaCount = el("span");
  R.metaTime = el("span");
  R.metaChip = el("span", { class: "mchip" });
  const titlewrap = el("div", { class: "titlewrap" }, [
    R.title,
    R.ideas,
    el("div", { class: "meta" }, [R.metaPill, el("span", { class: "mdot" }), R.metaCount, el("span", { class: "mdot" }), R.metaTime, el("span", { class: "mdot" }), R.metaChip]),
  ]);
  wireTitle();

  // Rail
  R.railCount = el("span");
  R.ritems = el("div", { class: "ritems" });
  R.railAdd = el("button", { class: "add", type: "button", onclick: () => addQuestion() }, [svg(G.addSmall), S.QE_ADD_QUESTION]);
  const ns = "http://www.w3.org/2000/svg";
  const ring = document.createElementNS(ns, "svg");
  ring.setAttribute("class", "ring");
  ring.setAttribute("viewBox", "0 0 44 44");
  ring.setAttribute("aria-hidden", "true");
  for (const cls of ["rt", "rp"]) {
    const c = document.createElementNS(ns, "circle");
    c.setAttribute("cx", "22");
    c.setAttribute("cy", "22");
    c.setAttribute("r", "18");
    c.setAttribute("class", cls);
    ring.appendChild(c);
  }
  R.ovRing = ring.querySelector(".rp");
  R.ovNum = el("b");
  R.ovTitle = el("b");
  R.ovSub = el("small");
  R.ovQ = el("b");
  R.ovT = el("b");
  R.ovP = el("b");
  const ov = el("section", { class: "ov", "aria-label": S.QE_PROGRESS }, [
    el("div", { class: "ovtop" }, [el("span", { class: "ringw" }, [ring, R.ovNum]), el("div", {}, [R.ovTitle, R.ovSub])]),
    el("div", { class: "ovstats" }, [
      el("div", {}, [R.ovQ, el("small", { text: S.QE_STAT_QUESTIONS })]),
      el("div", {}, [R.ovT, el("small", { text: S.QE_STAT_TIME })]),
      el("div", {}, [R.ovP, el("small", { text: S.QE_STAT_POINTS })]),
    ]),
    el("div", { class: "ovkeys" }, [
      el("div", {}, [el("span", { text: S.QE_KEY_NEW_OPTION }), el("kbd", { text: "Enter" })]),
      el("div", {}, [el("span", { text: S.QE_KEY_NEXT }), el("span", {}, [el("kbd", { text: "Ctrl" }), " ", el("kbd", { text: "Enter" })])]),
      el("div", {}, [el("span", { text: S.QE_KEY_TYPE }), el("kbd", { text: "/" })]),
      el("button", { type: "button", class: "ovall", onclick: (e) => { e.stopPropagation(); kb.open(true); } }, [S.QE_ALL_SHORTCUTS, el("kbd", { text: "?" })]),
    ]),
  ]);
  R.rail = el("nav", { class: "rail", "aria-label": S.QE_QUESTIONS }, [
    el("h3", {}, [el("span", { text: S.QE_QUESTIONS }), R.railCount]),
    R.ritems,
    readOnly() ? null : R.railAdd,
    readOnly() ? null : el("div", { class: "more" }, [el("button", { type: "button", onclick: addFromBank }, [svg(G.bankSmall), S.QE_FROM_BANK])]),
    ov,
  ]);
  wireRail();

  // Centre column
  R.cardHost = el("div", { class: "card-host" });
  R.qset = el("section", { class: "qset", "aria-label": S.QE_Q_SETTINGS });
  R.nextBtn = el("button", { class: "nextbtn", type: "button", onclick: () => addQuestion() }, [svg(G.addSmall), S.QE_NEXT]);
  const col = el("div", { class: "col" }, [R.cardHost, R.qset, readOnly() ? null : el("div", { class: "next" }, [R.nextBtn])]);
  wireSmartPaste(R.cardHost, ed);

  // Right panel
  panelApi = buildPanel({
    quiz: () => state.quiz,
    questions: persisted,
    readOnly,
    themeReadOnly: () => !!state.blocked,
    lastPreviewSec: () => state.lastPreviewSec,
    sched: state.sched,
    setQuiz: changeQuiz,
    onHide: () => setPanel(false, { announce: true }),
    meta: renderMeta,
  });

  R.editor = el("div", { class: "editor" }, [titlewrap, R.rail, col, panelApi.panel]);
  R.notices = el("div");
  R.menu = el("div", { class: "tmenu", role: "menu", "aria-label": S.QE_TYPE_MENU });
  R.showSet = el("button", { class: "showset", type: "button", hidden: true, "aria-label": S.QE_SHOW_SETTINGS, onclick: () => setPanel(true) }, [svg(G.sliders), el("span", { text: S.QE_QUIZ_SETTINGS })]);
  R.mset = el("button", { type: "button", class: "msetbtn" }, [svg(G.sliders2), S.QE_QUIZ_SETTINGS]);
  R.toast = el("div", { class: "qtoast", role: "status", "aria-live": "polite" });

  R.app = el("div", { class: "qe app" }, [
    el("main", {}, [nav.mobileBar, el("div", { class: "qbanner" }, [el("b", { text: S.QE_BETA }), S.BETA_SEP, S.BETA_NOTE]), bar, R.notices, R.editor]),
  ]);
  R.root = el("div", { class: "qe" }, [R.app, R.menu, R.showSet, R.mset, R.toast]);
  // The same sidebar as every other page, beside the editor (outside .qe, so none of the
  // editor's own styles reach it).
  root.replaceChildren(el("div", { class: "shell" }, [nav.sidebar, R.root, nav.scrim]));
  document.title = `${S.NEW_QUIZ_TITLE} — ${S.APP_NAME} ${S.STUDIO} (${S.BETA})`;

  renderNotices();
  applyLimits(titlewrap);
  setQc();
  wireMenu();
  wireStickyRail();
  wireMobileSettings();
  try {
    if (localStorage.getItem(NOSET_KEY) === "1") setPanel(false, { instant: true });
  } catch {
    /* default: shown */
  }
}

function setQc() {
  R.app.style.setProperty("--qc", themeColor(state.quiz.themeColorName));
}

function renderNotices() {
  const items = [];
  if (state.isLocked) {
    items.push(
      el("div", { class: "qnotice" }, [
        el("b", { text: S.LOCKED_TITLE }),
        el("span", { text: S.LOCKED_BODY }),
        el("span", { class: "sp" }),
        el("a", { href: route(`results/?id=${encodeURIComponent(state.quiz.id)}`), text: S.VIEW_RESULTS }),
        el("button", { type: "button", text: S.DUPLICATE, onclick: duplicateLocked }),
      ])
    );
  }
  if (state.conflict) {
    items.push(
      el("div", { class: "qnotice err" }, [
        el("span", { text: state.conflict === "has_answers" ? S.QE_HAS_ANSWERS : S.QE_CHANGED_ELSEWHERE }),
        el("span", { class: "sp" }),
        el("button", { type: "button", text: S.QE_RELOAD, onclick: () => window.location.reload() }),
      ])
    );
  }
  if (state.blocked === "maintenance") items.push(el("div", { class: "qnotice" }, [el("span", { text: S.CREATE_DISABLED })]));
  if (state.blocked === "quota") {
    items.push(el("div", { class: "qnotice err" }, [el("span", { text: t(S.LIMIT_REACHED_QUIZZES, { n: state.limits.maxQuizzes }) }), el("span", { class: "sp" }), el("a", { href: route(""), text: S.BACK_TO_QUIZZES })]));
  }
  R.notices.replaceChildren(...items);
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderAll({ focus = false } = {}) {
  renderStrip();
  renderCard({ focus });
  renderPane();
  refreshTop();
}

function renderCard({ focus = false, fresh = null, focusSel = null } = {}) {
  const form = selected();
  const enter = form.id !== lastCard.id;
  const swap = !enter && form.type !== lastCard.type;
  lastCard = { id: form.id, type: form.type };
  paintCard(R.cardHost, ed, { enter, swap, fresh, focus: focusSel ?? (focus && !readOnly() ? ".qtext" : null) });
}

let lastPaneKey = "";
function renderPane({ focus = null } = {}) {
  const form = selected();
  const key = `${form.id}|${form.type}`;
  const changed = key !== lastPaneKey;
  lastPaneKey = key;
  // Keep focus (and caret) on the same control across the re-render.
  const active = document.activeElement;
  const fk = active && R.qset.contains(active) ? active.id || active.dataset.fk : null;
  const caret = fk && typeof active.selectionStart === "number" ? [active.selectionStart, active.selectionEnd] : null;
  renderQset(R.qset, ed, { changed });
  const target = focus ? R.qset.querySelector(focus) : fk ? R.qset.querySelector(`#${CSS.escape(fk)}, [data-fk="${CSS.escape(fk)}"]`) : null;
  if (target) {
    target.focus({ preventScroll: true });
    if (focus && target.select) target.select();
    else if (caret && target.setSelectionRange) {
      try {
        target.setSelectionRange(caret[0], caret[1]);
      } catch {
        /* not a text field */
      }
    }
  }
}

function renderStrip() {
  const cur = selected();
  const c = ctx();
  flipKeyed(R.ritems, ".ri", () => {
    R.ritems.replaceChildren(
      ...state.forms.map((form, i) => {
        const isDone = done(form, c);
        const on = form.id === cur.id;
        const warn = !isDone && !on && (state.pubTried || started(form));
        const todo = !isDone && !on && !warn;
        const list = steps(form, c);
        const n = list.filter((s) => s[1]).length;
        const title = railTitle(form);
        const mp = el("span", { class: `mp ${n === list.length ? "ok" : ""}`, title: t(S.QE_STEPS_DONE, { n, total: list.length }), vars: { p: `${(n / list.length) * 100}%` } });
        const tail = warn
          ? el("span", { class: "miss", text: missing(form, c) })
          : todo
            ? el("span", { class: "todo-t", text: S.QE_NOT_STARTED })
            : [el("span", { class: "tyi" }, [svg(TYPE_ICON[form.type])]), typeName(form.type)];
        return el(
          "button",
          {
            class: `ri ${on ? "on" : ""} ${state.justAdded === form.id ? "new" : ""} ${isDone ? "done" : ""} ${warn ? "warn" : ""} ${todo ? "todo" : ""}`,
            type: "button",
            "data-k": form.id,
            "data-ty": form.type,
            draggable: readOnly() ? undefined : "true",
            title: S.QE_DRAG_HINT,
            "aria-current": on ? "true" : undefined,
          },
          [
            readOnly() ? null : el("span", { class: "grip", "aria-hidden": "true" }, [svg(G.grip)]),
            el("span", { class: "n", title: typeName(form.type), text: String(i + 1) }),
            el("span", { class: "t" }, [el("b", { class: title ? "" : "is-empty", dir: "auto", text: title || S.QE_NEW_QUESTION }), el("small", {}, [mp, tail])]),
            // Shown on hover / focus. The last question is reset rather than removed, and a locked
            // quiz can't lose questions, so neither gets the icon.
            readOnly() || state.forms.length === 1
              ? null
              : el("span", { class: "rdel", role: "button", tabindex: "0", title: t(S.QE_RAIL_DELETE, { n: i + 1 }), "aria-label": t(S.QE_RAIL_DELETE, { n: i + 1 }) }, [svg(G.del)]),
          ]
        );
      })
    );
  });
  state.justAdded = null;
  const total = state.forms.length;
  R.railCount.textContent = t(S.QE_COUNT_OF, { n: total, max: state.limits.maxQuestions });
  R.railAdd.disabled = total >= state.limits.maxQuestions;
  // Progress card
  const ready = state.forms.filter((f) => done(f, c)).length;
  const left = total - ready;
  R.ovRing.style.strokeDashoffset = String(113.1 * (1 - ready / total));
  R.ovNum.textContent = `${ready}/${total}`;
  R.ovTitle.textContent = left === 0 ? S.QE_ALL_DONE : S.QE_PROGRESS;
  R.ovSub.textContent =
    left === 0 ? S.QE_CAN_PUBLISH : ready === 0 ? (total === 1 ? S.QE_FINISH_FIRST : t(S.QE_FINISH_N, { n: total })) : t(left === 1 ? S.QE_N_COMPLETE_ONE : S.QE_N_COMPLETE_MANY, { done: ready, left });
  R.ovQ.textContent = String(total);
  const secs = takeSeconds(state.forms);
  R.ovT.textContent = secs < 60 ? t(S.QE_SEC_SHORT, { n: secs }) : t(S.QE_MIN_SHORT, { n: Math.round(secs / 60) });
  R.ovP.textContent = String(state.forms.reduce((a, f) => a + (f.type === T.POLL ? 0 : f.points || 0), 0));
  renderMeta();
}

function renderMeta() {
  if (!R.metaPill) return;
  const pill = state.isLocked ? ["ro", S.QE_READ_ONLY] : state.quiz.isDraft ? ["", S.QE_DRAFT] : ["live", S.QE_PUBLISHED];
  R.metaPill.className = `dpill ${pill[0]}`;
  R.metaPill.replaceChildren(el("i"), pill[1]);
  const n = state.forms.length;
  R.metaCount.textContent = n === 1 ? S.QE_Q_ONE : t(S.QE_Q_MANY, { n });
  const secs = takeSeconds(state.forms);
  R.metaTime.textContent = secs < 60 ? t(S.QE_TAKE_SEC, { n: secs }) : t(S.QE_TAKE_MIN, { n: Math.round(secs / 60) });
  const [icon, text, cls] = schedChip(state.quiz);
  const sig = `${cls}|${text}`;
  if (R.metaChip.dataset.sig !== sig) {
    const first = !R.metaChip.dataset.sig;
    R.metaChip.dataset.sig = sig;
    R.metaChip.className = `mchip ${cls}`;
    R.metaChip.title = text;
    R.metaChip.replaceChildren(svg(icon), el("span", { text }));
    if (!first && !reduce()) R.metaChip.animate([{ opacity: 0.3, transform: "translateY(2px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
}

/** The publish checklist, in order: write every question, finish every question, name it
 *  (plus the schedule, when its end is before its start — the real validation needs that too). */
function checklist() {
  const c = ctx();
  const { startAt, endAt } = state.quiz;
  const list = [
    [S.QE_CHECK_WRITE, state.forms.every((f) => (f.type === T.FILL_BLANK ? f.fb.sentence.trim() : questionText(f).trim()))],
    [S.QE_CHECK_FINISH, state.forms.every((f) => done(f, c))],
    [S.QE_CHECK_NAME, !!(state.quiz.title ?? "").trim()],
  ];
  if (startAt && endAt && endAt <= startAt) list.push([S.QE_END_AFTER, false]);
  return list;
}

function leftCount() {
  const c = ctx();
  const { startAt, endAt } = state.quiz;
  return state.forms.filter((f) => !done(f, c)).length + ((state.quiz.title ?? "").trim() ? 0 : 1) + (startAt && endAt && endAt <= startAt ? 1 : 0);
}

/** Top bar: breadcrumb title, Draft chip, save state, undo/redo, Publish. */
function refreshTop() {
  const title = (state.quiz.title ?? "").trim() || S.QE_UNTITLED;
  R.barTitle.textContent = title.length > 15 ? `${title.slice(0, 15).trimEnd()}…` : title;
  R.barTitle.title = title;
  R.draft.textContent = state.isLocked ? S.QE_READ_ONLY : state.quiz.isDraft ? S.QE_DRAFT : S.QE_PUBLISHED;
  R.undo.disabled = readOnly() || !history.canUndo;
  R.redo.disabled = readOnly() || !history.canRedo;

  // Save state
  R.saved.hidden = !!state.blocked || (state.isLocked && !isDirty() && !state.saveError);
  R.saved.classList.remove("saving", "dirty", "err");
  R.retry.hidden = true;
  if (state.saveError) {
    R.saved.classList.add("err");
    R.savedTxt.textContent = state.saveError;
    R.retry.hidden = false;
  } else if (state.saving || (isDirty() && state.quiz.isDraft)) {
    R.saved.classList.add("saving");
    R.savedTxt.textContent = S.QE_SAVING;
  } else if (isDirty()) {
    R.saved.classList.add("dirty");
    R.savedTxt.textContent = S.QE_UNSAVED;
  } else R.savedTxt.textContent = S.QE_SAVED;

  // Preview: locked until at least one question is finished.
  R.prev.setAttribute("data-locked", state.forms.some((f) => done(f, ctx())) ? "false" : "true");

  // Publish / Save changes / Duplicate
  R.pubIcon.replaceChildren();
  if (state.isLocked) {
    // Locked: Duplicate — or, once the title or theme changed, Save changes (only those two are written).
    R.pub.removeAttribute("data-locked");
    R.pubIcon.append(svg(isDirty() ? G.save : G.copy16));
    R.pubLabel.textContent = isDirty() ? S.QE_SAVE : S.DUPLICATE;
    R.pubTip.hidden = true;
    return;
  }
  const left = leftCount();
  R.pub.setAttribute("data-locked", left ? "true" : "false");
  R.pubIcon.append(svg(state.quiz.isDraft ? G.send : G.save));
  R.pubLabel.textContent = state.quiz.isDraft ? S.QE_PUBLISH : S.QE_SAVE;
  R.pubTip.hidden = false;
  R.pubChecks.replaceChildren(...checklist().map(([label, ok]) => el("li", { class: ok ? "ok" : "", text: `${ok ? "✓" : "○"} ${label}` })));
}

// ── Editor API for the views ────────────────────────────────────────────────

const ed = {
  form: selected,
  forms: () => state.forms,
  index,
  total: () => state.forms.length,
  get limits() {
    return state.limits;
  },
  quiz: () => state.quiz,
  ctx,
  readOnly,
  undo: () => undo(),
  toast: (msg, act) => toast(msg, act),
  /** Applies [fn] to the current question as one undoable change. opts: card / pane / rail
   *  (re-render those; card and pane may carry { fresh, focus }), breakChain. */
  change(key, fn, opts = {}) {
    if (readOnly()) return;
    const form = selected();
    history.checkpoint(`${form.id}-${key}`, snapshot());
    if (opts.breakChain) history.breakChain();
    fn(form);
    touched();
    if (opts.card) renderCard(typeof opts.card === "object" ? { fresh: opts.card.fresh, focusSel: opts.card.focus } : {});
    if (opts.pane) renderPane(typeof opts.pane === "object" ? opts.pane : {});
    if (opts.rail) renderStrip();
  },
  nudge() {
    nudgeCard(R.cardHost, ed);
    renderStrip();
  },
  renderCard: () => renderCard(),
  refreshTry: () => runTry(ed),
  refreshAta() {
    // The "Same for every question?" strip follows points/time; update it in place, and
    // re-render the card only when it has to appear or go.
    const text = ataText(ed);
    const node = R.qset.querySelector("[data-ata]");
    if (!!text === !!node) {
      if (node) node.textContent = text;
    } else renderPane();
  },
  refreshPointsNote() {
    const f = selected();
    R.qset.querySelectorAll("[data-fb-total]").forEach((n) => (n.textContent = t(S.QE_FB_POINTS_NOTE_EACH, { n: f.points })));
    renderStrip();
  },
  toggleTypeMenu: (btn) => toggleMenu(btn),
  duplicate: () => duplicateQuestion(),
  remove: () => deleteQuestion(),
  goNext,
  applyToAll,
};

// ── Changes ─────────────────────────────────────────────────────────────────

const snapshot = () => ({ quiz: state.quiz, forms: state.forms, selectedId: state.selectedId });

function touched() {
  state.version++;
  state.saveError = null;
  if (state.quiz.questionPreviewSec > 0) state.lastPreviewSec = state.quiz.questionPreviewSec;
  refreshTop();
  renderMeta();
  // The quiz rules that depend on timed questions follow the questions.
  const untimed = persisted().filter((q) => q.type !== T.POLL).every((q) => !(q.timeSec > 0));
  if (lastUntimed !== null && untimed !== lastUntimed) panelApi.render();
  lastUntimed = untimed;
  scheduleAutosave();
}

function changeQuiz(key, fn) {
  // A locked quiz still takes a new title and theme (saved by saveLockedDetails); every rule stays put.
  if (readOnly() && !(state.isLocked && !state.blocked && (key === "title" || key === "theme"))) return;
  history.checkpoint(`quiz-${key}`, snapshot());
  fn(state.quiz);
  if (key === "theme") setQc();
  touched();
  if (key === "manual") {
    // Manual marking changes what each question needs (no right answer required).
    renderCard();
    renderPane();
    renderStrip();
  }
  if (key === "title") return;
  renderStrip();
}

/** A structural change to the question list — its own undo step. */
function changeForms(key, fn) {
  if (readOnly()) return false;
  history.checkpoint(key, snapshot());
  history.breakChain();
  fn();
  touched();
  return true;
}

function select(id, { focus = true } = {}) {
  if (!state.forms.some((f) => f.id === id)) return;
  state.selectedId = id;
  history.breakChain();
  closeMenu();
  renderAll({ focus });
}

function goNext() {
  const i = index();
  if (i < state.forms.length - 1) {
    select(state.forms[i + 1].id);
    window.scrollTo({ top: 0, behavior: reduce() ? "auto" : "smooth" });
  } else addQuestion();
}

function addQuestion() {
  if (readOnly()) return;
  if (state.forms.length >= state.limits.maxQuestions) {
    toast(t(S.QE_Q_LIMIT, { n: state.limits.maxQuestions }));
    return;
  }
  const prev = selected()?.type;
  const type = [T.TRUE_FALSE, T.POLL, T.MULTIPLE_CORRECT].includes(prev) ? prev : T.SINGLE_CHOICE;
  const form = newForm(type, { timeSec: state.quiz.defaultTimeSec ?? 30 });
  changeForms(`add-${form.id}`, () => {
    state.forms.splice(index() + 1, 0, form);
    state.selectedId = form.id;
    state.justAdded = form.id;
  });
  renderAll({ focus: true });
  window.scrollTo({ top: 0, behavior: reduce() ? "auto" : "smooth" });
}

function duplicateQuestion() {
  if (state.forms.length >= state.limits.maxQuestions) {
    toast(t(S.QE_Q_LIMIT, { n: state.limits.maxQuestions }));
    return;
  }
  const at = index();
  const copy = cloneForm(state.forms[at]);
  changeForms(`dup-${copy.id}`, () => {
    state.forms.splice(at + 1, 0, copy);
    state.selectedId = copy.id;
    state.justAdded = copy.id;
  });
  renderAll({ focus: true });
  toast(S.QE_DUPLICATED, { label: S.UNDO, fn: undo });
}

/** Deletes the open question, or the one with [id] (the rail's hover icon). */
function deleteQuestion(id = selected().id) {
  const isOpen = id === selected().id;
  const card = isOpen ? R.cardHost.querySelector(".qcard") : null;
  const row = R.ritems.querySelector(`.ri[data-k="${CSS.escape(id)}"]`);
  if (row) animateOut(row, () => {});
  const go = () => {
    const at = state.forms.findIndex((f) => f.id === id);
    if (at < 0) return;
    changeForms(`del-${id}`, () => {
      if (state.forms.length === 1) {
        // The last question is reset instead of removed.
        state.forms = [newForm(T.SINGLE_CHOICE, { timeSec: state.quiz.defaultTimeSec ?? 30 })];
        state.selectedId = state.forms[0].id;
      } else {
        state.forms.splice(at, 1);
        // Deleting another row leaves the open question open.
        if (isOpen) state.selectedId = state.forms[Math.max(0, at - 1)].id;
      }
    });
    renderAll();
    toast(S.QE_DELETED, { label: S.UNDO, fn: undo });
  };
  if (reduce() || !card) return go();
  card.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(8px) scale(.98)" }], { duration: 220, easing: "ease-in" }).onfinish = go;
}

/** The rail's trash icon: always asks first (the card's own delete relies on Undo alone). */
async function confirmDeleteQuestion(id) {
  const at = state.forms.findIndex((f) => f.id === id);
  if (at < 0) return;
  const text = railTitle(state.forms[at]);
  const short = text.length > 80 ? `${text.slice(0, 80)}…` : text;
  const ok = await confirmDialog({
    title: t(S.QE_DEL_CONFIRM_TITLE, { n: at + 1 }),
    body: short ? t(S.QE_DEL_CONFIRM_BODY, { text: short }) : S.QE_DEL_CONFIRM_BODY_EMPTY,
    confirmLabel: S.DELETE,
  });
  if (ok) deleteQuestion(id);
}

function moveQuestion(from, to) {
  if (to < 0 || to >= state.forms.length || from === to) return;
  changeForms(`move-${state.forms[from].id}`, () => {
    const [moved] = state.forms.splice(from, 1);
    state.forms.splice(to, 0, moved);
  });
  renderAll();
  toast(t(S.QE_MOVED, { n: to + 1 }));
}

function setType(type) {
  const form = selected();
  closeMenu();
  if (form.type === type) return;
  const { form: next, losesContent } = convertType(form, type);
  changeForms(`type-${form.id}`, () => {
    state.forms[index()] = next;
  });
  renderAll();
  toast(t(S.QE_CHANGED_TO, { type: typeName(type) }), losesContent ? { label: S.UNDO, fn: undo } : null);
}

function applyToAll() {
  const cur = selected();
  const poll = cur.type === T.POLL;
  changeForms("apply-all", () => {
    for (const f of state.forms) {
      if (f === cur || f.type === T.POLL) continue;
      f.timeSec = cur.timeSec;
      f._customTime = cur._customTime;
      if (poll) continue;
      if (f.type === T.FILL_BLANK && blankPointsMode(f) === "each") continue;
      f.points = f.type === T.FILL_BLANK ? Math.max(1, cur.points) : cur.points;
      if (f.type === T.FILL_BLANK) syncBlankPoints(f);
    }
  });
  renderPane();
  renderStrip();
  toast(S.QE_APPLIED, { label: S.UNDO, fn: undo });
}

function undo() {
  if (readOnly()) return;
  const snap = history.undo(snapshot());
  if (!snap) return;
  restore(snap);
  toast(S.QE_UNDONE);
}

function redo() {
  if (readOnly()) return;
  const snap = history.redo(snapshot());
  if (!snap) return;
  restore(snap);
  toast(S.QE_REDONE);
}

function restore(snap) {
  state.quiz = snap.quiz;
  state.forms = snap.forms;
  state.selectedId = state.forms.some((f) => f.id === snap.selectedId) ? snap.selectedId : state.forms[0].id;
  state.version++;
  R.title.value = state.quiz.title ?? "";
  R.title._cc?.();
  setQc();
  renderAll();
  panelApi.render();
  scheduleAutosave();
}

function jumpToFirstIncomplete() {
  const c = ctx();
  const first = state.forms.find((f) => !done(f, c));
  if (first) {
    if (first.id !== selected().id) select(first.id);
    else R.cardHost.querySelector(".qtext")?.focus();
    return true;
  }
  return false;
}

// ── Title ───────────────────────────────────────────────────────────────────

function wireTitle() {
  const small = matchMedia("(max-width: 600px)");
  const ph = () => (R.title.placeholder = small.matches ? S.QE_TITLE_PH_SHORT : S.QE_TITLE_PH);
  ph();
  small.addEventListener?.("change", ph);
  R.title.addEventListener("input", () => {
    changeQuiz("title", (q) => (q.title = R.title.value));
    showIdeas(!R.title.value.trim());
  });
  R.title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      R.cardHost.querySelector(".qtext")?.focus();
    }
  });
  R.title.addEventListener("pointerdown", () => showIdeas(true));
  R.title.addEventListener("blur", () => setTimeout(() => {
    if (!document.activeElement?.closest(".tideas")) showIdeas(false);
  }, 150));
  R.ideas.addEventListener("mousedown", (e) => e.preventDefault());
}

function showIdeas(show) {
  if (readOnly()) return;
  if (show && !R.title.value.trim()) {
    if (!R.ideas.hidden) return;
    const date = new Date().toLocaleDateString([], { day: "numeric", month: "short" });
    R.ideas.replaceChildren(
      el("span", { text: S.QE_IDEAS }),
      ...[t(S.QE_IDEA_TEST, { date }), S.QE_IDEA_WEEKLY, S.QE_IDEA_QUICK, S.QE_IDEA_REVISION].map((idea) =>
        el("button", {
          type: "button",
          text: idea,
          onclick: () => {
            R.title.value = idea;
            R.title.dispatchEvent(new Event("input", { bubbles: true }));
            showIdeas(false);
            R.title.blur();
          },
        })
      )
    );
    reveal(R.ideas, true);
  } else if (!R.ideas.hidden) reveal(R.ideas, false);
}

// ── Rail: select, drag, Alt+arrows, smart sticky ────────────────────────────

function wireRail() {
  let dragFrom = -1;
  const rowIndex = (node) => state.forms.findIndex((f) => f.id === node.dataset.k);
  R.ritems.addEventListener("click", (e) => {
    const b = e.target.closest(".ri");
    if (!b) return;
    if (e.target.closest(".rdel")) confirmDeleteQuestion(b.dataset.k);
    else select(b.dataset.k);
  });
  // The trash icon is a span inside the row's button, so Enter / Space are wired by hand.
  R.ritems.addEventListener("keydown", (e) => {
    const del = e.target.closest?.(".rdel");
    if (!del || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    e.stopPropagation();
    confirmDeleteQuestion(del.closest(".ri").dataset.k);
  });
  R.ritems.addEventListener("dragstart", (e) => {
    const b = e.target.closest(".ri");
    if (!b) return;
    dragFrom = rowIndex(b);
    b.classList.add("dragging");
    R.rail.classList.add("sorting");
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", String(dragFrom));
    } catch {
      /* ignore */
    }
  });
  R.ritems.addEventListener("dragover", (e) => {
    const b = e.target.closest(".ri");
    if (!b || dragFrom < 0) return;
    e.preventDefault();
    R.ritems.querySelectorAll(".ri").forEach((x) => x.classList.remove("drop-before", "drop-after"));
    const r = b.getBoundingClientRect();
    b.classList.add(e.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after");
  });
  R.ritems.addEventListener("drop", (e) => {
    const b = e.target.closest(".ri");
    if (!b || dragFrom < 0) return;
    e.preventDefault();
    let to = rowIndex(b);
    if (b.classList.contains("drop-after")) to++;
    if (dragFrom < to) to--;
    const from = dragFrom;
    dragFrom = -1;
    moveQuestion(from, to);
  });
  R.ritems.addEventListener("dragend", () => {
    dragFrom = -1;
    R.rail.classList.remove("sorting");
    R.ritems.querySelectorAll(".ri").forEach((x) => x.classList.remove("dragging", "drop-before", "drop-after"));
  });
  R.ritems.addEventListener("keydown", (e) => {
    const b = e.target.closest(".ri");
    if (!b || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown") || readOnly()) return;
    e.preventDefault();
    const i = rowIndex(b);
    state.selectedId = b.dataset.k;
    moveQuestion(i, i + (e.key === "ArrowUp" ? -1 : 1));
    R.ritems.querySelector(".ri.on")?.focus();
  });
}

/** The rail has no inner scroll: it moves with the page and sticks at its top or bottom edge. */
function wireStickyRail() {
  let top = RAIL_TOP;
  let lastY = scrollY;
  const narrow = matchMedia("(max-width: 900px)");
  const upd = () => {
    if (narrow.matches) {
      R.rail.style.removeProperty("--rtop");
      return;
    }
    const h = R.rail.offsetHeight;
    const min = Math.min(RAIL_TOP, innerHeight - h - RAIL_GAP);
    const dy = scrollY - lastY;
    lastY = scrollY;
    top = Math.max(min, Math.min(RAIL_TOP, top - dy));
    R.rail.style.setProperty("--rtop", `${top}px`);
  };
  addEventListener("scroll", upd, { passive: true });
  addEventListener("resize", () => {
    lastY = scrollY;
    upd();
  });
  new ResizeObserver(upd).observe(R.rail);
  upd();
}

// ── Quiz settings panel: hide / show, phone jump button ─────────────────────

function setPanel(show, { instant = false, announce = false } = {}) {
  const pn = panelApi.panel;
  if (!show && !instant && !reduce() && pn.offsetWidth) {
    pn.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(24px)" }], { duration: 220, easing: "ease-in" }).onfinish = () => {
      R.editor.classList.add("noset");
      reveal(R.showSet, true, { pop: true });
    };
  } else {
    R.editor.classList.toggle("noset", !show);
    R.showSet.hidden = show;
    if (show && !reduce()) pn.animate([{ opacity: 0, transform: "translateX(24px)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
  try {
    if (show) localStorage.removeItem(NOSET_KEY);
    else localStorage.setItem(NOSET_KEY, "1");
  } catch {
    /* not remembered */
  }
  if (announce) toast(S.QE_SETTINGS_HIDDEN);
}

function wireMobileSettings() {
  R.mset.addEventListener("click", () => panelApi.panel.scrollIntoView({ behavior: reduce() ? "auto" : "smooth", block: "start" }));
  new IntersectionObserver(([entry]) => R.mset.classList.toggle("away", entry.isIntersecting), { threshold: 0.05 }).observe(panelApi.panel);
}

// ── Type menu ───────────────────────────────────────────────────────────────

let menuBtn = null;
function toggleMenu(btn, force) {
  const open = force ?? !R.menu.classList.contains("open");
  if (!open) return closeMenu();
  if (readOnly()) return;
  menuBtn = btn ?? R.cardHost.querySelector("[data-type-btn]");
  if (!menuBtn) return;
  const cur = selected().type;
  R.menu.replaceChildren(
    el("div", { class: "grp", text: S.QE_TYPE_GROUP }),
    ...TYPES.map((x) =>
      el("button", { class: `mi ${x.id === cur ? "sel" : ""}`, "data-t": x.id, role: "menuitem", type: "button" }, [
        el("span", { class: "ti" }, [svg(TYPE_ICON[x.id])]),
        el("span", {}, [el("b", { text: x.name() }), el("small", { text: x.d() })]),
        el("kbd", { text: x.k }),
      ])
    )
  );
  const r = menuBtn.getBoundingClientRect();
  R.menu.style.top = `${r.bottom + scrollY + 8}px`;
  R.menu.style.left = `${Math.max(12, Math.min(r.right + scrollX - 300, innerWidth - 312))}px`;
  R.menu.classList.add("open");
  menuBtn.setAttribute("aria-expanded", "true");
  setTimeout(() => R.menu.querySelector(".mi.sel")?.focus(), 30);
}

function closeMenu() {
  if (!R.menu?.classList.contains("open")) return;
  R.menu.classList.remove("open");
  menuBtn?.setAttribute("aria-expanded", "false");
}

function wireMenu() {
  R.menu.addEventListener("click", (e) => {
    const b = e.target.closest("[data-t]");
    if (b) setType(b.dataset.t);
  });
  R.menu.addEventListener("keydown", (e) => {
    const items = [...R.menu.querySelectorAll(".mi")];
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length].focus();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      closeMenu();
      menuBtn?.focus();
    } else {
      const x = TYPES.find((ty) => ty.k === e.key);
      if (x) {
        e.preventDefault();
        setType(x.id);
      }
    }
  });
  document.addEventListener("click", (e) => {
    if (!R.menu.contains(e.target)) closeMenu();
  });
}

// ── Shortcuts popover ───────────────────────────────────────────────────────

function shortcutsPopover() {
  const keys = (...ks) => el("span", { class: "kk" }, ks.flatMap((k, i) => (k === "–" ? [k] : [el("kbd", { text: k })])));
  const row = (label, k) => el("div", { class: "krow" }, [el("span", { text: label }), k]);
  const btn = el("button", { type: "button", class: "kbbtn", "aria-label": S.QE_SHORTCUTS, "aria-expanded": "false", "aria-controls": "qe-kbpop", title: S.QE_SHORTCUTS_TITLE }, [svg(G.keyboard)]);
  const x = el("button", { type: "button", class: "kbx", "aria-label": S.CLOSE }, [svg(G.close14)]);
  const pop = el("div", { class: "kbpop", id: "qe-kbpop", role: "dialog", "aria-label": S.QE_SHORTCUTS, hidden: true }, [
    el("div", { class: "kbh" }, [el("b", { text: S.QE_SHORTCUTS }), x]),
    el("div", { class: "kbb" }, [
      el("div", { class: "kgrp", text: S.QE_K_WRITING }),
      row(S.QE_K_NEW_OPTION, keys("Enter")),
      row(S.QE_K_NEXT, keys("Ctrl", "Enter")),
      row(S.QE_K_TYPE, keys("/")),
      row(S.QE_K_PASTE, keys("Ctrl", "V")),
      row(S.QE_K_PICK, keys("1", "–", "6")),
      el("div", { class: "kgrp", text: S.QE_K_LIST }),
      row(S.QE_K_MOVE, keys("Alt", "↑", "↓")),
      el("div", { class: "kgrp", text: S.QE_K_GENERAL }),
      row(S.QE_K_UNDO, keys("Ctrl", "Z")),
      row(S.QE_K_REDO, keys("Ctrl", "Shift", "Z")),
      row(S.QE_K_SHOW, keys("?")),
      row(S.QE_K_CLOSE, keys("Esc")),
    ]),
    el("div", { class: "kbf" }, [S.QE_K_FOOT_A, el("kbd", { text: "?" }), S.QE_K_FOOT_B]),
  ]);
  const open = (v) => {
    if (v === !pop.hidden) return;
    btn.setAttribute("aria-expanded", String(v));
    if (v) {
      pop.hidden = false;
      if (!reduce()) pop.animate([{ opacity: 0, transform: "translateY(-6px) scale(.97)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: "cubic-bezier(.2,.8,.2,1)" });
    } else if (reduce()) pop.hidden = true;
    else pop.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-4px) scale(.98)" }], { duration: 140, easing: "ease-in" }).onfinish = () => (pop.hidden = true);
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    open(pop.hidden);
  });
  x.addEventListener("click", () => {
    open(false);
    btn.focus();
  });
  document.addEventListener("click", (e) => {
    if (!pop.hidden && !e.target.closest(".kbw")) open(false);
  });
  return { node: el("div", { class: "kbw" }, [btn, pop]), open, isOpen: () => !pop.hidden, btn };
}

// ── Toast ───────────────────────────────────────────────────────────────────

let toastTimer = null;
function toast(message, action = null) {
  const node = R.toast;
  node.replaceChildren(message);
  node.classList.toggle("act", !!action);
  if (action) {
    node.appendChild(
      el("button", {
        type: "button",
        text: action.label,
        onclick: () => {
          node.classList.remove("show");
          action.fn();
        },
      })
    );
  }
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), action ? 4500 : 1800);
}

function relTime(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 10 ? S.QE_JUST_NOW : s < 60 ? t(S.QE_SEC_AGO, { n: s }) : t(S.QE_MIN_AGO, { n: Math.round(s / 60) });
}

// ── Publish ─────────────────────────────────────────────────────────────────

function onPreviewClick() {
  const ready = state.forms.filter((f) => done(f, ctx()));
  if (!ready.length) {
    R.prev.classList.remove("shk");
    void R.prev.offsetWidth;
    R.prev.classList.add("shk", "show");
    clearTimeout(R.prev._t);
    R.prev._t = setTimeout(() => R.prev.classList.remove("show"), 2800);
    jumpToFirstIncomplete();
    return;
  }
  closeMenu();
  // The quiz as it stands in the editor, settings included — saved or not.
  openPreview(R.root, state.quiz, ready.map(fromForm).map(normalizeQuestion), { user: state.user });
}

function onPublishClick() {
  if (state.isLocked) return isDirty() ? saveLockedDetails() : duplicateLocked();
  if (R.pub.getAttribute("data-locked") === "true") {
    R.pub.classList.remove("nudge");
    void R.pub.offsetWidth;
    R.pub.classList.add("nudge", "show");
    clearTimeout(R.pub._t);
    R.pub._t = setTimeout(() => R.pub.classList.remove("show"), 3200);
    if (!state.pubTried) {
      state.pubTried = true;
      renderStrip();
    }
    if (jumpToFirstIncomplete()) return;
    if (!(state.quiz.title ?? "").trim()) {
      R.title.focus();
      showIdeas(true);
    }
    return;
  }
  if (state.quiz.isDraft) publish();
  else if (isDirty()) reviewedSave("manual");
  else toast(S.QE_SAVED);
}

/**
 * The app's "Before your quiz goes out" review, on top of validation() (which stays the stricter gate and
 * runs first). Resolves true to carry on. A fix that happens in place (Mark them myself, timers on, Rapid off)
 * re-checks; a fix that sends the author to a question stops here.
 */
async function reviewSetup() {
  if (!validation().ok) return true; // save() shows what validation() blocks
  for (;;) {
    let left = false;
    const findings = reviewQuizSetup(setupSettings(state.quiz), persisted(), state.savedSettings, true);
    const result = await showSetupReview({
      findings,
      onAddQuestion: () => {
        left = true;
        addQuestion();
      },
      onEditQuestion: (id) => {
        left = true;
        select(id);
      },
      onMarkMyself: () => changeQuiz("manual", markMyself),
      onTimersOn: () => changeQuiz("timers", (q) => (q.showTimers = true)),
      onRapidOff: () => changeQuiz("rapid", (q) => (q.timeWeightageEnabled = false)),
    });
    if (result === "go") return true;
    panelApi.render();
    if (result === "back" || left) return false;
  }
}

async function reviewedSave(reason) {
  if (await reviewSetup()) return save(reason);
  return false;
}

async function publish() {
  if (!(await reviewSetup())) return;
  const ok = await confirmDialog({ title: S.CONFIRM_PUBLISH_TITLE, body: S.CONFIRM_PUBLISH_BODY, confirmLabel: S.PUBLISH, danger: false });
  if (!ok) return;
  if (await save("publish")) {
    renderAll();
    celebrate();
  }
}

function celebrate() {
  const code = state.quiz.shareCode;
  const title = (state.quiz.title ?? "").trim();
  const n = state.forms.length;
  const invite = t(S.QE_INVITE, { title, code });
  const canvas = el("canvas", { class: "conf" });
  const copyBtn = el("button", { type: "button", text: S.QE_COPY_CODE });
  const msgBtn = el("button", { type: "button", text: S.QE_COPY_MSG });
  const wa = el("a", { target: "_blank", rel: "noopener", href: `https://wa.me/?text=${encodeURIComponent(invite)}` }, [svg(G.whatsapp), S.QE_WHATSAPP]);
  const stay = el("button", { type: "button", class: "cstay", text: S.QE_STAY });
  const now = el("button", { type: "button", class: "cnow", text: S.QE_GO_DASH });
  const x = el("button", { type: "button", class: "cx", "aria-label": S.CLOSE, title: S.CLOSE }, [svg(G.close14)]);
  const box = el("div", { class: "cbox" }, [
    x,
    el("div", { class: "cok" }, [svg(G.okBig)]),
    el("h2", { text: S.QE_LIVE }),
    el("p", {}, [el("b", { text: title }), n === 1 ? S.QE_LIVE_SUB_ONE : t(S.QE_LIVE_SUB_MANY, { n })]),
    el("div", { class: "ccode" }, [
      el("small", { text: S.QE_SHARE_CODE }),
      el("div", { class: "cdig" }, [...code].map((ch, i) => el("span", { text: ch, vars: { d: `${i * 70 + 500}ms` } }))),
      el("div", { class: "cshare" }, [copyBtn, msgBtn, wa]),
    ]),
    el("div", { class: "cbtns" }, [stay, now]),
  ]);
  const overlay = el("div", { class: "celeb", role: "dialog", "aria-label": S.QE_PUBLISHED_LABEL, "aria-modal": "true" }, [canvas, box]);
  R.root.appendChild(overlay);
  confettiCanvas(canvas);
  now.focus();

  const close = () => {
    overlay.classList.add("out");
    setTimeout(() => overlay.remove(), reduce() ? 0 : 300);
  };
  function go() {
    overlay.classList.add("leaving");
    setTimeout(() => {
      document.body.classList.add("todash");
      window.location.href = route("");
    }, reduce() ? 0 : 700);
  }
  const copy = async (text, btn, label) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* the label still confirms; the code is on screen */
    }
    btn.textContent = label;
  };
  copyBtn.addEventListener("click", () => {
    track("quiz_shared", { quiz_id: state.quiz.id, method: "code_copied", from: "publish_celebration" });
    copy(code, copyBtn, S.QE_COPIED);
  });
  msgBtn.addEventListener("click", () => {
    track("quiz_shared", { quiz_id: state.quiz.id, method: "invite_copied", from: "publish_celebration" });
    copy(invite, msgBtn, S.QE_MSG_COPIED);
  });
  stay.addEventListener("click", close);
  x.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  now.addEventListener("click", go);
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}

// ── Import / bank / locked duplicate ────────────────────────────────────────

/** Unsaved edits are saved first, then /import/ adds the file's questions to this quiz. */
async function importFromFile() {
  if ((state.isNew || isDirty()) && !(await save("manual"))) return;
  window.location.href = route(`import/?quiz=${encodeURIComponent(state.quiz.id)}`);
}

function addFromBank() {
  if (readOnly()) return;
  const room = state.limits.maxQuestions - state.forms.length;
  if (room <= 0) {
    toast(t(S.QE_Q_LIMIT, { n: state.limits.maxQuestions }));
    return;
  }
  openBankPicker({
    user: state.user,
    room,
    onPick: (entries) => {
      const forms = entries.slice(0, room).map((entry) => toForm(copyForQuiz(entry, state.quiz.id)));
      if (!forms.length) return;
      changeForms(`bank-${forms[0].id}`, () => {
        // An untouched blank question makes way for what was picked.
        const blank = state.forms.length === 1 && !started(state.forms[0]);
        if (blank) state.forms = [];
        state.forms.splice(blank ? 0 : index() + 1, 0, ...forms);
        state.selectedId = forms[0].id;
        state.justAdded = forms[0].id;
      });
      renderAll();
      toast(forms.length === 1 ? S.BANK_PICKED_ONE : t(S.BANK_PICKED, { n: forms.length }));
    },
  });
}

async function duplicateLocked() {
  try {
    if ((await listMyQuizzes(state.user.id)).length >= state.limits.maxQuizzes) {
      toast(t(S.LIMIT_REACHED_QUIZZES, { n: state.limits.maxQuizzes }));
      return;
    }
    const copy = await duplicateQuiz(state.quiz.id, state.user.id, { suffix: S.COPY_SUFFIX, maxTitleChars: state.limits.maxQuizTitleChars });
    window.location.href = route(`create/?id=${encodeURIComponent(copy.id)}`);
  } catch (error) {
    console.error(error);
    toast(S.ERR_SAVE_FAILED);
  }
}

// ── Saving ──────────────────────────────────────────────────────────────────

function validation() {
  const result = validateQuiz(state.quiz, persisted(), state.limits);
  const { startAt, endAt } = state.quiz;
  if (startAt && endAt && endAt <= startAt) {
    result.quiz.push(S.SCHEDULE_END_BEFORE_START);
    result.ok = false;
  }
  return result;
}

function scheduleAutosave(delay = AUTOSAVE_MS) {
  clearTimeout(autosaveTimer);
  if (readOnly() || state.conflict || !state.quiz.isDraft || !isDirty()) return;
  autosaveTimer = setTimeout(() => save("auto"), delay);
}

/** The locked quiz: writes the title and the theme and nothing else (no rules, questions or schedule). */
async function saveLockedDetails() {
  if (state.saving || !state.isLocked || state.blocked || !isDirty()) return false;
  const title = (state.quiz.title ?? "").trim();
  if (!title || title.length > state.limits.maxQuizTitleChars) {
    toast(S.FIX_BEFORE_SAVE);
    R.title.focus();
    return false;
  }
  state.saving = true;
  refreshTop();
  const version = state.version;
  try {
    await saveTitleAndTheme(state.quiz.id, title, state.quiz.themeColorName);
    // That write moved the server's version; keep ours in step so returning to the tab isn't read as a change elsewhere.
    state.quiz.serverUpdatedAt = (await loadQuiz(state.quiz.id))?.serverUpdatedAt ?? state.quiz.serverUpdatedAt;
    state.quiz.title = title;
    state.savedVersion = version;
    state.saveError = null;
    toast(S.CHANGES_SAVED);
    return true;
  } catch (error) {
    console.error(error);
    state.saveError = S.QE_SAVE_FAILED;
    return false;
  } finally {
    state.saving = false;
    refreshTop();
  }
}

/** reason: "auto" (draft autosave), "manual" (Save / Ctrl+S / Import), "publish". */
async function save(reason) {
  clearTimeout(autosaveTimer);
  if (readOnly() || state.conflict) return false;
  if (state.saving) {
    state.saveQueued = true;
    return false;
  }
  const publishing = reason === "publish";
  const questions = persisted();

  if (publishing || !state.quiz.isDraft) {
    if (!validation().ok) {
      state.pubTried = true;
      renderStrip();
      if (!jumpToFirstIncomplete()) R.title.focus();
      toast(publishing ? S.FIX_BEFORE_PUBLISH : S.FIX_BEFORE_SAVE);
      return false;
    }
  } else if (exceedsLimits(state.quiz, questions, state.limits)) {
    state.saveError = S.ERR_TOO_LONG_TO_SAVE;
    refreshTop();
    return false;
  }
  // Nothing typed yet — don't create an empty quiz row just because the page opened.
  if (state.isNew && reason === "auto" && !(state.quiz.title ?? "").trim() && !state.forms.some(started)) {
    state.savedVersion = state.version;
    refreshTop();
    return false;
  }

  state.saving = true;
  refreshTop();
  const version = state.version;
  try {
    if (!state.quiz.shareCode) state.quiz.shareCode = await generateUniqueShareCode(state.quiz.id);
    const wasDraft = state.quiz.isDraft;
    const quiz = { ...state.quiz, isDraft: publishing ? false : state.quiz.isDraft };
    state.quiz.serverUpdatedAt = await saveQuiz(quiz, questions.map(normalizeQuestion), state.user.id, { checkLock: !state.isNew });
    state.quiz.isDraft = quiz.isDraft;
    // Publishing from the editor is a save with isDraft off, not core publishQuiz(), so the
    // funnel step is recorded here (the dashboard's Publish goes through publishQuiz()).
    if (wasDraft && !quiz.isDraft) {
      track("quiz_published", { quiz_id: quiz.id, question_count: questions.length, from: "editor" });
    }
    if (state.isNew) {
      state.isNew = false;
      window.history.replaceState(null, "", route(`create/?id=${encodeURIComponent(state.quiz.id)}`));
    }
    state.savedVersion = version;
    state.savedSettings = setupSettings(state.quiz);
    state.lastSavedAt = Date.now();
    state.saveError = null;
    if (reason === "manual" && !state.quiz.isDraft) toast(S.CHANGES_SAVED);
    return true;
  } catch (error) {
    console.error(error);
    if (error instanceof QuizLockedError) {
      state.isLocked = true;
      toast(S.QUIZ_NOW_LOCKED);
      window.location.reload();
    } else if (error instanceof QuizChangedError) {
      state.conflict = error.kind;
      renderNotices();
    } else {
      state.saveError = S.QE_SAVE_FAILED;
    }
    return false;
  } finally {
    state.saving = false;
    refreshTop();
    if (state.saveQueued) {
      state.saveQueued = false;
      scheduleAutosave(200);
    }
  }
}

// ── Keyboard ────────────────────────────────────────────────────────────────

function typing(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

document.addEventListener("keydown", (e) => {
  if (!state.quiz || !R.app || document.querySelector(".overlay, .celeb, .pvw")) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && key === "s") {
    e.preventDefault();
    if (state.isLocked) {
      if (isDirty()) saveLockedDetails();
    } else if (state.quiz.isDraft || state.isNew) {
      toast(S.QE_AUTOSAVES);
      if (isDirty()) save("auto");
    } else if (isDirty()) reviewedSave("manual");
    return;
  }
  if (e.key === "Escape") {
    if (R.kb.isOpen()) {
      R.kb.open(false);
      R.kb.btn.focus();
    } else closeMenu();
    return;
  }
  if (readOnly()) return;
  if (mod && key === "enter") {
    e.preventDefault();
    goNext();
    return;
  }
  if (typing(e.target)) return;
  if (mod && key === "z") {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if (mod && key === "y") {
    e.preventDefault();
    redo();
  } else if (e.key === "?") {
    e.preventDefault();
    R.kb.open(!R.kb.isOpen());
  } else if (e.key === "/" && !mod) {
    e.preventDefault();
    toggleMenu(null, true);
  }
});

// Back on this tab: if the quiz changed elsewhere meanwhile (the app, another tab), reload when nothing
// here is unsaved; otherwise say so now — the next save would be refused anyway.
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !state.quiz || state.isNew || state.conflict || state.saving) return;
  const fresh = await loadQuiz(state.quiz.id).catch(() => undefined);
  if (fresh === undefined || state.saving || fresh?.serverUpdatedAt === state.quiz.serverUpdatedAt) return;
  if (!isDirty()) {
    window.location.reload();
    return;
  }
  state.conflict = fresh ? "stale" : "deleted";
  clearTimeout(autosaveTimer);
  renderNotices();
});

// A draft's unsaved edits go out on the way out — through the same checked save, so a page left open
// while the quiz changed elsewhere can't overwrite it.
window.addEventListener("beforeunload", (e) => {
  if (state.quiz && isDirty() && !readOnly() && (state.quiz.isDraft ? !(state.isNew && !(state.quiz.title ?? "").trim() && !state.forms.some(started)) : true)) {
    if (state.quiz.isDraft) save("auto");
    e.preventDefault();
    e.returnValue = "";
  }
});

start();
