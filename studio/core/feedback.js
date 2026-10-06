// Feedback: reads and writes against the same feedback table the app uses — so a message sent here
// lands in the app's admin inbox and its reply shows in both. Unlike the app there is no Play
// Store hand-off: every rating is written to us.
//
// I/O goes through core/backend/; the pure rules are in ./feedback-rules.js (re-exported below,
// so pages import everything from this one file).

import * as backend from "./backend/index.js";
import { FeedbackCooldownError, clampRating, isCooldownRefusal } from "./feedback-rules.js";

export * from "./feedback-rules.js";

/** This account's past feedback, newest first. */
export async function listMyFeedback(userId) {
  return backend.listMyFeedback(userId);
}

/** Sends one piece of feedback. Throws FeedbackCooldownError on the 24h refusal, anything else as is. */
export async function submitFeedback(userId, { rating, category, message }) {
  try {
    await backend.insertFeedback(userId, {
      rating: clampRating(rating),
      category,
      message: message.trim(),
      createdAt: Date.now(),
    });
  } catch (error) {
    if (isCooldownRefusal(error)) throw new FeedbackCooldownError();
    throw error;
  }
}
