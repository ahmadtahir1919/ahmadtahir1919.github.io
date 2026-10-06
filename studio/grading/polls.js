// Polls beside the marking. A poll has no right answer and no marks, so it is never a card,
// never pending, never in a mode's list and never in a total. The one way in is the top bar's
// "📊 N Poll" chip, which opens a side pane in any mode; a quiz that is only polls gets a
// results page instead of empty marking modes.
// Names under an option only ever come from non-anonymous polls (voteOf returns null otherwise).

import { route } from "../core/paths.js";
import { S, t } from "../core/strings.js";
import { el } from "../ui/components.js";
import { G, plural } from "./gx-util.js";
import { tallyOf, voteOf } from "./store.js";

/** One poll: its question, "Poll · Q6 · no marks", option bars and, when not anonymous, who
 *  picked what. */
export function pollBlock(ctx, poll) {
  const qm = ctx.qm;
  const tally = tallyOf(qm, poll);
  const names = new Map(); // option index (-1 = Other) -> names
  for (const s of qm.studs) {
    const v = voteOf(qm, poll, s);
    for (const i of Array.isArray(v?.selected) ? v.selected : []) {
      if (!names.has(i)) names.set(i, []);
      names.get(i).push(s.name);
    }
  }
  const rows = [...tally.options.map((o, i) => ({ ...o, i })), ...(tally.other.count ? [{ label: S.POLL_OTHER, ...tally.other, i: -1 }] : [])];
  return el("section", { class: "pblock", "data-poll": poll.id }, [
    el("div", { class: "pbhead" }, [
      el("span", { class: "gpill poll" }, [G.poll(12), t(S.GX_POLL_PILL, { n: poll.num })]),
      poll.anonymous ? el("span", { class: "gpill", text: S.GX_POLL_ANON }) : null,
      el("span", { class: "pbvot", text: plural(tally.voters, S.GX_POLL_VOTED_ONE, S.GX_POLL_VOTED_MANY) }),
    ]),
    el("h3", { dir: "auto", text: poll.text }),
    tally.voters
      ? el(
          "div",
          { class: "pbars" },
          rows.map((o) =>
            el("div", { class: "popt" }, [
              el("div", { class: "pbl" }, [el("span", { dir: "auto", text: o.label }), el("b", { text: `${o.count} · ${o.percent}%` })]),
              el("div", { class: "pbt" }, [el("i", { style: `width:${o.percent}%` })]),
              names.get(o.i)?.length ? el("div", { class: "pbn" }, names.get(o.i).map((n) => el("span", { text: n }))) : null,
            ])
          )
        )
      : el("p", { class: "pbnone", text: S.POLL_NO_VOTES }),
  ]);
}

/** Closes the side pane; true if one was open. */
export function closePollPane() {
  const pane = document.getElementById("pollPane");
  if (!pane) return false;
  pane.remove();
  document.getElementById("pollScrim")?.remove();
  document.getElementById("pollChip")?.setAttribute("aria-expanded", "false");
  return true;
}

/** The side pane with every poll, scrolled to pollId when given. */
export function openPollPane(ctx, pollId) {
  closePollPane();
  const qm = ctx.qm;
  if (!qm?.polls.length) return;
  const body = el("div", { class: "ppb" }, qm.polls.map((p) => pollBlock(ctx, p)));
  const close = el("button", { class: "icob", type: "button", "aria-label": S.CLOSE, title: S.CLOSE, onclick: () => closePollPane() }, [G.x()]);
  const pane = el("aside", { class: "pollpane", id: "pollPane", role: "dialog", "aria-label": S.GX_POLLS_TITLE }, [
    el("div", { class: "pph" }, [
      el("div", { style: "min-width:0" }, [el("b", { text: plural(qm.polls.length, S.GX_POLLS_HEAD_ONE, S.GX_POLLS_HEAD_MANY) }), el("small", { text: S.GX_POLL_NOT_COUNTED })]),
      close,
    ]),
    body,
  ]);
  ctx.stage.append(el("div", { class: "ppscrim", id: "pollScrim", onclick: () => closePollPane() }), pane);
  document.getElementById("pollChip")?.setAttribute("aria-expanded", "true");
  if (pollId) body.querySelector(`[data-poll="${CSS.escape(pollId)}"]`)?.scrollIntoView({ block: "start" });
  close.focus();
}

/** A quiz with only polls: nothing to mark, so show the votes instead of the marking modes. */
export function renderPollOnly(ctx) {
  const qm = ctx.qm;
  ctx.stage.replaceChildren(
    el("div", { class: "view" }, [
      el("div", { class: "pobody" }, [
        el("div", { class: "ponly" }, [
          G.poll(22),
          el("div", { style: "min-width:0" }, [el("b", { text: S.GX_POLL_ONLY_TITLE }), el("span", { text: S.GX_POLL_ONLY_BODY })]),
          el("a", { class: "bt", href: route(`results/?id=${encodeURIComponent(qm.id)}`), text: S.GX_POLL_FULL_RESULTS }),
        ]),
        el("div", { class: "pogrid" }, qm.polls.map((p) => pollBlock(ctx, p))),
      ]),
    ])
  );
}
