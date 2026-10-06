// /grading/ — the Grading home and the grading suite (design-reference/grading.html).
//
//   (none)                       → Grading home: which quizzes need marking
//   ?quiz=<id>[&mode=rapid|byq|ind] → the suite on that quiz (Rapid Grade unless a mode is given)
//   ?attempt=<id>                → By student, that person's paper (old links)
//   ?quiz=<id>&by=question       → By question (old links)
// Back/forward move between the home and the suite without a reload.

import { S } from "../core/strings.js";
import { displayNameOf, requireUser } from "../core/auth.js";
import { fetchLimits } from "../core/limits.js";
import { listMyQuizzes } from "../core/quizzes.js";
import { route } from "../core/paths.js";
import { betaBar, el, errorBlock, loadingBlock, renderSignInGate, renderSpinner } from "../ui/components.js";
import { buildSidebar } from "../ui/sidebar.js";
import "../ui/theme.js";
import { renderHome } from "./home.js";
import { mountSuite } from "./suite.js";
import { openReport } from "./reports.js";
import { bottomTabs } from "./mtabs.js";
import { mountToast } from "./toast.js";
import { loadAll, pendingTotal, store, subscribe } from "./store.js";

const root = document.getElementById("root");
document.documentElement.dataset.page = "grading";

async function start() {
  renderSpinner(root);
  const user = await requireUser();
  if (!user) {
    renderSignInGate(root);
    return;
  }

  const nav = buildSidebar({ user, active: "grading", fetchPending: false });
  const hub = el("section", { class: "hub", id: "hub", "aria-label": S.GRADING_TITLE });
  const suiteSec = el("section", { class: "suite", id: "suite", hidden: true, "aria-label": S.GX_SUITE_LABEL });
  const gx = el("div", { class: "gx" }, [
    nav.mobileBar,
    el("main", {}, [betaBar(), hub, suiteSec]),
    bottomTabs({ onMore: () => nav.mobileBar.querySelector(".sb-burger")?.click() }),
  ]);
  root.replaceChildren(el("div", { class: "shell" }, [nav.sidebar, gx, nav.scrim]));
  mountToast(gx);

  const teacher = displayNameOf(user) || user.email || "";
  const report = (qm, opts = {}) =>
    openReport(qm, opts, {
      teacher,
      isOpenQuiz: (q) => !suiteSec.hidden && suite.ctx.qm === q,
      finishMarking: () => {
        suite.ctx.filter = "unmarked";
        suite.ctx.setMode("rapid");
      },
    });

  const showHome = ({ push = true } = {}) => {
    suite.close();
    suiteSec.hidden = true;
    hub.hidden = false;
    document.title = `${S.GRADING_TITLE} — ${S.APP_NAME} ${S.STUDIO} (${S.BETA})`;
    renderHome(hub, { onOpen: (qm, mode) => openQuiz(qm, mode), onReport: (qm) => report(qm, { scope: "class" }) });
    // Re-trigger the entrance on every return, like the reference.
    hub.style.animation = "none";
    void hub.offsetWidth;
    hub.style.animation = "";
    if (push) history.pushState({ v: "home" }, "", route("grading/"));
  };
  const openQuiz = (qm, mode, { push = true, student } = {}) => {
    hub.hidden = true;
    suiteSec.hidden = false;
    document.title = `${qm.title} — ${S.GRADING_TITLE} — ${S.APP_NAME} ${S.STUDIO}`;
    suite.open(qm, mode, { student });
    if (push) history.pushState({ v: "suite" }, "", route(`grading/?quiz=${encodeURIComponent(qm.id)}&mode=${suite.ctx.mode}`));
  };

  const suite = mountSuite(suiteSec, {
    onBack: async () => {
      if (await suite.confirmLeave()) showHome();
    },
    openReport: (qm, opts) => report(qm, opts),
    onModeChange: (qm, mode) => {
      if (!qm || suiteSec.hidden) return;
      history.replaceState({ v: "suite" }, "", route(`grading/?quiz=${encodeURIComponent(qm.id)}&mode=${mode}`));
    },
  });

  // The sidebar badge is the live total of answers waiting, across every quiz.
  const setBadge = () => {
    const n = pendingTotal();
    const badge = nav.sidebar.querySelector(".sb-count");
    const before = badge?.textContent;
    nav.setPendingCount(n);
    if (badge && before !== badge.textContent && before !== "") {
      badge.classList.add("bump");
      setTimeout(() => badge.classList.remove("bump"), 250);
    }
  };
  subscribe(() => setBadge());

  hub.replaceChildren(loadingBlock());
  const load = async () => {
    try {
      await loadAll(user);
    } catch (error) {
      console.error(error);
      hub.replaceChildren(el("h1", { text: S.GRADING_TITLE }), errorBlock(S.ERR_LOAD_FAILED, load));
      return;
    }
    nav.setPendingCount(pendingTotal());
    route_({ push: false });
  };

  /** Shows whatever the URL asks for. */
  function route_({ push }) {
    const p = new URLSearchParams(location.search);
    const attempt = p.get("attempt");
    const quizId = p.get("quiz");
    if (attempt) {
      const qm = store.quizzes.find((q) => q.studs.some((s) => s.attemptId === attempt));
      if (qm) {
        openQuiz(qm, "ind", { push: false, student: attempt });
        history.replaceState({ v: "suite" }, "", route(`grading/?quiz=${encodeURIComponent(qm.id)}&mode=ind`));
        return;
      }
    } else if (quizId && store.byId.has(quizId)) {
      const mode = p.get("by") === "question" ? "byq" : p.get("mode");
      openQuiz(store.byId.get(quizId), mode, { push });
      if (!push) history.replaceState({ v: "suite" }, "", route(`grading/?quiz=${encodeURIComponent(quizId)}&mode=${suite.ctx.mode}`));
      return;
    }
    showHome({ push: false });
    if (location.search) history.replaceState({ v: "home" }, "", route("grading/"));
  }
  window.addEventListener("popstate", () => store.quizzes && route_({ push: false }));

  // The quota card, as on every other page (the badge is ours, so the sidebar doesn't fetch it).
  Promise.all([listMyQuizzes(user.id), fetchLimits()])
    .then(([quizzes, limits]) => nav.setQuota({ used: quizzes.length, limit: limits.maxQuizzes, maxQuestions: limits.maxQuestions }))
    .catch((error) => console.error(error));

  await load();
}

start();
