// The Question Bank page's pieces: header + capacity meter, toolbar (search + type pills), the
// question card, the empty state and the floating selection bar. Ports of the composables in
// ui/bank/QuestionBankScreen.kt. Pure builders: they take state + handlers and return nodes.

import { answerSummary, plainText, stripMarkdown } from "../core/bank.js";
import { QUESTION_TYPES, fillBlankPlainText } from "../core/models.js";
import { S, t } from "../core/strings.js";
import { button, el, timeAgo } from "../ui/components.js";
import { emptyArt, icon } from "../ui/icons.js";
import { TYPE_META } from "../create/outline.js";

/** The short pill/chip names the app's bank uses ("MCQ", "Fill Blank"…). */
export const bankTypeLabel = (type) => S[`BANK_TYPE_${type}`] ?? type;

/** Coloured by type, like BankTypeChip. */
export function typeChip(type) {
  return el("span", { class: `bk-type bk-type-${type}` }, [icon(TYPE_META[type]?.iconName ?? "single", "icon"), el("span", { text: bankTypeLabel(type) })]);
}

/** Title, subtitle and the "n of cap" meter. */
export function header({ total, cap }) {
  const ratio = cap > 0 ? Math.min(1, total / cap) : 1;
  const left = Math.max(0, cap - total);
  const fill = el("i");
  requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = `${Math.round(ratio * 100)}%`)));
  return el("section", { class: "bk-hero" }, [
    el("span", { class: "bk-hero-mark" }, [icon("book")]),
    el("div", { class: "bk-hero-text" }, [el("h2", { text: S.BANK_TITLE }), el("p", { text: S.BANK_SUBTITLE })]),
    el("div", { class: `bk-meter ${ratio >= 1 ? "is-full" : ratio >= 0.8 ? "is-warn" : ""}` }, [
      el("div", { class: "bk-meter-top" }, [
        el("span", {}, [el("b", { text: t(S.BANK_STAT_TOTAL, { n: total, cap }) }), S.BANK_STAT_TOTAL_POST]),
        el("span", { class: "bk-meter-left", text: left ? t(S.BANK_STAT_LEFT, { n: left }) : S.BANK_STAT_FULL }),
      ]),
      el("div", { class: "bk-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(cap), "aria-valuenow": String(total), "aria-label": S.BANK_TITLE }, [fill]),
    ]),
  ]);
}

/** Search box + "All / MCQ 3 / Written 1…" pills. Clicking the active pill clears it. */
export function toolbar(state, h) {
  const search = el("input", {
    class: "input bk-search-input",
    type: "search",
    value: state.query,
    placeholder: S.BANK_SEARCH,
    "aria-label": S.BANK_SEARCH,
    "data-fk": "bank-search",
    oninput: (e) => h.onQuery(e.target.value),
  });
  const pills = state.filters.map((f) =>
    el(
      "button",
      {
        type: "button",
        class: `bk-pill ${state.type === f.type ? "is-on" : ""}`,
        "aria-pressed": state.type === f.type ? "true" : "false",
        "data-fk": `bank-pill-${f.type ?? "all"}`,
        onclick: () => h.onType(f.type),
      },
      [f.type ? icon(TYPE_META[f.type].iconName, "icon") : null, el("span", { text: f.type ? bankTypeLabel(f.type) : S.BANK_FILTER_ALL }), el("span", { class: "bk-pill-n", text: String(f.count) })]
    )
  );
  return el("div", { class: "bk-toolbar" }, [
    el("label", { class: "bk-search" }, [icon("search"), search]),
    el("div", { class: "bk-pills", role: "group", "aria-label": S.BANK_FILTER_LABEL }, pills),
  ]);
}

/** "Showing 3 of 8" + "Select all shown" — the row right above the grid. */
export function listMeta(state, h) {
  const shown = state.visible.length;
  const allShownSelected = shown > 0 && state.visible.every((e) => state.selected.includes(e.id));
  return el("div", { class: "bk-listmeta" }, [
    el("span", { text: t(S.BANK_SHOWING, { n: shown, total: state.all.length }) }),
    shown
      ? el("button", {
          type: "button",
          class: "link-btn",
          text: allShownSelected ? S.CANCEL : t(S.BANK_SELECT_ALL_SHOWN, { n: shown }),
          onclick: () => (allShownSelected ? h.onClearSelection() : h.onSelectAll()),
        })
      : null,
  ]);
}

function chips(entry) {
  const out = [typeChip(entry.type)];
  if (entry.type !== QUESTION_TYPES.POLL) {
    out.push(el("span", { class: "bk-meta bk-meta-pts" }, [icon("star", "icon"), t(entry.points === 1 ? S.BANK_CHIP_PT : S.BANK_CHIP_PTS, { n: entry.points ?? 0 })]));
  } else {
    out.push(el("span", { class: "bk-meta", text: S.BANK_NOT_SCORED }));
  }
  if (entry.timeSec > 0) out.push(el("span", { class: "bk-meta" }, [icon("clock", "icon"), t(S.BANK_CHIP_SECONDS, { n: entry.timeSec })]));
  return out;
}

function summaryLine(entry) {
  const summary = answerSummary(entry);
  if (!summary) return el("span", { class: "bk-summary is-missing" }, [icon("alert", "icon"), S.BANK_SUMMARY_NO_ANSWER]);
  const text = {
    written: () => S.BANK_SUMMARY_WRITTEN,
    fill: () => S.BANK_SUMMARY_FILL,
    poll: () => t(S.BANK_SUMMARY_POLL, { n: summary.count }),
    answer: () => (summary.more > 0 ? t(S.BANK_ANSWER_MORE, { text: summary.text, n: summary.more }) : t(S.BANK_ANSWER, { text: summary.text })),
  }[summary.kind]();
  return el("span", { class: `bk-summary ${summary.kind === "answer" ? "is-answer" : ""}`, dir: "auto" }, [summary.kind === "answer" ? icon("check-circle", "icon") : null, el("span", { class: "ellipsis", text })]);
}

/** The full answer: lettered options with the correct ones green, the written key, each blank's
 *  accepted answers, then the explanation and hint (BankAnswerBlock). */
function answerBlock(entry) {
  const rows = [];
  if (entry.type === QUESTION_TYPES.WRITTEN) {
    rows.push(
      entry.writtenAnswer?.trim()
        ? el("div", { class: "bk-ans is-correct" }, [icon("check", "icon"), el("div", { class: "grow" }, [el("small", { text: S.BANK_WRITTEN_KEY }), el("span", { dir: "auto", text: entry.writtenAnswer })])])
        : el("p", { class: "bk-note", text: S.BANK_WRITTEN_NO_KEY })
    );
  } else if (entry.type === QUESTION_TYPES.FILL_BLANK) {
    if (entry.fillBlank?.title?.trim()) rows.push(el("p", { class: "bk-sentence", dir: "auto", text: fillBlankPlainText(entry.fillBlank.template) }));
    (entry.fillBlank?.blanks ?? []).forEach((blank, i) =>
      rows.push(el("div", { class: "bk-ans is-correct" }, [icon("check", "icon"), el("span", { dir: "auto", text: t(S.BANK_BLANK_ANSWER, { n: i + 1, answers: (blank.acceptedAnswers ?? []).join(", ") }) })]))
    );
  } else {
    const correct = new Set(entry.correct ?? []);
    const poll = entry.type === QUESTION_TYPES.POLL;
    (entry.options ?? []).forEach((option, i) => {
      const ok = !poll && correct.has(option);
      rows.push(
        el("div", { class: `bk-ans ${ok ? "is-correct" : ""}` }, [
          el("span", { class: "bk-letter", text: String.fromCharCode(65 + (i % 26)) }),
          el("span", { class: "grow", dir: "auto", text: option }),
          ok ? icon("check-circle", "icon") : null,
        ])
      );
    });
  }
  if (entry.reason?.trim()) rows.push(el("div", { class: "bk-reason", dir: "auto" }, [el("span", { text: "💡" }), el("span", { text: stripMarkdown(entry.reason) })]));
  if (entry.hint?.trim()) rows.push(el("div", { class: "bk-hint", dir: "auto" }, [icon("bulb", "icon"), el("span", { text: stripMarkdown(entry.hint) })]));
  return el("div", { class: "bk-answers" }, rows);
}

/**
 * One bank entry. Click toggles the answer open — or, once anything is selected, toggles the
 * selection, the same "click = the mode you're in" rule the app's card follows.
 * opts: { selected, open, selectionMode, picker } — picker = the builder's compact list.
 */
export function questionCard(entry, opts, h) {
  const text = plainText(entry) || S.BANK_NO_QUESTION_TEXT;
  const check = el(
    "button",
    {
      type: "button",
      class: "bk-check",
      role: "checkbox",
      "aria-checked": opts.selected ? "true" : "false",
      "aria-label": opts.selected ? S.BANK_DESELECT : S.BANK_SELECT,
      title: opts.selected ? S.BANK_DESELECT : S.BANK_SELECT,
      "data-fk": `bank-check-${entry.id}`,
      onclick: (e) => {
        e.stopPropagation();
        h.onToggleSelect(entry.id, e.shiftKey);
      },
    },
    [icon("check", "icon")]
  );

  const toggle = el(
    "button",
    {
      type: "button",
      class: "bk-chevron",
      "aria-expanded": opts.open ? "true" : "false",
      "aria-label": opts.open ? S.BANK_COLLAPSE : S.BANK_EXPAND,
      title: opts.open ? S.BANK_COLLAPSE : S.BANK_EXPAND,
      onclick: (e) => {
        e.stopPropagation();
        h.onToggleOpen(entry.id);
      },
    },
    [icon("chevron-down", "icon")]
  );

  const actions = opts.picker
    ? null
    : el("div", { class: "bk-actions" }, [
        button({ label: S.BANK_USE_IN_QUIZ, icon: "plus-circle", variant: opts.open ? "primary" : "soft", size: "sm", cls: "bk-use", onClick: (e) => (e.stopPropagation(), h.onUseInQuiz(entry.id)) }),
        el("span", { class: "grow" }),
        opts.open ? el("span", { class: "bk-date", text: t(S.BANK_ADDED_ON, { when: timeAgo(entry.createdAt) }) }) : null,
        button({ label: S.BANK_EDIT, icon: "pencil", variant: "ghost", size: "sm", iconOnly: true, onClick: (e) => (e.stopPropagation(), h.onEdit(entry.id)) }),
        button({ label: S.BANK_DELETE, icon: "trash", variant: "danger-ghost", size: "sm", iconOnly: true, onClick: (e) => (e.stopPropagation(), h.onDelete(entry.id)) }),
      ]);

  const card = el(
    "article",
    {
      class: `bk-card ${opts.selected ? "is-selected" : ""} ${opts.open ? "is-open" : ""} ${opts.picker ? "is-picker" : ""}`,
      "data-id": entry.id,
      "data-flip": entry.id,
      tabindex: "0",
      "aria-label": text,
    },
    [
      el("div", { class: "bk-card-head" }, [check, el("div", { class: "bk-chips" }, chips(entry)), toggle]),
      el("h3", { class: "bk-q", dir: "auto", text }),
      opts.open ? answerBlock(entry) : el("div", { class: "bk-card-sum" }, [summaryLine(entry)]),
      actions,
    ]
  );
  const activate = () => (opts.selectionMode ? h.onToggleSelect(entry.id) : h.onToggleOpen(entry.id));
  card.addEventListener("click", (e) => {
    if (e.target.closest("button, a, input") || window.getSelection()?.toString()) return;
    activate();
  });
  card.addEventListener("keydown", (e) => {
    if (e.target !== card) return;
    if (e.key === "Enter") {
      e.preventDefault();
      activate();
    } else if (e.key === " ") {
      e.preventDefault();
      h.onToggleSelect(entry.id);
    }
  });
  return card;
}

/** First run: the illustration, the pitch, two ways in, and what you can do with it. */
export function emptyView(h) {
  return el("section", { class: "bk-empty" }, [
    emptyArt("bank"),
    el("h2", { text: S.BANK_EMPTY_TITLE }),
    el("p", { text: S.BANK_EMPTY_BODY }),
    el("div", { class: "bk-empty-actions" }, [
      button({ label: S.BANK_CREATE_FIRST, icon: "plus-circle", variant: "primary", size: "lg", onClick: h.onCreate }),
      button({ label: S.BANK_IMPORT_QUESTIONS, icon: "upload", variant: "secondary", size: "lg", onClick: h.onImport }),
    ]),
    el(
      "ul",
      { class: "bk-empty-tips" },
      [
        ["sparkles", S.BANK_EMPTY_TIP_1],
        ["upload", S.BANK_EMPTY_TIP_2],
        ["plus-circle", S.BANK_EMPTY_TIP_3],
      ].map(([name, text]) => el("li", {}, [el("span", { class: "bk-tip-ico" }, [icon(name)]), el("span", { text })]))
    ),
  ]);
}

/** A search / pill combination that matches nothing (the bank itself isn't empty). */
export function noMatches(h) {
  return el("div", { class: "bk-nomatch" }, [
    el("span", { class: "bk-nomatch-ico" }, [icon("search")]),
    el("h3", { text: S.BANK_NO_MATCHES }),
    el("p", { text: S.BANK_NO_MATCHES_BODY }),
    button({ label: S.BANK_CLEAR_FILTERS, variant: "secondary", size: "sm", onClick: h.onClearFilters }),
  ]);
}

/** Floating bar while questions are ticked: count, delete, cancel, Add to Quiz. */
export function selectionBar(state, h) {
  const n = state.selected.length;
  return el("div", { class: "bk-selbar", role: "region", "aria-label": t(S.BANK_N_SELECTED, { n }) }, [
    el("span", { class: "bk-selbar-n" }, [el("b", { text: String(n) }), el("span", { text: t(S.BANK_N_SELECTED, { n }).replace(/^\d+\s*/, "") })]),
    el("span", { class: "grow" }),
    button({ label: S.CANCEL, variant: "ghost", size: "sm", onClick: h.onClearSelection }),
    button({ label: S.BANK_DELETE, icon: "trash", variant: "danger-ghost", size: "sm", onClick: h.onBulkDelete }),
    button({ label: t(S.BANK_ADD_TO_QUIZ_N, { n }), icon: "plus-circle", variant: "primary", size: "sm", onClick: h.onAddSelected }),
  ]);
}
