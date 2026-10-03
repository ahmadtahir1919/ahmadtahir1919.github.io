// One quiz on the dashboard grid. Only the title and the buttons are links, so the card's text
// can be selected and the share code copied without navigating away.

import { joinLink, themeColor } from "../core/models.js";
import { QUIZ_STATUS } from "../core/status.js";
import { S, t } from "../core/strings.js";
import { button, codeChip, copyText, el, formatDate, menuButton, pill } from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { route } from "../core/paths.js";

/** Status → pill text/tone. Mirrors the app's card statuses (QuizStatusUi.kt). */
export function statusPill(status, quiz) {
  switch (status) {
    case QUIZ_STATUS.ARCHIVED:
      return pill(S.STATUS_ARCHIVED, "archived", { iconName: "archive" });
    case QUIZ_STATUS.DRAFT:
      return pill(S.STATUS_DRAFT, "draft", { dot: true });
    case QUIZ_STATUS.SCHEDULED:
      return pill(t(S.STATUS_SCHEDULED_AT, { when: formatDate(quiz.startAt) }), "scheduled", { iconName: "calendar" });
    case QUIZ_STATUS.ENDED:
      return pill(S.STATUS_ENDED, "ended", { dot: true });
    case QUIZ_STATUS.IN_PROGRESS:
      return pill(S.STATUS_LIVE, "live", { dot: true, pulse: true });
    default:
      return pill(S.STATUS_LIVE, "live", { dot: true });
  }
}

/**
 * card({ quiz, status, questionCount, participants, pending }, actions)
 * actions: { onPublish, onDuplicate, onArchive, onDelete }
 */
export function quizCard(info, actions) {
  const { quiz, status, questionCount, participants, pending } = info;
  const editHref = route(`create/?id=${encodeURIComponent(quiz.id)}`);
  const resultsHref = route(`results/?id=${encodeURIComponent(quiz.id)}`);
  const isDraft = quiz.isDraft;

  const meta = [
    t(S.CREATED_ON, { date: formatDate(quiz.createdAt) }),
    questionCount === 1 ? S.QUESTION_COUNT_ONE : t(S.QUESTION_COUNT_MANY, { n: questionCount }),
  ];
  if (!isDraft) meta.push(participants === 1 ? S.PARTICIPANT_ONE : t(S.PARTICIPANT_MANY, { n: participants }));

  const menu = menuButton(() => [
    !isDraft
      ? { label: S.COPY_LINK, iconName: "link", onSelect: () => copyText(joinLink(quiz.shareCode), S.LINK_COPIED) }
      : null,
    isDraft ? { label: S.PUBLISH, iconName: "send", onSelect: () => actions.onPublish(quiz) } : null,
    { label: S.DUPLICATE, iconName: "copy", onSelect: () => actions.onDuplicate(quiz) },
    !isDraft
      ? quiz.isArchived
        ? { label: S.UNARCHIVE, iconName: "unarchive", onSelect: () => actions.onArchive(quiz, false) }
        : { label: S.ARCHIVE, iconName: "archive", onSelect: () => actions.onArchive(quiz, true) }
      : null,
    "sep",
    { label: S.DELETE, iconName: "trash", danger: true, onSelect: () => actions.onDelete(quiz) },
  ]);

  return el("article", { class: "card quiz-card", vars: { accent: themeColor(quiz.themeColorName) } }, [
    el("div", { class: "quiz-card-accent" }),
    el("div", { class: "quiz-card-body" }, [
      el("div", { class: "row row-between" }, [statusPill(status, quiz), menu]),
      el("a", { class: "quiz-card-title clamp-2", href: isDraft ? editHref : resultsHref, dir: "auto", text: quiz.title?.trim() || S.UNTITLED_QUIZ }),
      el("p", { class: "quiz-card-meta", text: meta.join(" · ") }),
      quiz.groupName ? el("span", { class: "chip chip-static", dir: "auto" }, [icon("users", "icon icon-sm"), quiz.groupName]) : null,
      el("div", { class: "row row-wrap quiz-card-code" }, [
        isDraft ? el("span", { class: "small faint", text: S.CODE_AFTER_PUBLISH }) : codeChip(quiz.shareCode),
        pending > 0
          ? el("a", { class: "pill pill-warn", href: route(`grading/?quiz=${encodeURIComponent(quiz.id)}`) }, [
              icon("marking", "icon icon-sm"),
              t(S.N_TO_MARK, { n: pending }),
            ])
          : null,
      ]),
    ]),
    el("div", { class: "quiz-card-foot" }, [
      button({ label: S.EDIT, icon: "pencil", variant: "ghost", size: "sm", href: editHref }),
      isDraft
        ? button({ label: S.PUBLISH, icon: "send", variant: "soft", size: "sm", onClick: () => actions.onPublish(quiz) })
        : button({ label: S.VIEW_RESULTS, icon: "chart", variant: "soft", size: "sm", href: resultsHref }),
    ]),
  ]);
}
