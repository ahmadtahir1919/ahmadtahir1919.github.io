// Option rows shared by Single choice, Multiple correct, True/False and Poll.
//
// Every handler reads the LIVE form through ctx.get() / ctx.update() — never a copy captured
// at render time — so typing in one option can never reset another (the old draft's bug).
//
// Keyboard: Enter in the last option adds a new one; Backspace in an empty option removes it;
// pasting several lines into an option splits them into separate options.

import { QUESTION_TYPES } from "../../core/models.js";
import { S, t } from "../../core/strings.js";
import { button, counter, el, toast, updateCounter } from "../../ui/components.js";
import { icon } from "../../ui/icons.js";
import { item } from "../form.js";

/**
 * marker: "radio" | "check" | null (poll)
 * fixed: true for True/False (labels can't be edited, rows can't be added or removed)
 */
export function optionList(ctx, { marker, fixed = false }) {
  const form = ctx.get();
  const { maxOptions, maxOptionTextChars } = ctx.limits;
  const list = el("div", { class: "option-list", role: "list" });

  form.items.forEach((row, index) => {
    list.appendChild(optionRow(ctx, row, index, { marker, fixed, maxOptionTextChars }));
  });

  const atCap = form.items.length >= maxOptions;
  const addBtn = fixed
    ? null
    : button({
        label: S.ADD_OPTION,
        icon: "plus",
        variant: "ghost",
        size: "sm",
        disabled: atCap,
        title: atCap ? t(S.OPTION_LIMIT_REACHED, { n: maxOptions }) : undefined,
        onClick: () => addOption(ctx, form.items.length),
      });

  return el("div", { class: "stack-sm" }, [
    el("div", { class: "label-row" }, [
      el("span", { class: "label", text: marker === null ? S.POLL_CHOICES_LABEL : S.OPTIONS_LABEL }),
      el("span", { class: "counter", text: `${form.items.length} / ${maxOptions}` }),
    ]),
    marker ? el("p", { class: "hint-text", text: marker === "check" ? S.MARK_CORRECT_HINT_MULTI : S.MARK_CORRECT_HINT }) : null,
    list,
    addBtn ? el("div", { class: "row" }, [addBtn]) : null,
  ]);
}

function optionRow(ctx, row, index, { marker, fixed, maxOptionTextChars }) {
  const key = row.key;
  const findIndex = () => ctx.get().items.findIndex((i) => i.key === key);

  const markBtn = marker
    ? el(
        "button",
        {
          type: "button",
          class: `mark-toggle ${marker === "radio" ? "is-radio" : "is-check"} ${row.correct ? "is-on" : ""}`,
          role: marker === "radio" ? "radio" : "checkbox",
          "aria-checked": row.correct ? "true" : "false",
          "aria-label": S.MARK_AS_CORRECT,
          title: S.MARK_AS_CORRECT,
          "data-fk": `mark-${key}`,
          onclick: () =>
            ctx.update(
              `mark-${key}`,
              (form) => {
                const target = form.items.find((i) => i.key === key);
                if (!target) return;
                if (marker === "radio") form.items.forEach((i) => (i.correct = i.key === key));
                else target.correct = !target.correct;
              },
              { structural: true }
            ),
        },
        [icon("check")]
      )
    : el("span", { class: "option-bullet", "aria-hidden": "true", text: String(index + 1) });

  const count = counter(row.text.length, maxOptionTextChars);
  count.classList.add("option-counter");

  const input = el("input", {
    class: "input option-input",
    type: "text",
    value: row.text,
    dir: "auto",
    placeholder: t(S.OPTION_PLACEHOLDER, { n: index + 1 }),
    "aria-label": t(S.OPTION_PLACEHOLDER, { n: index + 1 }),
    readonly: fixed ? true : undefined,
    "data-fk": `opt-${key}`,
    "data-option-index": String(index),
  });

  input.addEventListener("input", () => {
    updateCounter(count, input.value.length, maxOptionTextChars);
    ctx.update(`opt-${key}`, (form) => {
      const target = form.items.find((i) => i.key === key);
      if (target) target.text = input.value;
    });
  });

  if (!fixed) {
    input.addEventListener("keydown", (e) => {
      const items = ctx.get().items;
      const at = findIndex();
      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (at === items.length - 1) addOption(ctx, at + 1);
        else focusOption(at + 1);
      } else if (e.key === "Backspace" && input.value === "" && items.length > 2) {
        e.preventDefault();
        removeOption(ctx, key, Math.max(0, at - 1));
      } else if (e.key === "ArrowDown" && at < items.length - 1) {
        e.preventDefault();
        focusOption(at + 1);
      } else if (e.key === "ArrowUp" && at > 0) {
        e.preventDefault();
        focusOption(at - 1);
      }
    });

    input.addEventListener("paste", (e) => {
      const text = e.clipboardData?.getData("text") ?? "";
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*(?:[-*•]|\(?[a-zA-Z0-9]{1,2}[.)])\s+/, "").trim())
        .filter(Boolean);
      if (lines.length < 2) return;
      e.preventDefault();
      const cap = ctx.limits.maxOptions;
      let added = 0;
      ctx.update(
        `paste-${key}`,
        (form) => {
          const at = form.items.findIndex((i) => i.key === key);
          const target = form.items[at];
          const rest = [...lines];
          if (target && !target.text.trim()) target.text = rest.shift();
          const room = Math.max(0, cap - form.items.length);
          const extra = rest.slice(0, room).map((line) => item(line));
          added = extra.length + (target ? 1 : 0);
          form.items.splice(at + 1, 0, ...extra);
        },
        { structural: true }
      );
      toast(t(S.OPTIONS_PASTED, { n: added }), { tone: "success" });
    });
  }

  const removeBtn =
    fixed
      ? null
      : button({
          label: S.REMOVE_OPTION,
          icon: "x",
          variant: "ghost",
          iconOnly: true,
          size: "sm",
          cls: "option-remove",
          disabled: ctx.get().items.length <= 2,
          onClick: () => removeOption(ctx, key, Math.max(0, findIndex() - 1)),
        });

  return el("div", { class: `option-row ${row.correct ? "is-correct" : ""}`, role: "listitem" }, [
    markBtn,
    el("div", { class: "option-field grow" }, [input, fixed ? null : count]),
    removeBtn,
  ]);
}

function addOption(ctx, at) {
  if (ctx.get().items.length >= ctx.limits.maxOptions) return;
  let key;
  ctx.update(
    "add-option",
    (form) => {
      const row = item();
      key = row.key;
      form.items.splice(at, 0, row);
    },
    { structural: true }
  );
  focusOptionByKey(key);
}

function removeOption(ctx, key, focusAt) {
  ctx.update(
    `remove-${key}`,
    (form) => {
      if (form.items.length <= 2) return;
      form.items = form.items.filter((i) => i.key !== key);
    },
    { structural: true }
  );
  focusOption(focusAt);
}

function focusOption(index) {
  requestAnimationFrame(() => document.querySelector(`[data-option-index="${index}"]`)?.focus());
}

function focusOptionByKey(key) {
  requestAnimationFrame(() => document.querySelector(`[data-fk="opt-${key}"]`)?.focus());
}

export function isTrueFalse(form) {
  return form.type === QUESTION_TYPES.TRUE_FALSE;
}
