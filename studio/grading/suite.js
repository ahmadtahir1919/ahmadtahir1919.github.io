// The grading suite: the top bar (.sbar) shared by all three modes, the stage they render into,
// progress + sync chip, the shortcuts popover, undo, and the one keyboard dispatcher (the
// reference's keyboard map — single keys stand down while you type, and everything stands
// down while the Download reports dialog is open).

import { S, t } from "../core/strings.js";
import { button, el, menuButton, openDialog } from "../ui/components.js";
import { announceMenuItem, openAnnounceFlow, runAnnounceAction } from "../ui/announce-flow.js";
import { announceState } from "../core/announce.js";
import { loadQuiz } from "../core/quizzes.js";
import { askSubmitMarks } from "./submit-dialog.js";
import { G, countTo, kbd, plural, reduce, typing } from "./gx-util.js";
import { clearUndo, discardDrafts, draftCount, draftStudents, manualKeys, pendingOf, pollOnly, stuStatus, submitDrafts, subscribe, undo, undoStack } from "./store.js";
import { toast } from "./toast.js";
import { buildDeck, rapidKey, renderRapid } from "./rapid.js";
import { byqKey, firstToMark, renderByQ } from "./by-question.js";
import { closePollPane, openPollPane, renderPollOnly } from "./polls.js";
import { commitNotes, indKey, renderInd } from "./by-student.js";
import { celebrate, closeCeleb } from "./celebrate.js";

const MODES = ["rapid", "byq", "ind"];

/** The ⋮ item for a quiz in the grading suite or list: End quiz / Announce / Hide, or null. */
export function announceItem(qm) {
  if (!qm.quiz || qm.quiz.isArchived || pollOnly(qm)) return null;
  return announceMenuItem(announceState(qm.quiz, Date.now()));
}

/** Re-reads the quiz's settings (release, end time) into qm.quiz after an announce, end or hide. */
export async function refreshQuizState(qm) {
  try {
    const fresh = await loadQuiz(qm.id);
    if (fresh) qm.quiz = fresh;
  } catch (error) {
    console.warn(error); // offline: keep what we had
  }
}
const celebrated = new Set();

/**
 * mountSuite(section, { onBack, openReport(qm, opts) }) -> { open(qm, mode, opts), close() }
 */
export function mountSuite(section, { onBack, openReport, onModeChange = () => {} }) {
  const ctx = {
    qm: null,
    mode: "rapid",
    stage: el("div", { class: "stage", id: "stage" }),
    // rapid
    filter: "unmarked",
    deck: [],
    di: 0,
    dissolved: new Set(),
    excluded: new Set(),
    lastAct: null,
    // by question
    bqCur: 0,
    bqSeen: new Set(), // question ids opened this session
    remarkFor: null, // quiz id while Rapid's "Marking again" note is up
    // by student
    stuCur: 0,
    rFilter: "all",
    rSearch: "",
    pane: "roster",
    lastPend: 0,
  };

  // ── Top bar ──
  const qname = el("div", { class: "qname", id: "qname" });
  const ind = el("span", { class: "ind", "aria-hidden": "true" });
  const modeBtn = (m, glyph, label) =>
    el("button", { type: "button", role: "tab", "data-m": m, "aria-selected": "false", onclick: () => m !== ctx.mode && setMode(m) }, [glyph, el("span", { text: label })]);
  const modes = el("div", { class: "modes", role: "tablist", "aria-label": S.GX_MODE_LABEL, id: "modes" }, [
    ind,
    modeBtn("rapid", G.bolt(), S.GX_MODE_RAPID),
    modeBtn("byq", G.grid(), S.GX_MODE_BYQ),
    modeBtn("ind", G.person(), S.GX_MODE_IND),
  ]);
  const pDone = el("b", { id: "pDone", text: "0" });
  const pTot = el("b", { id: "pTot", text: "0" });
  const pPct = el("b", { id: "pPct", text: "0%" });
  const pBar = el("i", { id: "pBar" });
  const pMarked = el("span", { class: "pmk", text: S.GX_PROG_MARKED }); // hidden on narrower bars
  const pText = el("span", {}, [pDone, S.GX_PROG_OF, pTot, pMarked]);
  const progress = el("div", { class: "prog" }, [
    el("div", { class: "pt" }, [pText, pPct]),
    el("div", { class: "pbar" }, [pBar]),
  ]);
  const subN = el("i", { class: "subn", id: "subN", text: "0" });
  const submitBtn = el("button", { class: "bt pri sm subbtn", type: "button", id: "submitMarks", disabled: true, title: S.GX_SUBMIT_MARKS_TITLE, onclick: () => askSubmit() }, [
    G.send(),
    el("span", { class: "subl", text: S.GX_SUBMIT_MARKS }),
    el("span", { class: "subs", text: S.GX_SUBMIT }),
    subN,
  ]);
  const dlBtn = el("button", { class: "bt sm dlbtn", type: "button", id: "dlBtn", title: S.GX_DOWNLOAD_REPORTS, "aria-label": S.GX_DOWNLOAD_REPORTS, onclick: () => openReport(ctx.qm, { scope: "class" }) }, [
    G.download(),
    el("span", { text: S.GX_REPORT }),
  ]);
  const kbBtn = el("button", { class: "icob", type: "button", id: "kbBtn", "aria-label": S.GX_KB_TITLE, "aria-expanded": "false", title: S.GX_KB_BTN_TITLE }, [G.keyboard()]);
  const krow = (label, keys) => el("div", { class: "krow" }, [el("span", { text: label }), el("span", { class: "kk" }, keys)]);
  const kbHead = el("b");
  const kbBody = el("div", { class: "kbb" });
  const kbPop = el("div", { class: "kbpop", id: "kbPop", hidden: true, role: "dialog", "aria-label": S.GX_KB_TITLE }, [el("div", { class: "kbh" }, [kbHead, kbd("?")]), kbBody]);
  /** Only the keys that work on this screen: the mode's own, then the ones that work everywhere. */
  function fillKb(mode) {
    const label = { rapid: S.GX_MODE_RAPID, byq: S.GX_MODE_BYQ, ind: S.GX_MODE_IND }[mode];
    kbHead.textContent = t(S.GX_KB_HEAD_MODE, { mode: label });
    const own =
      mode === "rapid"
        ? [
            krow(S.GX_KB_FULL, [kbd("→")]),
            krow(S.GX_KB_HALF, [kbd("↓"), S.GX_KB_OR, kbd(S.GX_KEY_SPACE)]),
            krow(S.GX_KB_ZERO, [kbd("←")]),
            krow(S.GX_KB_EXACT, [kbd("0"), "–", kbd("9")]),
            krow(S.GX_KB_COMMENT, [kbd("C")]),
          ]
        : mode === "byq"
          ? [krow(S.GX_KB_PREV_NEXT_Q, [kbd("←"), kbd("→")])]
          : [krow(S.GX_KB_SAVE_NEXT, [kbd(S.GX_KEY_ENTER)]), krow(S.GX_KB_PREV_NEXT, [kbd("↑"), kbd("↓")])];
    kbBody.replaceChildren(
      ...own,
      el("div", { class: "kgrp", text: S.GX_KB_EVERYWHERE }),
      krow(S.GX_KB_UNDO, [kbd("Z"), S.GX_KB_OR, kbd(S.GX_KEY_CTRL), kbd("Z")]),
      krow(S.GX_KB_SWITCH, [kbd(S.GX_KEY_ALT), S.GX_KB_PLUS, kbd("1"), kbd("2"), kbd("3")]),
      krow(S.GX_KB_TOGGLE, [kbd("?")]),
      krow(S.GX_KB_CLOSE, [kbd(S.GX_KEY_ESC)])
    );
  }
  const kbw = el("div", { class: "kbw" }, [kbBtn, kbPop]);
  // ↶ Undo — enabled only while there is something to undo (updUndo).
  const undoBtn = el("button", { class: "bt sm undobtn", type: "button", id: "undoBtn", disabled: true, title: S.GX_UNDO_TITLE, "aria-label": S.GX_UNDO_TITLE, onclick: () => doUndo() }, [
    G.undo(),
    el("span", { text: S.UNDO }),
  ]);
  // 📊 N Poll(s) — shown only when the quiz has polls; opens the side pane in any mode.
  const pollChip = el("button", { class: "bt sm pollchip", type: "button", id: "pollChip", hidden: true, "aria-expanded": "false", "aria-haspopup": "dialog", title: S.GX_POLL_CHIP_TITLE }, [G.poll(14), el("span", { class: "pcw" })]);
  pollChip.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!closePollPane()) openPollPane(ctx);
  });
  kbBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleKb();
  });

  // ⋮ End quiz / Announce / Hide results — the same flow as the results page, for this quiz.
  const announceBtn = menuButton(() => {
    const item = ctx.qm ? announceItem(ctx.qm) : null;
    return item ? [{ ...item, danger: item.iconName === "stop", onSelect: () => announceFromSuite() }] : [];
  });
  announceBtn.classList.add("announcebtn");

  const sbar = el("div", { class: "sbar" }, [
    el("button", { class: "back", type: "button", id: "toHub", onclick: () => onBack() }, [G.back(), S.GRADING_TITLE]),
    qname,
    modes,
    el("div", { class: "sp" }),
    progress,
    el("div", { class: "stools" }, [undoBtn, pollChip, dlBtn, kbw]),
    submitBtn,
    announceBtn,
  ]);
  section.replaceChildren(sbar, ctx.stage);

  // ── Helpers the modes call ──
  ctx.toast = toast;
  ctx.setMode = setMode;
  ctx.undo = doUndo;
  ctx.openReport = (opts) => openReport(ctx.qm, opts);
  ctx.celebrate = (manual) => celebrate(ctx, manual);
  ctx.renderMode = renderMode;
  ctx.updProgress = updProgress;
  ctx.submit = () => askSubmit();

  /** Shown only when there is something to do (never for a draft, an archived quiz or Show Score on and over). */
  function updAnnounce() {
    announceBtn.hidden = !ctx.qm || !announceItem(ctx.qm);
  }

  /** Marks waiting go first — an announcement must not go out over unsent drafts — then the flow, read fresh. */
  async function announceFromSuite() {
    const qm = ctx.qm;
    if (!qm) return;
    if (draftCount(qm) && !(await askSubmit())) return;
    if (ctx.qm !== qm) return;
    await openAnnounceFlow({
      quizId: qm.id,
      pendingCount: qm.studs.filter((s) => stuStatus(qm, s) === "need").length,
      onMarkFirst: () => {
        ctx.filter = "unmarked";
        setMode("rapid");
      },
      onDone: () => refreshQuizState(qm).then(() => ctx.qm === qm && updAnnounce()),
    });
  }

  function updUndo() {
    undoBtn.disabled = !ctx.qm || !undoStack(ctx.qm).length;
  }

  function updDrafts() {
    const n = ctx.qm ? draftCount(ctx.qm) : 0;
    subN.textContent = String(n);
    submitBtn.disabled = n === 0 || submitBtn.classList.contains("busy");
    submitBtn.classList.toggle("has", n > 0);
  }

  /** Confirms, then sends whatever is marked so far — all of it or only a few. Resolves true
   *  when nothing is left unsent. */
  async function askSubmit() {
    commitNotes(); // a note typed a moment ago goes in too
    const qm = ctx.qm;
    const n = qm ? draftCount(qm) : 0;
    if (!n) return true;
    const m = draftStudents(qm).length;
    const choice = await askSubmitMarks({ quizId: qm.id, marks: n, students: m });
    if (!choice || ctx.qm !== qm) return false;
    submitBtn.classList.add("busy");
    submitBtn.disabled = true;
    let res;
    let releaseFailed = false;
    try {
      res = await submitDrafts(qm, { notify: choice.notify });
      // Marks first, then the end / announce the owner picked — and only when every mark landed:
      // an announce over a failed student's old marks would show them the wrong result.
      if (choice.action) {
        if (res.failed === 0 && res.sent > 0) {
          try {
            await runAnnounceAction(choice.action, choice.quiz);
          } catch (error) {
            console.error(error);
            releaseFailed = true;
          }
        } else releaseFailed = true;
      }
    } finally {
      submitBtn.classList.remove("busy");
      updDrafts();
    }
    // The Rapid end card offers Submit too; redraw it so it drops the button once sent.
    if (ctx.qm === qm && ctx.mode === "rapid" && !ctx.deck[ctx.di]) renderRapid(ctx, {});
    // By question's "changed, not submitted" dots go once sent.
    if (ctx.qm === qm && ctx.mode === "byq") renderByQ(ctx, { keepScroll: true });
    // …and By student's "N changes not submitted".
    if (ctx.qm === qm && ctx.mode === "ind") renderInd(ctx, true);
    if (res.sent) toast(plural(res.sent, S.GX_SUBMITTED_ONE, S.GX_SUBMITTED_MANY));
    if (res.failed) toast(plural(res.failed, S.GX_SUBMIT_FAILED_ONE, S.GX_SUBMIT_FAILED_MANY));
    if (releaseFailed) toast(S.GRADE_SUBMIT_RELEASE_FAILED);
    else if (choice.action && choice.action !== "END_ONLY") {
      // Announced: the app's "Results announced — Hide", which takes it back at once.
      toast(S.ANNOUNCE_SNACKBAR_ANNOUNCED, {
        label: S.ANNOUNCE_SNACKBAR_HIDE,
        fn: () =>
          runAnnounceAction("HIDE", choice.quiz)
            .catch((error) => {
              console.error(error);
              toast(S.ANNOUNCE_FAILED);
            })
            .finally(() => refreshQuizState(qm).then(() => ctx.qm === qm && updAnnounce())),
      });
    }
    if (choice.action) refreshQuizState(qm).then(() => ctx.qm === qm && updAnnounce());
    return draftCount(qm) === 0;
  }

  /** Before leaving the quiz: Submit now / Keep as draft / Discard. Resolves false to stay. */
  function confirmLeave() {
    commitNotes();
    const qm = ctx.qm;
    const n = qm ? draftCount(qm) : 0;
    if (!n) return Promise.resolve(true);
    return new Promise((resolve) => {
      let choice = null;
      const pick = (c) => () => {
        choice = c;
        dlg.close(c);
      };
      const dlg = openDialog({
        title: plural(n, S.GX_LEAVE_TITLE_ONE, S.GX_LEAVE_TITLE_MANY),
        content: [el("p", { class: "dialog-body", text: S.GX_LEAVE_BODY })],
        actions: [
          button({ label: S.GX_LEAVE_DISCARD, variant: "danger", onClick: pick("discard") }),
          button({ label: S.GX_LEAVE_KEEP, variant: "secondary", onClick: pick("keep") }),
          button({ label: S.GX_LEAVE_SUBMIT, variant: "primary", onClick: pick("submit") }),
        ],
        onClose: async () => {
          if (choice === "keep") resolve(true);
          else if (choice === "discard") {
            discardDrafts(qm);
            toast(S.GX_DISCARDED);
            resolve(true);
          } else if (choice === "submit") resolve(await askSubmit());
          else resolve(false);
        },
      });
    });
  }

  function openKb() {
    kbPop.hidden = false;
    kbBtn.setAttribute("aria-expanded", "true");
    if (!reduce()) kbPop.animate([{ opacity: 0, transform: "translateY(-6px) scale(.97)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
  function closeKb() {
    if (kbPop.hidden) return;
    kbBtn.setAttribute("aria-expanded", "false");
    kbPop.hidden = true;
  }
  function toggleKb() {
    kbPop.hidden ? openKb() : closeKb();
  }
  ctx.closeKb = closeKb;

  function moveInd() {
    const b = modes.querySelector("button.on");
    if (!b) return;
    ind.style.left = `${b.offsetLeft}px`;
    ind.style.width = `${b.offsetWidth}px`;
  }
  window.addEventListener("resize", moveInd);
  document.fonts?.ready?.then(moveInd);

  function setMode(m) {
    ctx.mode = m;
    closeKb();
    fillKb(m);
    for (const b of modes.querySelectorAll("button")) {
      b.classList.toggle("on", b.dataset.m === m);
      b.setAttribute("aria-selected", String(b.dataset.m === m));
    }
    moveInd();
    renderMode(true);
    onModeChange(ctx.qm, m);
  }

  function renderMode(rebuild) {
    if (!ctx.qm) return;
    closePollPane();
    if (pollOnly(ctx.qm)) renderPollOnly(ctx);
    else if (ctx.mode === "rapid") {
      if (rebuild) buildDeck(ctx);
      renderRapid(ctx, {});
    } else if (ctx.mode === "byq") renderByQ(ctx);
    else renderInd(ctx);
  }

  function updProgress() {
    const qm = ctx.qm;
    if (!qm) return;
    const tot = manualKeys(qm).length;
    const pend = pendingOf(qm);
    const done = tot - pend;
    const pct = tot ? Math.round((done / tot) * 100) : 100;
    // Nothing needs a human on a fully auto-marked quiz: say so instead of "0 of 0 … 100%".
    if (!tot) pText.replaceChildren(S.GX_PROG_AUTO);
    else if (!pText.contains(pDone)) pText.replaceChildren(pDone, S.GX_PROG_OF, pTot, pMarked);
    pPct.hidden = !tot;
    countTo(pDone, done);
    pTot.textContent = String(tot);
    pPct.textContent = `${pct}%`;
    pBar.style.width = `${pct}%`;
    // Celebrate once per quiz per session, when the last pending answer gets its mark.
    if (pend === 0 && ctx.lastPend > 0 && tot > 0 && !celebrated.has(qm.id)) {
      celebrated.add(qm.id);
      setTimeout(() => ctx.qm === qm && celebrate(ctx, false), reduce() ? 0 : 380);
    }
    ctx.lastPend = pend;
  }

  function doUndo() {
    const qm = ctx.qm;
    const entry = qm && undo(qm);
    if (!entry) {
      toast(S.GX_NOTHING_UNDO);
      return;
    }
    if (entry.ctx?.mode === "rapid" && ctx.mode === "rapid") {
      ctx.di = entry.ctx.di;
      ctx.lastAct = null;
      renderRapid(ctx, { from: entry.ctx.dir, noSkip: true });
    } else renderMode(false);
    toast(S.UNDONE);
  }

  subscribe((kind, qm) => {
    if (!ctx.qm || qm !== ctx.qm) return;
    updDrafts();
    updUndo();
    if (kind === "marks") updProgress();
    if (kind === "reload") {
      toast(S.GX_SHEET_CHANGED);
      updProgress();
      renderMode(true);
    }
  });

  // ── Keyboard ──
  document.addEventListener("keydown", (e) => {
    if (section.hidden || !ctx.qm) return;
    if (document.querySelector(".gx .rpm, .overlay")) return;
    // The poll pane stands every key down but Esc.
    if (document.getElementById("pollPane")) {
      if (e.key === "Escape") closePollPane();
      return;
    }
    if (document.querySelector(".gx .celeb")) {
      if (e.key === "Escape") closeCeleb();
      return;
    }
    if (e.key === "Escape") {
      closeKb();
      const gd = ctx.stage.querySelector("#gdrop");
      if (gd && !gd.hidden) {
        gd.hidden = true;
        ctx.stage.querySelector("#gmBtn")?.setAttribute("aria-expanded", "false");
      }
      return;
    }
    if (e.key === "?" && !typing()) {
      e.preventDefault();
      toggleKb();
      return;
    }
    if (e.altKey && /^Digit[123]$/.test(e.code)) {
      e.preventDefault();
      setMode(MODES[Number(e.code.slice(5)) - 1]);
      return;
    }
    if (typing() || e.ctrlKey || e.metaKey) return;
    if ((e.key === "z" || e.key === "Z") && !e.altKey) {
      e.preventDefault();
      doUndo();
      return;
    }
    if (ctx.mode === "rapid") rapidKey(ctx, e);
    else if (ctx.mode === "byq") byqKey(ctx, e);
    else if (ctx.mode === "ind") indKey(ctx, e);
  });
  // Ctrl/Cmd+Z undoes a mark (in the capture phase, before anything else sees it).
  document.addEventListener(
    "keydown",
    (e) => {
      if (section.hidden || !ctx.qm || document.querySelector(".gx .rpm, .overlay")) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "z" && !typing()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        doUndo();
      }
    },
    true
  );
  document.addEventListener("click", (e) => {
    if (!e.target.closest?.(".gmenu")) {
      const gd = ctx.stage.querySelector("#gdrop");
      if (gd && !gd.hidden) {
        gd.hidden = true;
        ctx.stage.querySelector("#gmBtn")?.setAttribute("aria-expanded", "false");
      }
    }
    if (!e.target.closest?.(".kbw")) closeKb();
  });

  return {
    ctx,
    /** Opens a quiz in a mode. opts.student = attempt id to show in By student. */
    open(qm, mode, opts = {}) {
      ctx.qm = qm;
      ctx.di = 0;
      ctx.lastAct = null;
      ctx.dissolved = new Set();
      ctx.excluded = new Set();
      ctx.bqSeen = new Set();
      ctx.remarkFor = null;
      ctx.bqCur = firstToMark(qm);
      const wanted = opts.student ? qm.studs.findIndex((s) => s.attemptId === opts.student) : -1;
      ctx.stuCur = wanted >= 0 ? wanted : Math.max(0, qm.studs.findIndex((s) => stuStatus(qm, s) === "need"));
      ctx.pane = wanted >= 0 ? "paper" : "roster";
      ctx.filter = pendingOf(qm) ? "unmarked" : "typed";
      ctx.rFilter = "all";
      ctx.rSearch = "";
      ctx.lastPend = pendingOf(qm);
      qname.replaceChildren(el("span", { class: "ini", vars: { c: qm.color }, text: qm.ini }), el("b", { title: qm.title, text: qm.title }));
      // Only polls: nothing to mark, so no modes, progress, Undo, Submit or shortcuts — just the votes.
      const only = pollOnly(qm);
      pollChip.hidden = only || !qm.polls.length;
      pollChip.querySelector(".pcw").textContent = plural(qm.polls.length, S.GX_POLL_CHIP_ONE, S.GX_POLL_CHIP_MANY);
      for (const n of [modes, progress, submitBtn, dlBtn, undoBtn, kbw]) n.hidden = only;
      updAnnounce();
      // The list's copy may be old (announced in the app since): re-read it for the menu.
      refreshQuizState(qm).then(() => ctx.qm === qm && updAnnounce());
      pDone.dataset.v = "0";
      updProgress();
      updDrafts();
      updUndo();
      const m = MODES.includes(mode) ? mode : "rapid";
      setMode(m);
      window.scrollTo(0, 0);
    },
    close() {
      closeKb();
      closePollPane();
      if (ctx.qm) clearUndo(ctx.qm);
      ctx.qm = null;
      updUndo();
      ctx.stage.replaceChildren();
    },
    confirmLeave,
  };
}
