// Grading queue (/grading/, /grading/?quiz=): every submission with answers still waiting for a
// mark, grouped by quiz, newest first. Published, non-poll-only quizzes only (like the app's
// GradingQueueViewModel).

import { QUESTION_TYPES } from "../core/models.js";
import { listMyQuizzes, questionsFor } from "../core/quizzes.js";
import { displayNames, groupByAttempt, loadAnswersFor, loadAttemptsFor, pendingMarking } from "../core/results.js";
import { pendingMarkingCount } from "../core/scoring.js";
import { S, t } from "../core/strings.js";
import { avatar, button, el, emptyState, errorBlock, loadingBlock, pill, progressBar, timeAgo } from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { confetti, stagger } from "../ui/motion.js";
import { route } from "../core/paths.js";

const SEEN_WORK_KEY = "quizoma.studio.queueHadWork";

export async function renderQueue(shell, user) {
  const params = new URLSearchParams(window.location.search);
  const quizFilter = params.get("quiz");
  shell.setTitle(S.GRADING_TITLE);
  shell.setCrumbs([{ label: S.NAV_GRADING }]);
  shell.content.replaceChildren(loadingBlock());

  try {
    const quizzes = (await listMyQuizzes(user.id)).filter((q) => !q.isDraft);
    const questionsByQuiz = await questionsFor(quizzes.map((q) => q.id));
    const gradable = quizzes.filter((q) => {
      const qs = questionsByQuiz.get(q.id) ?? [];
      return qs.length && !qs.every((x) => x.type === QUESTION_TYPES.POLL);
    });
    const pending = await pendingMarking(gradable.map((q) => q.id));
    shell.setPendingCount([...pending.values()].reduce((sum, p) => sum + p.answers, 0));

    const withWork = gradable.filter((q) => pending.has(q.id) && (!quizFilter || q.id === quizFilter));
    const attempts = await loadAttemptsFor(withWork.map((q) => q.id));
    const [answers, names] = await Promise.all([
      loadAnswersFor(attempts.map((a) => a.id)),
      displayNames(attempts.map((a) => a.user_id)),
    ]);
    const byAttempt = groupByAttempt(answers);

    const filterSelect = el(
      "select",
      { class: "select queue-filter", "aria-label": S.FILTER_BY_QUIZ },
      [
        el("option", { value: "", text: S.ALL_QUIZZES }),
        ...gradable.map((q) =>
          el("option", {
            value: q.id,
            text: `${q.title?.trim() || S.UNTITLED_QUIZ}${pending.get(q.id) ? ` (${pending.get(q.id).answers})` : ""}`,
            selected: q.id === quizFilter,
          })
        ),
      ]
    );
    filterSelect.addEventListener("change", () => {
      const url = new URL(window.location.href);
      if (filterSelect.value) url.searchParams.set("quiz", filterSelect.value);
      else url.searchParams.delete("quiz");
      window.history.pushState({}, "", url);
      renderQueue(shell, user);
    });

    const groups = withWork
      .map((quiz) => {
        const rows = attempts
          .filter((a) => a.quiz_id === quiz.id)
          .map((attempt) => {
            const list = byAttempt.get(attempt.id) ?? [];
            const manual = list.filter((a) => a.needs_manual_marking === true).length;
            const left = pendingMarkingCount(list);
            return { attempt, manual, left, name: names.get(attempt.user_id) || S.ANONYMOUS };
          })
          .filter((row) => row.left > 0);
        return { quiz, rows, pending: pending.get(quiz.id) };
      })
      .filter((g) => g.rows.length);

    const total = groups.reduce((sum, g) => sum + g.rows.reduce((s, r) => s + r.left, 0), 0);

    if (!groups.length) {
      const hadWork = sessionStorage.getItem(SEEN_WORK_KEY) === "1";
      sessionStorage.removeItem(SEEN_WORK_KEY);
      shell.content.replaceChildren(
        gradable.length ? el("div", { class: "queue-toolbar" }, [filterSelect]) : null,
        el("div", { class: "card" }, [
          emptyState({
            art: "done",
            title: S.ALL_CAUGHT_UP,
            body: quizFilter ? S.ALL_CAUGHT_UP_QUIZ : S.ALL_CAUGHT_UP_BODY,
            actions: [button({ label: S.BACK_TO_QUIZZES, icon: "grid", href: route("") })],
          }),
        ])
      );
      if (hadWork) confetti();
      return;
    }
    sessionStorage.setItem(SEEN_WORK_KEY, "1");

    const list = el(
      "div",
      { class: "stack-lg" },
      groups.map(({ quiz, rows, pending: info }) =>
        el("section", { class: "card queue-group" }, [
          el("header", { class: "card-head" }, [
            el("div", { class: "grow" }, [
              el("h3", { class: "ellipsis", dir: "auto", text: quiz.title?.trim() || S.UNTITLED_QUIZ }),
              el("p", {
                class: "small muted",
                text: t(S.QUEUE_GROUP_META, { people: rows.length, answers: rows.reduce((s, r) => s + r.left, 0) }),
              }),
            ]),
            button({
              label: S.MARK_BY_QUESTION,
              icon: "layers",
              variant: "soft",
              size: "sm",
              href: route(`grading/?quiz=${encodeURIComponent(quiz.id)}&by=question`),
              title: info ? t(S.MARK_BY_QUESTION_HINT, { n: info.questionIds.size }) : undefined,
            }),
          ]),
          el(
            "ul",
            { class: "queue-list" },
            rows.map((row) =>
              el("li", {}, [
                el("a", { class: "queue-row", href: route(`grading/?attempt=${encodeURIComponent(row.attempt.id)}`) }, [
                  avatar(row.name),
                  el("div", { class: "grow" }, [
                    el("div", { class: "strong ellipsis", dir: "auto", text: row.name }),
                    el("div", { class: "small muted", text: t(S.SUBMITTED_WHEN, { when: timeAgo(row.attempt.finished_at) }) }),
                  ]),
                  el("div", { class: "queue-progress hide-phone" }, [
                    progressBar(row.manual - row.left, row.manual, { label: S.MARKING_PROGRESS }),
                    el("span", { class: "small faint", text: t(S.MARKED_OF, { done: row.manual - row.left, total: row.manual }) }),
                  ]),
                  pill(t(S.N_TO_MARK, { n: row.left }), "warn"),
                  icon("chevron-right", "icon faint"),
                ]),
              ])
            )
          ),
        ])
      )
    );
    stagger(list);

    shell.content.replaceChildren(
      el("div", { class: "queue-toolbar" }, [
        filterSelect,
        el("span", { class: "grow" }),
        pill(t(S.N_ANSWERS_WAITING, { n: total }), "warn", { iconName: "marking" }),
      ]),
      list
    );
  } catch (error) {
    console.error(error);
    shell.content.replaceChildren(errorBlock(S.ERR_LOAD_FAILED, () => renderQueue(shell, user)));
  }
}
