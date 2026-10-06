// "Use in Quiz" / "Add to Quiz" — the app's two sheets (ui/bank/UseInQuizSheets.kt) as one
// dialog with two steps:
//   1. Pick a quiz: search, every quiz with its colour, status and "n/cap questions". Archived,
//      locked (people joined) and full quizzes show dimmed with the reason; clicking a locked
//      one explains and offers its participants. Ended quizzes don't appear. "Create New Quiz"
//      starts a fresh draft with the question(s) in it.
//   2. Position (one question only): the quiz's questions plus the new one, which starts at the
//      end; quick placement, ▲▼ and drag to reorder, then Confirm & Insert.
// Several questions skip step 2 and are appended in selection order, one at a time, with
// "Adding 3 / 7…" — a quiz that fills up halfway stops there and says how many made it.

import { INELIGIBLE, appendManyToQuiz, createQuizFromBank, insertIntoQuiz, plainText, selectableQuizzes, stripMarkdown } from "../core/bank.js";
import { newId, themeColor } from "../core/models.js";
import { route } from "../core/paths.js";
import { loadQuestions } from "../core/quizzes.js";
import { QUIZ_STATUS } from "../core/status.js";
import { S, t } from "../core/strings.js";
import { button, el, openDialog, pill, swap, toast } from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { flip } from "../ui/motion.js";

const STATUS_PILL = {
  [QUIZ_STATUS.DRAFT]: () => [S.STATUS_DRAFT, "draft"],
  [QUIZ_STATUS.ARCHIVED]: () => [S.STATUS_ARCHIVED, "archived"],
  [QUIZ_STATUS.SCHEDULED]: () => [S.STATUS_SCHEDULED, "scheduled"],
  [QUIZ_STATUS.ACTIVE]: () => [S.STATUS_PUBLISHED, "live"],
  [QUIZ_STATUS.IN_PROGRESS]: () => [S.STATUS_PUBLISHED, "live"],
};

const REASON = {
  [INELIGIBLE.ARCHIVED]: () => S.BANK_REASON_ARCHIVED,
  [INELIGIBLE.LOCKED]: () => S.BANK_REASON_LOCKED,
  [INELIGIBLE.AT_CAP]: () => S.BANK_REASON_FULL,
};

const FAILED = {
  [INELIGIBLE.ARCHIVED]: () => S.BANK_INSERT_FAILED_ARCHIVED,
  [INELIGIBLE.LOCKED]: () => S.BANK_INSERT_FAILED_LOCKED,
  [INELIGIBLE.AT_CAP]: () => S.BANK_INSERT_FAILED_FULL,
};

/** A one-button notice in the app's ConfirmActionDialog style. */
export function notice({ badge, badgeTone = "warn", title, body, list, actions }) {
  const dlg = openDialog({
    badge,
    badgeTone,
    title,
    content: [
      body ? el("p", { class: "dialog-body", text: body }) : null,
      list?.length ? el("ul", { class: "bk-notice-list" }, list.map((text) => el("li", { dir: "auto", text }))) : null,
    ],
    actions: actions?.((close) => dlg.close(close)) ?? [button({ label: S.BANK_OK, variant: "primary", onClick: () => dlg.close("ok") })],
  });
  return dlg;
}

/**
 * openUseInQuiz({ user, limits, entries, onLanded(ids) })
 * entries: the bank entries being added, in selection order. onLanded gets the ids that
 * actually made it into a quiz, so the page can take exactly those off the selection.
 */
export function openUseInQuiz({ user, limits, entries, onLanded }) {
  const bulk = entries.length > 1;
  const flow = {
    step: "pick",
    query: "",
    rows: null,
    loadError: false,
    selectedId: null,
    positionRows: [],
    newId: newId(),
    busy: false,
    progress: 0,
  };

  const head = el("div", { class: "uq-head" });
  const body = el("div", { class: "uq-body" });
  const foot = el("div", { class: "uq-foot" });

  const dlg = openDialog({
    cls: "uq-dialog",
    wide: true,
    content: [head, body, foot],
    beforeClose: () => !flow.busy,
  });
  dlg.node.setAttribute("aria-label", S.BANK_ADD_TITLE);

  const selectedRow = () => flow.rows?.find((r) => r.quiz.id === flow.selectedId) ?? null;

  function render() {
    if (flow.step === "pick") renderPick();
    else renderPosition();
  }

  // ── Step 1: pick a quiz ───────────────────────────────────────────────────

  function renderPick() {
    head.replaceChildren(
      el("span", { class: "uq-mark" }, [icon("plus-circle")]),
      el("div", { class: "grow" }, [
        el("h2", { text: S.BANK_ADD_TITLE }),
        el("p", { text: bulk ? t(S.BANK_ADD_SUB_BULK_MANY, { n: entries.length }) : S.BANK_ADD_SUB }),
      ]),
      closeButton()
    );

    const search = el("input", {
      class: "input",
      type: "search",
      value: flow.query,
      placeholder: S.BANK_QUIZ_SEARCH,
      "aria-label": S.BANK_QUIZ_SEARCH,
      "data-fk": "uq-search",
      oninput: (e) => {
        flow.query = e.target.value;
        renderPick();
      },
    });

    const createTile = el(
      "button",
      { type: "button", class: "uq-create", disabled: flow.busy, "data-fk": "uq-create", onclick: createNew },
      [
        el("span", { class: "uq-create-ico" }, [icon("plus")]),
        el("span", { class: "grow" }, [el("b", { text: S.BANK_CREATE_NEW_QUIZ }), el("small", { text: S.BANK_CREATE_NEW_QUIZ_SUB })]),
        icon("chevron-right", "icon"),
      ]
    );

    let list;
    if (flow.loadError) list = el("p", { class: "uq-empty", text: S.ERR_LOAD_FAILED });
    else if (!flow.rows) list = el("div", { class: "uq-loading" }, [el("div", { class: "spinner", role: "status", "aria-label": S.LOADING })]);
    else {
      const needle = flow.query.trim().toLowerCase();
      const rows = needle ? flow.rows.filter((r) => (r.quiz.title || S.UNTITLED_QUIZ).toLowerCase().includes(needle)) : flow.rows;
      list = !flow.rows.length
        ? el("p", { class: "uq-empty", text: S.BANK_NO_QUIZZES })
        : !rows.length
          ? el("p", { class: "uq-empty", text: S.BANK_NO_QUIZ_MATCHES })
          : el("div", { class: "uq-list", role: "radiogroup", "aria-label": S.BANK_ADD_TITLE }, rows.map(quizRow));
    }

    swap(body, flow.rows?.length > 5 ? el("label", { class: "bk-search uq-search" }, [icon("search"), search]) : null, createTile, list);

    const selected = selectedRow();
    const primary = bulk
      ? button({
          label: flow.busy ? t(S.BANK_ADDING_PROGRESS, { n: flow.progress, total: entries.length }) : t(S.BANK_ADD_N, { n: entries.length }),
          icon: flow.busy ? null : "plus-circle",
          variant: "primary",
          disabled: !selected || flow.busy,
          cls: flow.busy ? "is-progress" : "",
          onClick: insertBulk,
        })
      : button({ label: S.BANK_NEXT_POSITION, iconRight: "arrow-right", variant: "primary", disabled: !selected || flow.busy, onClick: toPosition });
    foot.replaceChildren(button({ label: S.CANCEL, variant: "secondary", disabled: flow.busy, onClick: () => dlg.close("cancel") }), primary);
  }

  function quizRow(row) {
    const { quiz, status, questionCount, cap, ineligible } = row;
    const [statusLabel, tone] = STATUS_PILL[status]?.() ?? [status, ""];
    const on = flow.selectedId === quiz.id;
    const locked = ineligible === INELIGIBLE.LOCKED;
    return el(
      "button",
      {
        type: "button",
        role: "radio",
        "aria-checked": on ? "true" : "false",
        "aria-disabled": ineligible && !locked ? "true" : undefined,
        class: `uq-row ${on ? "is-on" : ""} ${ineligible ? "is-off" : ""}`,
        vars: { "uq-color": themeColor(quiz.themeColorName) },
        "data-fk": `uq-row-${quiz.id}`,
        onclick: () => {
          if (flow.busy) return;
          if (locked) return lockedInfo(quiz);
          if (ineligible) return;
          flow.selectedId = quiz.id;
          renderPick();
        },
      },
      [
        el("span", { class: "uq-radio" }),
        el("span", { class: "uq-swatch", text: (quiz.title?.trim() || "?").slice(0, 1).toUpperCase() }),
        el("span", { class: "uq-row-text" }, [
          el("b", { class: "ellipsis", dir: "auto", text: quiz.title?.trim() || S.UNTITLED_QUIZ }),
          ineligible
            ? el("small", { class: "uq-reason" }, [icon(locked ? "lock" : "alert", "icon"), REASON[ineligible]()])
            : el("small", { text: t(S.BANK_QUIZ_QUESTIONS, { n: questionCount, cap }) }),
        ]),
        pill(statusLabel, tone, { dot: tone === "live" }),
      ]
    );
  }

  function lockedInfo(quiz) {
    notice({
      badge: S.BANK_LOCKED_BADGE,
      badgeTone: "danger",
      title: S.BANK_LOCKED_TITLE,
      body: S.BANK_LOCKED_BODY,
      actions: (close) => [
        button({ label: S.CANCEL, variant: "secondary", onClick: () => close("cancel") }),
        button({ label: S.BANK_LOCKED_MANAGE, icon: "users", variant: "primary", href: route(`results/?id=${encodeURIComponent(quiz.id)}`) }),
      ],
    });
  }

  // ── Step 2: position (single question) ────────────────────────────────────

  async function toPosition() {
    const row = selectedRow();
    if (!row) return;
    flow.busy = true;
    renderPick();
    try {
      const questions = await loadQuestions(row.quiz.id);
      flow.positionRows = [
        ...questions.map((q) => ({ id: q.id, text: plainText(q) || S.UNTITLED_QUESTION, isNew: false })),
        { id: flow.newId, text: plainText(entries[0]) || S.BANK_NO_QUESTION_TEXT, isNew: true },
      ];
      flow.step = "position";
    } catch (error) {
      console.error(error);
      toast(S.ERR_LOAD_FAILED, { tone: "error" });
    } finally {
      flow.busy = false;
      render();
    }
  }

  function renderPosition() {
    const row = selectedRow();
    const rows = flow.positionRows;
    const total = rows.length;
    const newIndex = rows.findIndex((r) => r.isNew);

    head.replaceChildren(
      el("button", { type: "button", class: "btn btn-ghost btn-icon", "aria-label": S.BACK, title: S.BACK, disabled: flow.busy, onclick: () => ((flow.step = "pick"), render()) }, [icon("arrow-left")]),
      el("div", { class: "grow" }, [el("h2", { text: S.BANK_POSITION_TITLE }), el("p", { text: S.BANK_POSITION_SUB })]),
      closeButton()
    );

    const list = el("ol", { class: "uq-pos" });
    let dragFrom = null;
    rows.forEach((r, i) => {
      const li = el(
        "li",
        { class: `uq-pos-row ${r.isNew ? "is-new" : ""}`, "data-flip": r.id, draggable: flow.busy ? undefined : "true" },
        [
          el("span", { class: "uq-pos-grip", "aria-hidden": "true" }, [icon("grip", "icon")]),
          el("span", { class: "uq-pos-n", text: t(S.BANK_Q_SHORT, { n: i + 1 }) }),
          el("span", { class: "uq-pos-text" }, [
            r.isNew ? el("small", { class: "uq-pos-badge", text: t(S.BANK_NEW_BADGE, { n: i + 1, total }) }) : null,
            el("span", { class: "ellipsis", dir: "auto", text: stripMarkdown(r.text) }),
          ]),
          el("span", { class: "uq-pos-arrows" }, [
            button({ label: S.MOVE_UP, icon: "arrow-up", variant: "ghost", size: "sm", iconOnly: true, disabled: i === 0 || flow.busy, onClick: () => move(i, i - 1) }),
            button({ label: S.MOVE_DOWN, icon: "arrow-down", variant: "ghost", size: "sm", iconOnly: true, disabled: i === total - 1 || flow.busy, onClick: () => move(i, i + 1) }),
          ]),
        ]
      );
      li.addEventListener("dragstart", (e) => {
        dragFrom = i;
        li.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", r.id);
      });
      li.addEventListener("dragend", () => {
        dragFrom = null;
        li.classList.remove("is-dragging");
        list.querySelectorAll(".drop-before, .drop-after").forEach((n) => n.classList.remove("drop-before", "drop-after"));
      });
      li.addEventListener("dragover", (e) => {
        if (dragFrom == null || dragFrom === i) return;
        e.preventDefault();
        const rect = li.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        li.classList.toggle("drop-after", after);
        li.classList.toggle("drop-before", !after);
      });
      li.addEventListener("dragleave", () => li.classList.remove("drop-before", "drop-after"));
      li.addEventListener("drop", (e) => {
        e.preventDefault();
        const after = li.classList.contains("drop-after");
        li.classList.remove("drop-before", "drop-after");
        if (dragFrom == null) return;
        let to = i + (after ? 1 : 0);
        if (dragFrom < to) to -= 1;
        move(dragFrom, to);
      });
      list.appendChild(li);
    });

    swap(
      body,
      el("div", { class: "uq-target", vars: { "uq-color": themeColor(row.quiz.themeColorName) } }, [
        el("span", { class: "uq-swatch", text: (row.quiz.title?.trim() || "?").slice(0, 1).toUpperCase() }),
        el("span", { class: "uq-row-text" }, [el("b", { class: "ellipsis", dir: "auto", text: row.quiz.title?.trim() || S.UNTITLED_QUIZ }), el("small", { text: total - 1 === 0 ? S.BANK_CURRENTLY_NONE : total - 1 === 1 ? S.BANK_CURRENTLY_ONE : t(S.BANK_CURRENTLY_N, { n: total - 1 }) })]),
        el("button", { type: "button", class: "link-btn", text: S.BANK_CHANGE, disabled: flow.busy, onclick: () => ((flow.step = "pick"), render()) }),
      ]),
      el("div", { class: "uq-quick" }, [
        el("span", { class: "uq-label", text: S.BANK_QUICK_PLACEMENT }),
        el("button", { type: "button", class: `bk-pill ${newIndex === total - 1 ? "is-on" : ""}`, disabled: flow.busy, onclick: () => move(newIndex, total - 1) }, [icon("arrow-down", "icon"), S.BANK_ADD_TO_END]),
        el("button", { type: "button", class: `bk-pill ${newIndex === 0 ? "is-on" : ""}`, disabled: flow.busy, onclick: () => move(newIndex, 0) }, [icon("arrow-up", "icon"), S.BANK_ADD_AS_FIRST]),
      ]),
      el("p", { class: "uq-label", text: S.BANK_REORDER_HINT }),
      list
    );

    foot.replaceChildren(
      button({ label: S.CANCEL, variant: "secondary", disabled: flow.busy, onClick: () => dlg.close("cancel") }),
      button({ label: flow.busy ? S.BANK_ADDING : S.BANK_CONFIRM_INSERT, icon: flow.busy ? null : "check", variant: "primary", disabled: flow.busy, cls: flow.busy ? "is-progress" : "", onClick: insertOne })
    );
    // Keep the new row in view when the quiz is long.
    requestAnimationFrame(() => list.querySelector(".is-new")?.scrollIntoView({ block: "nearest" }));
  }

  function move(from, to) {
    const rows = flow.positionRows;
    if (from < 0 || to < 0 || from >= rows.length || to >= rows.length || from === to) return;
    flip(body, () => {
      rows.splice(to, 0, rows.splice(from, 1)[0]);
      renderPosition();
    });
  }

  // ── Writes ────────────────────────────────────────────────────────────────

  async function insertOne() {
    if (flow.busy) return;
    flow.busy = true;
    renderPosition();
    try {
      const result = await insertIntoQuiz({
        userId: user.id,
        entry: entries[0],
        quizId: flow.selectedId,
        questionId: flow.newId,
        orderedIds: flow.positionRows.map((r) => r.id),
        limits,
      });
      flow.busy = false;
      dlg.close("done");
      if (result.ok) {
        onLanded?.([entries[0].id]);
        addedToast(result.quiz, 1);
      } else failed(result.ineligible);
    } catch (error) {
      console.error(error);
      flow.busy = false;
      renderPosition();
      toast(S.ERR_SAVE_FAILED, { tone: "error" });
    }
  }

  async function insertBulk() {
    if (flow.busy || !flow.selectedId) return;
    flow.busy = true;
    flow.progress = 0;
    renderPick();
    const quizTitle = selectedRow()?.quiz.title?.trim() || S.UNTITLED_QUIZ;
    try {
      const result = await appendManyToQuiz({
        userId: user.id,
        entries,
        quizId: flow.selectedId,
        limits,
        onProgress: (n) => {
          flow.progress = n;
          renderPick();
        },
      });
      flow.busy = false;
      dlg.close("done");
      // Only the ones that landed come off the selection; the rest stay ticked to retry.
      if (result.added) onLanded?.(entries.slice(0, result.added).map((e) => e.id));
      if (result.added === entries.length) addedToast(result.quiz, result.added);
      else if (result.added > 0) {
        notice({
          badge: S.BANK_INSERT_PARTIAL_BADGE,
          title: t(S.BANK_INSERT_PARTIAL_TITLE, { added: result.added, total: entries.length }),
          body: t(S.BANK_INSERT_PARTIAL_BODY, { added: result.added, total: entries.length, quiz: quizTitle }),
        });
      } else failed(result.ineligible);
    } catch (error) {
      console.error(error);
      flow.busy = false;
      renderPick();
      toast(S.ERR_SAVE_FAILED, { tone: "error" });
    }
  }

  async function createNew() {
    if (flow.busy) return;
    flow.busy = true;
    render();
    try {
      const result = await createQuizFromBank({ userId: user.id, entries, limits });
      flow.busy = false;
      if (result.ok) {
        dlg.close("done");
        onLanded?.(entries.map((e) => e.id), { leaving: true });
        window.location.href = route(`create/?id=${encodeURIComponent(result.quiz.id)}`);
        return;
      }
      render();
      if (result.disabled) toast(S.CREATE_DISABLED, { tone: "error" });
      else if (result.atCap) toast(t(S.BANK_TOO_MANY_FOR_QUIZ, { n: result.atCap }), { tone: "error" });
      else if (result.quizLimit) notice({ badge: S.IMP_LIMIT_QUIZZES_BADGE, title: S.IMP_LIMIT_QUIZZES_TITLE, body: S.IMP_LIMIT_QUIZZES_BODY });
    } catch (error) {
      console.error(error);
      flow.busy = false;
      render();
      toast(S.ERR_SAVE_FAILED, { tone: "error" });
    }
  }

  function failed(reason) {
    notice({ badge: S.BANK_INSERT_FAILED_BADGE, badgeTone: "danger", title: S.BANK_INSERT_FAILED_TITLE, body: (FAILED[reason] ?? FAILED[INELIGIBLE.LOCKED])() });
  }

  function addedToast(quiz, n) {
    const title = quiz?.title?.trim() || S.UNTITLED_QUIZ;
    toast(n === 1 ? t(S.BANK_ADDED_TO, { quiz: title }) : t(S.BANK_ADDED_N_TO, { n, quiz: title }), {
      tone: "success",
      duration: 6000,
      action: quiz ? { label: S.BANK_OPEN_QUIZ, onClick: () => (window.location.href = route(`create/?id=${encodeURIComponent(quiz.id)}`)) } : undefined,
    });
  }

  function closeButton() {
    return el("button", { type: "button", class: "btn btn-ghost btn-icon", "aria-label": S.CLOSE, title: S.CLOSE, disabled: flow.busy, onclick: () => dlg.close("cancel") }, [icon("x")]);
  }

  render();
  selectableQuizzes(user.id, limits)
    .then((rows) => {
      flow.rows = rows;
      // One eligible quiz? Pre-select it, as there is nothing to choose between.
      const eligible = rows.filter((r) => !r.ineligible);
      if (eligible.length === 1) flow.selectedId = eligible[0].quiz.id;
    })
    .catch((error) => {
      console.error(error);
      flow.loadError = true;
    })
    .finally(() => flow.step === "pick" && renderPick());
  return dlg;
}
