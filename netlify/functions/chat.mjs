/**
 * POST /api/chat — the atteste.art site bot endpoint.
 *
 * Phase 1. Same-origin by design: `_redirects` rewrites /api/chat to this
 * function with a 200, so the browser never leaves atteste.art and the site's
 * existing `connect-src 'self'` CSP needs no change at all. That property is
 * most of why this is a Netlify Function rather than a hosted widget.
 *
 * Every piece of reasoning below the transport layer is imported verbatim from
 * scripts/bot/lib — the same modules the Phase 0 CLI and the 53-case eval run
 * against. There is deliberately no second copy of the prompt or the guard.
 *
 * Requires GEMINI_API_KEY in the Netlify environment (Site settings →
 * Environment variables). Without it the endpoint fails closed with a routing
 * message rather than a stack trace.
 */

import pack from "../../scripts/bot/knowledge.json" with { type: "json" };
import { selectChunks } from "../../scripts/bot/lib/knowledge.mjs";
import { buildTurn } from "../../scripts/bot/lib/prompt.mjs";
import { checkAnswer, FALLBACK } from "../../scripts/bot/lib/ledger.mjs";
import { generate } from "../../scripts/bot/lib/model.mjs";

const ALLOWED_ORIGINS = ["https://atteste.art", "https://www.atteste.art"];

// Keep a lid on both abuse and spend. Mirrors the in-memory sliding window in
// functions/src/public_site/stephen_site.ts (MED-07): per-instance, no write
// per check. It is not a distributed limiter and does not pretend to be — it
// caps what any single warm instance will serve, which is the practical brake.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 20;
const buckets = new Map();

const MAX_MESSAGE_CHARS = 600;
const MAX_HISTORY_TURNS = 8;

function rateLimited(ip) {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_PER_WINDOW;
}

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/** Split the model's trailing "Sources: a, b" line off into structured links. */
function splitSources(text) {
  const m = text.match(/\n*\s*sources?:\s*(.+)$/is);
  if (!m) return { answer: text.trim(), sources: [] };
  // Strip angle brackets and trailing punctuation: models copy the citation
  // format literally, and a stray ">" turns a good link into a 404.
  const sources = [...new Set(m[1].match(/https?:\/\/[^\s,)<>]+/g) ?? [])]
    .map((u) => u.replace(/[.,;<>]+$/, ""))
    .filter((u) => u.startsWith("https://atteste.art"));
  return { answer: text.slice(0, m.index).trim(), sources };
}

export default async function handler(request, context) {
  if (request.method !== "POST") return json(405, { error: "POST only" });

  // Kill switch. Flip SITE_CHAT_ENABLED to "false" in the Netlify UI to take
  // the bot down in seconds without a deploy — the widget hides itself on 503.
  if ((process.env.SITE_CHAT_ENABLED ?? "true").toLowerCase() === "false") {
    return json(503, { error: "disabled" });
  }

  // Same-origin only. The widget is first-party; nothing else has a reason to
  // call this, and no CORS headers are sent, so browsers block cross-site use.
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.includes(origin) && !origin.startsWith("http://localhost:")) {
    return json(403, { error: "forbidden" });
  }

  const ip = context?.ip ?? request.headers.get("x-nf-client-connection-ip") ?? "unknown";
  if (rateLimited(ip)) {
    return json(429, {
      answer:
        "You've asked a lot in a short while — give it a few minutes. " +
        "If you need someone now, the team is at https://atteste.art/help/contact",
      sources: [],
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "bad json" });
  }

  const message = String(body?.message ?? "").trim().slice(0, MAX_MESSAGE_CHARS);
  if (!message) return json(400, { error: "empty message" });

  const persona = ["collector", "artist", "gallery"].includes(body?.persona) ? body.persona : null;
  const history = Array.isArray(body?.history)
    ? body.history
        .slice(-MAX_HISTORY_TURNS)
        .filter((h) => h && typeof h.text === "string")
        .map((h) => ({ role: h.role === "model" ? "model" : "user", text: h.text.slice(0, 2000) }))
    : [];

  try {
    const turn = buildTurn(pack, message, { persona, history, selector: selectChunks });
    const res = await generate(turn, { model: process.env.SITE_CHAT_MODEL || "gemini-flash-lite" });
    const verdict = checkAnswer(res.text, pack.never_claim);

    // Deliberately terse and PII-free: no message body, no IP, no history.
    // Enough to spot a spike, a cost drift, or a guard trip; not enough to
    // reconstruct what a visitor asked. Phase 4 adds opt-in question logging.
    console.log(
      JSON.stringify({
        evt: "chat",
        ok: verdict.ok,
        chars: message.length,
        turns: history.length,
        tok: res.usage,
        ms: res.ms,
        ...(verdict.ok ? {} : { violated: verdict.violations.map((v) => v.id) }),
      })
    );

    if (!verdict.ok) return json(200, { answer: FALLBACK, sources: [], withheld: true });

    return json(200, splitSources(res.text));
  } catch (err) {
    console.error("chat_error", err?.message ?? err);
    return json(200, {
      answer:
        "Something went wrong on my side. The team can help directly — " +
        "https://atteste.art/help/contact",
      sources: [],
      degraded: true,
    });
  }
}
