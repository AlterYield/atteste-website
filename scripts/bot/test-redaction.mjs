#!/usr/bin/env node
/**
 * Redaction tests for the conversation log. No key, no network.
 *
 *   node scripts/bot/test-redaction.mjs
 *
 * Visitors type free text into a public box, and some of them will type their
 * own email, phone, or ID number into it. Everything a sink ever sees passes
 * through redact() first, so this is the guard that keeps the log from
 * becoming a personal-data store. The negative cases matter as much as the
 * positive ones: over-redacting "50 artworks" would gut the log's usefulness.
 */
import { redact, buildRecord } from "./lib/chatlog.mjs";

const CASES = [
  ["my email is sarah.vd.merwe+art@gallery.co.za", "my email is [email]"],
  ["reach me on +27 82 555 0134 please", "reach me on [phone] please"],
  ["call (011) 555-0134", "call [phone]"],
  ["my id is 8801235045087", "my id is [number]"],
  ["card 4111111111111111 expires", "card [number] expires"],
  // Our own contact addresses survive — knowing the bot routed someone to
  // galleries@ is signal, and it is not somebody's personal data.
  ["email galleries@atteste.art to set up", "email galleries@atteste.art to set up"],
  ["reply to frida@atteste.work", "reply to frida@atteste.work"],
  // Must NOT be touched — these are the log's whole value.
  ["how much does the Boutique plan cost?", "how much does the Boutique plan cost?"],
  ["I have 50 artworks and 6 exhibitions", "I have 50 artworks and 6 exhibitions"],
  ["is $64.99 per month or per year?", "is $64.99 per month or per year?"],
];

let passed = 0;
for (const [input, want] of CASES) {
  const got = redact(input);
  const ok = got === want;
  passed += ok ? 1 : 0;
  console.log(`${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${JSON.stringify(got)}${ok ? "" : `  want ${JSON.stringify(want)}`}`);
}

// The record must never carry an identifier we promised not to keep.
const rec = buildRecord({
  question: "email me at x@y.com", answer: "Sure. Sources: https://atteste.art/help",
  cid: "abc123", page: "/galleries", usage: { in: 100, out: 20 }, ms: 900,
  costUsd: 0.00012, model: "gemini-flash-lite", verdict: { ok: true, violations: [] },
});
const forbidden = ["ip", "email", "ua", "userAgent", "referer"].filter((k) => k in rec);
const shapeOk = forbidden.length === 0 && rec.q === "email me at [email]";
passed += shapeOk ? 1 : 0;
console.log(`${shapeOk ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m record carries no IP/UA and redacts q${forbidden.length ? ` — found ${forbidden}` : ""}`);

console.log(`\n${passed}/${CASES.length + 1} passed`);
process.exit(passed === CASES.length + 1 ? 0 : 1);
