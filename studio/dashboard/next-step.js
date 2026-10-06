// "Next step" — the one action the dashboard spotlight offers, picked by the first rule that
// applies (STUDIO_DASHBOARD_PROMPT_v2 §5.2). Pure: takes the dashboard items, returns which
// rule and the quiz it is about; the view turns that into text and buttons.
//
// item: { quiz, bucket, pending, pollOnly, votes, submitted, ready, missing, ... }
// (see dashboard-page.js load()).

const DAY = 86400000;

/**
 * { kind, item?, items? } where kind is one of:
 *   "mark"   answers waiting — item = the quiz with the most pending, totalPending
 *   "poll"   a poll-only quiz still open — item = the one open longest
 *   "soon"   a scheduled quiz opening within 24 h — item = the soonest
 *   "ready"  a draft that would publish as it is — item = the newest
 *   "finish" only drafts that still need work — item = the newest
 *   "live"   quizzes open, nothing to mark — items = the live ones, item = the newest
 *   "done"   everything else (also the fallback when no rule above applies)
 */
export function pickNextStep(items, now = Date.now()) {
  const totalPending = items.reduce((sum, i) => sum + i.pending, 0);
  if (totalPending) {
    const item = items.filter((i) => i.pending > 0).sort((a, b) => b.pending - a.pending)[0];
    return { kind: "mark", item, totalPending };
  }

  const poll = items.filter((i) => i.bucket === "live" && i.pollOnly).sort((a, b) => openedAt(a.quiz) - openedAt(b.quiz))[0];
  if (poll) return { kind: "poll", item: poll };

  const soon = items
    .filter((i) => i.bucket === "sched" && i.quiz.startAt - now <= DAY)
    .sort((a, b) => a.quiz.startAt - b.quiz.startAt)[0];
  if (soon) return { kind: "soon", item: soon };

  const drafts = items.filter((i) => i.bucket === "draft").sort((a, b) => (b.quiz.createdAt ?? 0) - (a.quiz.createdAt ?? 0));
  const ready = drafts.find((i) => i.ready);
  if (ready) return { kind: "ready", item: ready };
  if (drafts.length) return { kind: "finish", item: drafts[0] };

  const live = items.filter((i) => i.bucket === "live").sort((a, b) => openedAt(b.quiz) - openedAt(a.quiz));
  if (live.length) return { kind: "live", item: live[0], items: live };

  return { kind: "done" };
}

/** When a quiz opened: its start time, or when it was made if it opened straight away. */
export function openedAt(quiz) {
  return quiz.startAt ?? quiz.createdAt ?? 0;
}
