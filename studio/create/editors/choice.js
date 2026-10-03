// Single choice, Multiple correct and True/False.

import { QUESTION_TYPES } from "../../core/models.js";
import { S } from "../../core/strings.js";
import { el, switchControl } from "../../ui/components.js";
import { optionList } from "./options.js";

export function choiceEditor(ctx) {
  const form = ctx.get();
  const multi = form.type === QUESTION_TYPES.MULTIPLE_CORRECT;
  const trueFalse = form.type === QUESTION_TYPES.TRUE_FALSE;
  const manual = ctx.quiz.manualMarkingDefault;

  const parts = [optionList(ctx, { marker: multi ? "check" : "radio", fixed: trueFalse })];

  if (manual) {
    parts.push(el("p", { class: "hint-text", text: S.CORRECT_OPTIONAL_MANUAL }));
  }

  if (multi) {
    const correctCount = form.items.filter((i) => i.correct).length;
    parts.push(
      el("label", { class: "switch-row card-inset" }, [
        el("span", { class: "grow" }, [
          el("span", { class: "switch-label", text: S.ACCEPT_ANY_CORRECT_LABEL }),
          el("span", {
            class: "switch-sub",
            text: correctCount < 2 ? S.ACCEPT_ANY_NEEDS_TWO : S.ACCEPT_ANY_CORRECT_SUB,
          }),
        ]),
        switchControl({
          checked: form.acceptAnyCorrect && correctCount >= 2,
          disabled: correctCount < 2,
          label: S.ACCEPT_ANY_CORRECT_LABEL,
          fk: "accept-any",
          onChange: (on) => ctx.update("accept-any", (f) => (f.acceptAnyCorrect = on), { structural: true }),
        }),
      ])
    );
  }

  return el("div", { class: "stack" }, parts);
}
