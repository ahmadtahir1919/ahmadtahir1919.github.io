// The Submit marks confirm — Studio's copy of the app's SubmitMarksDialog + SubmitMarksViewModel, same
// rules, same words (webtest/text-parity.test.mjs):
//
//  - results out: the "Notify participants" switch (off = submitted quietly; remembered, like the app's
//    GradeSubmitPrefs);
//  - results hidden: says so, and offers "After submitting" — Keep results hidden (always the default, so
//    a quick Submit never announces), End quiz and announce, Announce now / keep quiz open (open quiz),
//    or Announce results (finished quiz). Keep open asks the cheating warning first.
//
// The quiz is read fresh when the dialog opens, so a stale page can't offer the wrong choice. Nothing is
// written here: the caller submits the marks, then runs the release (runAnnounceAction) only if every
// mark landed — the app's order.

import { ANNOUNCE_STATE, announceState, resultsHiddenReason } from "../core/announce.js";
import { loadQuiz } from "../core/quizzes.js";
import { QUIZ_STATUS, effectiveStatus } from "../core/status.js";
import { S } from "../core/strings.js";
import { keepOpenWarning } from "../ui/announce-flow.js";
import { button, el, openDialog, switchControl } from "../ui/components.js";
import { plural } from "./gx-util.js";

const NOTIFY_KEY = "quizoma.gradeSubmitNotify";

function readNotify() {
  try {
    return localStorage.getItem(NOTIFY_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeNotify(value) {
  try {
    localStorage.setItem(NOTIFY_KEY, value ? "1" : "0");
  } catch {
    // Private mode: the choice just isn't remembered.
  }
}

/** The app's releaseOptionsFor: what "After submitting" offers for results hidden right now. */
export function releaseOptionsFor(state, scheduledNotStarted) {
  switch (state) {
    case ANNOUNCE_STATE.LIVE_AUTO:
    case ANNOUNCE_STATE.LIVE_MANUAL:
      return scheduledNotStarted ? [] : ["KEEP_HIDDEN", "END_AND_ANNOUNCE", "ANNOUNCE_KEEP_OPEN"];
    case ANNOUNCE_STATE.ENDED_NOT_ANNOUNCED:
      return ["KEEP_HIDDEN", "ANNOUNCE"];
    default:
      return [];
  }
}

/** The announce action for a release choice (the app's announceAction); null = leave results as they are.
 *  AUTO: ending is what shows the results, exactly as the announce sheet does it. */
export function releaseAction(release, auto) {
  switch (release) {
    case "ANNOUNCE":
      return "ANNOUNCE";
    case "END_AND_ANNOUNCE":
      return auto ? "END_ONLY" : "END_AND_ANNOUNCE";
    case "ANNOUNCE_KEEP_OPEN":
      return "ANNOUNCE_KEEP_OPEN";
    default:
      return null;
  }
}

const RELEASE_LABEL = {
  KEEP_HIDDEN: () => S.GRADE_SUBMIT_RELEASE_KEEP_HIDDEN,
  ANNOUNCE: () => S.GRADE_SUBMIT_RELEASE_ANNOUNCE,
  END_AND_ANNOUNCE: () => S.ANNOUNCE_CHOICE_END_AND_ANNOUNCE,
  ANNOUNCE_KEEP_OPEN: () => S.ANNOUNCE_CHOICE_KEEP_OPEN,
};

const HIDDEN_BODY = {
  MANUAL_NOT_ANNOUNCED: () => S.GRADE_SUBMIT_BODY_HIDDEN_MANUAL,
  AUTO_WITH_END: () => S.GRADE_SUBMIT_BODY_HIDDEN_AUTO_END,
  AUTO_NO_END: () => S.GRADE_SUBMIT_BODY_HIDDEN_AUTO_NO_END,
};

/**
 * Asks before submitting [marks] marks for [students] students of quiz [quizId]. Resolves null for
 * Cancel, or { notify, action, quiz } — action null = leave the results as they are.
 */
export async function askSubmitMarks({ quizId, marks, students }) {
  let quiz = null;
  try {
    quiz = await loadQuiz(quizId);
  } catch (error) {
    console.warn(error); // offline: the plain confirm, nothing about results offered
  }
  const now = Date.now();
  const hiddenReason = quiz ? resultsHiddenReason(quiz, now) : null;
  const hidden = hiddenReason != null;
  const options = hidden ? releaseOptionsFor(announceState(quiz, now), effectiveStatus(quiz, now) === QUIZ_STATUS.SCHEDULED) : [];
  const auto = quiz?.resultsReleaseMode !== "MANUAL";
  const showScore = quiz?.showResult ?? true;
  let notify = readNotify();
  let release = "KEEP_HIDDEN";

  return new Promise((resolve) => {
    let result = null;
    const body = el("p", { class: "dialog-body" });
    const extras = [];

    if (!hidden) {
      extras.push(
        el("label", { class: "card card-pad", style: "display:flex;align-items:center;gap:12px;cursor:pointer" }, [
          el("span", { style: "flex:1" }, [
            el("strong", { text: S.GRADE_SUBMIT_NOTIFY }),
            el("span", { class: "small muted", style: "display:block", text: S.GRADE_SUBMIT_NOTIFY_HINT }),
          ]),
          switchControl({
            checked: notify,
            label: S.GRADE_SUBMIT_NOTIFY,
            onChange: (value) => {
              notify = value;
              writeNotify(value);
              refresh();
            },
          }),
        ])
      );
    } else if (options.length) {
      const name = `rel-${Math.random().toString(36).slice(2)}`;
      extras.push(
        el("fieldset", { class: "card card-pad stack-sm", style: "border:0;margin:0" }, [
          el("legend", { class: "small", style: "font-weight:700;padding:0", text: S.GRADE_SUBMIT_RELEASE_LABEL }),
          ...options.map((option) => {
            const input = el("input", { type: "radio", name, value: option, checked: option === release });
            input.addEventListener("change", () => {
              if (!input.checked) return;
              release = option;
              refresh();
            });
            return el("label", { style: "display:flex;align-items:center;gap:8px;cursor:pointer" }, [input, el("span", { text: RELEASE_LABEL[option]() })]);
          }),
        ])
      );
    }

    const confirmBtn = button({
      label: S.GRADE_SUBMIT_CONFIRM,
      variant: "primary",
      onClick: async () => {
        let action = hidden ? releaseAction(release, auto) : null;
        if (action === "ANNOUNCE_KEEP_OPEN") {
          // The cheating warning first; Cancel there goes back to this dialog, nothing sent.
          action = await keepOpenWarning(auto);
          if (!action) return;
        }
        result = { notify: hidden || notify, action, quiz };
        dlg.close("confirm");
      },
    });

    const dlg = openDialog({
      badge: S.GRADE_SUBMIT_BADGE,
      title: plural(marks, S.GX_SUBMIT_TITLE_ONE, S.GX_SUBMIT_TITLE_MANY),
      content: [body, ...extras],
      actions: [button({ label: S.CANCEL, variant: "secondary", onClick: () => dlg.close("cancel") }), confirmBtn],
      initialFocus: () => confirmBtn,
      onClose: () => resolve(result),
    });
    const badge = dlg.node.querySelector(".dialog-badge");

    /** The body and badge say what Submit will actually do — the app's SubmitMarksDialog texts. */
    function refresh() {
      const announcing = hidden && release !== "KEEP_HIDDEN";
      const silent = (hidden && !announcing) || (!hidden && !notify);
      body.textContent = hidden
        ? HIDDEN_BODY[hiddenReason]()
        : !notify
          ? S.GRADE_SUBMIT_BODY_QUIET
          : !showScore
            ? S.GRADE_SUBMIT_BODY_RELEASED
            : plural(students, S.GRADE_SUBMIT_BODY_ONE, S.GRADE_SUBMIT_BODY_MANY);
      if (badge) {
        badge.lastChild.textContent = announcing ? S.GRADE_SUBMIT_BADGE : hidden ? S.GRADE_SUBMIT_BADGE_HIDDEN : !notify ? S.GRADE_SUBMIT_BADGE_QUIET : S.GRADE_SUBMIT_BADGE;
        badge.classList.toggle("pill-warn", silent);
        badge.classList.toggle("pill-info", !silent);
      }
    }
    refresh();
  });
}
