// Written answer: the expected answer plus the "Answer checking" rules (AnswerModels.kt
// AnswerRule). Combination rules are the app's: Exact and Case-sensitive stand alone; Smart
// match, Keywords and Number may be combined. Default: Smart match alone, 85% strictness,
// all-or-nothing marks.

import { MARKS_PATTERNS, MATCH_MODES } from "../../core/models.js";
import { S, t } from "../../core/strings.js";
import { button, counter, el, field, segmented, updateCounter } from "../../ui/components.js";
import { icon } from "../../ui/icons.js";

const EXCLUSIVE = new Set([MATCH_MODES.STRICT_EXACT, MATCH_MODES.CASE_SENSITIVE_EXACT]);

const MODES = [
  [MATCH_MODES.FUZZY_TYPO_TOLERANT, () => S.MODE_SMART, () => S.MODE_SMART_SUB],
  [MATCH_MODES.STRICT_EXACT, () => S.MODE_EXACT, () => S.MODE_EXACT_SUB],
  [MATCH_MODES.CASE_SENSITIVE_EXACT, () => S.MODE_CASE, () => S.MODE_CASE_SUB],
  [MATCH_MODES.KEYWORD_MATCH, () => S.MODE_KEYWORDS, () => S.MODE_KEYWORDS_SUB],
  [MATCH_MODES.NUMERIC_EQUIVALENT, () => S.MODE_NUMBER, () => S.MODE_NUMBER_SUB],
];

export function writtenEditor(ctx) {
  const form = ctx.get();
  const max = ctx.limits.maxAnswerTextChars;
  const manual = ctx.quiz.manualMarkingDefault;

  const count = counter(form.writtenAnswer.length, max);
  const answer = el("input", {
    class: "input",
    type: "text",
    dir: "auto",
    value: form.writtenAnswer,
    placeholder: S.WRITTEN_ANSWER_PLACEHOLDER,
    "data-fk": "written-answer",
  });
  answer.addEventListener("input", () => {
    updateCounter(count, answer.value.length, max);
    ctx.update("written-answer", (f) => (f.writtenAnswer = answer.value));
  });

  return el("div", { class: "stack" }, [
    field({
      label: S.WRITTEN_ANSWER_LABEL,
      control: answer,
      counterNode: count,
      hint: manual ? S.WRITTEN_ANSWER_HINT_MANUAL : S.WRITTEN_ANSWER_HINT,
    }),
    manual ? null : checkingPanel(ctx),
  ]);
}

function checkingPanel(ctx) {
  const rule = ctx.get().answerRule;
  const modes = new Set(rule.matchModeList ?? []);
  const setRule = (key, change, structural = true) =>
    ctx.update(key, (f) => change(f.answerRule), { structural });

  const toggleMode = (mode) =>
    setRule(`mode-${mode}`, (r) => {
      const current = new Set(r.matchModeList ?? []);
      if (EXCLUSIVE.has(mode)) {
        r.matchModeList = current.has(mode) && current.size === 1 ? [MATCH_MODES.FUZZY_TYPO_TOLERANT] : [mode];
        return;
      }
      for (const m of EXCLUSIVE) current.delete(m);
      if (current.has(mode)) current.delete(mode);
      else current.add(mode);
      // Never leave nothing selected: fall back to the default.
      r.matchModeList = current.size ? [...current] : [MATCH_MODES.FUZZY_TYPO_TOLERANT];
    });

  const modeCards = el(
    "div",
    { class: "mode-grid" },
    MODES.map(([mode, label, sub]) =>
      el(
        "button",
        {
          type: "button",
          class: `mode-card ${modes.has(mode) ? "is-selected" : ""}`,
          "aria-pressed": modes.has(mode) ? "true" : "false",
          "data-fk": `mode-${mode}`,
          onclick: () => toggleMode(mode),
        },
        [
          el("span", { class: "mode-check" }, [icon("check", "icon icon-sm")]),
          el("span", { class: "mode-title", text: label() }),
          el("span", { class: "mode-sub", text: sub() }),
        ]
      )
    )
  );

  const parts = [
    el("div", { class: "stack-sm" }, [
      el("span", { class: "label", text: S.MATCH_MODES_LABEL }),
      el("p", { class: "hint-text", text: S.MATCH_MODES_HINT }),
      modeCards,
    ]),
  ];

  if (modes.has(MATCH_MODES.FUZZY_TYPO_TOLERANT)) parts.push(strictness(rule, setRule));
  if (modes.has(MATCH_MODES.KEYWORD_MATCH)) parts.push(keywordsBlock(ctx, rule, setRule));
  parts.push(aliasBlock(ctx, rule, setRule));
  parts.push(
    el("div", { class: "stack-sm" }, [
      el("span", { class: "label", text: S.MARKS_PATTERN_LABEL }),
      segmented({
        label: "marks-pattern",
        value: rule.marksPattern ?? MARKS_PATTERNS.ALL_OR_NOTHING,
        options: [
          { value: MARKS_PATTERNS.ALL_OR_NOTHING, label: S.MARKS_ALL_OR_NOTHING },
          { value: MARKS_PATTERNS.HALF_FOR_PARTIAL, label: S.MARKS_HALF },
          { value: MARKS_PATTERNS.WEIGHTED_BY_SIMILARITY, label: S.MARKS_WEIGHTED },
        ],
        onChange: (value) => setRule("marks-pattern", (r) => (r.marksPattern = value)),
      }),
      el("p", { class: "hint-text", text: S.MARKS_PATTERN_HINT }),
    ])
  );

  return el("details", { class: "checking-panel", open: true }, [
    el("summary", {}, [icon("settings", "icon icon-sm"), el("span", { text: S.CHECKING_LABEL }), icon("chevron-down", "icon icon-sm summary-chevron")]),
    el("div", { class: "stack-lg checking-body" }, parts),
  ]);
}

function strictness(rule, setRule) {
  const value = Math.round((rule.minSimilarity ?? 0.85) * 100);
  const out = el("span", { class: "strong mono", text: `${value}%` });
  const slider = el("input", {
    type: "range",
    class: "range",
    min: "70",
    max: "100",
    step: "1",
    value: String(value),
    "aria-label": S.STRICTNESS_LABEL,
    "data-fk": "strictness",
  });
  slider.addEventListener("input", () => {
    out.textContent = `${slider.value}%`;
    setRule("strictness", (r) => (r.minSimilarity = Number(slider.value) / 100), false);
  });
  return el("div", { class: "stack-sm" }, [
    el("div", { class: "label-row" }, [el("span", { class: "label", text: S.STRICTNESS_LABEL }), out]),
    slider,
    el("div", { class: "row row-between small faint" }, [el("span", { text: S.STRICTNESS_LENIENT }), el("span", { text: S.STRICTNESS_STRICT })]),
  ]);
}

function keywordsBlock(ctx, rule, setRule) {
  const keywords = rule.keywords ?? [];
  const input = el("input", {
    class: "input",
    type: "text",
    dir: "auto",
    placeholder: S.KEYWORD_PLACEHOLDER,
    "data-fk": "keyword-input",
  });
  const add = () => {
    const words = input.value
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);
    if (!words.length) return;
    setRule("keywords", (r) => {
      const set = new Set(r.keywords ?? []);
      for (const w of words) set.add(w);
      r.keywords = [...set];
    });
    requestAnimationFrame(() => document.querySelector('[data-fk="keyword-input"]')?.focus());
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    }
  });

  return el("div", { class: "stack-sm" }, [
    el("span", { class: "label", text: S.KEYWORDS_LABEL }),
    el(
      "div",
      { class: "row row-wrap" },
      keywords.length
        ? keywords.map((word) =>
            el("span", { class: "chip is-selected", dir: "auto" }, [
              word,
              el(
                "button",
                {
                  type: "button",
                  class: "chip-remove",
                  "aria-label": t(S.REMOVE_NAMED, { name: word }),
                  onclick: () => setRule("keywords", (r) => (r.keywords = (r.keywords ?? []).filter((w) => w !== word))),
                },
                [icon("x", "icon icon-sm")]
              ),
            ])
          )
        : [el("span", { class: "small faint", text: S.NO_KEYWORDS })]
    ),
    el("div", { class: "row" }, [input, button({ label: S.ADD, variant: "secondary", onClick: add })]),
    el("div", { class: "row row-wrap" }, [
      el("span", { class: "small muted", text: S.KEYWORD_COVERAGE }),
      segmented({
        label: "coverage",
        value: rule.keywordCoverage ?? "ALL",
        options: [
          { value: "ALL", label: S.COVERAGE_ALL },
          { value: "MOST", label: S.COVERAGE_MOST },
          { value: "HALF", label: S.COVERAGE_HALF },
        ],
        onChange: (value) => setRule("coverage", (r) => (r.keywordCoverage = value)),
      }),
    ]),
  ]);
}

/** Equal words: "if they write X, treat it as Y" — answerWord must be in the expected answer. */
function aliasBlock(ctx, rule, setRule) {
  const pairs = rule.aliasPairs ?? [];
  const expected = ctx.get().writtenAnswer.toLowerCase();
  const rows = pairs.map((pair, index) => {
    const answerWord = el("input", { class: "input", type: "text", dir: "auto", value: pair.answerWord, placeholder: S.ALIAS_ANSWER_WORD, "data-fk": `alias-a-${index}` });
    const acceptedWord = el("input", { class: "input", type: "text", dir: "auto", value: pair.acceptedWord, placeholder: S.ALIAS_ACCEPTED_WORD, "data-fk": `alias-b-${index}` });
    answerWord.addEventListener("input", () => setRule(`alias-a-${index}`, (r) => (r.aliasPairs[index].answerWord = answerWord.value), false));
    acceptedWord.addEventListener("input", () => setRule(`alias-b-${index}`, (r) => (r.aliasPairs[index].acceptedWord = acceptedWord.value), false));
    const missing = pair.answerWord.trim() && !expected.includes(pair.answerWord.trim().toLowerCase());
    return el("div", { class: "stack-sm" }, [
      el("div", { class: "alias-row" }, [
        acceptedWord,
        el("span", { class: "alias-eq", text: "=" }),
        answerWord,
        button({
          label: S.REMOVE,
          icon: "x",
          variant: "ghost",
          iconOnly: true,
          size: "sm",
          onClick: () => setRule("alias-remove", (r) => r.aliasPairs.splice(index, 1)),
        }),
      ]),
      missing ? el("p", { class: "field-error", text: S.ALIAS_NOT_IN_ANSWER }) : null,
    ]);
  });

  return el("div", { class: "stack-sm" }, [
    el("span", { class: "label", text: S.ALIAS_LABEL }),
    el("p", { class: "hint-text", text: S.ALIAS_HINT }),
    ...rows,
    el("div", { class: "row" }, [
      button({
        label: S.ADD_ALIAS,
        icon: "plus",
        variant: "ghost",
        size: "sm",
        onClick: () => setRule("alias-add", (r) => (r.aliasPairs = [...(r.aliasPairs ?? []), { answerWord: "", acceptedWord: "" }])),
      }),
    ]),
  ]);
}
