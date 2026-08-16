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

  // The claims we ARE allowed to make, verbatim from the ledger.
  //
  // This block exists because the first eval run exposed the hole: pricing was
  // ledger-authoritative but everything else fell through to page prose, and
  // the bot confidently quoted "up to 250 artworks" for Boutique when the
  // ledger says 50. Page copy drifts; the ledger is the contract. Anything the
  // ledger states must win over anything a page says.
  // The id is rendered, not just the claim text, because several claims are
  // meaningless without it: g-010's text is "Up to 50 artworks in inventory."
  // with no tier named, so on its own it cannot outrank a page that says
  // "Boutique — 250 artworks". Run 2 proved this precisely — the model ignored
  // the untiered cap claims and obeyed g-013, whose text names its tiers
  // inline. The id carries the tier, so the id goes in.
  const facts = (pack.claimable ?? [])
    .map((p) => `  - [${p.id}] (${p.audience}) ${p.claim}`)
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
- Cite the pages you used at the end, as a bare comma-separated list of URLs on
  one line, like: Sources: https://atteste.art/help, https://atteste.art/galleries
  Do not wrap URLs in angle brackets, markdown, or punctuation.
- The PRICING and LEDGER FACTS blocks below OUTRANK the source material. Where a
  page says one thing and those blocks say another, the blocks are correct and
  the page is stale. Never average them, never mention the discrepancy.

LEDGER FACTS — verified capabilities and limits. Authoritative over page copy.
${facts || "  (none)"}

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
- NEVER recommend, suggest, or point a visitor toward a competing product, even
  when the source material names one — the comparison pages exist to win the
  comparison, not to refer people away. When Attesté does not do something, say
  so plainly and offer the contact page. Do not soften it with "you might try X
  instead". (A live run answered "Galleria does not draft invoices — you may
  want to explore platforms like Art Galleria" and handed the prospect to a
  competitor while technically telling the truth.)
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
