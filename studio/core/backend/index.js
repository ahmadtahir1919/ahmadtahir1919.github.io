// THE backend switch. Everything above core/backend/ imports from here and never from a
// backend folder directly, so moving Studio off Supabase is this one line plus a new folder
// that exports every function in ./contract.js (see docs/WEB_TECHNICAL_OVERVIEW.md).
export * from "./supabase/index.js";
