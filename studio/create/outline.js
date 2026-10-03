// Outline: the numbered question list. Click to select, drag (or Alt+↑/↓) to reorder, a red
// dot on questions with problems (only once the creator has tried to save/publish).

import { QUESTION_TYPES, QUESTION_TYPE_ORDER } from "../core/models.js";
import { S, t } from "../core/strings.js";
import { button, el, openMenu } from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { sentencePreview } from "./form.js";

export const TYPE_META = {
  [QUESTION_TYPES.SINGLE_CHOICE]: { iconName: "single", label: () => S.TYPE_SINGLE, sub: () => S.TYPE_SINGLE_SUB, key: "1" },
  [QUESTION_TYPES.MULTIPLE_CORRECT]: { iconName: "multiple", label: () => S.TYPE_MULTIPLE, sub: () => S.TYPE_MULTIPLE_SUB, key: "2" },
  [QUESTION_TYPES.TRUE_FALSE]: { iconName: "truefalse", label: () => S.TYPE_TRUE_FALSE, sub: () => S.TYPE_TRUE_FALSE_SUB, key: "3" },
  [QUESTION_TYPES.WRITTEN]: { iconName: "written", label: () => S.TYPE_WRITTEN, sub: () => S.TYPE_WRITTEN_SUB, key: "4" },
  [QUESTION_TYPES.FILL_BLANK]: { iconName: "blank", label: () => S.TYPE_FILL_BLANK, sub: () => S.TYPE_FILL_BLANK_SUB, key: "5" },
  [QUESTION_TYPES.POLL]: { iconName: "poll", label: () => S.TYPE_POLL, sub: () => S.TYPE_POLL_SUB, key: "6" },
};

export function typeLabel(type) {
  return TYPE_META[type]?.label() ?? type;
}

/** The first line a person would recognise the question by. */
export function questionSummary(form) {
  const text = form.type === QUESTION_TYPES.FILL_BLANK ? form.fb.title || sentencePreview(form.fb.sentence) : form.text;
  return String(text ?? "").trim().split(/\n/)[0] || S.UNTITLED_QUESTION;
}

/**
 * ctx: { forms, selectedId, errors: Map(id -> [msg]) | null, readOnly, maxQuestions,
 *        onSelect(id), onMove(from, to), onAdd(type) }
 */
export function renderOutline(ctx) {
  const list = el("ol", { class: "outline-list", "aria-label": S.QUESTIONS });
  let dragId = null;

  ctx.forms.forEach((form, index) => {
    const meta = TYPE_META[form.type];
    const hasErrors = ctx.errors?.get(form.id)?.length > 0;
    const row = el(
      "li",
      {
        class: `outline-row ${form.id === ctx.selectedId ? "is-selected" : ""} ${hasErrors ? "has-errors" : ""}`,
        "data-flip": form.id,
        draggable: ctx.readOnly ? undefined : "true",
      },
      [
        el(
          "button",
          {
            type: "button",
            class: "outline-btn",
            "aria-current": form.id === ctx.selectedId ? "true" : undefined,
            "data-fk": `outline-${form.id}`,
            onclick: () => ctx.onSelect(form.id),
          },
          [
            el("span", { class: "outline-num", text: String(index + 1) }),
            el("span", { class: "outline-type", title: meta?.label() }, [icon(meta?.iconName ?? "single", "icon icon-sm")]),
            el("span", { class: "outline-text ellipsis", dir: "auto", text: questionSummary(form) }),
            hasErrors ? el("span", { class: "outline-dot", title: S.HAS_PROBLEMS, "aria-label": S.HAS_PROBLEMS }) : null,
          ]
        ),
        ctx.readOnly ? null : el("span", { class: "outline-grip", "aria-hidden": "true" }, [icon("grip", "icon icon-sm")]),
      ]
    );

    if (!ctx.readOnly) {
      row.addEventListener("dragstart", (e) => {
        dragId = form.id;
        row.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", form.id);
      });
      row.addEventListener("dragend", () => {
        dragId = null;
        row.classList.remove("is-dragging");
        list.querySelectorAll(".drop-before, .drop-after").forEach((n) => n.classList.remove("drop-before", "drop-after"));
      });
      row.addEventListener("dragover", (e) => {
        if (!dragId || dragId === form.id) return;
        e.preventDefault();
        const rect = row.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        row.classList.toggle("drop-after", after);
        row.classList.toggle("drop-before", !after);
      });
      row.addEventListener("dragleave", () => row.classList.remove("drop-before", "drop-after"));
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        const after = row.classList.contains("drop-after");
        row.classList.remove("drop-before", "drop-after");
        if (!dragId || dragId === form.id) return;
        const from = ctx.forms.findIndex((f) => f.id === dragId);
        let to = index + (after ? 1 : 0);
        if (from < to) to -= 1;
        if (from !== to) ctx.onMove(from, to);
      });
    }
    list.appendChild(row);
  });

  const atCap = ctx.forms.length >= ctx.maxQuestions;
  const addBtn = ctx.readOnly
    ? null
    : button({
        label: S.ADD_QUESTION,
        icon: "plus",
        variant: "soft",
        cls: "btn-block",
        disabled: atCap,
        title: atCap ? t(S.QUESTION_LIMIT_REACHED, { n: ctx.maxQuestions }) : undefined,
      });
  addBtn?.addEventListener("click", () => openTypeMenu(addBtn, ctx.onAdd));

  return el("div", { class: "outline" }, [
    el("div", { class: "outline-head" }, [
      el("span", { class: "section-label", text: S.QUESTIONS }),
      el("span", { class: `counter ${atCap ? "is-near" : ""}`, text: `${ctx.forms.length} / ${ctx.maxQuestions}` }),
    ]),
    ctx.forms.length ? list : el("p", { class: "small faint outline-empty", text: S.OUTLINE_EMPTY }),
    addBtn,
  ]);
}

/** Type picker as a menu (from "+ Add question"). Audio/Video are "Soon", like the app. */
export function openTypeMenu(anchor, onAdd) {
  openMenu(anchor, [
    ...QUESTION_TYPE_ORDER.map((type) => ({
      label: TYPE_META[type].label(),
      iconName: TYPE_META[type].iconName,
      onSelect: () => onAdd(type),
    })),
    "sep",
    { label: `${S.TYPE_AUDIO} · ${S.SOON}`, iconName: "audio", disabled: true, onSelect: () => {} },
    { label: `${S.TYPE_VIDEO} · ${S.SOON}`, iconName: "video", disabled: true, onSelect: () => {} },
  ]);
}

/** The big type grid shown when a quiz has no questions yet. */
export function typeGrid(onAdd) {
  return el("div", { class: "type-grid" }, [
    ...QUESTION_TYPE_ORDER.map((type) => {
      const meta = TYPE_META[type];
      return el("button", { type: "button", class: "type-card", onclick: () => onAdd(type) }, [
        el("span", { class: "type-card-icon" }, [icon(meta.iconName)]),
        el("span", { class: "type-card-title", text: meta.label() }),
        el("span", { class: "type-card-sub", text: meta.sub() }),
        el("kbd", { class: "kbd type-card-key", text: meta.key }),
      ]);
    }),
    ...[
      ["audio", S.TYPE_AUDIO],
      ["video", S.TYPE_VIDEO],
    ].map(([iconName, label]) =>
      el("div", { class: "type-card is-soon", "aria-disabled": "true" }, [
        el("span", { class: "type-card-icon" }, [icon(iconName)]),
        el("span", { class: "type-card-title", text: label }),
        el("span", { class: "pill pill-info", text: S.SOON }),
      ])
    ),
  ]);
}
