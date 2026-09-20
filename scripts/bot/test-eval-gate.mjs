#!/usr/bin/env node
/**
 * THE TEST THAT PROVES A NON-RUN FAILS. No API key, no network.
 *
 * Each case below reconstructs a result a broken or absent run would leave
 * behind and asserts the gate — and the summariser — REFUSE it. The headline
 * one is `the empty run`: on 2026-09-19 `eval-summary.mjs` computed
 * `passed === results.length`, which for an empty array is `0 === 0`, so a run
 * that scored nothing printed "🟢 all passed" and wrote {"passed":0,"total":0}
 * into the permanent history.
 *
 * Usage: node scripts/bot/test-eval-gate.mjs
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRun } from "./eval-gate.mjs";
import { GOLDEN } from "./golden.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(HERE, "eval-gate.mjs");
const SUMMARY = resolve(HERE, "eval-summary.mjs");

let failures = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${e.message.split("\n")[0]}`);
  }
};

const caseOk = (id) => ({ id, fails: [], ledger: { ok: true, violations: [] }, costUsd: 0.007, ms: 1600 });

/** A run that SHOULD pass: every golden case scored, none failing. */
const good = (over = {}) => ({
  model: "gemini-flash-lite (gemini-3.5-flash-lite)",
  when: new Date().toISOString(),
  results: GOLDEN.map((c) => caseOk(c.id)),
  ...over,
});

const expectCases = GOLDEN.length;
const run = (script, args, env = process.env) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env });

function withResult(payload) {
  const dir = mkdtempSync(join(tmpdir(), "site-eval-gate-"));
  const path = join(dir, "latest.json");
  if (payload !== undefined) writeFileSync(path, JSON.stringify(payload, null, 1));
  return { dir, path };
}

console.log("\neval gate — a suite that did not run must never render as a pass\n");

test("the baseline: a complete real-model run passes", () => {
  const { ok, problems } = checkRun(good(), { expectCases });
  assert.equal(ok, true, problems.join("; "));
});

test("THE EMPTY RUN fails — `0 === 0` is not 'all passed'", () => {
  const { ok, problems } = checkRun(good({ results: [] }), { expectCases });
  assert.equal(ok, false);
  assert.ok(problems.some((m) => /NOTHING RAN/.test(m)), problems.join("; "));
});

test("the summariser REFUSES an empty run and writes no history line", () => {
  // The regression guard for the real defect. Before the fix this exited 0 and
  // appended {"passed":0,"total":0,"ledgerViolations":0} to history.jsonl.
  const { dir, path } = withResult(good({ results: [] }));
  const history = join(dir, "history.jsonl");
  const r = run(SUMMARY, [path, history]);
  assert.notEqual(r.status, 0, "summarising an empty run must not exit 0");
  assert.match(String(r.stderr), /NOTHING RAN/);
  const written = (() => { try { return readFileSync(history, "utf8"); } catch { return ""; } })();
  assert.equal(written, "", "no history line may be written for a run that did not happen");
  rmSync(dir, { recursive: true, force: true });
});

test("NO RESULT FILE AT ALL fails — the state this repo is in today", () => {
  const dir = mkdtempSync(join(tmpdir(), "site-eval-none-"));
  const r = run(GATE, ["--result", join(dir, "latest.json")]);
  assert.equal(r.status, 1);
  assert.match(String(r.stderr), /never scored a model/i);
  rmSync(dir, { recursive: true, force: true });
});

test("THE CREDENTIAL-ABSENT RUN fails, and is named as a credential problem", () => {
  // eval.mjs catches the keyFor() throw per case, so a run with no key writes
  // 54 error records and still produces a result file. That file must not pass.
  const dead = good({
    results: GOLDEN.map((c) => ({
      id: c.id,
      error: "GEMINI_API_KEY is not set.\n  The real key lives in Firebase secrets",
      fails: ["ERROR"],
      ledger: { ok: true, violations: [] },
    })),
  });
  const { ok, problems } = checkRun(dead, { expectCases });
  assert.equal(ok, false);
  assert.ok(problems.some((m) => /MISSING CREDENTIAL/.test(m)), problems.join("; "));
});

test("a COST-CAPPED run fails — coverage is incomplete and non-deterministic", () => {
  const capped = good({
    results: [
      ...GOLDEN.slice(0, 20).map((c) => caseOk(c.id)),
      ...GOLDEN.slice(20).map((c) => ({ id: c.id, skipped: true, fails: ["SKIPPED: cost cap $0.50 reached"], ledger: { ok: true } })),
    ],
  });
  const { ok, problems } = checkRun(capped, { expectCases });
  assert.equal(ok, false);
  assert.ok(problems.some((m) => /skipped by the cost cap/.test(m)), problems.join("; "));
});

test("a SHORT run fails: fewer cases than the golden set is not a baseline", () => {
  const short = good({ results: GOLDEN.slice(0, 2).map((c) => caseOk(c.id)) });
  const { ok, problems } = checkRun(short, { expectCases });
  assert.equal(ok, false);
  assert.ok(problems.some((m) => /partial run is not a baseline/.test(m)), problems.join("; "));
});

test("a record with NO `fails` key is not counted as a pass", () => {
  const shapeless = good({ results: [...GOLDEN.slice(1).map((c) => caseOk(c.id)), { id: GOLDEN[0].id }] });
  const { ok, problems } = checkRun(shapeless, { expectCases });
  assert.equal(ok, false);
  assert.ok(problems.some((m) => /unknown is not a pass/.test(m)), problems.join("; "));
});

test("an ALIAS-only model id fails — a model swap must not be invisible", () => {
  // `eval-baseline.json` records "gemini-flash-lite" and never the resolved
  // "gemini-3.5-flash-lite", so two runs across a GEMINI_MODEL_ID change look
  // identical.
  const { ok, problems } = checkRun(good({ model: "gemini-flash-lite" }), { expectCases });
  assert.equal(ok, false);
  assert.ok(problems.some((m) => /ALIAS with no resolved id/.test(m)), problems.join("; "));
  // ...and the same run WITH the resolved id recorded passes.
  assert.equal(checkRun(good({ model: "gemini-flash-lite", modelId: "gemini-3.5-flash-lite" }), { expectCases }).ok, true);
});

test("a LEDGER VIOLATION fails — the one thing this suite exists to catch", () => {
  const bad = good();
  bad.results[0] = { ...bad.results[0], ledger: { ok: false, violations: [{ id: "g-108", status: "gap", sentence: "Galleria drafts invoices for you" }] } };
  assert.equal(checkRun(bad, { expectCases }).ok, false);
});

test("a stale baseline fails under --max-age-days, a fresh one passes", () => {
  const stale = good({ when: new Date(Date.now() - 40 * 86_400_000).toISOString() });
  assert.equal(checkRun(stale, { expectCases, maxAgeDays: 14 }).ok, false);
  assert.equal(checkRun(stale, { expectCases, maxAgeDays: 90 }).ok, true);
});

test("the gate exits 0 on a real full pass, so it is not merely always-red", () => {
  const { dir, path } = withResult(good());
  const r = run(GATE, ["--result", path, "--expect-cases", String(expectCases)]);
  assert.equal(r.status, 0, `expected PASS; stderr: ${r.stderr}`);
  assert.match(String(r.stderr), /PASS/);
  rmSync(dir, { recursive: true, force: true });
});

test("the COMMITTED baseline still satisfies the gate (bar the alias-id rule)", () => {
  // Sanity: the rules are not so strict that the known-good 2026-08-16
  // baseline could never have passed them. It fails on exactly one rule — the
  // alias-only model id — which is the documented gap, not a false alarm.
  const baseline = JSON.parse(readFileSync(join(HERE, "eval-baseline.json"), "utf8"));
  const { problems } = checkRun(baseline, { expectCases });
  assert.deepEqual(
    problems.filter((m) => !/ALIAS with no resolved id/.test(m)),
    [],
    "the committed baseline should fail on the alias rule and nothing else",
  );
});

console.log(failures === 0 ? "\n\x1b[32mall gate tests passed\x1b[0m\n" : `\n\x1b[31m${failures} failed\x1b[0m\n`);
process.exit(failures === 0 ? 0 : 1);
