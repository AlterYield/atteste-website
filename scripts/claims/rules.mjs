/**
 * Copy rules the claim gate enforces on every page, staged blocks included.
 * Each rule cites where it comes from, so a rule can be retired with its source.
 */

export { RETIRED_PHRASES } from "../bot/lib/ledger.mjs";

/**
 * Pages exempt from the copy rules below (not from retired phrases): legal
 * documents state contract terms ("you may cancel at any time", "Commissioner")
 * rather than marketing claims, and their wording is owned by the legal review.
 */
export const LEGAL_PAGES = new Set([
  "terms.html", "privacy.html", "cookies.html", "refunds.html", "ai-disclosure.html",
  "legacy-disclaimer.html", "community-guidelines.html", "delete-account.html",
]);

/**
 * Lines that sat in a retired entry's bundle and lost their backing with it.
 * g-091's promise was four claims in one string, and a-002's carried "no
 * exclusivity": retiring the entry retired all of them. Management session
 * 2026-10-08: no live or shipping entry holds any of these. They come back
 * only with an entry of their own.
 */
export const ORPHANED_PHRASES = {
  "g-091-no-commission (orphaned sibling)": [
    /\bper[-\s]scan\b/i,
    /\bper[-\s]visitor\s+(charges?|fees?)\b/i,
    /\b(no|zero)\s+(setup|set-up|activation)\b[^.]{0,20}\bfees?\b/i,
    /\bcancel\s+(at\s+)?any\s*time\b/i,
    /\bno\s+(annual\s+|long-term\s+)?lock-in\b/i,
  ],
  "a-002-no-fees-no-commission (orphaned sibling)": [/\bno\s+exclusivity\b/i, /\bnon-exclusive\s+(by design|for artists)\b/i],
};

/**
 * Claim ceilings — Brain goal G12, binding on every word (2026-10-08), plus
 * the payment-copy rules in g-111's risks.
 * `sentence: true` means the pattern pair must co-occur within one sentence.
 * `negatable: true` lets "does not verify artist identity" through: stating a
 * ceiling is not breaking it.
 */
export const CEILINGS = [
  { id: "C1 identity is self-asserted", re: /\b(verifie[sd]|verify|verifying|authenticates?)\s+(the\s+|each\s+|every\s+)?artists?\b(?!['’]s\s+work)/i, negatable: true },
  { id: "C1 identity is self-asserted", re: /\bverified\s+artists?\b/i, negatable: true },
  { id: "C1 identity is self-asserted", re: /\bproves?\s+who\s+(made|painted|created)\b/i },
  { id: "C1 identity is self-asserted", re: /\bconfirm(ed|s|ing)?\s+authorship\b/i },
  { id: "C1 identity is self-asserted", re: /\bmarks?\s+(a|the)\s+work\s+as\s+authentic\b/i },
  { id: "C1/C4 Attesté does not authenticate art", re: /\b(catalogue|catalog),\s+authenticate\b|\bAttest[ée]\s+authenticates\b|\bauthenticates?\s+(your|the|an?|every)\s+(art|artworks?|works?|collections?)\b/i, negatable: true },
  { id: "C4 NFC points at the record", sentence: true, a: /\bNFC\b/i, b: /tamper|proves?\s+(it['’]?s\s+)?authentic|authenticity|counterfeit-proof|anti-counterfeit/i },
  { id: "C4 no tamper-proof (glossary: dishonest)", re: /\btamper[-\s]proof\b/i, except: ["glossary.html"] },
  { id: "C3/g-111 Attesté never holds funds", re: /\bAttest[ée]\s+(holds?|keeps?|safeguards?|protects?|guarantees?|secures?)(\s+(the|your|their|buyer['’]?s?|seller['’]?s?))*\s+(money|funds|payments?)\b/i },
  { id: "C3/g-111 Attesté never holds funds", re: /\b(we|Attest[ée])\s+(hold|protect|guarantee)\s+(your|the)\s+(money|funds|payment)\b/i },
  { id: "C3/g-111 no guaranteed payment", re: /\bguaranteed\s+(payment|payout|funds)\b/i },
  { id: "G11 TradeSafe is being retired", re: /\bTradeSafe\b/i },
  { id: "rail marks not licensed", re: /<img[^>]+(peach|escrow[-_.]?com)[^>]*>/i, raw: true },
  { id: "C5 no voice-capture invitation", sentence: true, a: /\b(record|tell|speak|narrate)\b/i, b: /\b(voice|aloud|out loud)\b[^.]{0,60}\b(provenance|story|stories)\b.*\b(certificate|publish|public)\b/i },
];

/**
 * Company identity (Charl, relayed 2026-10-09; Brain decision 2026-08-22
 * "two-address model"). The founder is Charl le Roux; the place of business is
 * Stellenbosch, Western Cape. Bloemfontein is the CIPC registered office:
 * correct only where it is LABELLED as the registered office, plus two
 * deliberate exceptions — Attesté's historical foundingLocation (kept by the
 * 2026-08-22 decision) and certificate provenance data (an artwork's history,
 * not the company's).
 */
export const IDENTITY = {
  banned: [/\bKarel\b/i, /\bKraai\b/i],
  bloemfontein: /\bBloemfontein\b/i,
  bloemfonteinAllowed: [
    /registered\s+office[^\n]{0,160}Bloemfontein/i,
    /"foundingLocation":\s*\{[^}]*Bloemfontein/i,
  ],
  bloemfonteinExemptPrefixes: ["cert/"],
};
