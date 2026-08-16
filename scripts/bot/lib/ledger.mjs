/**
 * Post-generation Promise Ledger check.
 *
 * The system prompt tells the model what it may not claim. This is the part
 * that assumes the model ignored it. Belt and braces is the right posture for
 * an unreviewed, real-time, public surface.
 *
 * Deliberately crude: it looks for the distinctive content words of each
 * forbidden claim appearing together in an affirmative sentence. It will have
 * false positives, and that is the correct bias — a wrongly-withheld answer
 * costs a click to the contact page; a wrongly-made promise costs trust.
 */

const STOP = new Set(
  ("a an and are as at be by can do does for from has have how in is it its of on or that the this to " +
   "was what when where which who why will with you your our we they their them a's able about above " +
   "any all also into over your yours attesté atteste app").split(" ")
);

const words = (s) =>
  (s.toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) ?? []).filter((w) => w.length > 3 && !STOP.has(w));

/** Sentences that read as a denial rather than an offer. */
const NEGATED = /\b(not|isn'?t|aren'?t|no|never|cannot|can'?t|don'?t|doesn'?t|without|unavailable|unable|yet to|not yet|coming|planned|roadmap|currently no)\b/i;

/**
 * @param {string} answer            the model's output
 * @param {object[]} neverClaim      pack.never_claim entries
 * @param {number} threshold         fraction of a claim's distinctive words that must co-occur
 * @returns {{ok: boolean, violations: object[]}}
 */
export function checkAnswer(answer, neverClaim = [], { threshold = 0.6 } = {}) {
  const sentences = answer.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim().length > 12);
  const violations = [];

  for (const entry of neverClaim) {
    const keys = [...new Set(words(entry.claim ?? ""))];
    if (keys.length < 3) continue;

    for (const sentence of sentences) {
      if (NEGATED.test(sentence)) continue; // "we don't offer X yet" is allowed
      const present = keys.filter((k) => sentence.toLowerCase().includes(k));
      const ratio = present.length / keys.length;
      if (ratio >= threshold) {
        violations.push({
          id: entry.id,
          status: entry.status,
          claim: entry.claim,
          matched: ratio,
          sentence: sentence.trim().slice(0, 200),
        });
        break;
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

/** What to serve instead when the check trips. Never show the raw answer. */
export const FALLBACK =
  "I'd rather not answer that from memory — let me get you a straight answer from a person. " +
  "You can reach the team at https://atteste.art/help/contact and they'll come back to you.";
