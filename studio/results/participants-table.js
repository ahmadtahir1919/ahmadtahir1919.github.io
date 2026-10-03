// Participants: everyone who submitted, plus people who joined but haven't submitted yet.
// Every row lands in exactly one tab — To mark / Graded / Not started — so the three counts
// always add up to All (QuizParticipantsScreen.kt bucket()). The owner's own row is never
// removable (the server refuses it too).

import { S, t } from "../core/strings.js";
import { avatar, button, el, formatDateTime, formatDuration, menuButton, pill, segmented } from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { route } from "../core/paths.js";

export const BUCKET = { TO_MARK: "TO_MARK", GRADED: "GRADED", NOT_STARTED: "NOT_STARTED" };

const SORTS = {
  NEWEST: (a, b) => b.sortDate - a.sortDate,
  OLDEST: (a, b) => a.sortDate - b.sortDate,
  POINTS_HIGH: (a, b) => (b.percent ?? -1) - (a.percent ?? -1),
  POINTS_LOW: (a, b) => (a.percent ?? 101) - (b.percent ?? 101),
  NAME: (a, b) => a.name.localeCompare(b.name),
};

/**
 * rows: [{ kind: "submitted"|"joined", userId, name, bucket, sortDate, percent, attempt?, breakdown?,
 *          pending?, timeSec?, joinedAt?, isOwner }]
 * ctx: { filter, search, sort, onFilter, onSearch, onSort, onRemove(row), showTimers }
 */
export function participantsSection(rows, ctx) {
  const count = (bucket) => rows.filter((r) => r.bucket === bucket).length;
  const query = ctx.search.trim().toLowerCase();
  const shown = rows
    .filter((r) => ctx.filter === "ALL" || r.bucket === ctx.filter)
    .filter((r) => !query || r.name.toLowerCase().includes(query))
    .sort(SORTS[ctx.sort]);

  const search = el("input", { class: "input", type: "search", placeholder: S.SEARCH_PEOPLE, "aria-label": S.SEARCH_PEOPLE, value: ctx.search, "data-fk": "people-search" });
  search.addEventListener("input", () => ctx.onSearch(search.value));

  const sort = el(
    "select",
    { class: "select dash-sort", "aria-label": S.SORT_BY, "data-fk": "people-sort" },
    [
      ["NEWEST", S.SORT_NEWEST],
      ["OLDEST", S.SORT_OLDEST],
      ["POINTS_HIGH", S.SORT_SCORE_HIGH],
      ["POINTS_LOW", S.SORT_SCORE_LOW],
      ["NAME", S.SORT_NAME],
    ].map(([value, label]) => el("option", { value, text: label, selected: ctx.sort === value }))
  );
  sort.addEventListener("change", () => ctx.onSort(sort.value));

  const toolbar = el("div", { class: "people-toolbar" }, [
    segmented({
      label: "people-filter",
      value: ctx.filter,
      onChange: ctx.onFilter,
      options: [
        { value: "ALL", label: S.FILTER_ALL, count: rows.length },
        { value: BUCKET.TO_MARK, label: S.FILTER_TO_MARK, count: count(BUCKET.TO_MARK) },
        { value: BUCKET.GRADED, label: S.FILTER_GRADED, count: count(BUCKET.GRADED) },
        { value: BUCKET.NOT_STARTED, label: S.FILTER_NOT_STARTED, count: count(BUCKET.NOT_STARTED) },
      ],
    }),
    el("div", { class: "row dash-tools" }, [el("div", { class: "search grow" }, [icon("search"), search]), sort]),
  ]);

  const body = shown.length
    ? el("div", { class: "table-wrap" }, [
        el("table", { class: "table people-table" }, [
          el("thead", {}, [
            el("tr", {}, [
              el("th", { text: S.COL_PERSON }),
              el("th", { text: S.COL_STATUS }),
              el("th", { class: "num", text: S.COL_SCORE }),
              el("th", { class: "num hide-phone", text: S.COL_CORRECT }),
              ctx.showTimers ? el("th", { class: "num hide-phone", text: S.COL_TIME }) : null,
              el("th", { class: "num", text: "" }),
            ]),
          ]),
          el("tbody", {}, shown.map((row) => rowNode(row, ctx))),
        ]),
      ])
    : el("p", { class: "muted people-empty", text: rows.length ? S.NO_PEOPLE_MATCH : S.NO_ATTEMPTS_BODY });

  return el("section", { class: "card" }, [
    el("header", { class: "card-head" }, [el("h3", { text: S.PARTICIPANTS }), el("span", { class: "small muted", text: t(S.N_PEOPLE, { n: rows.length }) })]),
    el("div", { class: "card-pad-sm stack" }, [toolbar, body]),
  ]);
}

function dateLines(row) {
  if (row.kind === "joined") return [t(S.JOINED_ON, { when: formatDateTime(row.joinedAt) })];
  const a = row.attempt;
  const lines = [];
  if ((a.retake_count ?? 0) > 0) {
    if (a.first_finished_at) lines.push(t(S.SUBMITTED_ON, { when: formatDateTime(a.first_finished_at) }));
    lines.push(t(S.RETAKEN_ON, { when: formatDateTime(a.finished_at) }));
  } else lines.push(t(S.SUBMITTED_ON, { when: formatDateTime(a.finished_at) }));
  if (a.graded_at) lines.push(t(S.MARKS_EDITED_ON, { when: formatDateTime(a.graded_at) }));
  return lines;
}

function statusOf(row) {
  if (row.bucket === BUCKET.NOT_STARTED) return pill(S.FILTER_NOT_STARTED, "archived");
  if (row.bucket === BUCKET.TO_MARK) return pill(t(S.N_TO_MARK, { n: row.pending }), "warn", { dot: true });
  return pill(S.STATUS_GRADED, "success", { iconName: "check" });
}

function rowNode(row, ctx) {
  const source = row.attempt?.source;
  const nameCell = el("div", { class: "person-cell" }, [
    avatar(row.name),
    el("div", { class: "grow" }, [
      el("div", { class: "row row-wrap person-name" }, [
        el("span", { class: "strong", dir: "auto", text: row.name }),
        row.isOwner ? pill(S.OWNER, "primary") : null,
        source ? pill(source === "WEB" ? S.SOURCE_WEB : S.SOURCE_ANDROID, "", { iconName: source === "WEB" ? "globe" : "phone" }) : null,
        row.attempt?.retake_count ? pill(t(S.RETAKEN_N, { n: row.attempt.retake_count }), "info") : null,
      ]),
      ...dateLines(row).map((line) => el("div", { class: "small faint", text: line })),
    ]),
  ]);

  const b = row.breakdown;
  // Nothing marked yet → "—", so a submission waiting on the owner never reads as a zero.
  const unmarked = row.kind === "joined" || b.gradedQuestionCount === 0;
  const score = unmarked ? "—" : b.hasMarks ? `${b.marksAwarded} / ${b.marksTotal}` : `${b.correctCount} / ${b.correctnessQuestionCount}`;
  const correct = unmarked ? "—" : `${b.totalCorrect} / ${b.questionCount}`;

  const actions = [];
  if (row.kind === "submitted") {
    actions.push(
      button({
        label: row.pending ? S.MARK : S.REVIEW,
        icon: row.pending ? "marking" : "eye",
        variant: row.pending ? "soft" : "ghost",
        size: "sm",
        href: route(`grading/?attempt=${encodeURIComponent(row.attempt.id)}`),
      })
    );
  }
  if (!row.isOwner) {
    actions.push(menuButton(() => [{ label: S.REMOVE_PARTICIPANT, iconName: "trash", danger: true, onSelect: () => ctx.onRemove(row) }]));
  }

  return el("tr", {}, [
    el("td", {}, [nameCell]),
    el("td", {}, [statusOf(row)]),
    el("td", { class: "num mono", text: score }),
    el("td", { class: "num mono hide-phone", text: correct }),
    ctx.showTimers ? el("td", { class: "num mono hide-phone", text: row.kind === "joined" ? "—" : formatDuration(row.timeSec) }) : null,
    el("td", { class: "num" }, [el("div", { class: "row row-end" }, actions)]),
  ]);
}
