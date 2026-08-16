#!/usr/bin/env node
/**
 * Run the golden set and report whether the bot is fit to ship.
 *
 *   node scripts/bot/eval.mjs                     # full run
 *   node scripts/bot/eval.mjs --dry-run           # validate set + prompts, no API calls
 *   node scripts/bot/eval.mjs --model claude-haiku
 *   node scripts/bot/eval.mjs --only l,r          # id prefixes
 *   node scripts/bot/eval.mjs --json report.json
 *
 * Gate: ledger violations must be ZERO. Everything else is a judgement call;
 * that one is not, because it is the failure that costs money and trust.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFile } from "node:fs/promises";

import { loadKnowledge, selectChunks } from "./lib/knowledge.mjs";
import { buildTurn } from "./lib/prompt.mjs";
import { checkAnswer } from "./lib/ledger.mjs";
import { generate, DEFAULT_MODEL } from "./lib/model.mjs";
import { GOLDEN } from "./golden.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (flag, fallback = null) => {
  const i = argv.indexOf(flag);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (flag) => argv.includes(flag);

const MODEL = arg("--model", DEFAULT_MODEL);
const DRY = has("--dry-run");
const ONLY = (arg("--only") ?? "").split(",").filter(Boolean);
const JSON_OUT = arg("--json");
const CONCURRENCY = Number(arg("--concurrency", "4"));

const pack = await loadKnowledge(join(HERE, "knowledge.json"));
const cases = ONLY.length ? GOLDEN.filter((c) => ONLY.some((p) => c.id.startsWith(p))) : GOLDEN;

const REFUSAL = /(can'?t help|cannot help|not able to|unable to|can'?t advise|don'?t (?:have|provide|offer)|no access|not something I can|rather not|reach the team|get in touch|contact)/i;
const CITES = /sources?:/i;

const lower = (s) => s.toLowerCase();

function grade(c, answer) {
  const a = lower(answer);
  const fails = [];

  for (const s of c.expectAll ?? []) if (!a.includes(lower(s))) fails.push(`missing required "${s}"`);
  if (c.expectAny?.length && !c.expectAny.some((s) => a.includes(lower(s))))
    fails.push(`none of [${c.expectAny.join(", ")}]`);
  for (const s of c.expectNone ?? []) if (a.includes(lower(s))) fails.push(`FORBIDDEN "${s}" present`);
  if (c.mustRefuse && !REFUSAL.test(answer)) fails.push("did not refuse / route to a human");
  if (c.mustCite && !CITES.test(answer)) fails.push("no Sources: line");

  return fails;
}

async function runCase(c) {
  const turn = buildTurn(pack, c.q, { persona: c.persona ?? null, selector: selectChunks });

  if (DRY) {
    const problems = [];
    if (!c.note) problems.push("no note");
    if (!c.expectAll && !c.expectAny && !c.expectNone && !c.mustRefuse && !c.ledgerTrap)
      problems.push("no assertion — case can never fail");
    return { ...c, dry: true, promptTokens: Math.round((turn.system.length + turn.context.length) / 4), problems };
  }

  try {
    const res = await generate(turn, { model: MODEL });
    const ledger = checkAnswer(res.text, pack.never_claim);
    const fails = grade(c, res.text);
    if (!ledger.ok) fails.unshift(`LEDGER: ${ledger.violations.map((v) => v.id).join(", ")}`);
    return { ...c, answer: res.text, fails, ledger, usage: res.usage, costUsd: res.costUsd, ms: res.ms };
  } catch (err) {
    return { ...c, error: err.message, fails: ["ERROR"], ledger: { ok: true, violations: [] } };
  }
}

/** Bounded parallelism — the free-tier RPM ceiling is low and 429s look like failures. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

const started = Date.now();
const results = await pool(cases, DRY ? cases.length : CONCURRENCY, runCase);

// ── Report ──────────────────────────────────────────────────────────────────
const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", D = "\x1b[2m", Z = "\x1b[0m";

if (DRY) {
  const bad = results.filter((r) => r.problems.length);
  const tokens = results[0]?.promptTokens ?? 0;
  console.log(`${cases.length} cases · prompt ~${tokens.toLocaleString()} tokens each · no API calls made\n`);
  for (const r of bad) console.log(`${Y}!${Z} ${r.id}  ${r.problems.join("; ")}`);
  console.log(bad.length ? `\n${R}${bad.length} malformed case(s)${Z}` : `${G}✓ all cases well-formed${Z}`);
  process.exit(bad.length ? 1 : 0);
}

for (const r of results) {
  const ok = r.fails.length === 0;
  // A case flagged knownFlaky is failing because the DATA is contradictory,
  // not because the bot is wrong. It still prints, loudly, but it does not
  // gate the run — otherwise an unresolvable content bug masks real breakage.
  const blocked = !ok && r.knownFlaky;
  console.log(`${ok ? G + "✓" : blocked ? Y + "⚠" : R + "✗"}${Z} ${r.id}  ${D}${r.q.slice(0, 68)}${Z}`);
  if (blocked) console.log(`   ${Y}blocked on data:${Z} ${D}${r.knownFlaky}${Z}`);
  if (!ok && !blocked) {
    for (const f of r.fails) console.log(`   ${R}${f}${Z}`);
    if (r.error) console.log(`   ${D}${r.error.split("\n")[0]}${Z}`);
    else console.log(`   ${D}${(r.answer ?? "").replace(/\n/g, " ").slice(0, 200)}${Z}`);
  }
}

const done = results.filter((r) => !r.error);
const passed = results.filter((r) => r.fails.length === 0).length;
const blockedOnData = results.filter((r) => r.fails.length && r.knownFlaky);
const ledgerViolations = results.filter((r) => r.ledger && !r.ledger.ok);
const traps = results.filter((r) => r.ledgerTrap);
const trapsClean = traps.filter((r) => r.ledger.ok).length;
const refusals = results.filter((r) => r.mustRefuse);
const refusalsOk = refusals.filter((r) => !r.fails.some((f) => f.includes("refuse"))).length;
const cost = done.reduce((n, r) => n + (r.costUsd ?? 0), 0);
const times = done.map((r) => r.ms).sort((a, b) => a - b);

console.log(`
${"─".repeat(58)}
model              ${MODEL}
passed             ${passed}/${cases.length}${blockedOnData.length ? `   (+${blockedOnData.length} blocked on contradictory site copy: ${blockedOnData.map((r) => r.id).join(", ")})` : ""}
${ledgerViolations.length ? R : G}ledger violations  ${ledgerViolations.length}   (must be 0)${Z}
ledger traps clean ${trapsClean}/${traps.length}
refusals correct   ${refusalsOk}/${refusals.length}
errors             ${results.length - done.length}
median latency     ${times.length ? times[Math.floor(times.length / 2)] : 0}ms
cost this run      $${cost.toFixed(4)}   (~$${((cost / (done.length || 1)) * 4).toFixed(3)}/conversation at 4 turns)
wall clock         ${((Date.now() - started) / 1000).toFixed(1)}s
${"─".repeat(58)}`);

if (ledgerViolations.length) {
  console.log(`\n${R}SHIP BLOCKER — the bot stated things we have not built:${Z}`);
  for (const r of ledgerViolations)
    for (const v of r.ledger.violations) console.log(`  ${r.id}  ${v.id} [${v.status}]\n    "${v.sentence}"`);
}

if (JSON_OUT) {
  await writeFile(JSON_OUT, JSON.stringify({ model: MODEL, when: new Date().toISOString(), results }, null, 1));
  console.log(`\nwrote ${JSON_OUT}`);
}

const realFailures = results.filter((r) => r.fails.length && !r.knownFlaky).length;
process.exit(ledgerViolations.length || realFailures ? 1 : 0);
