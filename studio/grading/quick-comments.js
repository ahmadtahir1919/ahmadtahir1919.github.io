// Quick-comment chips for per-answer feedback: five built-ins plus the owner's own (max 10,
// each ≤ 100 chars, newest first), stored in localStorage. Same rules as the app's
// appendQuickComment / addQuickComment (GradeSubmissionViewModel.kt).

import { GRADE_FEEDBACK_MAX_CHARS } from "../core/scoring.js";
import { S } from "../core/strings.js";
import { el, toast } from "../ui/components.js";
import { icon } from "../ui/icons.js";

const KEY = "quizoma.studio.quickComments";
const MAX_SAVED = 10;
const MAX_CHARS = 100;

function saved() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function store(list) {
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_SAVED)));
}

/** [chip] appended to [current] with one space; unchanged if already there or over the cap. */
export function appendQuickComment(current, chip) {
  if (!chip.trim() || current.includes(chip)) return current;
  const sep = !current || /\s$/.test(current) ? "" : " ";
  const result = current + sep + chip;
  return result.length > GRADE_FEEDBACK_MAX_CHARS ? current : result;
}

export function quickComments({ getText, setText }) {
  const wrap = el("div", { class: "row row-wrap quick-comments" });

  const render = () => {
    const builtIn = [S.QC_WELL_EXPLAINED, S.QC_PARTLY_CORRECT, S.QC_INCOMPLETE, S.QC_CHECK_SPELLING, S.QC_OFF_TOPIC];
    const mine = saved();
    wrap.replaceChildren(
      ...[...mine, ...builtIn.filter((b) => !mine.includes(b))].map((text) =>
        el("span", { class: "chip chip-sm qc-chip" }, [
          el("button", { type: "button", class: "qc-add", dir: "auto", text, onclick: () => setText(appendQuickComment(getText(), text)) }),
          mine.includes(text)
            ? el(
                "button",
                {
                  type: "button",
                  class: "chip-remove",
                  "aria-label": S.REMOVE_QUICK_COMMENT,
                  title: S.REMOVE_QUICK_COMMENT,
                  onclick: () => {
                    store(saved().filter((x) => x !== text));
                    render();
                  },
                },
                [icon("x", "icon icon-sm")]
              )
            : null,
        ])
      ),
      el(
        "button",
        {
          type: "button",
          class: "chip chip-sm chip-ghost",
          title: S.SAVE_QUICK_COMMENT_HINT,
          onclick: () => {
            const text = getText().trim();
            if (!text) return;
            if (text.length > MAX_CHARS) {
              toast(S.QUICK_COMMENT_TOO_LONG, { tone: "error" });
              return;
            }
            store([text, ...saved().filter((x) => x !== text)]);
            render();
            toast(S.QUICK_COMMENT_SAVED, { tone: "success" });
          },
        },
        [icon("plus", "icon icon-sm"), S.SAVE_QUICK_COMMENT]
      )
    );
  };
  render();
  return wrap;
}
