// "All submissions marked!" — a blurred backdrop, a confetti burst (skipped with reduced
// motion), the drawn check, and an expandable SCORES chart of the class in five 20% bands.
// Fires once per quiz per session from suite.js, or by hand from "View results chart".

import { S, t } from "../core/strings.js";
import { el } from "../ui/components.js";
import { G, anim, reduce } from "./gx-util.js";
import { stuScore, subs } from "./store.js";

export function celebrate(ctx, manual) {
  const root = document.querySelector(".gx");
  if (!root || root.querySelector(".celeb")) return;
  const qm = ctx.qm;
  const sc = subs(qm).map((s) => {
    const [g, m] = stuScore(qm, s);
    return m ? (g / m) * 100 : 0;
  });
  const bins = [0, 0, 0, 0, 0];
  for (const v of sc) bins[Math.min(4, Math.floor(v / 20))]++;
  const mx = Math.max(1, ...bins);
  const avg = sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : 0;

  const chart = el("div", { class: "chart", id: "cchart", hidden: !manual }, [
    el("h4", { text: t(S.GX_SCORES_OF, { title: qm.title }) }),
    el(
      "div",
      { class: "bars" },
      bins.map((b, i) =>
        el("div", {}, [el("b", { text: String(b) }), el("i", { style: `height:${Math.max(4, (b / mx) * 90)}px;animation-delay:${i * 70}ms` }), el("small", { text: t(S.GX_BAND, { lo: i * 20, hi: i * 20 + 20 }) })])
      )
    ),
    el("div", { class: "cstat" }, [
      el("span", {}, [el("b", { text: `${avg}%` }), S.GX_AVERAGE]),
      el("span", {}, [el("b", { text: `${sc.length ? Math.round(Math.max(...sc)) : 0}%` }), S.GX_HIGHEST]),
      el("span", {}, [el("b", { text: String(sc.length) }), S.GX_STUDENTS]),
    ]),
  ]);
  const exp = el("button", { class: `bt ${manual ? "pri" : ""}`, type: "button", id: "cExp", text: S.GX_EXPORT_RESULTS });
  const close = el("button", { class: "bt", type: "button", id: "cClose", text: S.CLOSE });
  const chartBtn = manual ? null : el("button", { class: "bt pri", type: "button", id: "cChart", text: S.GX_VIEW_CHART });
  const canvas = el("canvas");
  const o = el("div", { class: "celeb", role: "dialog", "aria-modal": "true", "aria-label": S.GX_ALL_MARKED }, [
    canvas,
    el("div", { class: "cbox" }, [
      el("div", { class: "cok" }, [G.okCircle()]),
      el("h2", { text: S.GX_ALL_MARKED }),
      el("p", { text: S.GX_READY_EXPORT }),
      chart,
      el("div", { class: "acts" }, [
        chartBtn,
        exp,
        // TODO(share-results): the web has no "share results with the class" feature yet (the app
        // shares files from ResultScreen.kt). Until it does, this says so instead of faking it.
        el("button", { class: "bt", type: "button", id: "cShare", text: S.GX_SHARE_CLASS, onclick: () => ctx.toast(S.GX_SHARE_SOON) }),
        close,
      ]),
    ]),
  ]);
  root.appendChild(o);
  if (!manual && !reduce()) confetti(canvas);

  chartBtn?.addEventListener("click", () => {
    chart.hidden = false;
    const h = chart.offsetHeight;
    anim(chart, [{ height: "0px", opacity: 0, overflow: "hidden" }, { height: `${h}px`, opacity: 1, overflow: "hidden" }], { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)" });
    chartBtn.remove();
    exp.classList.add("pri");
  });
  exp.addEventListener("click", () => {
    closeCeleb();
    setTimeout(() => ctx.openReport({ scope: "class" }), 220);
  });
  close.addEventListener("click", closeCeleb);
  o.addEventListener("click", (e) => {
    if (e.target === o) closeCeleb();
  });
  setTimeout(() => close.focus(), 50);
}

export function closeCeleb() {
  const o = document.querySelector(".gx .celeb");
  if (!o || o.dataset.closing) return;
  o.dataset.closing = "1";
  if (reduce()) {
    o.remove();
    return;
  }
  o.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).onfinish = () => o.remove();
}

/** The reference's confetti: 140 pieces, gravity .35, 170 frames. */
function confetti(cv) {
  const ctx = cv.getContext("2d");
  const W = (cv.width = innerWidth);
  const H = (cv.height = innerHeight);
  const cols = ["#4f46e5", "#10b981", "#f59e0b", "#ec4899", "#0ea5e9", "#7c74ff"];
  const P = [...Array(140)].map(() => ({
    x: W / 2 + (Math.random() - 0.5) * 120,
    y: H * 0.42,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 14 - 4,
    s: Math.random() * 6 + 4,
    r: Math.random() * 6,
    vr: (Math.random() - 0.5) * 0.3,
    c: cols[Math.floor(Math.random() * cols.length)],
  }));
  let frame = 0;
  (function f() {
    ctx.clearRect(0, 0, W, H);
    for (const p of P) {
      p.vy += 0.35;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    if (++frame < 170 && cv.isConnected) requestAnimationFrame(f);
    else ctx.clearRect(0, 0, W, H);
  })();
}
