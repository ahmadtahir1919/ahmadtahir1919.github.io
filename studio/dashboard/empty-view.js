// The dashboard before the owner has any quiz — design-reference/dashboard-welcome.html:
// welcome hero with a looping mini demo (create → share → grade), three ways to start, and
// the quick-start templates.
//
// renderEmpty(container, { userName }) → cleanup()   (stops the demo loop)

import { route } from "../core/paths.js";
import { S, t } from "../core/strings.js";
import { TEMPLATES, templateCounts } from "../create/templates.js";
import { el } from "../ui/components.js";
import { prefersReducedMotion } from "../ui/motion.js";
import { firstNameOf, plural, svg } from "./dash-util.js";

const CREATE = route("create/");
const IMPORT = route("import/");

const PEN = '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>';
const FILE = '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>';
const PULSE = '<path d="M3 12h4l3-8 4 16 3-8h4"/>';

export function renderEmpty(container, { userName }) {
  const first = firstNameOf(userName);
  const hi = first ? t(S.HI_NAMED, { name: first }) : S.HI_UNNAMED;

  const flow = [S.FLOW_CREATE, S.FLOW_SHARE, S.FLOW_GRADE].map((label) => el("span", { text: label }));
  const demo = demoCards();

  const hero = el("div", { class: "dv-hero dv-rise", vars: { i: "0" } }, [
    el("div", {}, [
      el("div", { class: "dv-eyebrow", text: S.WELCOME_EYEBROW }),
      el("h1", {}, [hi, el("span", { class: "dv-hl", text: S.HI_MARK })]),
      el("p", { class: "dv-lead", text: S.WELCOME_LEAD }),
      el("div", { class: "dv-ctas" }, [
        el("a", { class: "dv-cta pri", href: CREATE }, [S.CTA_CREATE, " ", el("span", { class: "dv-arr", text: S.ARROW })]),
        el("a", { class: "dv-cta", href: IMPORT, text: S.CTA_IMPORT }),
      ]),
      el("div", { class: "dv-flow", "aria-hidden": "true" }, [flow[0], el("em", { text: S.FLOW_SEP }), flow[1], el("em", { text: S.FLOW_SEP }), flow[2]]),
      el("div", { class: "dv-fine", text: S.WELCOME_FINE }),
    ]),
    demo.node,
  ]);

  const way = (cls, i, href, iconPaths, titleNodes, body, go) =>
    el("a", { class: `dv-way ${cls} dv-rise`, vars: { i: String(i) }, href }, [
      el("span", { class: "dv-ico" }, [svg(iconPaths)]),
      el("b", {}, titleNodes),
      el("p", { text: body }),
      el("span", { class: "dv-go" }, [go, " ", S.ARROW]),
    ]);

  const ways = el("section", { class: "dv-sec" }, [
    el("div", { class: "dv-sh dv-rise", vars: { i: "2" } }, [el("h2", { text: S.WAYS_TITLE })]),
    el("div", { class: "dv-ways" }, [
      way("dv-w1", 3, CREATE, PEN, [S.WAY_SCRATCH_TITLE], S.WAY_SCRATCH_BODY, S.WAY_SCRATCH_GO),
      way("dv-w2", 4, IMPORT, FILE, [S.WAY_IMPORT_TITLE, el("span", { class: "dv-tag", text: S.WAY_IMPORT_TAG })], S.WAY_IMPORT_BODY, S.WAY_IMPORT_GO),
      // The builder has no "start with a poll" URL, so this is the plain create flow.
      way("dv-w3", 5, CREATE, PULSE, [S.WAY_POLL_TITLE], S.WAY_POLL_BODY, S.WAY_POLL_GO),
    ]),
  ]);

  const templates = el("section", { class: "dv-sec" }, [
    el("div", { class: "dv-sh dv-rise", vars: { i: "6" } }, [el("h2", { text: S.START_FROM_TEMPLATE }), el("span", { text: S.TEMPLATES_HINT })]),
    el(
      "div",
      { class: "dv-tpls" },
      TEMPLATES.map((tpl, index) => {
        const counts = templateCounts(tpl.id);
        const countText =
          counts.polls === counts.questions
            ? plural(counts.polls, S.POLL_COUNT_ONE, S.POLL_COUNT_MANY)
            : plural(counts.questions, S.QUESTION_COUNT_ONE, S.QUESTION_COUNT_MANY);
        return el("div", { class: "dv-tpl dv-rise", vars: { i: String(7 + index) } }, [
          el("div", { class: "dv-sw", vars: { sw: tpl.swatch }, "aria-hidden": "true", text: tpl.glyph }),
          el("div", {}, [
            el("b", { text: tpl.title() }),
            el("p", { text: tpl.body() }),
            el("small", {}, [
              el("span", { text: countText }),
              el("a", { href: route(`create/?template=${tpl.id}`), "data-fk": `tpl-${tpl.id}` }, [S.USE_TEMPLATE, " ", S.ARROW]),
            ]),
          ]),
        ]);
      })
    ),
  ]);

  container.replaceChildren(el("div", { class: "dv dv-first" }, [el("div", { class: "dv-wrap" }, [hero, ways, templates])]));
  return demo.start(flow);
}

// ── Mini demo ───────────────────────────────────────────────────────────────
// Illustrative only: fixed example content from the reference, never the owner's data.

function demoCards() {
  const okOpt = el("div", { class: "dv-opt" }, [el("i"), S.DEMO_OPT_2]);
  const letters = [...S.DEMO_CODE].map((ch) => el("span", { text: ch }));
  const joined = el("b", { text: "0" });
  const ans = el("div", { class: "dv-ans" }, [el("span", { text: S.DEMO_ANSWER }), el("span", { class: "dv-grp", text: S.DEMO_GROUP })]);
  const tick = el("div", { class: "dv-tick", text: S.DEMO_TICK });

  const node = el("div", { class: "dv-demo", "aria-hidden": "true" }, [
    el("div", { class: "dv-dcard dv-q" }, [
      el("div", { class: "dv-qh" }, [el("span", { text: S.DEMO_Q_HEAD }), el("span", { text: S.DEMO_TIMER })]),
      el("div", { class: "dv-qt", text: S.DEMO_QUESTION }),
      el("div", { class: "dv-opt" }, [el("i"), S.DEMO_OPT_1]),
      okOpt,
      el("div", { class: "dv-opt" }, [el("i"), S.DEMO_OPT_3]),
    ]),
    el("div", { class: "dv-dcard dv-share" }, [
      el("small", { text: S.DEMO_SHARE }),
      el("div", { class: "dv-codebox" }, letters),
      el("div", { class: "dv-joined" }, [joined, S.DEMO_JOINED]),
    ]),
    el("div", { class: "dv-dcard dv-grade" }, [
      el("div", { class: "dv-gh" }, [el("span", { text: S.DEMO_GRADE }), el("span", { text: S.DEMO_GRADE_Q })]),
      el("div", { class: "dv-swipe" }, [ans]),
      tick,
    ]),
  ]);

  /** Runs the reference loop; returns a stop function. Pauses while the tab is hidden. */
  function start(flow) {
    const finalFrame = () => {
      flow.forEach((f) => f.classList.add("on"));
      okOpt.classList.add("ok");
      letters.forEach((c) => c.classList.add("in"));
      joined.textContent = S.DEMO_JOINED_N;
      tick.textContent = S.DEMO_TICK_DONE;
    };
    if (prefersReducedMotion()) {
      finalFrame();
      return () => {};
    }

    let run = 0; // bumping this cancels the loop in flight
    let stopped = false;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    async function loop(id) {
      const live = () => id === run && !stopped && node.isConnected;
      while (live()) {
        flow.forEach((f) => f.classList.remove("on"));
        okOpt.classList.remove("ok");
        letters.forEach((c) => c.classList.remove("in"));
        joined.textContent = "0";
        ans.classList.remove("go");
        tick.textContent = S.DEMO_TICK;
        await sleep(900); if (!live()) return;
        flow[0].classList.add("on");
        await sleep(500); if (!live()) return;
        okOpt.classList.add("ok");
        await sleep(1100); if (!live()) return;
        flow[1].classList.add("on");
        for (const c of letters) {
          c.classList.add("in");
          await sleep(110); if (!live()) return;
        }
        for (let n = 0; n <= 24; n++) {
          joined.textContent = String(n);
          await sleep(45); if (!live()) return;
        }
        await sleep(500); if (!live()) return;
        flow[2].classList.add("on");
        await sleep(600); if (!live()) return;
        ans.classList.add("go");
        tick.textContent = S.DEMO_TICK_DONE;
        await sleep(3200);
      }
    }

    const onVisibility = () => {
      run++;
      node.dataset.demo = document.hidden ? "paused" : "running";
      if (!document.hidden) loop(run);
    };
    document.addEventListener("visibilitychange", onVisibility);
    node.dataset.demo = "running";
    loop(run);
    return () => {
      stopped = true;
      run++;
      node.dataset.demo = "stopped";
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }

  return { node, start };
}
