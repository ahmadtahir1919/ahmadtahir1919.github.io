// Centre pane: the selected question — header (number, type switcher, actions), the question
// text, and the type's own editor. Read-only (a locked quiz) wraps everything in a disabled
// <fieldset>, so every control is inert without each editor having to know.

import { QUESTION_TYPES, QUESTION_TYPE_ORDER } from "../core/models.js";
import { S, t } from "../core/strings.js";
import { counter, el, menuButton, updateCounter } from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { choiceEditor } from "./editors/choice.js";
import { fillBlankEditor } from "./editors/fill-blank.js";
import { pollEditor } from "./editors/poll.js";
import { writtenEditor } from "./editors/written.js";
import { TYPE_META } from "./outline.js";

/**
 * opts: { ctx (get/update/limits/quiz), index, total, readOnly, errors: [msg],
 *         onChangeType(type), onDuplicate(), onMove(delta), onDelete(), canAdd,
 *         kicker (replaces "Question n of m"), standalone (no ⋮ menu — the Question Bank's
 *         editor holds one question, so duplicate/move/delete mean nothing there) }
 * Returns { node, errorsNode }.
 */
export function editorPane(opts) {
  const { ctx, index, total, readOnly } = opts;
  const form = ctx.get();
  const meta = TYPE_META[form.type];

  const typeSelect = el(
    "select",
    { class: "select type-select", "aria-label": S.QUESTION_TYPE, "data-fk": "type-select" },
    QUESTION_TYPE_ORDER.map((type) => el("option", { value: type, text: TYPE_META[type].label(), selected: type === form.type }))
  );
  typeSelect.addEventListener("change", () => opts.onChangeType(typeSelect.value));

  const actions = menuButton(() => [
    { label: S.DUPLICATE_QUESTION, iconName: "copy", disabled: !opts.canAdd, onSelect: opts.onDuplicate },
    { label: S.MOVE_UP, iconName: "arrow-up", disabled: index === 0, onSelect: () => opts.onMove(-1) },
    { label: S.MOVE_DOWN, iconName: "arrow-down", disabled: index === total - 1, onSelect: () => opts.onMove(1) },
    "sep",
    { label: S.DELETE_QUESTION, iconName: "trash", danger: true, onSelect: opts.onDelete },
  ]);

  const head = el("div", { class: "editor-head" }, [
    el("span", { class: "editor-type-icon" }, [icon(meta.iconName)]),
    el("div", { class: "grow" }, [
      el("div", { class: "editor-kicker", text: opts.kicker ?? t(S.QUESTION_N_OF, { n: index + 1, total }) }),
      el("div", { class: "editor-type-name", text: meta.label() }),
    ]),
    readOnly ? null : typeSelect,
    readOnly || opts.standalone ? null : actions,
  ]);

  const errorsNode = el("div", { class: "editor-errors" });
  fillErrors(errorsNode, opts.errors);

  const body = [];
  if (form.type !== QUESTION_TYPES.FILL_BLANK) body.push(questionText(ctx));
  body.push(typeEditor(ctx, form.type));

  const fieldset = el("fieldset", { class: "editor-fields", disabled: readOnly }, body);

  return {
    node: el("article", { class: "card editor-card" }, [head, errorsNode, fieldset]),
    errorsNode,
  };
}

export function fillErrors(node, errors) {
  if (!errors?.length) {
    node.replaceChildren();
    return;
  }
  node.replaceChildren(
    el("div", { class: "banner banner-error", role: "alert" }, [
      icon("alert"),
      el("ul", { class: "error-list" }, errors.map((message) => el("li", { text: message }))),
    ])
  );
}

function questionText(ctx) {
  const max = ctx.limits.maxQuestionTextChars;
  const form = ctx.get();
  const count = counter(form.text.length, max);
  const area = el("textarea", {
    class: "textarea question-input",
    rows: "2",
    dir: "auto",
    value: form.text,
    placeholder: S.QUESTION_TEXT_PLACEHOLDER,
    "aria-label": S.QUESTION_TEXT_LABEL,
    "data-fk": "question-text",
  });
  const grow = () => {
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight + 2, 320)}px`;
  };
  area.addEventListener("input", () => {
    updateCounter(count, area.value.length, max);
    grow();
    ctx.update("question-text", (f) => (f.text = area.value));
  });
  requestAnimationFrame(grow);
  return el("div", { class: "field" }, [
    el("div", { class: "label-row" }, [el("label", { class: "label", text: S.QUESTION_TEXT_LABEL }), count]),
    area,
  ]);
}

function typeEditor(ctx, type) {
  switch (type) {
    case QUESTION_TYPES.WRITTEN:
      return writtenEditor(ctx);
    case QUESTION_TYPES.FILL_BLANK:
      return fillBlankEditor(ctx);
    case QUESTION_TYPES.POLL:
      return pollEditor(ctx);
    default:
      return choiceEditor(ctx);
  }
}

/** Placeholder card when there are no questions yet. */
export function emptyEditor(grid) {
  return el("article", { class: "card editor-card editor-empty" }, [
    el("div", { class: "stack-sm" }, [el("h2", { text: S.NO_QUESTIONS_TITLE }), el("p", { class: "muted", text: S.NO_QUESTIONS_BODY })]),
    grid,
  ]);
}
