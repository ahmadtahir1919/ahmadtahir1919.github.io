// The setup review dialog — Studio's copy of the app's SetupReviewSheet findings ("Before your quiz goes out"):
// what the quiz's settings will actually do to the questions the author wrote. The findings come from
// core/rules.js reviewQuizSetup (pinned to the app's QuizSetupReview.kt by shared tables); the words are the
// app's (webtest/text-parity.test.mjs).
//
// Studio's own blocking validation (core/validate.js: title, questions, missing keys) still runs first and is
// stricter than the app; this review is added on top of it, never instead.

import { S, t } from "../core/strings.js";
import { button, el, openDialog } from "./components.js";

const plural = (n, one, many) => t(n === 1 ? one : many, { n });

/** The text and the ways out of one finding. actions: [{ label, run }] — run is one of the handlers. */
function describe(finding, handlers) {
  switch (finding.kind) {
    case "NO_QUESTIONS":
      return { text: S.SR_NO_QUESTIONS, actions: [{ label: S.SR_ACTION_ADD_QUESTION, run: handlers.onAddQuestion }] };
    case "MISSING_ANSWERS":
      return {
        text: plural(finding.ids.length, S.SR_MISSING_ANSWERS_ONE, S.SR_MISSING_ANSWERS_MANY),
        actions: [
          { label: S.SR_ACTION_MARK_MYSELF, run: handlers.onMarkMyself },
          { label: plural(finding.ids.length, S.SR_ACTION_EDIT_ONE, S.SR_ACTION_EDIT_MANY), run: () => handlers.onEditQuestion(finding.ids[0]) },
        ],
      };
    case "MANUAL_MARKING":
      return { text: S.SR_MANUAL, actions: [] };
    case "RESULT_WITHOUT_ANSWERS":
      return {
        text: plural(finding.ids.length, S.SR_RESULT_NO_ANSWER_ONE, S.SR_RESULT_NO_ANSWER_MANY),
        actions: [{ label: plural(finding.ids.length, S.SR_ACTION_EDIT_ONE, S.SR_ACTION_EDIT_MANY), run: () => handlers.onEditQuestion(finding.ids[0]) }],
      };
    case "TIMERS_OFF":
      return { text: plural(finding.count, S.SR_TIMERS_OFF_ONE, S.SR_TIMERS_OFF_MANY), actions: [{ label: S.SR_ACTION_TIMERS_ON, run: handlers.onTimersOn }] };
    default:
      return { text: S.SR_RAPID_NO_EFFECT, actions: [{ label: S.SR_ACTION_RAPID_OFF, run: handlers.onRapidOff }] };
  }
}

/**
 * Shows the findings. Resolves "go" (carry on: the author confirmed), "back" (Go back / closed) or "fixed"
 * (the author used one of the ways out — the caller must re-check before going on). With nothing to say it
 * resolves "go" without showing anything. A finding that must be resolved offers no way to carry on.
 */
export function showSetupReview({ findings, confirmLabel = S.SR_SAVE_SETTINGS, ...handlers }) {
  if (!findings.length) return Promise.resolve("go");
  const must = findings.some((f) => f.mustResolve);
  return new Promise((resolve) => {
    let result = "back";
    const finish = (value) => () => {
      result = value;
      dlg.close("pick");
    };
    const cards = findings.map((finding) => {
      const { text, actions } = describe(finding, handlers);
      return el("div", { class: `sr-finding ${finding.mustResolve ? "must" : ""}`, "data-finding": finding.kind }, [
        el("div", { text }),
        actions.length
          ? el(
              "div",
              { class: "sr-actions" },
              actions.map((a) =>
                button({
                  label: a.label,
                  variant: "secondary",
                  size: "sm",
                  onClick: () => {
                    a.run?.();
                    finish("fixed")();
                  },
                })
              )
            )
          : null,
      ]);
    });
    const dlg = openDialog({
      title: must ? S.SR_TITLE_MUST : S.SR_TITLE,
      content: [el("p", { class: "dialog-body", text: must ? S.SR_MESSAGE_MUST : S.SR_MESSAGE }), el("div", { class: "stack-sm" }, cards)],
      actions: [
        button({ label: S.SR_GO_BACK, variant: "secondary", onClick: finish("back") }),
        must ? null : button({ label: confirmLabel, variant: "primary", onClick: finish("go") }),
      ].filter(Boolean),
      onClose: () => resolve(result),
    });
  });
}
