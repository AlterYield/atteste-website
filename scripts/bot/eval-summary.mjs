#!/usr/bin/env node
/**
 * Fold one eval run's JSON into a single history line + a job summary.
 *
 * Separate from eval.mjs on purpose: the eval decides pass/fail, this decides
 * what gets committed. Keeping them apart means a change to the reporting
 * format can never alter a verdict.
 *
 * Usage: node scripts/bot/eval-summary.mjs <latest.json> <history.jsonl>
 */

import { readFile, appendFile } from "node:fs/promises";

const [, , latestPath, historyPath] = process.argv;
if (!latestPath || !historyPath) {
  console.error("usage: eval-summary.mjs <latest.json> <history.jsonl>");
  process.exit(2);
}

const run = JSON.parse(await readFile(latestPath, "utf8"));
const results = run.results ?? [];

// A run that scored nothing must not be folded into the permanent history as
// a green line. Before this guard, `passed === results.length` on an empty
// array was `0 === 0` — so a run that produced NOTHING printed "🟢 all passed"
// and appended {"passed":0,"total":0,"ledgerViolations":0} to history.jsonl.
// The history then read as an unbroken run of successes with invisible gaps.
if (results.length === 0) {
  console.error(
    "::error::eval-summary: the run scored 0 cases. NOTHING RAN — this is not a pass, and no " +
      "history line will be written. An empty history is honest; a green one is not.",
  );
  process.exit(1);
}
const done = results.filter((r) => !r.error && !r.skipped);
// `(r.fails ?? [])` treated a record with NO fails key as a pass — a dry-run
// record or a hand-edited file would score 100%. Unknown is not a pass.
const scored = results.filter((r) => Array.isArray(r.fails));
const unscored = results.length - scored.length;
const passed = scored.filter((r) => r.fails.length === 0).length;
const ledgerViolations = results.filter((r) => r.ledger && !r.ledger.ok).length;
const skipped = results.filter((r) => r.skipped).length;
const costUsd = Number(done.reduce((n, r) => n + (r.costUsd ?? 0), 0).toFixed(6));
const times = done.map((r) => r.ms).filter(Number.isFinite).sort((a, b) => a - b);
const medianMs = times.length ? times[Math.floor(times.length / 2)] : null;

const errors = results.filter((r) => r.error).length;
const line = {
  when: run.when,
  model: run.model,
  passed,
  // `total` is the declared case count; `scored` is how many were actually
  // graded. The pair is what distinguishes a truncated run from a complete
  // one — without it, 2 of 54 and 54 of 54 are the same line.
  total: results.length,
  scored: scored.length,
  unscored,
  errors,
  ledgerViolations,
  skipped,
  costUsd,
  medianMs,
};

await appendFile(historyPath, JSON.stringify(line) + "\n");
console.log(JSON.stringify(line));

const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  // A verdict must never be reachable by a run that did not happen. "all
  // passed" now requires that every declared case was actually scored.
  const complete = scored.length === results.length && errors === 0 && skipped === 0;
  const verdict =
    ledgerViolations > 0
      ? "🔴 LEDGER VIOLATION"
      : !complete
        ? "🔴 INCOMPLETE — did not score every case"
        : passed === results.length
          ? "🟢 all passed"
          : "🟡 failures";
  await appendFile(
    summary,
    `### Website bot eval — ${verdict}\n\n` +
      `| metric | value |\n|---|---|\n` +
      `| when | ${line.when} |\n| model | ${line.model} |\n` +
      `| passed | **${passed} / ${results.length}** |\n` +
      `| actually scored | **${scored.length} / ${results.length}**${unscored ? " ⚠️" : ""} |\n` +
      `| errored | ${errors}${errors ? " ⚠️" : ""} |\n` +
      `| ledger violations | **${ledgerViolations}** (must be 0) |\n` +
      `| skipped for cost | ${skipped} |\n` +
      `| cost | $${costUsd.toFixed(4)} |\n| median latency | ${medianMs ?? "—"} ms |\n\n` +
      (skipped > 0 ? `> ⚠️ ${skipped} case(s) were skipped by the cost cap — coverage is incomplete.\n` : ""),
  );
}
