// "Preview": the quiz exactly as a student takes it. Rather than a look-alike, this frames the
// real take page (/take/?preview=1) and hands it the quiz as it stands in the editor, saved or
// not — so the timer, progress bar, read-first reveal, hints, instant feedback, polls and the
// result screen are the taker's own code, following this quiz's settings. In preview mode the
// take page runs on an in-memory client (deploy/take/preview.js): nothing is graded on the
// server, saved or recorded.

import { displayNameOf } from "../core/auth.js";
// The take page reads quizzes as database rows (its quizFromRow/questionFromRow), so the
// preview hands it the very rows saveQuiz would write, built by the same mappers.
import { previewQuestionRow, previewQuizRow } from "../core/backend/index.js";
import { S } from "../core/strings.js";
import { el } from "../ui/components.js";
import { prefersReducedMotion } from "../ui/motion.js";
import { G, svg } from "./qe-icons.js";

// Root-absolute: the take page lives at the site root's /take/, outside the studio's BASE.
const TAKE_PREVIEW_URL = "/take/?preview=1";

/** Opens the preview over [host] for [quiz] and its [questions] (finished ones, in order). */
export function openPreview(host, quiz, questions, { user = null } = {}) {
  if (!questions.length) return;
  const opener = document.activeElement;
  const frame = el("iframe", { class: "pvframe", src: TAKE_PREVIEW_URL, title: S.QE_PV_LABEL });
  const close = el("button", { type: "button", class: "pvx", "aria-label": S.QE_PV_CLOSE, title: S.QE_PV_CLOSE }, [svg(G.close14)]);
  const overlay = el("div", { class: "pvw", role: "dialog", "aria-modal": "true", "aria-label": S.QE_PV_LABEL }, [
    el("div", { class: "pvtop" }, [el("small", { text: S.QE_PV_NOTE }), close]),
    frame,
  ]);

  const payload = {
    type: "quizoma-preview-load",
    quiz: previewQuizRow(quiz, quiz.ownerId),
    questions: questions.map((q, i) => previewQuestionRow({ ...q, orderIndex: i }, quiz.id)),
    userName: user ? displayNameOf(user) : "",
  };

  let open = true;
  const shut = () => {
    if (!open) return;
    open = false;
    window.removeEventListener("message", onMessage);
    document.removeEventListener("keydown", onKey, true);
    overlay.classList.add("out");
    setTimeout(() => overlay.remove(), prefersReducedMotion() ? 0 : 200);
    if (opener && typeof opener.focus === "function") opener.focus();
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      shut();
    }
  };
  // Only the framed take page, on this origin, is answered.
  function onMessage(e) {
    if (e.origin !== window.location.origin || e.source !== frame.contentWindow) return;
    const type = e.data?.type;
    if (type === "quizoma-preview-ready") frame.contentWindow.postMessage(payload, window.location.origin);
    else if (type === "quizoma-preview-close") shut();
  }

  window.addEventListener("message", onMessage);
  document.addEventListener("keydown", onKey, true);
  // Escape pressed while focus is inside the quiz closes it too.
  frame.addEventListener("load", () => {
    try {
      frame.contentWindow.addEventListener("keydown", onKey, true);
    } catch {
      /* not same-origin — the close button and the quiz's own X still work */
    }
    frame.focus();
  });
  close.addEventListener("click", shut);
  host.appendChild(overlay);
}
