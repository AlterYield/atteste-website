/**
 * Conversation logging.
 *
 * The point of this is not observability for its own sake. The questions
 * strangers ask on a pre-distribution site ARE the FAQ page we haven't written
 * and the objections the sales lane has to answer. That is the deliverable;
 * latency and cost are a side-effect.
 *
 * Two sinks, chosen because of what this repo is:
 *
 *  - `console` — always on. Netlify captures stdout per invocation. Free,
 *    zero-dependency, zero new infrastructure. Rotates, and is not queryable,
 *    so it is a stopgap rather than an answer.
 *
 *  - `webhook` — opt-in. POSTs the record to SITE_CHAT_LOG_WEBHOOK, HMAC-signed
 *    with SITE_CHAT_LOG_SECRET. Unset by default, so nothing leaves the
 *    function until someone decides where the data should live.
 *
 * What was rejected and why, so it isn't relitigated:
 *  - Netlify Blobs needs `@netlify/blobs` in a package.json. This site's
 *    publish directory IS the repo root, so an install would publish
 *    node_modules. Its raw HTTP contract is undocumented.
 *  - Firestore direct needs a service-account key placed in Netlify env.
 *  - The right long-term home is a small public Cloud Function in the Atteste
 *    functions repo writing to Firestore — same shape as
 *    public_site/stephen_site.ts. Then this is one env var, no code change.
 *    That is why the sink is a webhook and not something cleverer.
 *
 * POPIA: visitors type free text and some of them will type their own email or
 * phone number into it. `redact()` strips the obvious identifiers BEFORE the
 * record is built, so no sink ever sees them. IP addresses are never recorded.
 * The conversation id is generated client-side per browser session — a
 * grouping key, not an identity, and it dies with the tab.
 */

import { createHmac } from "node:crypto";

/** Strip the identifiers a visitor is most likely to volunteer. */
export function redact(text) {
  if (typeof text !== "string") return "";
  return (
    text
      // Our OWN addresses are not personal data here, and knowing the bot
      // pointed someone at galleries@atteste.art is exactly the signal the log
      // exists for. Redact everyone else's.
      .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi, (m) =>
        /@atteste\.(art|work)$/i.test(m) ? m : "[email]")
      // Bare long digit runs FIRST — SA ID numbers are 13 digits, card numbers
      // 16. Ordering matters: the phone pattern below also matches these, and
      // whichever runs first wins the label. Everything gets redacted either
      // way, but a 13-digit ID tagged "[phone]" misleads whoever reads the log.
      .replace(/\b\d{9,}\b/g, "[number]")
      // Separated forms: +27 82 555 0134, (011) 555-0134, 082-555-0134.
      .replace(/\(?\+?\d[\d\s().-]{7,}\d\)?/g, "[phone]")
  );
}

/**
 * @returns a flat, PII-minimised record. Flat because a webhook target and a
 *          log line both want the same thing, and nesting helps neither.
 */
export function buildRecord({
  question, answer, persona = null, cid = null, turnIndex = 0,
  usage = {}, ms = 0, costUsd = 0, model = null, verdict = { ok: true, violations: [] },
  withheld = false, page = null,
}) {
  return {
    evt: "chat",
    at: new Date().toISOString(),
    cid,                       // per-tab grouping key, not an identity
    turn: turnIndex,
    persona,
    page,                      // which page the question was asked from
    q: redact(question).slice(0, 600),
    a: redact(answer).slice(0, 2000),
    withheld,                  // ledger guard fired; `a` is the fallback text
    violations: verdict.ok ? [] : verdict.violations.map((v) => v.id),
    model,
    tok_in: usage.in ?? 0,
    tok_out: usage.out ?? 0,
    ms,
    usd: Number(costUsd.toFixed(6)),
  };
}

async function sendWebhook(record) {
  const url = process.env.SITE_CHAT_LOG_WEBHOOK;
  const secret = process.env.SITE_CHAT_LOG_SECRET;
  if (!url) return;

  const body = JSON.stringify(record);
  const headers = { "content-type": "application/json" };
  if (secret) headers["x-atteste-signature"] = createHmac("sha256", secret).update(body).digest("hex");

  // Never let logging break an answer that already succeeded. A visitor
  // waiting on a reply must not pay for our telemetry being down.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    await fetch(url, { method: "POST", headers, body, signal: ctrl.signal });
  } catch (err) {
    console.error("chatlog_webhook_failed", err?.name ?? err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Write one turn to every configured sink. Always resolves — logging failures
 * are reported, never thrown.
 */
export async function logTurn(record) {
  console.log(JSON.stringify(record));
  await sendWebhook(record);
}
