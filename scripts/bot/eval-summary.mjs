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
const done = results.filter((r) => !r.error && !r.skipped);
const passed = results.filter((r) => (r.fails ?? []).length === 0).length;
const ledgerViolations = results.filter((r) => r.ledger && !r.ledger.ok).length;
const skipped = results.filter((r) => r.skipped).length;
const costUsd = Number(done.reduce((n, r) => n + (r.costUsd ?? 0), 0).toFixed(6));
const times = done.map((r) => r.ms).filter(Number.isFinite).sort((a, b) => a - b);
const medianMs = times.length ? times[Math.floor(times.length / 2)] : null;

const line = {
  when: run.when,
  model: run.model,
  passed,
  total: results.length,
  ledgerViolations,
  skipped,
  costUsd,
  medianMs,
};

await appendFile(historyPath, JSON.stringify(line) + "\n");
console.log(JSON.stringify(line));

const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  const verdict = ledgerViolations > 0 ? "🔴 LEDGER VIOLATION" : passed === results.length ? "🟢 all passed" : "🟡 failures";
  await appendFile(
    summary,
    `### Website bot eval — ${verdict}\n\n` +
      `| metric | value |\n|---|---|\n` +
      `| when | ${line.when} |\n| model | ${line.model} |\n` +
      `| passed | **${passed} / ${results.length}** |\n` +
      `| ledger violations | **${ledgerViolations}** (must be 0) |\n` +
      `| skipped for cost | ${skipped} |\n` +
      `| cost | $${costUsd.toFixed(4)} |\n| median latency | ${medianMs ?? "—"} ms |\n\n` +
      (skipped > 0 ? `> ⚠️ ${skipped} case(s) were skipped by the cost cap — coverage is incomplete.\n` : ""),
  );
}
