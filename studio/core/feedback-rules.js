// Feedback's pure rules — the web port of the app's ui/feedback/FeedbackViewModel.kt. No I/O and
// no backend import, so they run under node (dev/feedback.test.mjs); core/feedback.js re-exports
// them next to the reads and writes.

/** The app's FeedbackCategory, in its order. */
export const FEEDBACK_CATEGORIES = ["BUG", "CRASH", "SYNC", "UI_UX", "PERFORMANCE", "FEATURE_REQUEST", "REPORT_CONTENT", "OTHER"];

/** One submission per account per 24h; schema.sql's feedback_insert_rate_limited is the real gate. */
export const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const MIN_MESSAGE_CHARS = 5;

/** Thrown when the server refuses a submission because the 24h window hasn't passed. */
export class FeedbackCooldownError extends Error {
  constructor() {
    super("You can only send feedback once every 24 hours.");
    this.name = "FeedbackCooldownError";
  }
}

/** Why a submission can't go yet: "category" or "message" (checked top to bottom, like the form
 *  reads), or null when it is fine. */
export function validateFeedback({ category, message }) {
  if (!FEEDBACK_CATEGORIES.includes(category)) return "category";
  if ((message ?? "").trim().length < MIN_MESSAGE_CHARS) return "message";
  return null;
}

/** Milliseconds until the user may send again; 0 when they can now (or have never sent). */
export function cooldownRemaining(history, now = Date.now()) {
  if (!history.length) return 0;
  const last = Math.max(...history.map((f) => f.createdAt));
  return Math.max(0, COOLDOWN_MS - (now - last));
}

/** "3h 20m", "45m", "under a minute". */
export function formatCooldown(ms) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return "under a minute";
}

/** The history list for a filter: null = everything, 0 = suggestions (no stars), 1-5 = that rating. */
export function filterHistory(history, rating) {
  return rating === null || rating === undefined ? history : history.filter((f) => f.rating === rating);
}

/** Which ratings (0 = suggestion) have anything in the history. */
export function ratingsPresent(history) {
  return new Set(history.map((f) => f.rating));
}

/** What the server says when the 24h policy refuses an insert: Postgres 42501 (the one reason an
 *  own insert is ever rejected), however the client words it. */
export function isCooldownRefusal(error) {
  const text = `${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase();
  return text.includes("42501") || text.includes("row-level security");
}

/** The rating as it is stored: a whole number 0-5. */
export function clampRating(rating) {
  return Math.min(5, Math.max(0, Math.round(rating) || 0));
}
