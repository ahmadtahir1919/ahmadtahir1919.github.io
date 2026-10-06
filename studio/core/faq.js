// The Studio FAQ's pure logic: searching, grouping, and turning an answer's light markup into
// parts. No DOM and no backend, so it runs under node (dev/faq.test.mjs). The questions
// themselves are data in faq/faq-data.js; the page is faq/faq-page.js.
//
// Answer markup (kept tiny on purpose, so the text stays easy to write and review):
//   • a blank line starts a new paragraph;
//   • lines that start with "- " are a bullet list, lines that start with "1. " a numbered one;
//   • **bold** and {{Ctrl}} (a keyboard key) inside any line.

/** The words of a query: lower-cased, split on whitespace, no repeats. */
export function tokenize(query) {
  return [...new Set(String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean))];
}

/** Answer text without its markup — what search looks through. */
export function plainText(markup) {
  return String(markup ?? "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\{\{(.+?)\}\}/g, "$1")
    .replace(/^\s*(-|\d+\.)\s+/gm, "");
}

/** What one item is searched against, lower-cased, by weight. */
function fields(item, categoryLabel) {
  return {
    question: item.question.toLowerCase(),
    keywords: (item.keywords ?? []).join(" ").toLowerCase(),
    category: String(categoryLabel ?? "").toLowerCase(),
    body: `${plainText(item.answer)} ${plainText(item.example ?? "")}`.toLowerCase(),
  };
}

/**
 * Items matching every word of [query], best first (a word in the question outranks one in a keyword,
 * which outranks one in the answer; the whole phrase in the question gets a bonus; ties keep the
 * original order). An empty query returns every item in its original order.
 * [categories]: [{ id, label }] — a word may also match the category's name.
 */
export function searchFaq(items, categories, query) {
  const words = tokenize(query);
  if (!words.length) return [...items];
  const label = new Map(categories.map((c) => [c.id, c.label]));
  const phrase = words.join(" ");
  const scored = [];
  items.forEach((item, index) => {
    const f = fields(item, label.get(item.category));
    let score = f.question.includes(phrase) && words.length > 1 ? 5 : 0;
    for (const word of words) {
      let hit = 0;
      if (f.question.includes(word)) hit += 4;
      if (f.keywords.includes(word)) hit += 3;
      if (f.category.includes(word)) hit += 2;
      if (f.body.includes(word)) hit += 1;
      if (!hit) return; // every word has to match somewhere
      score += hit;
    }
    scored.push({ item, score, index });
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map((s) => s.item);
}

/** [{ category, items }] in category order, leaving out categories with nothing in them. */
export function groupByCategory(items, categories) {
  return categories.map((category) => ({ category, items: items.filter((item) => item.category === category.id) })).filter((g) => g.items.length);
}

/** Map<categoryId, number> over [items]. */
export function countByCategory(items) {
  const counts = new Map();
  for (const item of items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  return counts;
}

/** One line of an answer as parts: { type: "text" | "b" | "kbd", text }. */
export function inlineParts(line) {
  const parts = [];
  const re = /\*\*(.+?)\*\*|\{\{(.+?)\}\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) parts.push({ type: "text", text: line.slice(last, m.index) });
    parts.push(m[1] !== undefined ? { type: "b", text: m[1] } : { type: "kbd", text: m[2] });
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push({ type: "text", text: line.slice(last) });
  return parts;
}

/** An answer as blocks: { type: "p", text } | { type: "ul" | "ol", items: [text] }. */
export function answerBlocks(markup) {
  const blocks = [];
  for (const chunk of String(markup ?? "").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    let i = 0;
    while (i < lines.length) {
      const kind = /^- /.test(lines[i]) ? "ul" : /^\d+\. /.test(lines[i]) ? "ol" : "p";
      if (kind === "p") {
        const para = [];
        while (i < lines.length && !/^- |^\d+\. /.test(lines[i])) para.push(lines[i++]);
        blocks.push({ type: "p", text: para.join(" ") });
      } else {
        const strip = kind === "ul" ? /^- / : /^\d+\. /;
        const list = [];
        while (i < lines.length && strip.test(lines[i])) list.push(lines[i++].replace(strip, ""));
        blocks.push({ type: kind, items: list });
      }
    }
  }
  return blocks;
}

/** [text] cut into { text, hit } so the words of a query can be marked (case-insensitive). */
export function highlightSegments(text, words) {
  const ws = words.filter(Boolean).sort((a, b) => b.length - a.length);
  if (!ws.length || !text) return [{ text, hit: false }];
  const alt = ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const whole = new RegExp(`^(?:${alt})$`, "i");
  return text
    .split(new RegExp(`(${alt})`, "i"))
    .filter((s) => s !== "")
    .map((s) => ({ text: s, hit: whole.test(s) }));
}
