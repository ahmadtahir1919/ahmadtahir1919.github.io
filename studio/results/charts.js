// Small inline charts built from plain elements (no chart library): a score distribution and
// per-question accuracy. Pending answers are left out of accuracy (questionStats), and attempts
// still waiting for marks are left out of the distribution, so neither reads lower than it is.

import { S, t } from "../core/strings.js";
import { el } from "../ui/components.js";

/** percents: number[] (0–100). Ten buckets: 0–9 … 90–100. */
export function scoreDistribution(percents) {
  const buckets = Array.from({ length: 10 }, () => 0);
  for (const p of percents) buckets[Math.min(9, Math.floor(p / 10))]++;
  const peak = Math.max(1, ...buckets);
  if (!percents.length) return el("p", { class: "small faint chart-empty", text: S.CHART_NO_SCORES });
  return el("div", { class: "dist-chart", role: "img", "aria-label": S.CHART_DISTRIBUTION }, [
    el(
      "div",
      { class: "dist-bars" },
      buckets.map((count, i) => {
        const bar = el("div", { class: "dist-bar", title: t(S.CHART_BUCKET, { from: i * 10, to: i === 9 ? 100 : i * 10 + 9, n: count }) }, [
          count ? el("span", { class: "dist-count", text: String(count) }) : null,
        ]);
        bar.style.height = `${Math.max(count ? 8 : 2, (count / peak) * 100)}%`;
        bar.classList.toggle("is-high", i >= 8);
        bar.classList.toggle("is-low", i < 4);
        return bar;
      })
    ),
    el(
      "div",
      { class: "dist-axis" },
      buckets.map((_, i) => el("span", { text: i % 2 === 0 ? `${i * 10}` : "" }))
    ),
  ]);
}

/** rows: [{ label, correct, total, pending }] in question order. */
export function accuracyBars(rows) {
  if (!rows.length) return el("p", { class: "small faint chart-empty", text: S.CHART_NO_SCORES });
  return el(
    "ol",
    { class: "acc-list" },
    rows.map((row, i) => {
      const pct = row.total ? Math.round((row.correct * 100) / row.total) : null;
      const fill = el("div", { class: `acc-fill ${pct == null ? "" : pct >= 70 ? "is-good" : pct >= 40 ? "is-mid" : "is-bad"}` });
      fill.style.width = `${pct ?? 0}%`;
      return el("li", { class: "acc-row" }, [
        el("span", { class: "outline-num", text: String(i + 1) }),
        el("div", { class: "grow stack-sm acc-main" }, [
          el("div", { class: "row row-between" }, [
            el("span", { class: "ellipsis small strong", dir: "auto", text: row.label }),
            el("span", { class: "mono small nowrap", text: pct == null ? "—" : `${pct}%` }),
          ]),
          el("div", { class: "acc-track" }, [fill]),
          row.pending ? el("span", { class: "small faint", text: t(S.N_WAITING_TO_MARK, { n: row.pending }) }) : null,
        ]),
      ]);
    })
  );
}

/** One poll's option bars. */
export function pollBars(tally) {
  if (!tally.voters) return el("p", { class: "small faint", text: S.POLL_NO_VOTES });
  const rows = [...tally.options, ...(tally.other.count ? [{ label: S.POLL_OTHER, ...tally.other }] : [])];
  return el(
    "div",
    { class: "stack-sm" },
    rows.map((o) => {
      const fill = el("div", { class: "acc-fill is-poll" });
      fill.style.width = `${o.percent}%`;
      return el("div", { class: "stack-sm" }, [
        el("div", { class: "row row-between" }, [
          el("span", { class: "small", dir: "auto", text: o.label }),
          el("span", { class: "mono small", text: `${o.count} · ${o.percent}%` }),
        ]),
        el("div", { class: "acc-track" }, [fill]),
      ]);
    })
  );
}
