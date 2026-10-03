// Side panel, Quiz tab: details, schedule, share code and the three rule cards — a port of the
// app's QuizRuleCards.kt, including its dependency rules and "ask first" dialogs:
//
//  - Manual review ON forces Instant correctness, Partial credit and Rapid bonus OFF and locks
//    them (CreateQuizViewModel.onManualMarkingDefaultChanged).
//  - No question has a time limit → Timer, Preview and Rapid bonus are unavailable; their saved
//    values are kept and come back when a question gets a time limit.
//  - Timer OFF → Preview and Rapid bonus unavailable.
//  - Turning on Show score or Instant correctness asks first (answers could leak).
//  - Allow going back + Instant correctness together asks first (takers could fix answers).

import { PREVIEW_OPTIONS, QUIZ_THEMES, hasOnlyUntimedQuestions } from "../core/models.js";
import { S, t } from "../core/strings.js";
import { button, codeChip, confirmDialog, counter, el, field, switchControl, updateCounter } from "../ui/components.js";
import { icon } from "../ui/icons.js";

/**
 * ctx: { quiz(): live quiz, questions(): persisted-shape questions, setQuiz(key, fn, opts),
 *        limits, resetShareCode(), lastPreviewSec }
 */
export function settingsPanel(ctx) {
  const quiz = ctx.quiz();
  const untimed = hasOnlyUntimedQuestions(ctx.questions());
  const manual = quiz.manualMarkingDefault;
  const flashOn = quiz.showCorrectnessInstantly && !manual;
  const set = (key, change) => ctx.setQuiz(key, change, { structural: true });

  const previewBlocked = untimed ? S.PREVIEW_BLOCKED_NO_TIMED : !quiz.showTimers ? S.PREVIEW_BLOCKED_TIMER_OFF : null;
  const timerBlocked = untimed ? S.TIMER_BLOCKED_NO_TIMED : null;
  const rapidBlocked = manual ? S.RAPID_BLOCKED_MANUAL : untimed ? S.RAPID_BLOCKED_NO_TIMED : !quiz.showTimers ? S.RAPID_BLOCKED_TIMER_OFF : null;
  const previewOn = quiz.questionPreviewSec > 0;

  const askInstant = () =>
    confirmDialog({
      badge: S.HEADS_UP,
      title: S.INSTANT_WARNING_TITLE,
      body: S.INSTANT_WARNING_BODY,
      confirmLabel: S.INSTANT_WARNING_CONFIRM,
      cancelLabel: S.INSTANT_WARNING_CANCEL,
      danger: false,
    });
  const askBackFlash = () =>
    confirmDialog({
      badge: S.HEADS_UP,
      title: S.BACK_FLASH_WARNING_TITLE,
      body: t(S.BACK_FLASH_WARNING_BODY, { flash: S.RULE_FLASH, back: S.RULE_BACK }),
      confirmLabel: S.BACK_FLASH_WARNING_CONFIRM,
      cancelLabel: S.BACK_FLASH_WARNING_CANCEL,
      danger: false,
    });

  const mechanics = ruleCard(S.SECTION_MECHANICS, [
    rule({
      iconName: "hash",
      title: S.RULE_NUMBERED,
      sub: S.RULE_NUMBERED_SUB,
      checked: quiz.showQuestionNumbers,
      onChange: (on) => set("numbers", (q) => (q.showQuestionNumbers = on)),
    }),
    rule({
      iconName: "timer",
      title: S.RULE_TIMER,
      sub: S.RULE_TIMER_SUB,
      checked: quiz.showTimers && !timerBlocked,
      blocked: timerBlocked,
      onChange: (on) => set("timers", (q) => (q.showTimers = on)),
    }),
    rule({
      iconName: "eye",
      title: S.RULE_PREVIEW,
      sub: S.RULE_PREVIEW_SUB,
      checked: previewOn && !previewBlocked,
      blocked: previewBlocked,
      onChange: (on) =>
        set("preview", (q) => {
          q.questionPreviewSec = on ? ctx.lastPreviewSec() : 0;
        }),
      extra:
        previewOn && !previewBlocked
          ? el("div", { class: "rule-extra" }, [
              el("span", { class: "small muted", text: S.READING_TIME }),
              el(
                "div",
                { class: "row row-wrap" },
                PREVIEW_OPTIONS.map((sec) =>
                  el("button", {
                    type: "button",
                    class: `chip ${quiz.questionPreviewSec === sec ? "is-selected" : ""}`,
                    text: t(S.SECONDS_SHORT, { n: sec }),
                    onclick: () => set("preview-sec", (q) => (q.questionPreviewSec = sec)),
                  })
                )
              ),
            ])
          : null,
    }),
    rule({
      iconName: "bolt",
      title: S.RULE_FLASH,
      sub: S.RULE_FLASH_SUB,
      checked: flashOn,
      blocked: manual ? S.FLASH_BLOCKED_MANUAL : null,
      onChange: async (on) => {
        if (!on) return set("flash", (q) => (q.showCorrectnessInstantly = false));
        if (quiz.allowBack && !(await askBackFlash())) return false;
        if (!(await askInstant())) return false;
        set("flash", (q) => (q.showCorrectnessInstantly = true));
      },
    }),
    rule({
      iconName: "arrow-left",
      title: S.RULE_BACK,
      sub: S.RULE_BACK_SUB,
      checked: quiz.allowBack,
      onChange: async (on) => {
        if (on && flashOn && !(await askBackFlash())) return false;
        set("back", (q) => (q.allowBack = on));
      },
    }),
  ]);

  const review = ruleCard(S.SECTION_REVIEW, [
    rule({
      iconName: "chart",
      title: S.RULE_SCORE,
      sub: S.RULE_SCORE_SUB,
      checked: quiz.showResult,
      onChange: async (on) => {
        if (on && !quiz.showResult && !(await askInstant())) return false;
        set("score", (q) => {
          q.showResult = on;
          q.showAnswers = on;
        });
      },
    }),
    rule({
      iconName: "refresh",
      title: S.RULE_RETAKE,
      sub: S.RULE_RETAKE_SUB,
      checked: quiz.allowRetake,
      onChange: (on) => set("retake", (q) => (q.allowRetake = on)),
    }),
  ]);

  const evaluation = ruleCard(S.SECTION_EVALUATION, [
    rule({
      iconName: "marking",
      title: S.RULE_MANUAL,
      sub: S.RULE_MANUAL_SUB,
      checked: manual,
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
    rule({
      iconName: "multiple",
      title: S.RULE_PARTIAL,
      sub: S.RULE_PARTIAL_SUB,
      checked: quiz.splitPointsAcrossChoices && !manual,
      blocked: manual ? S.PARTIAL_BLOCKED_MANUAL : null,
      onChange: (on) => set("partial", (q) => (q.splitPointsAcrossChoices = on)),
    }),
    rule({
      iconName: "sparkles",
      title: S.RULE_RAPID,
      sub: S.RULE_RAPID_SUB,
      checked: quiz.timeWeightageEnabled && !rapidBlocked,
      blocked: rapidBlocked,
      onChange: (on) => set("rapid", (q) => (q.timeWeightageEnabled = on)),
    }),
  ]);

  return el("div", { class: "stack-lg" }, [detailsCard(ctx), scheduleCard(ctx), mechanics, review, evaluation]);
}

function ruleCard(title, rows) {
  return el("section", { class: "rule-card" }, [el("h3", { class: "section-label", text: title }), el("div", { class: "rule-list" }, rows)]);
}

function rule({ iconName, title, sub, checked, onChange, blocked = null, extra = null }) {
  return el("div", { class: `rule ${blocked ? "is-blocked" : ""}` }, [
    el("div", { class: "rule-main" }, [
      el("span", { class: "rule-icon" }, [icon(iconName)]),
      el("div", { class: "grow" }, [el("div", { class: "rule-title", text: title }), el("div", { class: "rule-sub", text: blocked ?? sub })]),
      switchControl({ checked, disabled: !!blocked, label: title, fk: `rule-${title}`, onChange }),
    ]),
    extra,
  ]);
}

function detailsCard(ctx) {
  const quiz = ctx.quiz();
  const max = 60;
  const groupCount = counter((quiz.groupName ?? "").length, max);
  const group = el("input", {
    class: "input",
    type: "text",
    dir: "auto",
    value: quiz.groupName ?? "",
    maxlength: String(max),
    placeholder: S.GROUP_PLACEHOLDER,
    "data-fk": "quiz-group",
  });
  group.addEventListener("input", () => {
    updateCounter(groupCount, group.value.length, max);
    ctx.setQuiz("group", (q) => (q.groupName = group.value));
  });

  const swatches = el(
    "div",
    { class: "swatches", role: "radiogroup", "aria-label": S.THEME_LABEL },
    QUIZ_THEMES.map((theme) =>
      el(
        "button",
        {
          type: "button",
          role: "radio",
          class: `swatch ${quiz.themeColorName === theme.name ? "is-selected" : ""}`,
          "aria-checked": quiz.themeColorName === theme.name ? "true" : "false",
          "aria-label": theme.name,
          title: theme.name,
          vars: { swatch: theme.color },
          onclick: () => ctx.setQuiz("theme", (q) => (q.themeColorName = theme.name), { structural: true }),
        },
        [icon("check", "icon icon-sm")]
      )
    )
  );

  const defaultTime = el(
    "select",
    { class: "select", "data-fk": "default-time" },
    [10, 15, 20, 30, 45, 60, 90, 120].map((sec) => el("option", { value: String(sec), text: t(S.SECONDS_SHORT, { n: sec }), selected: quiz.defaultTimeSec === sec }))
  );
  defaultTime.addEventListener("change", () => ctx.setQuiz("default-time", (q) => (q.defaultTimeSec = Number(defaultTime.value))));

  const shareRow = quiz.shareCode
    ? el("div", { class: "row row-wrap" }, [
        codeChip(quiz.shareCode),
        button({
          label: S.RESET_CODE,
          icon: "refresh",
          variant: "ghost",
          size: "sm",
          onClick: async () => {
            if (!quiz.isDraft) {
              const ok = await confirmDialog({ title: S.RESET_CODE_TITLE, body: S.RESET_CODE_BODY, confirmLabel: S.RESET_CODE, danger: false });
              if (!ok) return;
            }
            await ctx.resetShareCode();
          },
        }),
      ])
    : el("p", { class: "small muted", text: S.CODE_ON_FIRST_SAVE });

  return el("section", { class: "rule-card" }, [
    el("h3", { class: "section-label", text: S.SECTION_DETAILS }),
    el("div", { class: "stack" }, [
      field({ label: S.GROUP_LABEL, control: group, counterNode: groupCount }),
      field({ label: S.THEME_LABEL, control: swatches }),
      field({ label: S.DEFAULT_TIME_LABEL, control: defaultTime, hint: S.DEFAULT_TIME_HINT }),
      field({ label: S.SHARE_CODE_LABEL, control: shareRow, hint: quiz.isDraft ? S.SHARE_CODE_DRAFT_HINT : null }),
    ]),
  ]);
}

/** Epoch ms ⇄ <input type="datetime-local"> value, in local time. */
function toLocalInput(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function scheduleCard(ctx) {
  const quiz = ctx.quiz();
  const input = (key, value) => {
    const node = el("input", { class: "input", type: "datetime-local", value: toLocalInput(value), "data-fk": `sched-${key}` });
    node.addEventListener("change", () =>
      ctx.setQuiz(`sched-${key}`, (q) => (q[key] = fromLocalInput(node.value)), { structural: true })
    );
    return node;
  };
  const clear = (key) =>
    button({ label: S.CLEAR, icon: "x", variant: "ghost", iconOnly: true, size: "sm", onClick: () => ctx.setQuiz(`sched-${key}`, (q) => (q[key] = null), { structural: true }) });

  const bad = quiz.startAt && quiz.endAt && quiz.endAt <= quiz.startAt;
  return el("section", { class: "rule-card" }, [
    el("h3", { class: "section-label", text: S.SECTION_SCHEDULE }),
    el("div", { class: "stack" }, [
      field({ label: S.SCHEDULE_START, control: el("div", { class: "row" }, [input("startAt", quiz.startAt), quiz.startAt ? clear("startAt") : null]), hint: quiz.startAt ? null : S.SCHEDULE_START_NONE }),
      field({ label: S.SCHEDULE_END, control: el("div", { class: "row" }, [input("endAt", quiz.endAt), quiz.endAt ? clear("endAt") : null]), hint: quiz.endAt ? null : S.SCHEDULE_END_NONE, error: bad ? S.SCHEDULE_END_BEFORE_START : null }),
    ]),
  ]);
}
