// /bank/ — the Question Bank, a port of the app's ui/bank/QuestionBankScreen.kt +
// QuestionBankViewModel.kt. A personal library of reusable questions (bank_questions), the same
// one the app shows:
//   • browse: search + type pills (AND), click a card for its full answer;
//   • create / edit in a side drawer (bank-editor.js) — the cap applies to creating only;
//   • delete one, or tick several and delete / Add to Quiz together (use-in-quiz.js);
//   • import from a file (/import/?target=bank) or from your own quizzes, export .txt / .csv.
// Back from /import/ with ?imported=n, it says how many arrived.

import { deleteFromBank, filterBank, listMyBank, typeFilters } from "../core/bank.js";
import { requireUser } from "../core/auth.js";
import { fetchLimits } from "../core/limits.js";
import { route } from "../core/paths.js";
import { S, t } from "../core/strings.js";
import { button, confirmDialog, el, menuButton, errorBlock, loadingBlock, renderSignInGate, renderSpinner, swap, toast } from "../ui/components.js";
import { stagger } from "../ui/motion.js";
import { mountShell } from "../ui/shell.js";
import { openBankEditor } from "./bank-editor.js";
import { bankFull, openExport, openHelp, openImportSource } from "./bank-dialogs.js";
import * as V from "./bank-views.js";
import { openUseInQuiz } from "./use-in-quiz.js";

const root = document.getElementById("root");
const params = new URLSearchParams(window.location.search);

const state = {
  user: null,
  limits: null,
  all: [],
  visible: [],
  filters: [],
  query: "",
  type: null,
  open: new Set(),
  /** Ticked ids in the order they were ticked — bulk "Add to Quiz" appends in this order. */
  selected: [],
  lastTicked: null,
};

let shell = null;
let region = null;
let firstPaint = true;

const isFull = () => state.all.length >= state.limits.maxBankQuestions;
const entryById = (id) => state.all.find((e) => e.id === id);

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
    active: "bank",
    title: S.BANK_TITLE,
    crumbs: [{ label: S.NAV_DASHBOARD, href: route("") }, { label: S.BANK_TITLE }],
    width: "wide",
  });
  shell.content.classList.add("bk-page");
  shell.content.replaceChildren(loadingBlock());
  await load();

  const imported = Number(params.get("imported"));
  if (imported > 0) {
    toast(imported === 1 ? S.BANK_IMPORTED_ONE : t(S.BANK_IMPORTED_MANY, { n: imported }), { tone: "success" });
    window.history.replaceState(null, "", route("bank/"));
  }
}

async function load() {
  try {
    const [limits, all] = await Promise.all([state.limits ? state.limits : fetchLimits(), listMyBank(state.user.id)]);
    state.limits = limits;
    state.all = all;
    // Anything deleted elsewhere drops out of the selection and the open set.
    const ids = new Set(all.map((e) => e.id));
    state.selected = state.selected.filter((id) => ids.has(id));
    state.open = new Set([...state.open].filter((id) => ids.has(id)));
    render();
  } catch (error) {
    console.error(error);
    shell.content.replaceChildren(errorBlock(S.ERR_LOAD_FAILED, load));
  }
}

// ── Render ──────────────────────────────────────────────────────────────────

function render() {
  state.filters = typeFilters(state.all);
  // A pill whose type has gone (its last question deleted) falls back to All.
  if (state.type && !state.filters.some((f) => f.type === state.type)) state.type = null;
  state.visible = filterBank(state.all, { query: state.query, type: state.type });
  renderActions();

  if (!state.all.length) {
    swap(shell.content, V.emptyView(handlers));
    firstPaint = true;
    return;
  }

  if (!region || !shell.content.contains(region)) {
    region = el("div", { class: "bk-grid" });
    shell.content.replaceChildren(
      V.header({ total: state.all.length, cap: state.limits.maxBankQuestions }),
      el("div", { class: "bk-sticky" }),
      el("div", { class: "bk-meta-row" }),
      region,
      el("div", { class: "bk-selbar-slot" })
    );
  } else {
    shell.content.querySelector(".bk-hero").replaceWith(V.header({ total: state.all.length, cap: state.limits.maxBankQuestions }));
  }
  swap(shell.content.querySelector(".bk-sticky"), V.toolbar(state, handlers));
  swap(shell.content.querySelector(".bk-meta-row"), V.listMeta(state, handlers));

  const selectionMode = state.selected.length > 0;
  swap(
    region,
    ...(state.visible.length
      ? state.visible.map((entry) =>
          V.questionCard(entry, { selected: state.selected.includes(entry.id), open: state.open.has(entry.id), selectionMode }, handlers)
        )
      : [V.noMatches(handlers)])
  );
  region.classList.toggle("is-empty", !state.visible.length);
  if (firstPaint) {
    stagger(region);
    firstPaint = false;
  }

  const slot = shell.content.querySelector(".bk-selbar-slot");
  slot.replaceChildren(selectionMode ? V.selectionBar(state, handlers) : "");
  shell.content.classList.toggle("has-selection", selectionMode);
}

function renderActions() {
  const empty = !state.all.length;
  shell.setTitle(state.selected.length ? t(S.BANK_N_SELECTED, { n: state.selected.length }) : S.BANK_TITLE);
  shell.setActions([
    button({ label: S.BANK_HELP, icon: "help", variant: "ghost", iconOnly: true, cls: empty ? "" : "hide-phone", onClick: openHelp }),
    empty ? null : button({ label: S.BANK_EXPORT, icon: "download", variant: "ghost", cls: "hide-phone", onClick: () => openExport(state.all) }),
    empty ? null : button({ label: S.BANK_IMPORT, icon: "upload", variant: "secondary", cls: "hide-phone", onClick: handlers.onImport }),
    empty ? null : button({ label: S.BANK_CREATE, icon: "plus", variant: "primary", onClick: handlers.onCreate }),
    // Phones have no room for Import / Export buttons — the app keeps them in its ⋮ menu too.
    empty
      ? null
      : (() => {
          const more = menuButton(() => [
            { label: S.BANK_IMPORT_QUESTIONS, iconName: "upload", onSelect: handlers.onImport },
            { label: S.BANK_EXPORT_TITLE, iconName: "download", onSelect: () => openExport(state.all) },
            "sep",
            { label: S.BANK_HELP, iconName: "help", onSelect: openHelp },
          ]);
          more.classList.add("show-phone");
          return more;
        })(),
  ]);
}

// ── Handlers ────────────────────────────────────────────────────────────────

const handlers = {
  onQuery(value) {
    state.query = value;
    render();
  },
  onType(type) {
    // Clicking the active pill again clears it, so "All" is always one click away.
    state.type = state.type === type ? null : type;
    render();
  },
  onClearFilters() {
    state.query = "";
    state.type = null;
    render();
    shell.content.querySelector('[data-fk="bank-search"]')?.focus();
  },
  onToggleOpen(id) {
    if (state.open.has(id)) state.open.delete(id);
    else state.open.add(id);
    render();
  },
  /** Shift+click ticks the whole run between the last ticked card and this one. */
  onToggleSelect(id, range = false) {
    if (range && state.lastTicked && state.lastTicked !== id) {
      const ids = state.visible.map((e) => e.id);
      const [a, b] = [ids.indexOf(state.lastTicked), ids.indexOf(id)].sort((x, y) => x - y);
      if (a >= 0 && b >= 0) {
        for (const each of ids.slice(a, b + 1)) if (!state.selected.includes(each)) state.selected.push(each);
        state.lastTicked = id;
        render();
        return;
      }
    }
    state.selected = state.selected.includes(id) ? state.selected.filter((x) => x !== id) : [...state.selected, id];
    state.lastTicked = id;
    render();
  },
  onSelectAll() {
    for (const entry of state.visible) if (!state.selected.includes(entry.id)) state.selected.push(entry.id);
    render();
  },
  onClearSelection() {
    state.selected = [];
    state.lastTicked = null;
    render();
  },
  /** Create and Import both refuse at the cap rather than letting someone type a question
   *  that can't be saved. */
  onCreate() {
    if (isFull()) return bankFull(state.limits.maxBankQuestions);
    openBankEditor({ user: state.user, limits: state.limits, onSaved: afterSave, onFull: (n) => bankFull(n) });
  },
  onImport() {
    if (isFull()) return bankFull(state.limits.maxBankQuestions);
    openImportSource({ user: state.user, limits: state.limits, bank: state.all, onImported: () => load() });
  },
  onEdit(id) {
    const entry = entryById(id);
    if (entry) openBankEditor({ user: state.user, limits: state.limits, entry, onSaved: afterSave, onFull: (n) => bankFull(n) });
  },
  async onDelete(id) {
    const ok = await confirmDialog({ badge: S.BANK_DELETE_BADGE, title: S.BANK_DELETE_TITLE, body: S.BANK_DELETE_BODY, confirmLabel: S.BANK_DELETE });
    if (!ok) return;
    await remove([id]);
  },
  async onBulkDelete() {
    const n = state.selected.length;
    if (!n) return;
    const ok = await confirmDialog({
      badge: S.BANK_DELETE_BADGE,
      title: n === 1 ? S.BANK_DELETE_BULK_TITLE_ONE : t(S.BANK_DELETE_BULK_TITLE_MANY, { n }),
      body: S.BANK_DELETE_BULK_BODY,
      confirmLabel: S.BANK_DELETE,
    });
    if (!ok) return;
    await remove([...state.selected]);
  },
  onUseInQuiz(id) {
    const entry = entryById(id);
    if (entry) addToQuiz([entry]);
  },
  onAddSelected() {
    const entries = state.selected.map(entryById).filter(Boolean);
    if (entries.length) addToQuiz(entries);
  },
};

function addToQuiz(entries) {
  openUseInQuiz({
    user: state.user,
    limits: state.limits,
    entries,
    onLanded: (ids) => {
      state.selected = state.selected.filter((id) => !ids.includes(id));
      render();
    },
  });
}

async function afterSave(question, isNew) {
  // A new entry goes to the top; clear filters that would hide it so it can be seen landing.
  if (isNew && (state.query || (state.type && state.type !== question.type))) {
    state.query = "";
    state.type = null;
  }
  state.open.add(question.id);
  await load();
  shell.content.querySelector(`.bk-card[data-id="${CSS.escape(question.id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function remove(ids) {
  try {
    await deleteFromBank(ids);
    state.selected = state.selected.filter((id) => !ids.includes(id));
    toast(ids.length === 1 ? S.BANK_DELETED_ONE : t(S.BANK_DELETED_MANY, { n: ids.length }), { tone: "success" });
    await load();
  } catch (error) {
    console.error(error);
    toast(S.ERR_SAVE_FAILED, { tone: "error" });
  }
}

// ── Keyboard + leaving ──────────────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  if (!state.limits || document.querySelector(".overlay")) return;
  const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
  if (e.key === "Escape" && state.selected.length && !typing) handlers.onClearSelection();
  else if (e.key === "/" && !typing) {
    e.preventDefault();
    shell.content.querySelector('[data-fk="bank-search"]')?.focus();
  } else if (e.key.toLowerCase() === "n" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    handlers.onCreate();
  }
});

// The app asks before a back press drops a selection; the web's equivalent is the browser's
// own "leave this page?" — nothing is added to a quiz until one is chosen.
window.addEventListener("beforeunload", (e) => {
  if (state.selected.length) {
    e.preventDefault();
    e.returnValue = "";
  }
});

start();
