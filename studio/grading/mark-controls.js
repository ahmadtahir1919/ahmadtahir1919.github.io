// The marking controls shared by "mark one person" and "mark by question": the three verdict
// buttons, the number field, slider and presets — all kept in sync.
//
// Rules (GradeSubmissionViewModel / GradeByQuestionViewModel): Correct = full marks (1 on a
// no-marks question), Partial = half rounded up (only when max >= 2), Incorrect = 0. Whole
// numbers only; anything above the max snaps to the max.

import { VERDICT, verdictMark, verdictOf } from "../core/scoring.js";
import { S } from "../core/strings.js";
import { el, kbd } from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { pop } from "../ui/motion.js";

/**
 * markControls({ max, mark, onChange(mark|null), compact, keyHints })
 * Returns { node, setMark(mark) } — setMark updates every control without re-rendering.
 */
export function markControls({ max, mark, onChange, compact = false, keyHints = true, fkPrefix = "mark" }) {
  let current = mark;
  const hasMarks = max > 0;

  const verdictBtn = (verdict, label, iconName, key, tone) => {
    const btn = el(
      "button",
      {
        type: "button",
        class: `verdict-btn verdict-${tone}`,
        "aria-pressed": "false",
        "data-verdict": verdict,
        "data-fk": `${fkPrefix}-${verdict}`,
        onclick: () => set(verdictMark(verdict, max)),
      },
      [icon(iconName), el("span", { text: label }), keyHints ? kbd(key) : null]
    );
    return btn;
  };

  const buttons = [
    verdictBtn(VERDICT.CORRECT, S.VERDICT_CORRECT, "check-circle", "C", "correct"),
    hasMarks && max >= 2 ? verdictBtn(VERDICT.PARTIAL, S.VERDICT_PARTIAL, "half-circle", "P", "partial") : null,
    verdictBtn(VERDICT.INCORRECT, S.VERDICT_INCORRECT, "x-circle", "X", "incorrect"),
  ].filter(Boolean);

  let number = null;
  let slider = null;
  let presets = null;
  if (hasMarks) {
    number = el("input", {
      class: "input input-number mark-number",
      type: "number",
      inputmode: "numeric",
      min: "0",
      max: String(max),
      step: "1",
      "aria-label": S.MARKS_AWARDED,
      "data-fk": `${fkPrefix}-number`,
      "data-mark-input": "true",
    });
    number.addEventListener("input", () => {
      if (number.value === "") return set(null, { from: "number" });
      set(Math.round(Number(number.value) || 0), { from: "number" });
    });
    number.addEventListener("blur", () => sync());

    slider = el("input", { class: "range mark-slider", type: "range", min: "0", max: String(max), step: "1", "aria-label": S.MARKS_AWARDED });
    slider.addEventListener("input", () => set(Number(slider.value), { from: "slider" }));

    presets = el(
      "div",
      { class: "row row-wrap mark-presets" },
      [0, 25, 50, 75, 100].map((pct) =>
        el("button", {
          type: "button",
          class: "chip chip-sm",
          text: `${pct}%`,
          onclick: () => set(Math.round((max * pct) / 100)),
        })
      )
    );
  }

  function set(value, { from } = {}) {
    let next = value;
    if (next !== null && next !== undefined) {
      next = Math.max(0, Math.min(Math.round(next), hasMarks ? max : 1));
    } else next = null;
    current = next;
    sync(from);
    onChange(next);
  }

  function sync(from) {
    const verdict = verdictOf(current, max);
    for (const btn of buttons) {
      const on = btn.dataset.verdict === verdict;
      if (on && btn.getAttribute("aria-pressed") !== "true") pop(btn);
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    if (number && from !== "number") number.value = current == null ? "" : String(current);
    if (slider && from !== "slider") slider.value = String(current ?? 0);
    slider?.classList.toggle("is-unset", current == null);
  }

  const node = el("div", { class: `mark-controls ${compact ? "is-compact" : ""}` }, [
    el("div", { class: "verdict-row" }, buttons),
    hasMarks
      ? el("div", { class: "mark-row" }, [
          el("div", { class: "row mark-number-wrap" }, [number, el("span", { class: "mark-of", text: `/ ${max}` })]),
          compact ? null : el("div", { class: "grow mark-slider-wrap" }, [slider]),
          compact ? null : presets,
        ])
      : el("p", { class: "hint-text", text: S.NO_MARKS_QUESTION }),
  ]);
  sync();

  return {
    node,
    setMark(value) {
      current = value;
      sync();
    },
    focusNumber(digit) {
      if (!number) return false;
      number.focus();
      if (digit !== undefined) {
        number.value = digit;
        number.dispatchEvent(new Event("input"));
      }
      return true;
    },
    applyVerdict(verdict) {
      const value = verdictMark(verdict, max);
      if (value === null) return;
      set(value);
    },
  };
}

/** A small read-only verdict marker for lists. */
export function verdictBadge(mark, max, { pending = false } = {}) {
  if (pending || mark == null) return el("span", { class: "vbadge is-pending", title: S.STATUS_TO_MARK }, [el("span", { class: "dot is-warn" })]);
  const verdict = verdictOf(mark, max);
  const map = {
    [VERDICT.CORRECT]: ["check", "is-correct", S.VERDICT_CORRECT],
    [VERDICT.PARTIAL]: ["half-circle", "is-partial", S.VERDICT_PARTIAL],
    [VERDICT.INCORRECT]: ["x", "is-incorrect", S.VERDICT_INCORRECT],
  };
  const [iconName, cls, label] = map[verdict];
  return el("span", { class: `vbadge ${cls}`, title: label, "aria-label": label }, [icon(iconName, "icon icon-sm")]);
}

/** "7 / 10" for a marks question, "Correct"/"Incorrect" for a no-marks one, "—" pending. */
export function markText(mark, max) {
  if (mark == null) return "—";
  if (max > 0) return `${mark} / ${max}`;
  return mark > 0 ? S.VERDICT_CORRECT : S.VERDICT_INCORRECT;
}
