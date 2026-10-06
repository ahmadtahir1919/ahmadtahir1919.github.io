// A quiz's status as a pill (results page header). Mirrors the app's card statuses
// (QuizStatusUi.kt). The dashboard cards draw their own pills (dashboard/quiz-card.js).

import { QUIZ_STATUS } from "../core/status.js";
import { S, t } from "../core/strings.js";
import { formatDate, pill } from "./components.js";

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
