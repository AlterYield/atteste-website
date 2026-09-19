#!/usr/bin/env node
/**
 * THE GATE — a suite that did not run must never render as a pass.
 *
 * The 54-case golden set has had a committed baseline since 2026-08-16 and the
 * weekly workflow that runs it has, as of 2026-09-19, **zero runs ever**. That
 * alone is the thing worth knowing, and nothing in the repo said it.
 *
 * Worse, when it does run, several shapes of "did not run" are indistinguish-
 * able from a pass:
 *
 *   1. `eval-summary.mjs` computed `passed === results.length`. With an empty
 *      results array that is `0 === 0`, so a run that produced NOTHING printed
 *      "🟢 all passed" and appended {"passed":0,"total":0} to the permanent
 *      history. There was no `total > 0` guard anywhere.
 *   2. `continue-on-error: true` on the eval step means eval.mjs's exit 1 —
 *      which fires on a ledger violation, on real failures, AND on all 54
 *      cases erroring — downgrades the job to success with a ::warning::.
 *   3. The `Summarise` and `Commit` steps `exit 0` when there is no result
 *      file, so a crashed run leaves a GREEN job and no history line at all.
 *      The history is a record of successes with invisible gaps: "the last
 *      line was green" never meant "the last run was green".
 *   4. A run with no key writes 54 error records — and those records carry no
 *      `costUsd` and no `ms`, so the baseline's own shape silently changes.
 *
 * This gate is the answer to all four. It reads the result file and the golden
 * set and fails unless a real model scored EVERY case. It needs no key and no
 * network, which is the point: the check that catches a missing credential
 * must not itself need one.
 *
 *   node scripts/bot/eval-gate.mjs                       # the committed latest
 *   node scripts/bot/eval-gate.mjs --result <path>
 *   node scripts/bot/eval-gate.mjs --max-age-days 14
 *   node scripts/bot/eval-gate.mjs --expect-cases 54
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RESULT = join(HERE, "eval-results", "latest.json");

/**
 * checkRun(run, {expectCases, maxAgeDays, now}) -> {ok, problems[]}
 *
 * `run` is the parsed result file. Every rule answers one question: did a real
 * model score every case? A rule a non-run could satisfy does not belong here.
 */
export function checkRun(run, { expectCases = null, maxAgeDays = null, now = new Date() } = {}) {
  const problems = [];
  const p = (m) => problems.push(m);

  if (run == null || typeof run !== "object") return { ok: false, problems: ["the result file did not parse as an object"] };

  const results = Array.isArray(run.results) ? run.results : null;
  if (results === null) {
    return { ok: false, problems: ["the result file has no `results` array — nothing was scored"] };
  }

  // Rule 1, the headline. `0 === 0` is not "all passed".
  if (results.length === 0) {
    p("the run scored 0 cases — NOTHING RAN. An empty result set is an absence of evidence, not a pass");
  }

  if (expectCases != null && results.length !== expectCases) {
    p(
      `the run holds ${results.length} case(s) but the golden set has ${expectCases} — ` +
        "a partial run is not a baseline; re-run without --only and with a cap high enough to finish",
    );
  }

  // Rule 2: a case that never reached the model.
  const errored = results.filter((r) => r && r.error);
  const skipped = results.filter((r) => r && r.skipped);
  if (errored.length > 0) {
    const first = String(errored[0].error ?? "");
    const credentialish = /API_KEY|api key|not set|credential|unauthorized|401|403/i.test(first);
    p(
      `${errored.length} of ${results.length} case(s) errored rather than being scored` +
        (credentialish
          ? ` — and the first error looks like a MISSING CREDENTIAL: "${first.split("\n")[0].slice(0, 120)}". ` +
            "That is a run that did not happen, not a model that answered badly"
          : ` — first: "${first.split("\n")[0].slice(0, 120)}"`),
    );
  }
  if (skipped.length > 0) {
    p(
      `${skipped.length} case(s) were skipped by the cost cap — coverage is incomplete, and because ` +
        "the cap is applied across 4 concurrent workers there is no guarantee WHICH cases were dropped. " +
        "The 8 ledger traps and 6 refusals sit late in the set, so they are the most likely to be lost",
    );
  }

  // Rule 3: a record with no `fails` key must never be counted as a pass. The
  // old summariser's `(r.fails ?? []).length === 0` did exactly that.
  const shapeless = results.filter((r) => !r || !Array.isArray(r.fails));
  if (shapeless.length > 0) {
    p(`${shapeless.length} case record(s) carry no \`fails\` array — unknown is not a pass`);
  }

  const failed = results.filter((r) => Array.isArray(r?.fails) && r.fails.length > 0 && !r.knownFlaky);
  if (failed.length > 0) p(`${failed.length} case(s) failed: ${failed.slice(0, 6).map((r) => r.id).join(", ")}`);

  const ledger = results.filter((r) => r?.ledger && r.ledger.ok === false);
  if (ledger.length > 0) p(`${ledger.length} LEDGER VIOLATION(S) — the bot stated things we have not built`);

  // Rule 4: name the model. `run.model` was the ALIAS only, so a run before
  // and after a GEMINI_MODEL_ID change looked identical.
  if (typeof run.model !== "string" || !run.model.trim()) {
    p("no model recorded — a result that cannot name the model it scored is not evidence");
  } else if (!/\(.+\)/.test(run.model) && !run.modelId) {
    p(
      `model is "${run.model}" — an ALIAS with no resolved id. Record the resolved id ` +
        "(e.g. gemini-flash-lite (gemini-3.5-flash-lite)) or a run across a model swap is invisible",
    );
  }

  if (maxAgeDays != null) {
    const t = Date.parse(run.when ?? "");
    if (!Number.isFinite(t)) p(`\`when\` is ${JSON.stringify(run.when)} — unparseable, so staleness cannot be checked`);
    else {
      const age = (now.getTime() - t) / 86_400_000;
      if (age > maxAgeDays) p(`the result is ${age.toFixed(1)} days old, past the ${maxAgeDays}-day limit`);
    }
  }

  return { ok: problems.length === 0, problems };
}

function argOf(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback;
}

async function main() {
  const path = resolve(argOf("--result", DEFAULT_RESULT));
  const maxAgeRaw = argOf("--max-age-days", null);
  const expectRaw = argOf("--expect-cases", null);
  const maxAgeDays = maxAgeRaw == null ? null : Number(maxAgeRaw);
  let expectCases = expectRaw == null ? null : Number(expectRaw);
  if (expectCases == null) {
    // Default to the live golden set, so adding a case automatically widens
    // the gate rather than needing someone to remember.
    const { GOLDEN } = await import("./golden.mjs");
    expectCases = GOLDEN.length;
  }

  if (!existsSync(path)) {
    console.error("");
    console.error("::error::EVAL GATE FAILED — no eval result on disk. This suite has never scored a model.");
    console.error("");
    console.error(`  Looked for: ${path}`);
    console.error("");
    console.error("  As of 2026-09-19 the weekly workflow (bot-eval-weekly.yml) had ZERO runs, so this");
    console.error("  is the honest state rather than a bug in the gate.");
    console.error("");
    console.error("  To produce the baseline (the GEMINI_API_KEY secret already exists on this repo):");
    console.error("    gh workflow run bot-eval-weekly.yml --repo AlterYield/atteste-website");
    console.error("");
    process.exit(1);
  }

  let run;
  try {
    run = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`::error::EVAL GATE FAILED — ${path} did not parse: ${e.message}`);
    process.exit(1);
  }

  const { ok, problems } = checkRun(run, { expectCases, maxAgeDays });
  if (!ok) {
    console.error("");
    console.error(`::error::EVAL GATE FAILED — ${path} does not evidence a completed real-model run`);
    for (const m of problems) console.error(`  · ${m}`);
    console.error("");
    process.exit(1);
  }
  console.error(
    `eval gate: PASS — ${run.results.length}/${expectCases} cases scored by ${run.model} on ${run.when}`,
  );
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
