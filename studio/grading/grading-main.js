// /grading/ entry point: picks the view from the URL.
//   ?attempt=<id>               → mark one person
//   ?quiz=<id>&by=question      → mark by question
//   (none) or ?quiz=<id>        → the queue
// Back/forward between queue filters re-renders without a full reload.

import { S } from "../core/strings.js";
import { requireUser } from "../core/supabase.js";
import { renderSignInGate, renderSpinner } from "../ui/components.js";
import { mountShell } from "../ui/shell.js";
import { renderMarkByQuestion } from "./mark-by-question.js";
import { renderMarkPerson } from "./mark-person.js";
import { renderQueue } from "./queue-page.js";
import { route } from "../core/paths.js";

const root = document.getElementById("root");

async function start() {
  renderSpinner(root);
  const user = await requireUser();
  if (!user) {
    renderSignInGate(root);
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const attemptId = params.get("attempt");
  const quizId = params.get("quiz");
  const byQuestion = params.get("by") === "question";

  const shell = mountShell(root, {
    user,
    active: "grading",
    title: S.GRADING_TITLE,
    crumbs: [{ label: S.NAV_GRADING }],
    backHref: attemptId || byQuestion ? (quizId ? route(`grading/?quiz=${encodeURIComponent(quizId)}`) : route("grading/")) : route(""),
  });

  if (attemptId) await renderMarkPerson(shell, user, attemptId);
  else if (quizId && byQuestion) await renderMarkByQuestion(shell, user, quizId);
  else {
    await renderQueue(shell, user);
    window.addEventListener("popstate", () => renderQueue(shell, user));
  }
}

start();
