// Undo / redo history for the builder: a stack of deep snapshots, max 100.
//
// checkpoint(key, snapshot) is called BEFORE a change is applied. Consecutive changes with the
// same key inside COALESCE_MS (typing in one field) share one checkpoint, so Ctrl+Z undoes a
// burst of typing rather than one character.

const COALESCE_MS = 1200;

export function createHistory(limit = 100) {
  const past = [];
  const future = [];
  let lastKey = null;
  let lastAt = 0;

  return {
    checkpoint(key, snapshot) {
      const now = Date.now();
      if (key && key === lastKey && now - lastAt < COALESCE_MS) {
        lastAt = now;
        return;
      }
      past.push(structuredClone(snapshot));
      if (past.length > limit) past.shift();
      future.length = 0;
      lastKey = key;
      lastAt = now;
    },
    /** Returns the snapshot to restore, or null. [current] goes onto the redo stack. */
    undo(current) {
      if (!past.length) return null;
      future.push(structuredClone(current));
      lastKey = null;
      return past.pop();
    },
    redo(current) {
      if (!future.length) return null;
      past.push(structuredClone(current));
      lastKey = null;
      return future.pop();
    },
    /** Ends coalescing, so the next change starts a new undo step. */
    breakChain() {
      lastKey = null;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
  };
}
