// What the person answered, beside the answer key.
//  - Choice questions list every option: the person's pick marked "Selected", the key marked
//    "Correct answer", both visible at once; a wrong pick is outlined red.
//  - Written: their answer and the expected answer side by side.
//  - Fill in the blanks: each blank's answer against its accepted answers.

import { QUESTION_TYPES } from "../core/models.js";
import { S } from "../core/strings.js";
import { el } from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { givenList } from "./data.js";

export function answerView(question, answer) {
  const given = givenList(answer);
  const skipped = given.every((g) => !g.trim());

  if ([QUESTION_TYPES.SINGLE_CHOICE, QUESTION_TYPES.MULTIPLE_CORRECT, QUESTION_TYPES.TRUE_FALSE].includes(question.type) && question.options?.length) {
    const picked = new Set(given);
    const correct = new Set(question.correct ?? []);
    return el("div", { class: "stack-sm" }, [
      skipped ? el("div", { class: "banner banner-info" }, [icon("info"), el("span", { text: S.SKIPPED_ANSWER })]) : null,
      el(
        "ul",
        { class: "choice-review" },
        question.options.map((option) => {
          const isPicked = picked.has(option);
          const isKey = correct.has(option);
          return el("li", { class: `choice-item ${isPicked ? "is-picked" : ""} ${isKey ? "is-key" : ""} ${isPicked && !isKey ? "is-wrong" : ""}` }, [
            el("span", { class: "choice-mark" }, [isPicked ? icon(isKey ? "check" : "x", "icon icon-sm") : null]),
            el("span", { class: "grow", dir: "auto", text: option }),
            isPicked ? el("span", { class: "pill pill-primary", text: S.SELECTED }) : null,
            isKey ? el("span", { class: "pill pill-success", text: S.CORRECT_ANSWER }) : null,
          ]);
        })
      ),
    ]);
  }

  if (question.type === QUESTION_TYPES.FILL_BLANK && question.fillBlank) {
    const blanks = orderedBlanks(question.fillBlank);
    return el(
      "div",
      { class: "blank-review" },
      blanks.map((blank, i) =>
        el("div", { class: "answer-compare" }, [
          answerBox(`${S.BLANK_N.replace("{n}", i + 1)} · ${S.THEIR_ANSWER}`, given[i], "is-theirs"),
          answerBox(S.ACCEPTED_ANSWERS, (blank.acceptedAnswers ?? []).filter(Boolean).join(" · "), "is-key"),
        ])
      )
    );
  }

  return el("div", { class: "answer-compare" }, [
    answerBox(S.THEIR_ANSWER, given.join(", "), "is-theirs"),
    answerBox(S.EXPECTED_ANSWER, question.writtenAnswer ?? "", "is-key"),
  ]);
}

function answerBox(label, text, cls) {
  const value = String(text ?? "").trim();
  return el("div", { class: `answer-box ${cls}` }, [
    el("span", { class: "answer-label", text: label }),
    el("p", { class: `answer-text ${value ? "" : "is-empty"}`, dir: "auto", text: value || (cls === "is-key" ? S.NO_KEY : S.NO_ANSWER) }),
  ]);
}

function orderedBlanks(content) {
  const byId = new Map((content.blanks ?? []).map((b) => [b.id, b]));
  const out = [];
  const re = /\[\[([^[\]]*)\]\]/g;
  let match;
  while ((match = re.exec(content.template ?? "")) !== null) {
    const blank = byId.get(match[1]);
    if (blank) out.push(blank);
  }
  return out;
}

/** The question text to show while marking; fill-blank shows its sentence with rules. */
export function questionHeading(question) {
  if (question.type === QUESTION_TYPES.FILL_BLANK) {
    const title = question.fillBlank?.title?.trim();
    return { title: title || question.text, sentence: title ? question.text : null };
  }
  return { title: question.text, sentence: null };
}
