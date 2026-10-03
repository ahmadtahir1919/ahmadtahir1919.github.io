// Where the studio is mounted. Locally (node web-v2/server.mjs) that's the site root "/"; on the
// live site it's "/studio/". Derived from this module's own URL, so no page has to know: every
// in-app link goes through route() instead of a hard-coded "/create/…".

export const BASE = new URL("../", import.meta.url).pathname;

/** route("create/?id=1") → "/create/?id=1" locally, "/studio/create/?id=1" live. */
export function route(path = "") {
  return BASE + String(path).replace(/^\/+/, "");
}
