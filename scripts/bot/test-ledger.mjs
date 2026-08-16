#!/usr/bin/env node
/**
 * Self-test for the Promise Ledger guard. No API key, no network.
 *
 *   node scripts/bot/test-ledger.mjs
 *
 * This is the one component that must work even when the model misbehaves, so
 * it gets tested independently of the model. Fixtures are written against the
 * real never_claim entries in knowledge.json rather than invented ones — a mock
 * that mirrors the bug is worse than no test.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";

import { checkAnswer } from "./lib/ledger.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const pack = JSON.parse(await readFile(join(HERE, "knowledge.json"), "utf8"));
const never = pack.never_claim;

if (!never?.length) {
  console.error("knowledge.json has no never_claim entries — rebuild it first.");
  process.exit(2);
}

const CASES = [
  // Must be caught: affirmative statements of unbuilt capability.
  { want: "violation", why: "invoice drafting (gap)", text:
    "Yes — Galleria drafts invoices for you automatically, handling the busywork of invoices and certificates." },
  { want: "violation", why: "artist collections (planned)", text:
    "You can group works into a named, priced Collection and offer it as one bundle to buyers." },
  { want: "violation", why: "gallery IAP (planned)", text:
    "Galleries subscribe directly in the iOS or Android app via the App Store or Play Store, monthly or annual." },
  { want: "violation", why: "wearable capture (planned)", text:
    "Capture works hands-free from smartglasses, or import straight from your camera roll into the Atelier." },
  { want: "violation", why: "consignment dashboard (planned)", text:
    "There's a view showing every work you have on consignment with galleries, with status and splits in one place." },

  // Must pass: the same subjects, correctly denied. Denial is the whole point —
  // the bot has to be able to talk ABOUT a missing feature without promising it.
  { want: "clean", why: "invoicing denied", text:
    "Invoice drafting is not available today — Galleria does not draft invoices yet. The team can tell you more." },
  { want: "clean", why: "web checkout denied", text:
    "Self-serve web checkout is planned but not yet available; galleries activate with an activation code instead." },
  { want: "clean", why: "collections denied", text:
    "Grouping works into a priced Collection isn't something you can do yet. I can put you in touch with the team." },

  // Must pass: ordinary grounded answers with no bearing on the ledger.
  { want: "clean", why: "certificate explainer", text:
    "A certificate of attestation is a SHA-256 sealed provenance record for a work. Sources: https://atteste.art/help/provenance-and-certificates" },
  { want: "clean", why: "pricing answer", text:
    "Boutique is $64.99 a month. Founding galleries get 30% off for the first year. Sources: https://atteste.art/galleries" },
  { want: "clean", why: "refusal", text:
    "I can't give valuations — that needs a qualified appraiser. Reach the team at https://atteste.art/help/contact" },
];

let passed = 0;
for (const c of CASES) {
  const res = checkAnswer(c.text, never);
  const got = res.ok ? "clean" : "violation";
  const ok = got === c.want;
  passed += ok ? 1 : 0;
  const detail = res.ok ? "" : ` (${res.violations.map((v) => v.id).join(", ")})`;
  console.log(`${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${c.why} — expected ${c.want}, got ${got}${detail}`);
}

console.log(`\n${passed}/${CASES.length} passed`);
process.exit(passed === CASES.length ? 0 : 1);
