// Mark one person (/grading/?attempt=). Split view: their questions on the left (with the running
// score and the overall note), the current question on the right.
//
// Mirrors GradeSubmissionViewModel: every scored question is listed — hand-marked and
// auto-graded — so the owner can override any of them; a pending answer starts with no mark;
// "Save & next" saves only the current question (one save_grades call), with a 5-second Undo
// that puts an auto-graded answer's original verdict back rather than leaving it "adjusted".

import { GradesNotSavedError, saveGrades } from "../core/results.js";
import { GRADE_FEEDBACK_MAX_CHARS, VERDICT, scoreBreakdown, untouchedAutoVerdict } from "../core/scoring.js";
import { S, t } from "../core/strings.js";
import {
  avatar,
  button,
  counter,
  el,
  emptyState,
  errorBlock,
  formatDateTime,
  loadingBlock,
  pill,
  segmented,
  swap,
  toast,
  updateCounter,
  withLoading,
} from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { enter } from "../ui/motion.js";
import { typeLabel } from "../create/outline.js";
import { answerView, questionHeading } from "./answer-view.js";
import { NotOwnerError, buildItems, itemChanged, itemFor, loadAttemptForMarking } from "./data.js";
import { markControls, markText, verdictBadge } from "./mark-controls.js";
import { nextAttemptToMark } from "./next.js";
import { quickComments } from "./quick-comments.js";
import { route } from "../core/paths.js";

export async function renderMarkPerson(shell, user, attemptId) {
  const params = new URLSearchParams(window.location.search);
  const s = {
    attempt: null,
    quiz: null,
    questions: [],
    items: [],
    name: "",
    /** Auto verdicts as first loaded, for Undo of an override. */
    originalAuto: new Map(),
    filter: "ALL",
    index: 0,
    overall: "",
    savedOverall: "",
    saving: false,
    done: false,
    lastUndo: null,
  };
  let controls = null;
  let sideList = null;
  let summaryNode = null;
  let main = null;
  let side = null;

  shell.setTitle(S.MARK_SUBMISSION);
  shell.content.replaceChildren(loadingBlock());

  async function load(keepPosition = false) {
    try {
      const data = await loadAttemptForMarking(attemptId, user);
      s.attempt = data.attempt;
      s.quiz = data.quiz;
      s.questions = data.questions;
      s.name = data.name || S.ANONYMOUS;
      const previous = s.items;
      s.items = buildItems(data.questions, data.answers);
      if (!s.originalAuto.size) {
        for (const a of data.answers) {
          const auto = untouchedAutoVerdict(a);
          if (auto) s.originalAuto.set(a.question_id, auto);
        }
      }
      s.overall = s.savedOverall = data.attempt.overall_feedback ?? "";
      if (!keepPosition || !previous.length) {
        const wanted = params.get("q");
        const at = wanted ? s.items.findIndex((i) => i.question.id === wanted) : -1;
        const firstPending = s.items.findIndex((i) => i.needsMarking && i.mark == null);
        s.index = at >= 0 ? at : Math.max(0, firstPending);
      }
      shell.setTitle(s.name);
      shell.setCrumbs([
        { label: S.NAV_GRADING, href: route("grading/") },
        { label: s.quiz.title?.trim() || S.UNTITLED_QUIZ, href: route(`grading/?quiz=${encodeURIComponent(s.quiz.id)}`) },
        { label: s.name },
      ]);
      shell.setActions([
        button({ label: S.VIEW_RESULTS, icon: "chart", variant: "ghost", cls: "hide-phone", href: route(`results/?id=${encodeURIComponent(s.quiz.id)}`) }),
      ]);
      build();
    } catch (error) {
      console.error(error);
      if (error instanceof NotOwnerError) {
        shell.content.replaceChildren(
          el("div", { class: "card" }, [emptyState({ art: "people", title: S.SUBMISSION_NOT_FOUND, body: S.SUBMISSION_NOT_FOUND_BODY, actions: [button({ label: S.BACK_TO_QUEUE, href: route("grading/") })] })])
        );
      } else {
        shell.content.replaceChildren(errorBlock(S.ERR_LOAD_FAILED, () => load(keepPosition)));
      }
    }
  }

  const visible = () =>
    s.items.filter((item) => (s.filter === "TYPED" ? item.typed : s.filter === "NOT_ADJUSTED" ? !item.ownerReviewed : true));
  const current = () => visible()[Math.min(s.index, visible().length - 1)] ?? null;
  const dirty = () => s.items.some(itemChanged) || s.overall.trim() !== s.savedOverall.trim();

  function build() {
    if (!s.items.length) {
      shell.content.replaceChildren(el("div", { class: "card" }, [emptyState({ art: "done", title: S.NOTHING_TO_MARK, body: S.NOTHING_TO_MARK_BODY })]));
      return;
    }
    side = el("aside", { class: "card mark-side" });
    main = el("section", { class: "mark-main" });
    shell.content.classList.add("page-wide");
    shell.content.replaceChildren(el("div", { class: "mark-split" }, [side, main]));
    renderSide();
    renderMain();
  }

  // ── Left: person, score, question list, overall note ──────────────────────

  function renderSide() {
    const saved = s.items.map((i) => i.answer);
    const breakdown = scoreBreakdown(saved);
    summaryNode = el("div", { class: "score-box" }, [
      breakdown.hasMarks ? scoreStat(S.MARKS, `${breakdown.marksAwarded} / ${breakdown.marksTotal}`) : null,
      scoreStat(S.CORRECT, `${breakdown.totalCorrect} / ${breakdown.questionCount}`),
      scoreStat(S.TO_MARK, String(breakdown.pendingCount), breakdown.pendingCount ? "is-warn" : ""),
    ]);

    sideList = el("ol", { class: "mark-qlist" });
    renderSideList();

    const max = GRADE_FEEDBACK_MAX_CHARS;
    const count = counter(s.overall.length, max);
    const overall = el("textarea", {
      class: "textarea",
      rows: "3",
      dir: "auto",
      maxlength: String(max),
      value: s.overall,
      placeholder: S.OVERALL_FEEDBACK_PLACEHOLDER,
      "data-fk": "overall",
    });
    overall.addEventListener("input", () => {
      s.overall = overall.value;
      updateCounter(count, overall.value.length, max);
    });

    swap(
      side,
      el("div", { class: "mark-person" }, [
        avatar(s.name, { large: true }),
        el("div", { class: "grow" }, [
          el("div", { class: "strong ellipsis", dir: "auto", text: s.name }),
          el("div", { class: "small muted ellipsis", dir: "auto", text: s.quiz.title }),
          el("div", { class: "small faint", text: t(S.SUBMITTED_WHEN, { when: formatDateTime(s.attempt.finished_at) }) }),
        ]),
      ]),
      summaryNode,
      el("div", { class: "section-label", text: S.QUESTIONS }),
      sideList,
      el("div", { class: "field mark-overall" }, [
        el("div", { class: "label-row" }, [el("label", { class: "label", text: S.OVERALL_FEEDBACK_LABEL }), count]),
        overall,
        el("p", { class: "hint-text", text: S.OVERALL_FEEDBACK_HINT }),
      ])
    );
  }

  function scoreStat(label, value, cls = "") {
    return el("div", { class: `score-stat ${cls}` }, [el("span", { class: "score-value mono", text: value }), el("span", { class: "score-label", text: label })]);
  }

  function renderSideList() {
    const shown = visible();
    const cur = current();
    sideList.replaceChildren(
      ...s.items.map((item) =>
        el("li", {}, [
          el(
            "button",
            {
              type: "button",
              class: `mark-qrow ${item === cur ? "is-current" : ""} ${shown.includes(item) ? "" : "is-filtered"} ${itemChanged(item) ? "is-unsaved" : ""}`,
              onclick: () => goTo(item),
            },
            [
              el("span", { class: "outline-num", text: String(item.number) }),
              el("span", { class: "grow ellipsis", dir: "auto", text: questionHeading(item.question).title }),
              itemChanged(item) ? el("span", { class: "dot is-primary", title: S.UNSAVED_CHANGES }) : null,
              el("span", { class: "mono small nowrap", text: markText(item.mark, item.max) }),
              verdictBadge(item.mark, item.max, { pending: item.mark == null }),
            ]
          ),
        ])
      )
    );
  }

  // ── Right: the current question ───────────────────────────────────────────

  function renderMain() {
    if (s.done) return renderSummary();
    const shown = visible();
    const item = current();
    if (!item) {
      swap(main, filterBar(), el("div", { class: "card" }, [emptyState({ art: "done", title: S.FILTER_EMPTY, body: S.FILTER_EMPTY_BODY })]));
      return;
    }
    const pos = shown.indexOf(item);
    const heading = questionHeading(item.question);

    const segments = el(
      "div",
      { class: "segments", "aria-hidden": "true" },
      shown.map((it) => el("span", { class: `segment ${it === item ? "is-current" : it.savedMark != null ? "is-done" : "is-todo"}` }))
    );

    controls = markControls({
      max: item.max,
      mark: item.mark,
      onChange: (mark) => {
        item.mark = mark;
        renderSideList();
        statusNode.replaceChildren(...statusParts(item));
      },
    });

    const statusNode = el("div", { class: "row row-wrap mark-status" }, statusParts(item));

    const card = el("article", { class: "card mark-card" }, [
      el("div", { class: "mark-card-head" }, [
        el("div", { class: "grow" }, [
          el("div", { class: "editor-kicker", text: t(S.Q_N_OF, { n: pos + 1, total: shown.length }) }),
          el("div", { class: "small muted", text: `${typeLabel(item.question.type)} · ${item.max > 0 ? t(S.N_MARKS, { n: item.max }) : S.NO_MARKS}` }),
        ]),
        statusNode,
      ]),
      segments,
      el("h2", { class: "mark-question", dir: "auto", text: heading.title || S.UNTITLED_QUESTION }),
      heading.sentence ? el("p", { class: "muted", dir: "auto", text: heading.sentence }) : null,
      answerView(item.question, item.answer),
      el("div", { class: "mark-panel" }, [controls.node]),
      feedbackField(item),
      el("div", { class: "mark-actions" }, [
        button({ label: S.PREVIOUS, icon: "chevron-left", variant: "ghost", disabled: pos === 0, kbd: "K", onClick: () => step(-1) }),
        el("span", { class: "grow" }),
        item.needsMarking && item.mark != null
          ? button({
              label: S.CLEAR_MARK,
              variant: "ghost",
              onClick: () => {
                item.mark = null;
                controls.setMark(null);
                renderSideList();
                statusNode.replaceChildren(...statusParts(item));
              },
            })
          : null,
        saveNextButton(pos === shown.length - 1),
      ]),
    ]);
    swap(main, filterBar(), enter(card));
  }

  function statusParts(item) {
    const parts = [];
    if (item.needsMarking) parts.push(item.savedMark == null ? pill(S.STATUS_TO_MARK, "warn", { dot: true }) : pill(S.MARKED, "success", { iconName: "check" }));
    else if (item.ownerReviewed) parts.push(pill(S.ADJUSTED_BY_YOU, "primary", { iconName: "pencil" }));
    else parts.push(pill(S.AUTO_GRADED, "info", { iconName: "bolt" }));
    if (itemChanged(item)) parts.push(pill(S.UNSAVED, "", { dot: true }));
    return parts;
  }

  function saveNextButton(isLast) {
    const btn = button({ label: isLast ? S.SAVE_AND_FINISH : S.SAVE_AND_NEXT, iconRight: "arrow-right", variant: "primary", kbd: "Enter", cls: "save-next" });
    btn.addEventListener("click", () => withLoading(btn, saveAndNext));
    return btn;
  }

  function filterBar() {
    const typed = s.items.filter((i) => i.typed).length;
    const notAdjusted = s.items.filter((i) => !i.ownerReviewed).length;
    return el("div", { class: "row row-wrap mark-filter" }, [
      segmented({
        label: "mark-filter",
        value: s.filter,
        options: [
          { value: "ALL", label: S.FILTER_ALL, count: s.items.length },
          { value: "TYPED", label: S.FILTER_TYPED, count: typed },
          { value: "NOT_ADJUSTED", label: S.FILTER_NOT_ADJUSTED, count: notAdjusted },
        ],
        onChange: (value) => {
          const item = current();
          s.filter = value;
          const next = visible();
          s.index = Math.max(0, next.indexOf(item));
          s.done = false;
          renderSideList();
          renderMain();
        },
      }),
    ]);
  }

  function feedbackField(item) {
    const max = GRADE_FEEDBACK_MAX_CHARS;
    const count = counter(item.feedback.length, max);
    const area = el("textarea", {
      class: "textarea",
      rows: "2",
      dir: "auto",
      maxlength: String(max),
      value: item.feedback,
      placeholder: S.FEEDBACK_PLACEHOLDER,
      "data-fk": "feedback",
      "data-feedback": "true",
    });
    area.addEventListener("input", () => {
      item.feedback = area.value;
      updateCounter(count, area.value.length, max);
      renderSideList();
    });
    const chips = quickComments({
      getText: () => area.value,
      setText: (text) => {
        area.value = text;
        area.dispatchEvent(new Event("input"));
        area.focus();
      },
    });
    return el("div", { class: "field" }, [
      el("div", { class: "label-row" }, [el("label", { class: "label", text: S.FEEDBACK_LABEL }), count]),
      area,
      chips,
    ]);
  }

  // ── Navigation & saving ───────────────────────────────────────────────────

  function goTo(item) {
    if (!visible().includes(item)) s.filter = "ALL";
    s.index = visible().indexOf(item);
    s.done = false;
    renderSideList();
    renderMain();
  }

  function step(delta) {
    const shown = visible();
    const next = Math.max(0, Math.min(shown.length - 1, s.index + delta));
    if (next === s.index) return;
    s.index = next;
    s.done = false;
    renderSideList();
    renderMain();
  }

  async function saveAndNext() {
    if (s.saving) return;
    const item = current();
    if (!item) return;
    // An auto-graded answer can't be cleared to "pending" — that state belongs only to answers
    // that need hand-marking. Treat an emptied box as "no change".
    if (item.mark == null && !item.needsMarking) item.mark = item.savedMark;

    const markChanged = item.mark !== item.savedMark;
    const feedbackChanged = item.feedback.trim() !== item.savedFeedback.trim();
    const overallChanged = s.overall.trim() !== s.savedOverall.trim();

    if (markChanged || feedbackChanged || overallChanged) {
      const marks = new Map();
      const questionFeedback = new Map();
      if (markChanged) marks.set(item.question.id, { mark: item.mark, maxPoints: item.max });
      if (feedbackChanged) questionFeedback.set(item.question.id, item.feedback);
      const undo = {
        questionId: item.question.id,
        mark: markChanged ? { mark: item.savedMark, maxPoints: item.max, wasAuto: !item.ownerReviewed && !item.needsMarking } : null,
        feedback: feedbackChanged ? item.savedFeedback : undefined,
        overall: overallChanged ? s.savedOverall : undefined,
      };
      const ok = await persist({ marks, questionFeedback, overallFeedback: overallChanged ? s.overall : undefined });
      if (!ok) return;
      s.lastUndo = undo;
      toast(S.MARKS_SAVED, { tone: "success", duration: 5000, action: { label: S.UNDO, onClick: undoLast } });
    }

    const shown = visible();
    if (s.index >= shown.length - 1) s.done = true;
    else s.index += 1;
    renderSide();
    renderMain();
  }

  /** Saves and merges the server's copy back in, keeping unsaved edits on other questions. */
  async function persist(payload) {
    s.saving = true;
    try {
      const result = await saveGrades(attemptId, payload);
      const byQuestion = new Map(result.answers.map((a) => [a.question_id, a]));
      s.items = s.items.map((old) => {
        const answer = byQuestion.get(old.question.id);
        if (!answer) return old;
        const fresh = itemFor(old.question, answer, old.number);
        const touchedNow = payload.marks?.has(old.question.id) || payload.questionFeedback?.has(old.question.id) || payload.restore?.has(old.question.id);
        if (!touchedNow && itemChanged(old)) {
          fresh.mark = old.mark;
          fresh.feedback = old.feedback;
        }
        return fresh;
      });
      if (payload.overallFeedback !== undefined) s.savedOverall = s.overall = payload.overallFeedback ?? "";
      return true;
    } catch (error) {
      console.error(error);
      if (error instanceof GradesNotSavedError) {
        toast(S.GRADES_NOT_SAVED_RETAKE, { tone: "error", duration: 6000 });
        await load(true);
      } else {
        toast(S.ERR_SAVE_FAILED, { tone: "error" });
      }
      return false;
    } finally {
      s.saving = false;
    }
  }

  async function undoLast() {
    const undo = s.lastUndo;
    if (!undo) return;
    s.lastUndo = null;
    const payload = { marks: new Map(), questionFeedback: new Map(), restore: new Map() };
    if (undo.mark) {
      const auto = s.originalAuto.get(undo.questionId);
      if (undo.mark.wasAuto && auto) payload.restore.set(undo.questionId, auto);
      else payload.marks.set(undo.questionId, { mark: undo.mark.mark, maxPoints: undo.mark.maxPoints });
    }
    if (undo.feedback !== undefined) payload.questionFeedback.set(undo.questionId, undo.feedback);
    if (undo.overall !== undefined) {
      payload.overallFeedback = undo.overall;
      s.overall = undo.overall;
    }
    if (await persist(payload)) {
      const item = s.items.find((i) => i.question.id === undo.questionId);
      if (item) goTo(item);
      renderSide();
      toast(S.UNDONE, { tone: "info" });
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  async function renderSummary() {
    const breakdown = scoreBreakdown(s.items.map((i) => i.answer));
    const left = breakdown.pendingCount;
    const nextBtn = button({ label: S.NEXT_PERSON, iconRight: "arrow-right", variant: "primary", kbd: "N", cls: "next-person" });
    nextBtn.addEventListener("click", () => withLoading(nextBtn, goNextPerson));
    swap(
      main,
      enter(
        el("article", { class: "card mark-summary" }, [
          el("div", { class: "summary-badge" }, [icon(left ? "marking" : "check-circle", "icon icon-lg")]),
          el("h2", { dir: "auto", text: left ? t(S.SUMMARY_PARTLY, { name: s.name }) : t(S.SUMMARY_DONE, { name: s.name }) }),
          el("p", {
            class: "muted",
            text: [
              breakdown.hasMarks ? t(S.SUMMARY_MARKS, { got: breakdown.marksAwarded, total: breakdown.marksTotal }) : null,
              t(S.SUMMARY_CORRECT, { n: breakdown.totalCorrect, total: breakdown.questionCount }),
            ]
              .filter(Boolean)
              .join(" · "),
          }),
          left ? el("p", { class: "banner banner-warn", text: t(S.SUMMARY_LEFT, { n: left }) }) : null,
          el("div", { class: "row row-wrap row-center" }, [
            left
              ? button({ label: S.GO_TO_UNMARKED, variant: "secondary", onClick: () => goTo(s.items.find((i) => i.needsMarking && i.mark == null)) })
              : null,
            button({ label: S.BACK_TO_QUEUE, variant: "ghost", href: route("grading/") }),
            nextBtn,
          ]),
        ])
      )
    );
  }

  async function goNextPerson() {
    try {
      const nextId = await nextAttemptToMark(s.quiz.id, attemptId);
      if (nextId) window.location.href = route(`grading/?attempt=${encodeURIComponent(nextId)}`);
      else {
        toast(S.NO_ONE_ELSE, { tone: "success" });
        window.location.href = route(`grading/?quiz=${encodeURIComponent(s.quiz.id)}`);
      }
    } catch (error) {
      console.error(error);
      toast(S.ERR_LOAD_FAILED, { tone: "error" });
    }
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────

  document.addEventListener("keydown", (e) => {
    if (!s.items.length || document.querySelector(".overlay, .menu")) return;
    const target = e.target;
    const typing = target instanceof HTMLElement && (target.tagName === "TEXTAREA" || (target.tagName === "INPUT" && !target.dataset.markInput) || target.tagName === "SELECT");
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === "z" && !typing) {
      e.preventDefault();
      undoLast();
      return;
    }
    if (e.key === "Enter" && !mod && !e.shiftKey && target?.tagName !== "TEXTAREA" && target?.tagName !== "BUTTON" && target?.tagName !== "A") {
      if (s.done) return;
      e.preventDefault();
      document.querySelector(".save-next")?.click();
      return;
    }
    if (typing || mod || e.altKey) return;
    const key = e.key.toLowerCase();
    if (s.done) {
      if (key === "n") document.querySelector(".next-person")?.click();
      return;
    }
    if (key === "c") controls?.applyVerdict(VERDICT.CORRECT);
    else if (key === "p") controls?.applyVerdict(VERDICT.PARTIAL);
    else if (key === "x") controls?.applyVerdict(VERDICT.INCORRECT);
    else if (key === "f") {
      e.preventDefault();
      document.querySelector("[data-feedback]")?.focus();
    } else if (key === "j" || e.key === "ArrowRight") step(1);
    else if (key === "k" || e.key === "ArrowLeft") step(-1);
    else if (/^[0-9]$/.test(e.key) && !(target?.dataset?.markInput)) {
      if (controls?.focusNumber(e.key)) e.preventDefault();
    }
  });

  window.addEventListener("beforeunload", (e) => {
    if (dirty()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  await load();
}
