/**
 * Knowledge pack loading + chunk selection.
 *
 * Zero dependencies, plain ESM. Everything below the loader is a pure
 * function over a pack object, so `netlify/functions/chat.mjs` (Phase 1) can
 * import this file verbatim — no port, no rewrite.
 */

import { readFile } from "node:fs/promises";

/** Load a built pack from disk. Node-only; the function bundles the JSON. */
export async function loadKnowledge(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

/**
 * Pick the chunks that go into the prompt.
 *
 * Phase 0 uses "all" — the whole pack is ~15k tokens, which comfortably fits
 * one prompt, so retrieval would add failure modes and buy nothing. The
 * signature already takes a question and a strategy so that swapping in BM25
 * later (when model cost justifies it) touches this function and nothing else.
 *
 * @returns {{chunks: object[], strategy: string, total: number}}
 */
export function selectChunks(pack, question, { strategy = "all", limit = 12 } = {}) {
  const all = pack.chunks ?? [];
  if (strategy === "all") return { chunks: all, strategy, total: all.length };
  if (strategy === "bm25") {
    const scored = rankBm25(all, question).slice(0, limit);
    return { chunks: scored, strategy, total: all.length };
  }
  throw new Error(`unknown selection strategy: ${strategy}`);
}

// ── v2 retrieval, dormant until cost justifies it ───────────────────────────
// Deliberately dependency-free and deliberately unused in Phase 0. Kept here
// so the seam is real and testable rather than hypothetical.

const STOP = new Set(
  ("a an and are as at be by can do does for from has have how i in is it its of on or that the this to " +
   "was what when where which who why will with you your").split(" ")
);

const tokenize = (s) =>
  (s.toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) ?? []).filter((t) => t.length > 1 && !STOP.has(t));

export function rankBm25(chunks, question, { k1 = 1.5, b = 0.75 } = {}) {
  const terms = tokenize(question);
  if (!terms.length) return chunks;

  const docs = chunks.map((c) => tokenize(`${c.title} ${c.heading} ${c.text}`));
  const avgLen = docs.reduce((n, d) => n + d.length, 0) / (docs.length || 1);

  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);

  return chunks
    .map((chunk, i) => {
      const doc = docs[i];
      const freq = new Map();
      for (const t of doc) freq.set(t, (freq.get(t) ?? 0) + 1);
      let score = 0;
      for (const t of terms) {
        const f = freq.get(t);
        if (!f) continue;
        const idf = Math.log(1 + (docs.length - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * doc.length) / avgLen)));
      }
      return { chunk, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .map((r) => r.chunk);
}
