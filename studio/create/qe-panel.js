// Right panel, "Quiz settings" — design-reference/editor.html's .panel, holding the app's quiz
// rules in the app's order (CreateQuizScreen / QuizRuleCards.kt): schedule, then Quiz Mechanics
// & Real-Time Feedback, Post-Session Review, Evaluation Logic, then the accent palette. Titles
// are the app's; the line under each is the reference's wording. The dependency rules and the
// "ask first" dialogs are the app's (QuizRuleCards.kt, CreateQuizViewModel.kt):
//
//  - Manual review ON forces Instant correctness, Partial credit and Rapid bonus OFF.
//  - No timed question → Timer, Preview and Rapid bonus unavailable (saved values kept).
//  - Timer OFF → Preview and Rapid bonus unavailable.
//  - Turning on Show score or Instant correctness asks first; Back + Instant asks first.

import { PREVIEW_OPTIONS, QUIZ_THEMES } from "../core/models.js";
import { blocksFor, questionFacts } from "../core/rules.js";
import { S, t } from "../core/strings.js";
import { confirmDialog, el, swap } from "../ui/components.js";
import { reveal } from "../ui/motion.js";
import { G, svg } from "./qe-icons.js";
import { presetGroup } from "./qe-presets.js";

const DURATIONS = [
  [15, () => S.QE_DUR_15],
  [30, () => S.QE_DUR_30],
  [60, () => S.QE_DUR_60],
  [1440, () => S.QE_DUR_DAY],
  [0, () => S.QE_DUR_NONE],
  ["custom", () => S.QE_DUR_CUSTOM],
];

// ── Dates ────────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, "0");
const dateValue = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeValue = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fromInputs = (date, time) => {
  if (!date) return null;
  const ms = new Date(`${date}T${time || "09:00"}`).getTime();
  return Number.isFinite(ms) ? ms : null;
};
export const fmtT = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export function fmtD(d) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const diff = Math.round((x - today) / 864e5);
  return diff === 0 ? S.QE_TODAY : diff === 1 ? S.QE_TOMORROW : d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}
const lcD = (d) => {
  const x = fmtD(d);
  return x === S.QE_TODAY || x === S.QE_TOMORROW ? x.toLowerCase() : x;
};

/** The schedule as the panel shows it: { on, mins } from startAt/endAt. */
export function schedOf(quiz, remembered) {
  if (!quiz.startAt && !quiz.endAt) return { on: false, mins: remembered ?? 30 };
  if (!quiz.endAt) return { on: true, mins: 0 };
  if (quiz.startAt) {
    const mins = Math.round((quiz.endAt - quiz.startAt) / 6e4);
    if (remembered !== "custom" && [15, 30, 60, 1440].includes(mins)) return { on: true, mins };
  }
  return { on: true, mins: "custom" };
}

/** The meta line's open-status chip: [iconMarkup, text, cls]. */
export function schedChip(quiz) {
  const { startAt, endAt } = quiz;
  if (!startAt && !endAt) return [G.inf13, S.QE_ALWAYS_OPEN, "open"];
  if (!startAt) {
    const e = new Date(endAt);
    return [G.clock13, t(S.QE_END_ONLY, { when: fmtD(e), time: fmtT(e) }), "sch"];
  }
  const s = new Date(startAt);
  if (!endAt) return [G.clock13, t(S.QE_STARTS_NO_END, { when: lcD(s), time: fmtT(s) }), "sch"];
  if (endAt <= startAt) return [G.clock13, t(S.QE_STARTS_NO_END_SET, { when: lcD(s), time: fmtT(s) }), "warn"];
  return [G.clock13, rangeText(s, new Date(endAt)), "sch"];
}

function rangeText(s, e) {
  const sameDay = e.toDateString() === s.toDateString();
  return t(S.QE_RANGE, { when: fmtD(s), start: fmtT(s), end: `${sameDay ? "" : `${fmtD(e)}, `}${fmtT(e)}` });
}

function openFor(mins) {
  if (mins >= 1440) return Math.round(mins / 1440) === 1 ? S.QE_OPEN_FOR_DAY : t(S.QE_OPEN_FOR_DAYS, { n: Math.round(mins / 1440) });
  if (mins >= 60) {
    if (mins === 60) return S.QE_OPEN_FOR_HOUR;
    return mins % 60 ? t(S.QE_OPEN_FOR_HM, { h: Math.floor(mins / 60), m: mins % 60 }) : t(S.QE_OPEN_FOR_HOURS, { n: mins / 60 });
  }
  return t(S.QE_OPEN_FOR_MIN, { n: mins });
}

// ── Panel ────────────────────────────────────────────────────────────────────

/**
 * ctx: { quiz(), questions() persisted shape, setQuiz(key, fn, {render}), readOnly(),
 *        lastPreviewSec(), sched: { mins } (remembered end choice), onHide(), meta() }
 */
export function buildPanel(ctx) {
  const body = el("div", { class: "pbody" });
  const hide = el("button", { class: "hidep", type: "button", title: S.QE_HIDE_SETTINGS_TITLE, "aria-label": S.QE_HIDE_SETTINGS }, [svg(G.hidePanel)]);
  hide.addEventListener("click", () => ctx.onHide());
  const panel = el("aside", { class: "panel", "aria-label": S.QE_QUIZ_SETTINGS }, [
    el("div", { class: "ptabs" }, [el("span", { class: "pt-h", text: S.QE_QUIZ_SETTINGS }), el("span", { class: "pt-s", text: S.QE_FOR_WHOLE }), hide]),
    body,
  ]);
  const schedule = scheduleGroup(ctx);
  const rest = el("div", { class: "prest" });
  body.append(schedule.node, rest);
  const render = () => {
    schedule.sync();
    swap(rest, presetGroup(ctx, render), ...ruleGroups(ctx, render), paletteGroup(ctx, render));
  };
  render();
  return { panel, render, syncSchedule: schedule.sync };
}

function scheduleGroup(ctx) {
  const ro = () => ctx.readOnly();
  const anyBtn = el("button", { type: "button", "data-w": "any", role: "radio" }, [
    el("span", { class: "wi" }, [svg(G.infinity18)]),
    el("span", { class: "wt" }, [el("b", { text: S.QE_WHEN_ANY }), el("small", { text: S.QE_WHEN_ANY_SUB })]),
    el("span", { class: "rd" }),
  ]);
  const setBtn = el("button", { type: "button", "data-w": "set", role: "radio" }, [
    el("span", { class: "wi" }, [svg(G.alarm18)]),
    el("span", { class: "wt" }, [el("b", { text: S.QE_WHEN_SET }), el("small", { text: S.QE_WHEN_SET_SUB })]),
    el("span", { class: "rd" }),
  ]);
  const sDate = el("input", { type: "date", "aria-label": S.QE_START_DATE, "data-fk": "s-date" });
  const sTime = el("input", { type: "time", "aria-label": S.QE_START_TIME, "data-fk": "s-time" });
  const eDate = el("input", { type: "date", "aria-label": S.QE_END_DATE, "data-fk": "e-date" });
  const eTime = el("input", { type: "time", "aria-label": S.QE_END_TIME, "data-fk": "e-time" });
  const durBtns = DURATIONS.map(([m, label]) => el("button", { type: "button", "data-m": String(m), text: label() }));
  const endCustom = el("div", { class: "sin", hidden: true }, [eDate, eTime]);
  const enote = el("div", { class: "enote", hidden: true, text: S.QE_END_AFTER });
  const ssum = el("div", { class: "ssum" });
  const sched = el("div", { class: "sched", hidden: true }, [
    el("div", { class: "srow" }, [
      el("span", { class: "sdot start" }),
      el("div", { class: "sl" }, [el("small", { text: S.QE_START_LABEL }), el("div", { class: "sin" }, [sDate, sTime])]),
    ]),
    el("div", { class: "sline" }),
    el("div", { class: "srow" }, [
      el("span", { class: "sdot end" }),
      el("div", { class: "sl" }, [el("small", { text: S.QE_END_LABEL }), el("div", { class: "chips" }, durBtns), endCustom, enote]),
    ]),
    ssum,
  ]);
  const when = el("div", { class: "whenc", role: "radiogroup", "aria-label": S.QE_START_END }, [anyBtn, setBtn]);
  const node = el("div", { class: "grp" }, [el("h5", { text: S.QE_START_END }), when, sched]);

  const write = (startAt, endAt) => ctx.setQuiz("schedule", (q) => {
    q.startAt = startAt;
    q.endAt = endAt;
  });

  // Writes the inputs' state back to the quiz.
  const commit = () => {
    const start = fromInputs(sDate.value, sTime.value);
    const mins = ctx.sched.mins;
    let end = null;
    if (mins === "custom") end = fromInputs(eDate.value || sDate.value, eTime.value || "10:00");
    else if (mins && start) end = start + mins * 6e4;
    write(start, end);
    sync();
  };

  anyBtn.addEventListener("click", () => {
    if (ro()) return;
    write(null, null);
    sync();
  });
  setBtn.addEventListener("click", () => {
    if (ro()) return;
    const q = ctx.quiz();
    if (q.startAt || q.endAt) return;
    // Default: tomorrow at 09:00, with the remembered end choice (30 min).
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    sDate.value = dateValue(d);
    sTime.value = "09:00";
    if (ctx.sched.mins === "custom") ctx.sched.mins = 30;
    commit();
  });
  durBtns.forEach((b) =>
    b.addEventListener("click", () => {
      if (ro()) return;
      const m = b.dataset.m === "custom" ? "custom" : Number(b.dataset.m);
      ctx.sched.mins = m;
      if (m === "custom" && !eDate.value) {
        const q = ctx.quiz();
        const base = new Date(q.endAt || (q.startAt ?? Date.now()) + 60 * 6e4);
        eDate.value = dateValue(base);
        eTime.value = timeValue(base);
      }
      commit();
      if (m === "custom") eTime.focus();
    })
  );
  [sDate, sTime, eDate, eTime].forEach((x) => x.addEventListener("input", () => !ro() && commit()));

  // The first sync (page load) places things without animating.
  let first = true;
  const show = (node, on) => (first ? (node.hidden = !on) : reveal(node, on));
  function sync() {
    const q = ctx.quiz();
    const st = schedOf(q, ctx.sched.mins);
    ctx.sched.mins = st.mins;
    [anyBtn, setBtn].forEach((b) => {
      const on = (b === setBtn) === st.on;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", String(on));
      b.disabled = ro();
    });
    durBtns.forEach((b) => {
      b.classList.toggle("on", b.dataset.m === String(st.mins));
      b.disabled = ro();
    });
    [sDate, sTime, eDate, eTime].forEach((x) => (x.disabled = ro()));
    if (q.startAt && document.activeElement !== sDate && document.activeElement !== sTime) {
      const s = new Date(q.startAt);
      sDate.value = dateValue(s);
      sTime.value = timeValue(s);
    }
    if (q.endAt && st.mins === "custom" && document.activeElement !== eDate && document.activeElement !== eTime) {
      const e = new Date(q.endAt);
      eDate.value = dateValue(e);
      eTime.value = timeValue(e);
    }
    show(sched, st.on);
    show(endCustom, st.on && st.mins === "custom");
    const bad = !!(q.startAt && q.endAt && q.endAt <= q.startAt);
    show(enote, st.on && st.mins === "custom" && bad);
    first = false;
    ssum.replaceChildren();
    if (st.on && q.startAt && !bad) {
      const s = new Date(q.startAt);
      const line = q.endAt ? rangeText(s, new Date(q.endAt)) : t(S.QE_ONWARDS, { when: fmtD(s), time: fmtT(s) });
      const sub = q.endAt ? openFor(Math.round((q.endAt - q.startAt) / 6e4)) : S.QE_STAYS_OPEN;
      ssum.append(el("span", { class: "clk" }, [svg(G.clock18)]), el("div", {}, [el("b", { text: line }), el("span", { text: sub })]));
    }
    ctx.meta();
  }

  return { node, sync };
}

function ruleRow({ title, sub, on, blocked = null, onChange, extra = null, ro }) {
  const sw = el("button", { class: "sw", role: "switch", type: "button", "aria-checked": String(on), "aria-label": title, disabled: ro || !!blocked || undefined, "data-fk": `rule-${title}` });
  sw.addEventListener("click", async () => {
    const result = await onChange(!on);
    if (result === false) sw.focus();
  });
  return el("div", { class: `tg ${blocked ? "blocked" : ""}` }, [el("div", {}, [el("b", { text: title }), el("small", { text: blocked ?? sub }), extra]), sw]);
}

/** "Show results": When the quiz ends (AUTO) / When I announce them (MANUAL), with the app's no-end-time hint. */
function releaseRow({ quiz, ro, set }) {
  const mode = quiz.resultsReleaseMode === "MANUAL" ? "MANUAL" : "AUTO";
  const hint = mode === "AUTO" && quiz.endAt == null ? S.RESULTS_RELEASE_NO_END : null;
  const chip = (value, label) =>
    el("button", {
      type: "button",
      class: mode === value ? "on" : "",
      role: "radio",
      "aria-checked": String(mode === value),
      text: label,
      disabled: ro || undefined,
      onclick: () => set("release-mode", (q) => (q.resultsReleaseMode = value)),
    });
  return el("div", { class: "tg", "data-fk": "rule-release-mode" }, [
    el("div", {}, [
      el("b", { text: S.RESULTS_RELEASE_TITLE }),
      el("div", { class: "extra" }, [
        el("div", { class: "chips", role: "radiogroup", "aria-label": S.RESULTS_RELEASE_TITLE }, [
          chip("AUTO", S.RESULTS_RELEASE_AUTO),
          chip("MANUAL", S.RESULTS_RELEASE_MANUAL),
        ]),
      ]),
      hint ? el("small", { text: hint }) : null,
    ]),
  ]);
}

/** The text for a block reason (RuleBlocks.kt BlockReason); null = the row is usable. The words are the app's. */
function reasonText(reason, rule) {
  return reason ? REASON_TEXT[reason](rule) : null;
}

const REASON_TEXT = {
  ONLY_POLLS: () => S.BLOCKED_ONLY_POLLS,
  MANUAL_REVIEW: (rule) => ({ flash: S.FLASH_BLOCKED_MANUAL, partial: S.PARTIAL_BLOCKED_MANUAL, rapid: S.RAPID_BLOCKED_MANUAL })[rule],
  NO_TIMED_QUESTION: (rule) => ({ timer: S.TIMER_BLOCKED_NO_TIMED, preview: S.PREVIEW_BLOCKED_NO_TIMED, rapid: S.RAPID_BLOCKED_NO_TIMED })[rule],
  TIMER_OFF: (rule) => ({ preview: S.PREVIEW_BLOCKED_TIMER_OFF, rapid: S.RAPID_BLOCKED_TIMER_OFF })[rule],
  NO_MULTIPLE_CORRECT: () => S.PARTIAL_BLOCKED_NO_MULTIPLE,
};

function ruleGroups(ctx, render) {
  const quiz = ctx.quiz();
  const ro = ctx.readOnly();
  // Which rows are greyed out, and why, is core/rules.js — a port of the app's RuleBlocks.kt, pinned to it by a
  // shared table. Saved values are kept; a greyed row just reads off and says why.
  const blocks = blocksFor(quiz, questionFacts(ctx.questions()));
  const manual = quiz.manualMarkingDefault;
  const flashOn = quiz.showCorrectnessInstantly && !blocks.flash;
  const set = (key, fn) => {
    ctx.setQuiz(key, fn);
    render();
  };
  const previewBlocked = reasonText(blocks.preview, "preview");
  const timerBlocked = reasonText(blocks.timer, "timer");
  const rapidBlocked = reasonText(blocks.rapid, "rapid");
  const previewOn = quiz.questionPreviewSec > 0 && !previewBlocked;

  const askInstant = () =>
    confirmDialog({ badge: S.HEADS_UP, title: S.INSTANT_WARNING_TITLE, body: S.INSTANT_WARNING_BODY, confirmLabel: S.INSTANT_WARNING_CONFIRM, cancelLabel: S.INSTANT_WARNING_CANCEL, danger: false });
  const askBackFlash = () =>
    confirmDialog({
      badge: S.HEADS_UP,
      title: S.BACK_FLASH_WARNING_TITLE,
      body: t(S.BACK_FLASH_WARNING_BODY, { flash: S.RULE_FLASH, back: S.RULE_BACK }),
      confirmLabel: S.BACK_FLASH_WARNING_CONFIRM,
      cancelLabel: S.BACK_FLASH_WARNING_CANCEL,
      danger: false,
    });

  const readingChips = previewOn
    ? el("div", { class: "extra" }, [
        el("small", { text: S.QE_READING_TIME }),
        el(
          "div",
          { class: "chips" },
          PREVIEW_OPTIONS.map((sec) =>
            el("button", {
              type: "button",
              class: quiz.questionPreviewSec === sec ? "on" : "",
              text: t(S.QE_SEC_SHORT, { n: sec }),
              disabled: ro || undefined,
              onclick: () => set("preview-sec", (q) => (q.questionPreviewSec = sec)),
            })
          )
        ),
      ])
    : null;

  return [
    el("div", { class: "grp" }, [
      el("h5", { text: S.QE_SEC_MECHANICS }),
      ruleRow({ ro, title: S.RULE_NUMBERED, sub: S.QE_R_NUMBERED_SUB, on: quiz.showQuestionNumbers, onChange: (on) => set("numbers", (q) => (q.showQuestionNumbers = on)) }),
      ruleRow({ ro, title: S.RULE_TIMER, sub: S.QE_R_TIMER_SUB, on: quiz.showTimers && !timerBlocked, blocked: timerBlocked, onChange: (on) => set("timers", (q) => (q.showTimers = on)) }),
      ruleRow({
        ro,
        title: S.RULE_PREVIEW,
        sub: previewOn ? t(S.QE_R_PREVIEW_SUB, { n: quiz.questionPreviewSec }) : S.QE_R_PREVIEW_OFF_SUB,
        on: previewOn,
        blocked: previewBlocked,
        extra: readingChips,
        onChange: (on) => set("preview", (q) => (q.questionPreviewSec = on ? ctx.lastPreviewSec() : 0)),
      }),
      ruleRow({
        ro,
        title: S.RULE_FLASH,
        sub: S.QE_R_FLASH_SUB,
        on: flashOn,
        blocked: reasonText(blocks.flash, "flash"),
        onChange: async (on) => {
          if (!on) return set("flash", (q) => (q.showCorrectnessInstantly = false));
          if (quiz.allowBack && !(await askBackFlash())) return false;
          if (!(await askInstant())) return false;
          set("flash", (q) => (q.showCorrectnessInstantly = true));
        },
      }),
      ruleRow({
        ro,
        title: S.RULE_BACK,
        sub: S.QE_R_BACK_SUB,
        on: quiz.allowBack,
        onChange: async (on) => {
          if (on && flashOn && !(await askBackFlash())) return false;
          set("back", (q) => (q.allowBack = on));
        },
      }),
    ]),
    el("div", { class: "grp" }, [
      el("h5", { text: S.QE_SEC_REVIEW }),
      ruleRow({
        ro,
        title: S.RULE_SCORE,
        sub: S.QE_R_SCORE_SUB,
        on: quiz.showResult,
        onChange: async (on) => {
          if (on && !quiz.showResult && !(await askInstant())) return false;
          set("score", (q) => {
            q.showResult = on;
            q.showAnswers = on;
          });
        },
      }),
      // Show results — only while Show Score is off (the app's ResultsReleaseModeRow): when students see their
      // result. Not a stored default; written with the quiz (quizToRow), the announcement itself never is.
      quiz.showResult ? null : releaseRow({ quiz, ro, set }),
      ruleRow({ ro, title: S.RULE_RETAKE, sub: S.QE_R_RETAKE_SUB, on: quiz.allowRetake, onChange: (on) => set("retake", (q) => (q.allowRetake = on)) }),
    ]),
    el("div", { class: "grp" }, [
      el("h5", { text: S.QE_SEC_EVALUATION }),
      ruleRow({
        ro,
        title: S.RULE_MANUAL,
        sub: S.QE_R_MANUAL_SUB,
        on: manual && !blocks.manual,
        blocked: reasonText(blocks.manual),
        onChange: (on) =>
          set("manual", (q) => {
            q.manualMarkingDefault = on;
            if (on) {
              q.showCorrectnessInstantly = false;
              q.splitPointsAcrossChoices = false;
              q.timeWeightageEnabled = false;
            }
          }),
      }),
      ruleRow({ ro, title: S.RULE_PARTIAL, sub: S.QE_R_PARTIAL_SUB, on: quiz.splitPointsAcrossChoices && !blocks.partial, blocked: reasonText(blocks.partial, "partial"), onChange: (on) => set("partial", (q) => (q.splitPointsAcrossChoices = on)) }),
      ruleRow({ ro, title: S.RULE_RAPID, sub: S.QE_R_RAPID_SUB, on: quiz.timeWeightageEnabled && !rapidBlocked, blocked: rapidBlocked, onChange: (on) => set("rapid", (q) => (q.timeWeightageEnabled = on)) }),
    ]),
  ];
}

function paletteGroup(ctx, render) {
  const quiz = ctx.quiz();
  const current = QUIZ_THEMES.find((x) => x.name === quiz.themeColorName) ?? QUIZ_THEMES[0];
  return el("div", { class: "grp" }, [
    el("h5", {}, [S.QE_PALETTE, el("span", { class: "cname", text: current.name })]),
    el(
      "div",
      { class: "colors", role: "radiogroup", "aria-label": S.QE_PALETTE },
      QUIZ_THEMES.map((theme) =>
        el("button", {
          type: "button",
          role: "radio",
          class: theme.name === current.name ? "on" : "",
          "aria-checked": String(theme.name === current.name),
          title: theme.name,
          "aria-label": theme.name,
          vars: { c: theme.color },
          // A locked quiz keeps its rules but may change its theme (like the app).
          disabled: (ctx.themeReadOnly ?? ctx.readOnly)() || undefined,
          "data-fk": `theme-${theme.name}`,
          onclick: () => {
            ctx.setQuiz("theme", (q) => (q.themeColorName = theme.name));
            render();
          },
        })
      )
    ),
  ]);
}
