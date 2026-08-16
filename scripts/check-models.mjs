#!/usr/bin/env node
/**
 * Model-reference drift guard.
 *
 * Two different rules apply to model names in this repo, and the whole point
 * of this script is that they are opposites:
 *
 *   CODE  (scripts/, netlify/functions/) MUST pin an exact model id.
 *         See the comment at the top of scripts/bot/lib/model.mjs: an uncapped
 *         public endpoint on a rotating alias is a billing surprise waiting to
 *         happen. Pinning is deliberate there.
 *
 *   PROSE (the .html and .txt files we actually serve) must NOT pin a version.
 *         A version number in legal or marketing copy is a fact with an expiry
 *         date, and nothing in a static site reminds you when it expires. On
 *         2026-08-16 the AI disclosure still named "Gemini 2.0 Flash", the
 *         privacy policy agreed with it, and llms-full.txt said 2.5 — while the
 *         app was actually running eleven different pinned ids. Three documents,
 *         three answers, none of them right.
 *
 * So: prose names the provider and the family, code names the version, and this
 * script fails the moment prose starts naming versions again.
 *
 * Usage:
 *   node scripts/check-models.mjs          static scan only (no network, no key)
 *   node scripts/check-models.mjs --live   also verify pinned ids still exist
 *
 * --live needs GEMINI_API_KEY. Without it the live half is skipped, not failed,
 * so the static guard still works anywhere with zero setup.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Directories whose model references are legitimately pinned, or not served. */
const SKIP_DIRS = new Set([
  ".git", "node_modules", ".netlify", ".claude",
  "scripts",  // code — pinning is correct and required here
  "netlify",  // ditto (functions)
  "docs",     // internal design records; they SHOULD name the model of the day
]);

const SCAN_EXT = new Set([".html", ".txt", ".xml", ".json", ".md"]);

/**
 * Patterns that indicate a pinned version in prose. Each requires the digits to
 * be attached to the family name — so "Gemini Live", "Gemini Flash-Lite" and
 * "Claude (via Messages API)" all pass, while "Gemini 2.0 Flash" does not.
 */
const PINNED = [
  { re: /\bgemini[\s-]+\d+(?:\.\d+)?/i, hint: 'name the family: "Gemini" or "current-generation Gemini Flash models"' },
  { re: /\bclaude[\s-]+\d+(?:\.\d+)?/i, hint: 'name the family: "Claude"' },
  { re: /\b(?:sonnet|opus|haiku)[\s-]+\d+(?:[.-]\d+)*/i, hint: "drop the version — say Claude" },
  { re: /\b(?:gemini|claude)-[a-z]+(?:-[a-z]+)*-\d{6,}\b/i, hint: "dated model id — not for visitor-facing copy" },
];

/** Escape hatch: put this on the line to keep a deliberate version reference. */
const ALLOW_MARKER = "model-ref-ok";

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") && entry !== ".well-known") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(full, out);
    } else if (SCAN_EXT.has(extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

function staticScan() {
  const findings = [];
  for (const file of walk(ROOT)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (line.includes(ALLOW_MARKER)) return;
      for (const { re, hint } of PINNED) {
        const m = line.match(re);
        if (m) findings.push({ file: relative(ROOT, file), line: i + 1, match: m[0].trim(), hint });
      }
    });
  }
  return findings;
}

async function liveCheck() {
  const { MODELS, listModels } = await import("./bot/lib/model.mjs");
  if (!(process.env.GEMINI_API_KEY ?? "").trim()) {
    console.log("· live check skipped — GEMINI_API_KEY not set");
    return [];
  }
  const available = new Set(await listModels("gemini"));
  const gone = [];
  for (const [name, spec] of Object.entries(MODELS)) {
    if (spec.provider !== "gemini") continue;      // no list endpoint for Claude
    const ok = available.has(spec.id);
    console.log(`  ${ok ? "OK  " : "GONE"} ${name.padEnd(18)} ${spec.id}`);
    if (!ok) gone.push({ name, id: spec.id });
  }
  return gone;
}

const findings = staticScan();
if (findings.length) {
  console.error(`\nFAIL — ${findings.length} pinned model version(s) in visitor-facing copy:\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  "${f.match}"`);
    console.error(`    -> ${f.hint}\n`);
  }
  console.error(`  Deliberate exception? Add "${ALLOW_MARKER}" to the line.\n`);
} else {
  console.log("OK — no pinned model versions in visitor-facing copy");
}

let gone = [];
if (process.argv.includes("--live")) {
  console.log("\nPinned ids still served by the Gemini API:");
  gone = await liveCheck();
  if (gone.length) {
    console.error("\nFAIL — pinned model id(s) no longer available:");
    for (const g of gone) console.error(`  ${g.name} -> ${g.id}`);
    console.error("  Update MODELS in scripts/bot/lib/model.mjs.");
    console.error("  List what the key can call: node scripts/bot/ask.mjs --list-models\n");
  }
}

process.exit(findings.length || gone.length ? 1 : 0);
