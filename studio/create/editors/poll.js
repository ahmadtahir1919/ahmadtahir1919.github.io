// Poll: choices with no correct answer, quick-fill templates, and the poll's own settings
// (PollModels.kt). Polls carry 0 points and are outside scoring entirely.

import { POLL_TEMPLATES } from "../../core/models.js";
import { S } from "../../core/strings.js";
import { el, switchControl } from "../../ui/components.js";
import { item } from "../form.js";
import { optionList } from "./options.js";

const SETTINGS = [
  ["allowMultiple", () => S.POLL_ALLOW_MULTIPLE],
  ["allowVoteChange", () => S.POLL_ALLOW_CHANGE],
  ["anonymous", () => S.POLL_ANONYMOUS],
  ["showResultsToVoters", () => S.POLL_SHOW_RESULTS],
  ["allowOther", () => S.POLL_ALLOW_OTHER],
  ["askReason", () => S.POLL_ASK_REASON],
  ["shuffleOptions", () => S.POLL_SHUFFLE],
  ["noTimeLimit", () => S.POLL_NO_TIME_LIMIT],
];

export function pollEditor(ctx) {
  const form = ctx.get();

  const templates = el(
    "div",
    { class: "row row-wrap" },
    POLL_TEMPLATES.map((choices) =>
      el("button", {
        type: "button",
        class: "chip",
        text: choices.length > 3 ? `${choices[0]} … ${choices[choices.length - 1]}` : choices.join(" / "),
        onclick: () =>
          ctx.update(
            "poll-template",
            (f) => {
              f.items = choices.slice(0, ctx.limits.maxOptions).map((text) => item(text));
            },
            { structural: true }
          ),
      })
    )
  );

  const settings = el(
    "div",
    { class: "settings-list" },
    SETTINGS.map(([key, label]) =>
      el("label", { class: "switch-row" }, [
        el("span", { class: "switch-label grow", text: label() }),
        switchControl({
          checked: form.pollSettings[key] === true,
          label: label(),
          fk: `poll-${key}`,
          onChange: (on) => ctx.update(`poll-${key}`, (f) => (f.pollSettings[key] = on), { structural: true }),
        }),
      ])
    )
  );

  return el("div", { class: "stack" }, [
    el("div", { class: "stack-sm" }, [el("span", { class: "label", text: S.POLL_TEMPLATES }), templates]),
    optionList(ctx, { marker: null }),
    el("div", { class: "stack-sm" }, [el("span", { class: "label", text: S.POLL_SETTINGS }), settings]),
  ]);
}
