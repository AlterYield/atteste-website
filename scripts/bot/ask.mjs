#!/usr/bin/env node
/**
 * Ask the site bot one question, from the terminal. No UI — that is Phase 1.
 *
 *   node scripts/bot/ask.mjs "do you have a free plan?"
 *   node scripts/bot/ask.mjs --persona gallery "how many artworks can I list?"
 *   node scripts/bot/ask.mjs --model claude-haiku "what is a source certificate?"
 *   node scripts/bot/ask.mjs --dry-run "..."      # show the prompt, call nothing
 *   node scripts/bot/ask.mjs --list-models        # pin a real model id
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadKnowledge, selectChunks } from "./lib/knowledge.mjs";
import { buildTurn } from "./lib/prompt.mjs";
import { checkAnswer, FALLBACK } from "./lib/ledger.mjs";
import { generate, listModels, DEFAULT_MODEL, MODELS } from "./lib/model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, "knowledge.json");

function parseArgs(argv) {
  const opts = { model: DEFAULT_MODEL, persona: null, strategy: "all", dryRun: false, listModels: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--model") opts.model = argv[++i];
    else if (a === "--persona") opts.persona = argv[++i];
    else if (a === "--strategy") opts.strategy = argv[++i];
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--list-models") opts.listModels = true;
    else rest.push(a);
  }
  opts.question = rest.join(" ").trim();
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

if (opts.listModels) {
  for (const id of await listModels("gemini")) console.log(id);
  process.exit(0);
}

if (!opts.question) {
  console.error('usage: node scripts/bot/ask.mjs [--persona collector|artist|gallery] [--model <name>] "question"');
  console.error(`models: ${Object.keys(MODELS).join(", ")}`);
  process.exit(2);
}

const pack = await loadKnowledge(PACK).catch(() => {
  console.error("knowledge.json missing — run: python3 scripts/bot/build_knowledge.py");
  process.exit(2);
});

const turn = buildTurn(pack, opts.question, {
  persona: opts.persona,
  strategy: opts.strategy,
  selector: selectChunks,
});

if (opts.dryRun) {
  console.log(turn.system);
  console.log("\n===== SOURCE MATERIAL =====\n");
  console.log(turn.context);
  console.log(`\n===== ${turn.meta.chunks_used}/${turn.meta.chunks_total} chunks · ~${Math.round(
    (turn.system.length + turn.context.length) / 4
  )} tokens =====`);
  process.exit(0);
}

const res = await generate(turn, { model: opts.model });
const verdict = checkAnswer(res.text, pack.never_claim);

console.log(verdict.ok ? res.text : FALLBACK);

if (!verdict.ok) {
  console.log("\n\x1b[31m✗ LEDGER VIOLATION — answer withheld\x1b[0m");
  for (const v of verdict.violations) {
    console.log(`  [${v.status}] ${v.id} (${Math.round(v.matched * 100)}% match)`);
    console.log(`    "${v.sentence}"`);
  }
  console.log("\n  raw answer was:\n  " + res.text.replace(/\n/g, "\n  "));
}

console.error(
  `\n\x1b[2m${res.model} · ${turn.meta.chunks_used}/${turn.meta.chunks_total} chunks · ` +
    `${res.usage.in}+${res.usage.out} tok · $${res.costUsd.toFixed(5)} · ${res.ms}ms\x1b[0m`
);
