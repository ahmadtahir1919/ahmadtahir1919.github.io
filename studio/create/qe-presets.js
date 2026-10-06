// The preset cards, the summary strip with its chips, and the conflict notices — Studio's copy of the app's
// PresetPicker (ui/create/components/PresetPicker.kt). The rules are core/rules.js, a port pinned to the app by
// shared tables (webtest/rules-parity.test.mjs); the words are the app's (webtest/text-parity.test.mjs).
//
// ctx: { quiz(), questions() persisted shape, readOnly(), setQuiz(key, fn) }

import { PRESETS, answersChip, applyPreset, conflictsFor, matchingPreset, presetSummary, questionFacts, timerChip, triesChip } from "../core/rules.js";
import { S } from "../core/strings.js";
import { el } from "../ui/components.js";
import { G, svg } from "./qe-icons.js";

const CARD = {
  CLASS_TEST: () => [S.PRESET_CLASS_TEST, S.PRESET_CLASS_TEST_TAGLINE],
  PRACTICE: () => [S.PRESET_PRACTICE, S.PRESET_PRACTICE_TAGLINE],
  SPEED_DRILL: () => [S.PRESET_SPEED_DRILL, S.PRESET_SPEED_DRILL_TAGLINE],
};

const SENTENCE = {
  CLASS_TEST: () => S.PRESET_SUMMARY_CLASS_TEST,
  PRACTICE: () => S.PRESET_SUMMARY_PRACTICE,
  PRACTICE_MANUAL: () => S.PRESET_SUMMARY_PRACTICE_MANUAL,
  SPEED_DRILL: () => S.PRESET_SUMMARY_SPEED_DRILL,
  SPEED_DRILL_MANUAL: () => S.PRESET_SUMMARY_SPEED_DRILL_MANUAL,
  ONLY_POLLS: () => S.PRESET_SUMMARY_ONLY_POLLS,
  CUSTOM: () => S.PRESET_SUMMARY_CUSTOM,
};

const CHIP = {
  INSTANT: () => S.PRESET_CHIP_INSTANT,
  SHOWN: () => S.PRESET_CHIP_SHOWN,
  HIDDEN: () => S.PRESET_CHIP_HIDDEN,
  TIMED: () => S.PRESET_CHIP_TIMED,
  NO_TIMER: () => S.PRESET_CHIP_NO_TIMER,
  RETAKES: () => S.PRESET_CHIP_RETAKES,
  ONE_TRY: () => S.PRESET_CHIP_ONE_TRY,
};

const NOTICE = {
  RETAKE_WITH_ANSWERS: () => S.CONFLICT_RETAKE_WITH_ANSWERS,
  BACK_ON_TIMED: () => S.CONFLICT_BACK_ON_TIMED,
  MANUAL_OFF_OPEN_ANSWERS: () => S.CONFLICT_MANUAL_OFF_OPEN_ANSWERS,
};

/** Manual Review ON, with the effect on the three rules it switches off — the same as its own row. */
export function markMyself(q) {
  q.manualMarkingDefault = true;
  q.showCorrectnessInstantly = false;
  q.splitPointsAcrossChoices = false;
  q.timeWeightageEnabled = false;
}

export function presetGroup(ctx, render) {
  const quiz = ctx.quiz();
  const ro = ctx.readOnly();
  const facts = questionFacts(ctx.questions());
  const selected = matchingPreset(quiz);

  const cards = PRESETS.map((preset) => {
    const [name, tagline] = CARD[preset]();
    const on = preset === selected;
    return el(
      "button",
      {
        type: "button",
        class: `pcard ${on ? "on" : ""}`,
        role: "radio",
        "aria-checked": String(on),
        "aria-label": `${name}, ${tagline}`,
        disabled: ro || undefined,
        "data-fk": `preset-${preset}`,
        // A preset sets the rules directly, with no confirmation dialog — those live on the rows' own switches.
        onclick: () => {
          ctx.setQuiz("preset", (q) => Object.assign(q, applyPreset(preset, q)));
          render();
        },
      },
      [el("b", { text: name }), el("small", { text: tagline }), on ? el("i", { class: "pck", "aria-hidden": "true" }, [svg(G.check14)]) : null]
    );
  });

  const sentence = SENTENCE[presetSummary(selected, quiz.manualMarkingDefault === true, facts.onlyPolls)]();
  const strip = el("div", { class: "psum", "data-fk": "preset-summary" }, [
    el("p", { text: sentence }),
    el("div", { class: "pchips" }, [
      el("span", { text: CHIP[answersChip(quiz, facts)]() }),
      el("span", { text: CHIP[timerChip(quiz, facts)]() }),
      el("span", { text: CHIP[triesChip(quiz)]() }),
    ]),
  ]);

  const notices = conflictsFor(quiz, facts).map((conflict) =>
    el("div", { class: "pnote", role: "status", "data-conflict": conflict }, [
      el("span", { text: NOTICE[conflict]() }),
      // The one fix: the same effect as turning Manual Review on by hand. Hidden when the quiz is locked.
      conflict === "MANUAL_OFF_OPEN_ANSWERS" && !ro
        ? el("button", {
            type: "button",
            class: "linkbtn",
            text: S.CONFLICT_MARK_MYSELF,
            "data-fk": "conflict-mark-myself",
            onclick: () => {
              ctx.setQuiz("manual", markMyself);
              render();
            },
          })
        : null,
    ])
  );

  return el("div", { class: "grp grp-presets" }, [
    el("h5", { text: S.PRESET_SECTION }),
    el("div", { class: "pcards", role: "radiogroup", "aria-label": S.PRESET_SECTION }, cards),
    strip,
    ...notices,
  ]);
}
