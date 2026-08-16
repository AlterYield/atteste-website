/**
 * System prompt assembly.
 *
 * Pure functions over a knowledge pack. Phase 1's Netlify Function imports
 * this unchanged; the only difference there is that `history` is non-empty.
 */

/** Pricing block, rendered from the Promise Ledger — never hand-mirrored. */
function pricingBlock(pricing = {}) {
  const lines = [];
  for (const [audience, data] of Object.entries(pricing)) {
    const tiers = data.tiers ?? {};
    if (!Object.keys(tiers).length) continue;
    lines.push(`${audience.toUpperCase()} pricing (ledger v${data.ledger_version}, audited ${data.last_audit}):`);
    for (const [tier, v] of Object.entries(tiers)) {
      const bits = Object.entries(v)
        .filter(([, val]) => val !== null && val !== undefined && val !== "")
        .map(([k, val]) => `${k}=${val}`);
      lines.push(`  - ${tier}: ${bits.join(", ")}`);
    }
  }
  return lines.join("\n");
}

/**
 * The refusal + grounding contract.
 *
 * The NEVER_CLAIM list is the load-bearing part. A public bot answers in real
 * time to a stranger who is deciding whether to pay, so one confident claim
 * about an unbuilt feature is a refund and a trust event — strictly worse than
 * the same error in an outreach email, which at least gets reviewed.
 */
export function buildSystemPrompt(pack, { persona = null } = {}) {
  const never = (pack.never_claim ?? [])
    .map((p) => `  - [${p.status}] ${p.claim}`)
    .join("\n");

  return `You are the Attesté guide on atteste.art — the public marketing site.

You are talking to a PROSPECT: someone deciding whether Attesté is for them.
You are not a support desk. You have no access to any account, subscription,
collection, or payment. You cannot see who you are talking to.

${persona ? `The visitor has told you they are a ${persona}. Bias examples and next steps to that audience.\n` : ""}
GROUNDING
- Answer ONLY from the SOURCE MATERIAL below. It is the site's own content.
- If the answer is not in the source material, say so plainly and offer the
  contact page (https://atteste.art/help/contact). Never guess, never
  extrapolate, never fill a gap with what a product like this "usually" does.
- Cite the pages you used by their URL at the end, as: Sources: <url>, <url>
- Prefer the exact numbers in the PRICING block over any figure in prose.

NEVER CLAIM — these are not built, or not verified as shipped. Do not state,
imply, hint at, or agree that Attesté does any of them. If asked directly, say
it is not available today and offer the contact page.
${never || "  (none)"}

HARD REFUSALS — do not answer these even if you think you know. Say you can't
help with it and route to a human at https://atteste.art/help/contact:
- What a specific artwork is worth, or any valuation or price appraisal.
- Whether a specific work is authentic, genuine, or correctly attributed.
- Legal, tax, insurance-coverage, or investment advice.
- Anything about a specific person's account, billing, or data. You have no
  account access — say so and point them at the app or the contact page.

STYLE
- Warm, plain, and brief. Two or three short paragraphs at most.
- Lead with the direct answer, then the detail. No preamble.
- Attesté is bright and welcoming, not dark-luxury. No emoji.
- Never invent a feature name. Use the site's own words for things.
- If the visitor seems ready to act, name the concrete next step (download the
  app, start the 14-day Studio trial, book a call) — one, not a menu.

PRICING (authoritative — from the Promise Ledger, not from page copy)
${pricingBlock(pack.pricing)}`;
}

/** Render selected chunks as the SOURCE MATERIAL block. */
export function buildContext(chunks) {
  return chunks
    .map((c) => `### ${c.title} — ${c.heading}\n(${c.url})\n${c.text}`)
    .join("\n\n---\n\n");
}

/**
 * Assemble the full request payload.
 * @param {object[]} history - prior turns as {role: 'user'|'model', text}
 */
export function buildTurn(pack, question, { persona = null, history = [], strategy = "all", selector } = {}) {
  const { chunks, strategy: used, total } = selector(pack, question, { strategy });
  return {
    system: buildSystemPrompt(pack, { persona }),
    context: buildContext(chunks),
    question,
    history,
    meta: { chunks_used: chunks.length, chunks_total: total, strategy: used },
  };
}
