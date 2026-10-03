// Mark by question (/grading/?quiz=…&by=question): one question at a time; every distinct
// answer is one card showing who gave it, and a mark set on a card applies to everyone in it.
//
// Grouping and eligibility follow GradeByQuestionViewModel.kt: answers are grouped by
// normalizeAnswerKey (joined, trimmed, lower-cased, spaces collapsed), largest group first;
// typed questions (Written / Fill in the blanks) can always be re-marked here, other types only
// while still pending. Unlike the phone, answers given by only one person are listed too.
// Each member's mark is clamped to their own max (memberMarkFor).

import { GradesNotSavedError, saveGrades } from "../core/results.js";
import { VERDICT, currentMark, isPendingMarking, memberMarkFor, untouchedAutoVerdict, verdictOf } from "../core/scoring.js";
import { S, t } from "../core/strings.js";
import { avatar, button, el, emptyState, errorBlock, loadingBlock, pill, progressBar, toast, withLoading } from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { stagger } from "../ui/motion.js";
import { typeLabel } from "../create/outline.js";
import { questionHeading } from "./answer-view.js";
import { NotOwnerError, TYPED, givenList, loadOwnedQuiz, loadQuizAttempts, normalizeAnswerKey } from "./data.js";
import { markControls, markText } from "./mark-controls.js";
import { QUESTION_TYPES } from "../core/models.js";
import { route } from "../core/paths.js";

export async function renderMarkByQuestion(shell, user, quizId) {
  const params = new URLSearchParams(window.location.search);
  const s = { quiz: null, questions: [], qIndex: 0, groups: [], members: new Map(), originalAuto: new Map(), lastUndo: null, saving: false };
  let cardControls = [];

  shell.setTitle(S.MARK_BY_QUESTION);
  shell.content.replaceChildren(loadingBlock());

  async function load(keepQuestionId = null) {
    try {
      const { quiz, questions } = await loadOwnedQuiz(quizId, user);
      const { attempts, answersByAttempt, names } = await loadQuizAttempts(quizId);
      s.quiz = quiz;
      // question id -> members
      s.members = new Map();
      for (const attempt of attempts) {
        for (const answer of answersByAttempt.get(attempt.id) ?? []) {
          if (!s.originalAuto.has(answer.id)) {
            const auto = untouchedAutoVerdict(answer);
            if (auto) s.originalAuto.set(answer.id, auto);
          }
          const list = s.members.get(answer.question_id) ?? [];
          list.push({ attempt, answer, name: names.get(attempt.user_id) || S.ANONYMOUS });
          s.members.set(answer.question_id, list);
        }
      }
      s.questions = questions.filter((q) => {
        if (q.type === QUESTION_TYPES.POLL) return false;
        return eligible(q).length > 0;
      });
      const wanted = keepQuestionId ?? params.get("q");
      const at = wanted ? s.questions.findIndex((q) => q.id === wanted) : -1;
      const firstPending = s.questions.findIndex((q) => eligible(q).some((m) => isPendingMarking(m.answer)));
      s.qIndex = at >= 0 ? at : Math.max(0, firstPending);

      shell.setCrumbs([
        { label: S.NAV_GRADING, href: route("grading/") },
        { label: quiz.title?.trim() || S.UNTITLED_QUIZ, href: route(`grading/?quiz=${encodeURIComponent(quiz.id)}`) },
        { label: S.MARK_BY_QUESTION },
      ]);
      render();
    } catch (error) {
      console.error(error);
      shell.content.replaceChildren(
        error instanceof NotOwnerError
          ? el("div", { class: "card" }, [emptyState({ art: "quizzes", title: S.ERR_NOT_FOUND, body: S.ERR_NOT_FOUND_BODY, actions: [button({ label: S.BACK_TO_QUEUE, href: route("grading/") })] })])
          : errorBlock(S.ERR_LOAD_FAILED, () => load(keepQuestionId))
      );
    }
  }

  /** Members whose answer to [question] can be marked here. */
  function eligible(question) {
    const typed = TYPED.has(question.type);
    return (s.members.get(question.id) ?? []).filter((m) => typed || isPendingMarking(m.answer));
  }

  function buildGroups(question) {
    const byKey = new Map();
    for (const member of eligible(question)) {
      const given = givenList(member.answer);
      const blank = given.every((g) => !g.trim());
      const key = blank ? "" : normalizeAnswerKey(given);
      const group = byKey.get(key) ?? { key, display: blank ? "" : given.filter((g) => g.trim()).join(question.type === QUESTION_TYPES.FILL_BLANK ? " · " : ", "), blank, members: [], mark: undefined };
      group.members.push(member);
      byKey.set(key, group);
    }
    return [...byKey.values()].sort((a, b) => b.members.length - a.members.length);
  }

  const groupMax = (group) => Math.max(...group.members.map((m) => Math.max(0, m.answer.max_points ?? 0)));
  /** The mark shared by every member, or null when mixed / pending. */
  function sharedMark(group) {
    const marks = group.members.map((m) => currentMark(m.answer));
    return marks.every((m) => m === marks[0]) ? marks[0] : null;
  }
  const changedGroups = () => s.groups.filter((g) => g.mark !== undefined && g.mark !== null);

  function render() {
    if (!s.questions.length) {
      shell.content.replaceChildren(
        el("div", { class: "card" }, [emptyState({ art: "done", title: S.ALL_CAUGHT_UP, body: S.ALL_CAUGHT_UP_QUIZ, actions: [button({ label: S.BACK_TO_QUEUE, href: route("grading/") })] })])
      );
      return;
    }
    const question = s.questions[s.qIndex];
    s.groups = buildGroups(question);
    const heading = questionHeading(question);
    const members = eligible(question);
    const markedCount = members.filter((m) => !isPendingMarking(m.answer)).length;

    const select = el(
      "select",
      { class: "select bq-select", "aria-label": S.QUESTION },
      s.questions.map((q, i) => {
        const pendingHere = eligible(q).filter((m) => isPendingMarking(m.answer)).length;
        return el("option", { value: String(i), selected: i === s.qIndex, text: `${t(S.Q_N, { n: i + 1 })} — ${questionHeading(q).title.slice(0, 60)}${pendingHere ? ` (${pendingHere})` : ""}` });
      })
    );
    select.addEventListener("change", () => goQuestion(Number(select.value)));

    const key = keyText(question);
    const head = el("article", { class: "card bq-head" }, [
      el("div", { class: "row row-wrap" }, [
        button({ label: S.PREVIOUS_QUESTION, icon: "chevron-left", variant: "ghost", iconOnly: true, disabled: s.qIndex === 0, onClick: () => goQuestion(s.qIndex - 1) }),
        select,
        button({ label: S.NEXT_QUESTION, icon: "chevron-right", variant: "ghost", iconOnly: true, disabled: s.qIndex === s.questions.length - 1, onClick: () => goQuestion(s.qIndex + 1) }),
        el("span", { class: "grow" }),
        pill(typeLabel(question.type), "primary"),
      ]),
      el("h2", { class: "mark-question", dir: "auto", text: heading.title || S.UNTITLED_QUESTION }),
      heading.sentence ? el("p", { class: "muted", dir: "auto", text: heading.sentence }) : null,
      key ? el("div", { class: "answer-box is-key" }, [el("span", { class: "answer-label", text: S.ANSWER_KEY }), el("p", { class: "answer-text", dir: "auto", text: key })]) : null,
      el("div", { class: "row bq-progress" }, [
        el("div", { class: "grow" }, [progressBar(markedCount, members.length, { label: S.MARKING_PROGRESS })]),
        el("span", { class: "small muted nowrap", text: t(S.MARKED_OF, { done: markedCount, total: members.length }) }),
      ]),
    ]);

    cardControls = [];
    const grid = el("div", { class: "bq-grid" }, s.groups.map((group, i) => groupCard(group, i)));
    stagger(grid);

    const saveBtn = button({ label: s.qIndex === s.questions.length - 1 ? S.SAVE_MARKS : S.SAVE_AND_NEXT_QUESTION, iconRight: "arrow-right", variant: "primary", kbd: "Enter", cls: "bq-save" });
    saveBtn.addEventListener("click", () => withLoading(saveBtn, () => saveQuestion(true)));

    shell.content.classList.add("page-wide");
    shell.content.replaceChildren(
      head,
      el("p", { class: "small muted bq-hint", text: S.BY_QUESTION_HINT }),
      grid,
      el("div", { class: "bq-footer" }, [
        el("span", { class: "small muted bq-changed", text: "" }),
        el("span", { class: "grow" }),
        saveBtn,
      ])
    );
    updateFooter();
  }

  function keyText(question) {
    if (question.type === QUESTION_TYPES.WRITTEN) return question.writtenAnswer ?? "";
    if (question.type === QUESTION_TYPES.FILL_BLANK) {
      return (question.fillBlank?.blanks ?? []).map((b) => (b.acceptedAnswers ?? []).filter(Boolean).join(" / ")).join(" · ");
    }
    return (question.correct ?? []).join(", ");
  }

  function groupCard(group, index) {
    const max = groupMax(group);
    const shared = sharedMark(group);
    const statusNode = el("div", { class: "row bq-status" });
    const setStatus = () => {
      const changed = group.mark !== undefined && group.mark !== null;
      card.classList.toggle("is-changed", changed);
      statusNode.replaceChildren(
        changed
          ? pill(S.UNSAVED, "primary", { dot: true })
          : shared !== null
            ? pill(markText(shared, max), verdictTone(shared, max))
            : group.members.some((m) => isPendingMarking(m.answer))
              ? pill(S.STATUS_TO_MARK, "warn", { dot: true })
              : pill(S.MIXED_MARKS, "")
      );
    };

    const controls = markControls({
      max,
      mark: shared,
      compact: true,
      keyHints: false,
      fkPrefix: `g${index}`,
      onChange: (mark) => {
        group.mark = mark;
        setStatus();
        updateFooter();
      },
    });
    cardControls.push(controls);

    const people = el("details", { class: "bq-people" }, [
      el("summary", {}, [
        el("span", { class: "avatar-stack" }, group.members.slice(0, 5).map((m) => avatar(m.name))),
        el("span", { class: "small strong", text: group.members.length === 1 ? group.members[0].name : t(S.N_PEOPLE, { n: group.members.length }) }),
      ]),
      el(
        "ul",
        { class: "bq-member-list" },
        group.members.map((m) =>
          el("li", {}, [
            el("a", { href: route(`grading/?attempt=${encodeURIComponent(m.attempt.id)}&q=${encodeURIComponent(m.answer.question_id)}`), dir: "auto", text: m.name }),
            el("span", { class: "mono small", text: markText(currentMark(m.answer), Math.max(0, m.answer.max_points ?? 0)) }),
          ])
        )
      ),
    ]);

    const card = el("article", { class: "card bq-card", tabindex: "0", "data-group": String(index) }, [
      el("div", { class: "row bq-card-head" }, [el("span", { class: "pill pill-info", text: `×${group.members.length}` }), el("span", { class: "grow" }), statusNode]),
      el("p", { class: `bq-answer ${group.blank ? "is-empty" : ""}`, dir: "auto", text: group.blank ? S.NOT_ATTEMPTED : group.display }),
      people,
      controls.node,
    ]);
    setStatus();
    return card;
  }

  function verdictTone(mark, max) {
    const v = verdictOf(mark, max);
    return v === VERDICT.CORRECT ? "success" : v === VERDICT.PARTIAL ? "warn" : "danger";
  }

  function updateFooter() {
    const node = shell.content.querySelector(".bq-changed");
    if (!node) return;
    const groups = changedGroups();
    const people = groups.reduce((sum, g) => sum + g.members.length, 0);
    node.textContent = groups.length ? t(S.BQ_CHANGED, { groups: groups.length, people }) : S.BQ_NOTHING_CHANGED;
  }

  async function goQuestion(index) {
    if (index < 0 || index >= s.questions.length || index === s.qIndex) return;
    if (changedGroups().length && !(await saveQuestion(false))) return;
    s.qIndex = index;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** Saves every changed card: one save_grades per affected attempt, in parallel. */
  async function saveQuestion(advance) {
    if (s.saving) return false;
    const question = s.questions[s.qIndex];
    const byAttempt = new Map();
    const undo = [];
    for (const group of changedGroups()) {
      for (const member of group.members) {
        const max = Math.max(0, member.answer.max_points ?? 0);
        const next = memberMarkFor(group.mark, max);
        const prev = currentMark(member.answer);
        if (next === prev && member.answer.graded_at != null) continue;
        byAttempt.set(member.attempt.id, { member, mark: next, max });
        undo.push({
          attemptId: member.attempt.id,
          answerId: member.answer.id,
          wasAuto: member.answer.needs_manual_marking !== true && member.answer.graded_at == null,
          prev,
          max,
        });
      }
    }
    if (!byAttempt.size) {
      if (advance) advanceQuestion();
      return true;
    }

    s.saving = true;
    const entries = [...byAttempt.entries()];
    const results = await Promise.allSettled(
      entries.map(([attemptId, { mark, max }]) => saveGrades(attemptId, { marks: new Map([[question.id, { mark, maxPoints: max }]]) }))
    );
    s.saving = false;

    const failed = [];
    results.forEach((result, i) => {
      const { member } = entries[i][1];
      if (result.status === "fulfilled") {
        const fresh = result.value.answers.find((a) => a.question_id === question.id);
        if (fresh) member.answer = fresh;
      } else {
        console.error(result.reason);
        failed.push(result.reason instanceof GradesNotSavedError ? t(S.NAME_RETOOK, { name: member.name }) : member.name);
      }
    });
    const savedUndo = undo.filter((u) => !failed.length || results[entries.findIndex(([id]) => id === u.attemptId)]?.status === "fulfilled");
    s.lastUndo = { questionId: question.id, items: savedUndo };

    if (failed.length) {
      toast(t(S.SAVE_FAILED_FOR, { names: failed.join(", ") }), { tone: "error", duration: 8000 });
      render();
      return false;
    }
    toast(t(S.MARKED_N_ANSWERS, { n: entries.length }), { tone: "success", duration: 5000, action: { label: S.UNDO, onClick: undoLast } });
    if (advance) advanceQuestion();
    else render();
    return true;
  }

  function advanceQuestion() {
    if (s.qIndex < s.questions.length - 1) {
      s.qIndex += 1;
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      render();
      const left = s.questions.reduce((sum, q) => sum + eligible(q).filter((m) => isPendingMarking(m.answer)).length, 0);
      if (!left) toast(S.ALL_CAUGHT_UP, { tone: "success" });
    }
  }

  async function undoLast() {
    const undo = s.lastUndo;
    if (!undo?.items.length) return;
    s.lastUndo = null;
    const results = await Promise.allSettled(
      undo.items.map((u) => {
        const auto = s.originalAuto.get(u.answerId);
        const payload = u.wasAuto && auto ? { restore: new Map([[undo.questionId, auto]]) } : { marks: new Map([[undo.questionId, { mark: u.prev, maxPoints: u.max }]]) };
        return saveGrades(u.attemptId, payload);
      })
    );
    results.forEach((r) => r.status === "rejected" && console.error(r.reason));
    await load(undo.questionId);
    toast(results.every((r) => r.status === "fulfilled") ? S.UNDONE : S.UNDO_PARTLY_FAILED, { tone: results.every((r) => r.status === "fulfilled") ? "info" : "error" });
  }

  // Keyboard: J/K move between answer cards; C/P/X mark the focused card; Enter saves.
  document.addEventListener("keydown", (e) => {
    if (document.querySelector(".overlay, .menu")) return;
    const target = e.target;
    const typing = target instanceof HTMLElement && (target.tagName === "TEXTAREA" || target.tagName === "SELECT" || (target.tagName === "INPUT" && target.type !== "range" && target.type !== "number"));
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    const cards = [...document.querySelectorAll(".bq-card")];
    const card = target instanceof HTMLElement ? target.closest(".bq-card") : null;
    const index = card ? cards.indexOf(card) : -1;
    const key = e.key.toLowerCase();
    if (key === "j" || key === "k") {
      e.preventDefault();
      const next = cards[Math.max(0, Math.min(cards.length - 1, index + (key === "j" ? 1 : -1)))] ?? cards[0];
      next?.focus();
      next?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else if (index >= 0 && (key === "c" || key === "p" || key === "x") && target.type !== "number") {
      cardControls[index]?.applyVerdict({ c: VERDICT.CORRECT, p: VERDICT.PARTIAL, x: VERDICT.INCORRECT }[key]);
    } else if (e.key === "Enter" && target?.tagName !== "BUTTON" && target?.tagName !== "A" && target?.tagName !== "SUMMARY") {
      e.preventDefault();
      document.querySelector(".bq-save")?.click();
    }
  });

  window.addEventListener("beforeunload", (e) => {
    if (changedGroups().length) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  await load();
}
