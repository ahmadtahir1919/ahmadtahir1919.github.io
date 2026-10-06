// Results release, as far as Studio knows it. Pure — no I/O, so it can be unit tested in node.
//
// The app lets an owner choose WHEN students see their result while Show Score is off: when the quiz
// ends (AUTO) or when the owner announces it (MANUAL). Studio reads and writes the MODE with the quiz
// (rows.js) but never writes the announcement through a save — that is only the set_results_release RPC
// (ui/announce-flow.js; the rules are core/announce.js). What is left here: what a duplicate inherits.

/**
 * The draft copy a duplicate saves (QuizRepository.duplicateQuiz / Quiz.asDuplicateDraft in the app):
 * new id, owner, title and share code, a fresh draft, not archived, no schedule — and a release of its own:
 * the MODE is a rule and is kept, but an announcement is state about the original's participants and is
 * never inherited, so the copy starts not announced.
 */
export function duplicateDraft(original, { id, ownerId, title, shareCode, createdAt }) {
  return {
    ...original,
    id,
    ownerId,
    title,
    shareCode,
    isDraft: true,
    isArchived: false,
    startAt: null,
    endAt: null,
    createdAt,
    resultsReleaseMode: original.resultsReleaseMode === "MANUAL" ? "MANUAL" : "AUTO",
    resultsReleasedAt: null,
    // A new quiz to the server: its first save creates it, not checked against the original's version.
    serverUpdatedAt: null,
  };
}
