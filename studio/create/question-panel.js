// Side panel, Question tab: points, time limit, hint and explanation for the selected question.

import { MAX_POINTS, QUESTION_TYPES, TIME_PRESETS } from "../core/models.js";
import { S, t } from "../core/strings.js";
import { counter, el, field, updateCounter } from "../ui/components.js";

export function questionPanel(ctx) {
  const form = ctx.get();
  if (!form) return el("p", { class: "muted small", text: S.SELECT_A_QUESTION });
  const poll = form.type === QUESTION_TYPES.POLL;
  const parts = [];

  // Points
  if (poll) {
    parts.push(el("div", { class: "banner banner-info" }, [el("span", { text: S.POLL_NOT_SCORED })]));
  } else {
    const points = el("input", {
      class: "input input-number",
      type: "number",
      inputmode: "numeric",
      min: "0",
      max: String(MAX_POINTS),
      step: "1",
      value: String(form.points ?? 0),
      "data-fk": "q-points",
    });
    points.addEventListener("input", () => {
      const n = Math.max(0, Math.min(MAX_POINTS, Math.round(Number(points.value) || 0)));
      ctx.update("q-points", (f) => (f.points = n));
    });
    points.addEventListener("blur", () => (points.value = String(ctx.get().points)));
    parts.push(
      field({
        label: S.POINTS_LABEL,
        control: el("div", { class: "row" }, [
          points,
          el("div", { class: "row row-wrap" }, [1, 5, 10, 20].map((n) => presetChip(String(n), form.points === n, () => ctx.update("q-points-preset", (f) => (f.points = n), { structural: true })))),
        ]),
        hint: form.points === 0 ? S.POINTS_ZERO_HINT : t(S.POINTS_RANGE_HINT, { n: MAX_POINTS }),
      })
    );
  }

  // Time
  const custom = el("input", {
    class: "input input-number",
    type: "number",
    inputmode: "numeric",
    min: "0",
    max: "3600",
    step: "1",
    value: String(form.timeSec ?? 0),
    "aria-label": S.TIME_CUSTOM,
    "data-fk": "q-time",
  });
  custom.addEventListener("change", () => {
    const n = Math.max(0, Math.min(3600, Math.round(Number(custom.value) || 0)));
    ctx.update("q-time", (f) => (f.timeSec = n), { structural: true });
  });
  parts.push(
    field({
      label: S.TIME_LABEL,
      control: el("div", { class: "stack-sm" }, [
        el("div", { class: "row row-wrap" }, [
          ...TIME_PRESETS.map((sec) =>
            presetChip(sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60 ? ` ${sec % 60}s` : ""}`, form.timeSec === sec, () =>
              ctx.update("q-time", (f) => (f.timeSec = sec), { structural: true })
            )
          ),
          presetChip(S.NO_LIMIT, !(form.timeSec > 0), () => ctx.update("q-time", (f) => (f.timeSec = 0), { structural: true })),
        ]),
        el("div", { class: "row" }, [custom, el("span", { class: "small muted", text: S.SECONDS })]),
      ]),
      hint: form.timeSec > 0 ? null : S.NO_LIMIT_HINT,
    })
  );

  if (!poll) {
    parts.push(textArea(ctx, "hint", S.HINT_LABEL, S.HINT_PLACEHOLDER, ctx.limits.maxHintChars));
    parts.push(textArea(ctx, "reason", S.REASON_LABEL, S.REASON_PLACEHOLDER, ctx.limits.maxReasonChars, S.REASON_HINT));
  }

  return el("div", { class: "stack-lg" }, parts);
}

function presetChip(label, selected, onClick) {
  return el("button", { type: "button", class: `chip ${selected ? "is-selected" : ""}`, "aria-pressed": selected ? "true" : "false", text: label, onclick: onClick });
}

function textArea(ctx, key, label, placeholder, max, hint) {
  const value = ctx.get()[key] ?? "";
  const count = counter(value.length, max);
  const area = el("textarea", { class: "textarea", rows: "3", dir: "auto", value, placeholder, "data-fk": `q-${key}` });
  area.addEventListener("input", () => {
    updateCounter(count, area.value.length, max);
    ctx.update(`q-${key}`, (f) => (f[key] = area.value));
  });
  return field({ label, control: area, counterNode: count, hint });
}
