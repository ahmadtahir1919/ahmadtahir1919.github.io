// Grading home — "which quizzes need marking": the lead line, three stat cards, then one row
// per quiz (needs marking first, most pending first, then the latest submission) with a
// progress ring, ⚡ Start Rapid Grade / Open (or Review marks) and the ⤓ report icon.

import { S, t } from "../core/strings.js";
import { route } from "../core/paths.js";
import { el, emptyState } from "../ui/components.js";
import { G, iniTile, plural } from "./gx-util.js";
import { draftCount, manualKeys, pendingOf, pollOnly, store, subs } from "./store.js";

/**
 * renderHome(section, { onOpen(qm, mode), onReport(qm) })
 */
export function renderHome(section, { onOpen, onReport }) {
  const last = (qm) => Math.max(0, ...subs(qm).map((s) => s.sub));
  const sorted = [...store.quizzes].sort((a, b) => pendingOf(b) - pendingOf(a) || last(b) - last(a));
  const pend = sorted.filter((qm) => pendingOf(qm) > 0);
  const done = sorted.filter((qm) => pendingOf(qm) === 0);
  const total = pend.reduce((n, qm) => n + pendingOf(qm), 0);
  const subsN = store.quizzes.reduce((n, qm) => n + subs(qm).length, 0);

  const nodes = [el("h1", { text: S.GRADING_TITLE })];

  if (!subsN) {
    // Not in the reference: an empty-state card (art, copy, 3-step strip) for "nobody has submitted yet".
    const step = (n, title, hint) => el("div", { class: "gstep" }, [el("i", { text: String(n) }), el("div", {}, [el("b", { text: title }), el("span", { text: hint })])]);
    nodes.push(
      el("div", { class: "gempty-card" }, [
        emptyState({
          art: "people",
          title: S.GX_EMPTY_TITLE,
          body: S.GX_EMPTY_BODY,
          actions: [el("a", { class: "bt pri", href: route("") }, [S.GX_GO_DASHBOARD])],
        }),
        el("div", { class: "gsteps" }, [
          step(1, S.GX_STEP_1, S.GX_STEP_1_HINT),
          step(2, S.GX_STEP_2, S.GX_STEP_2_HINT),
          step(3, S.GX_STEP_3, S.GX_STEP_3_HINT),
        ]),
      ])
    );
    if (store.quizzes.length) {
      nodes.push(
        el("div", { class: "hsec", text: S.GX_YOUR_QUIZZES }),
        ...store.quizzes.map((qm, i) =>
          el("div", { class: "qrowc donec", style: `animation-delay:${i * 60}ms` }, [
            iniTile("", qm.color, { text: qm.ini }),
            el("div", { style: "min-width:0" }, [
              el("h3", { text: qm.title }),
              el("p", {}, [plural(0, S.GX_ROW_SUBMITTED_ONE, S.GX_ROW_SUBMITTED_MANY), S.GX_SEP, plural(qm.qs.length, S.GX_ROW_QUESTIONS_ONE, S.GX_ROW_QUESTIONS_MANY)]),
            ]),
          ])
        )
      );
    }
    section.replaceChildren(...nodes);
    return;
  }

  // Marks changed but not submitted: say so, or "Everything is marked" reads as all done.
  const unsent = store.quizzes.reduce((n, qm) => n + draftCount(qm), 0);
  nodes.push(
    el(
      "p",
      { class: "lead" },
      [
        ...(total
          ? [el("b", { text: plural(total, S.GX_N_ANSWERS_ONE, S.GX_N_ANSWERS_MANY) }), " ", plural(pend.length, S.GX_LEAD_WAITING_ONE, S.GX_LEAD_WAITING_MANY, { verb: total === 1 ? S.GX_IS : S.GX_ARE })]
          : [S.GX_LEAD_ALL_DONE]),
        unsent ? " " : null,
        unsent ? el("b", { style: "color:var(--accent)", text: plural(unsent, S.GX_LEAD_UNSENT_ONE, S.GX_LEAD_UNSENT_MANY) }) : null,
      ]
    ),
    el("div", { class: "hstats" }, [
      hstat(S.GX_STAT_TO_MARK, total, total === 1 ? S.GX_STAT_ANSWER : S.GX_STAT_ANSWERS, S.GX_STAT_TO_MARK_TIP),
      hstat(S.GX_STAT_SUBMISSIONS, subsN, S.GX_STAT_FROM_STUDENTS),
      hstat(S.GX_STAT_QUIZZES, pend.length, S.GX_STAT_NEED_MARKING),
    ])
  );
  if (pend.length) nodes.push(el("div", { class: "hsec", text: S.GX_SEC_NEEDS }), ...pend.map((qm, i) => row(qm, i)));
  if (done.length) nodes.push(el("div", { class: "hsec", text: S.GX_SEC_DONE }), ...done.map((qm, i) => row(qm, i + pend.length)));
  section.replaceChildren(...nodes);

  function row(qm, i) {
    const tot = manualKeys(qm).length;
    const p = pendingOf(qm);
    const d = tot - p;
    const sn = subs(qm).length;
    const dn = draftCount(qm);
    const pct = tot ? Math.round((d / tot) * 100) : 100;
    const ring = el("span", { class: "ringw", title: t(S.GX_RING_TITLE, { d, tot }) });
    ring.innerHTML = `<svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="18" class="rt"/><circle cx="22" cy="22" r="18" class="rp" style="stroke-dashoffset:${113.1 * (1 - (tot ? d / tot : 1))}"/></svg>`;
    ring.appendChild(el("b", { text: `${pct}%` }));
    const dl = el("button", { class: "icob", type: "button", title: S.GX_DOWNLOAD_REPORTS, "aria-label": t(S.GX_DOWNLOAD_FOR, { title: qm.title }), onclick: () => onReport(qm) }, [G.download()]);
    const only = pollOnly(qm);
    const polls = qm.polls.length;
    return el("div", { class: `qrowc ${p ? "" : "donec"}`, style: `animation-delay:${i * 60}ms` }, [
      iniTile("", qm.color, { text: qm.ini }),
      el("div", { style: "min-width:0" }, [
        el("h3", { text: qm.title }),
        el("p", {}, [
          plural(sn, S.GX_ROW_SUBMITTED_ONE, S.GX_ROW_SUBMITTED_MANY),
          S.GX_SEP,
          ...(only
            ? [S.GX_ROW_POLLS_ONLY]
            : [
                plural(qm.qs.length, S.GX_ROW_QUESTIONS_ONE, S.GX_ROW_QUESTIONS_MANY),
                polls ? S.GX_SEP : null,
                polls ? plural(polls, S.GX_ROW_POLLS_ONE, S.GX_ROW_POLLS_MANY) : null,
                S.GX_SEP,
                p ? el("b", { style: "color:var(--warn-ink)", text: plural(p, S.GX_ROW_TO_MARK_ONE, S.GX_ROW_TO_MARK_MANY) }) : S.GX_ROW_ALL_MARKED,
              ]),
          dn ? el("span", { class: "gpill acc draftp", text: plural(dn, S.GX_NOT_SUBMITTED_ONE, S.GX_NOT_SUBMITTED_MANY) }) : null,
        ]),
      ]),
      only ? el("span", { class: "pollring", title: S.GX_ROW_POLLS_ONLY }, [G.poll(18)]) : ring,
      el(
        "div",
        { class: "qacts" },
        only
          ? [el("button", { class: "bt", type: "button", onclick: () => onOpen(qm, "rapid") }, [G.poll(14), S.GX_VIEW_POLL_RESULTS])]
          : p
          ? [
              el("button", { class: "bt pri", type: "button", onclick: () => onOpen(qm, "rapid") }, [G.bolt(14), S.GX_START_RAPID]),
              el("button", { class: "bt", type: "button", onclick: () => onOpen(qm, "ind"), text: S.GX_OPEN }),
              dl,
            ]
          : [el("button", { class: "bt", type: "button", onclick: () => onOpen(qm, "rapid"), text: S.GX_REVIEW_MARKS }), dl]
      ),
    ]);
  }
}

function hstat(label, n, tail, tip) {
  return el("div", { class: "hstat", title: tip }, [el("small", { text: label }), el("b", { text: String(n) }), " ", el("span", { text: tail })]);
}
