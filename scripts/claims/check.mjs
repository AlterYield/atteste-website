#!/usr/bin/env node
/**
 * Claim gate — the CI check. No network, no dependencies.
 *
 *   node scripts/claims/check.mjs            # fail on any violation
 *   node scripts/claims/check.mjs --map      # also print the claim map (markdown)
 *
 * Fails when:
 *   1. a data-claim id is not in the ledger snapshot (typo = silent staging forever)
 *   2. the PRODUCTION render of any page still contains a gated block whose
 *      entry is not live|shipping, or a host with no proof
 *   3. any page (production render) carries a retired entry's wording, or an
 *      orphaned sibling of one (legal pages exempt from the siblings only)
 *   4. a retired entry in the snapshot has no phrase list to scan for
 *   5. any page, staged blocks INCLUDED, breaks a claim ceiling
 *   6. a production-visible link points at a page that production deletes
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT, loadSnapshot, provenHosts, judge, gatedElements, pageClaim, textFences,
  renderHtml, renderText, visibleText, siteFiles,
} from "./lib.mjs";
import { RETIRED_PHRASES, ORPHANED_PHRASES, CEILINGS, LEGAL_PAGES, IDENTITY } from "./rules.mjs";
import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const snapshot = loadSnapshot();
const hosts = provenHosts();
const files = siteFiles();
const fail = [];
const warn = [];
const map = [];

// 4. every retired entry has a phrase list
for (const [id, e] of Object.entries(snapshot.entries)) {
  if (e.status === "retired" && !RETIRED_PHRASES[id]) {
    fail.push(`ledger: ${id} is retired but RETIRED_PHRASES (scripts/bot/lib/ledger.mjs) has no phrases for it`);
  }
}

const synced = Date.parse(snapshot.synced_at ?? "");
if (Number.isFinite(synced) && Date.now() - synced > 14 * 864e5) {
  warn.push(`snapshot synced ${snapshot.synced_at} — over 14 days old; run scripts/claims/sync_ledger.py`);
}

// Pages production deletes.
const deadPages = new Set();
for (const f of files.filter((f) => f.endsWith(".html"))) {
  const pc = pageClaim(readFileSync(join(ROOT, f), "utf8"));
  if (pc && !judge("claim", pc, snapshot, hosts).ok) deadPages.add(f);
}

const sentences = (t) => t.split(/(?<=[.!?])\s+|\n+/);

for (const f of files) {
  const src = readFileSync(join(ROOT, f), "utf8");
  const isHtml = f.endsWith(".html");
  const legal = LEGAL_PAGES.has(f);

  // 1 + map
  const gates = isHtml ? gatedElements(src) : textFences(src);
  if (!isHtml) {
    const opens = (src.match(/<!--\s*claim:/g) ?? []).length;
    const closes = (src.match(/<!--\s*\/claim\s*-->/g) ?? []).length;
    if (opens !== gates.length || closes !== gates.length) fail.push(`${f}: ${opens} claim fence(s) opened, ${closes} closed, ${gates.length} matched — a malformed fence would ship its text`);
  }
  const pc = isHtml ? pageClaim(src) : null;
  if (pc) gates.unshift({ kind: "claim", value: pc, tag: "page" });
  for (const g of gates) {
    const v = judge(g.kind, g.value, snapshot, hosts);
    if (v.status === "unknown") fail.push(`${f}: data-claim "${g.value}" — ${v.reason}`);
    for (const h of g.value.split(/\s+/).filter((x) => x.startsWith("hold:"))) {
      if (!snapshot.holds[h.slice(5)]) warn.push(`${f}: ${h} is not in claims/holds.json (lifted?) — remove it from the markup`);
    }
    const line = g.start != null ? src.slice(0, g.start).split("\n").length : 1;
    map.push({ file: f, line, kind: g.tag === "page" ? "page" : g.kind, value: g.value, status: v.status, shown: v.ok });
  }

  // 2: production render
  const prod = isHtml ? renderHtml(src, "production", snapshot, hosts).html : renderText(src, "production", snapshot, hosts).text;
  if (isHtml) {
    for (const g of gatedElements(prod)) {
      const v = judge(g.kind, g.value, snapshot, hosts);
      if (!v.ok) fail.push(`${f}: production render still shows ${g.kind} "${g.value}" (${v.status})`);
    }
  } else if (textFences(prod).length) {
    fail.push(`${f}: production render still contains claim fences`);
  }
  if (deadPages.has(f)) continue; // production does not publish it; ceilings below still apply via preview

  // 3: retired + orphaned wording, production-visible text
  const text = isHtml ? visibleText(prod) : prod;
  for (const [id, res] of Object.entries(RETIRED_PHRASES)) {
    for (const re of res) {
      const m = text.match(re);
      if (m) fail.push(`${f}: retired ${id} wording "${m[0]}"`);
    }
  }
  if (!legal) {
    for (const [id, res] of Object.entries(ORPHANED_PHRASES)) {
      for (const re of res) {
        const m = text.match(re);
        if (m) fail.push(`${f}: ${id} "${m[0]}" — no live ledger entry backs it`);
      }
    }
  }

  // 6: links to pages production deletes
  if (isHtml) {
    for (const m of prod.matchAll(/href=["']\/?([^"'#?]+?)(?:\.html)?(?:[#?][^"']*)?["']/g)) {
      const target = m[1].replace(/^https:\/\/atteste\.art\//, "");
      if (deadPages.has(`${target}.html`) || deadPages.has(target)) {
        fail.push(`${f}: production links to ${target} — that page is gated off; wrap the link in a block with the same data-claim`);
      }
    }
  }
}

// 5: ceilings, on the PREVIEW render (staged copy must obey them too)
for (const f of files) {
  if (LEGAL_PAGES.has(f) || f.startsWith("cert/")) continue;
  const src = readFileSync(join(ROOT, f), "utf8");
  const text = f.endsWith(".html") ? visibleText(src) : src;
  for (const c of CEILINGS) {
    if (c.except?.includes(f)) continue;
    if (c.raw) {
      const m = src.match(c.re);
      if (m) fail.push(`${f}: ceiling [${c.id}] "${m[0].slice(0, 80)}"`);
    } else if (c.sentence) {
      for (const s of sentences(text)) {
        if (c.a.test(s) && c.b.test(s)) { fail.push(`${f}: ceiling [${c.id}] "${s.trim().slice(0, 140)}"`); break; }
      }
    } else {
      for (const m of text.matchAll(new RegExp(c.re.source, c.re.flags.replace("g", "") + "g"))) {
        // "does not verify artist identity" states the ceiling; it doesn't break it.
        if (c.negatable && /\b(not|n['’]t|never|no)\b[^.\n]{0,25}$/i.test(text.slice(Math.max(0, m.index - 40), m.index))) continue;
        fail.push(`${f}: ceiling [${c.id}] "${m[0]}"`);
        break;
      }
    }
  }
}

// 7: company identity — every tracked text file (scripts/ is published too)
{
  const tracked = spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).stdout.split("\n")
    .filter((f) => /\.(html|txt|xml|json|js|mjs|md|py|yml|toml)$/.test(f) && !f.startsWith("scripts/bot/eval-results/"));
  for (const f of tracked) {
    const src = readFileSync(join(ROOT, f), "utf8");
    if (f === "scripts/claims/rules.mjs" || f === "scripts/claims/test-claims.mjs") continue; // they name the banned strings
    for (const re of IDENTITY.banned) {
      const m = src.match(re);
      if (m) fail.push(`${f}: identity — "${m[0]}" (the founder is Charl le Roux)`);
    }
    if (!/\.(html|txt|xml)$/.test(f) || IDENTITY.bloemfonteinExemptPrefixes.some((p) => f.startsWith(p))) continue;
    let masked = src;
    for (const re of IDENTITY.bloemfonteinAllowed) masked = masked.replace(new RegExp(re.source, re.flags + "g"), "");
    const b = masked.match(IDENTITY.bloemfontein);
    if (b) {
      const at = masked.indexOf(b[0]);
      fail.push(`${f}: identity — unlabelled "Bloemfontein" ("${masked.slice(Math.max(0, at - 60), at + 20).replace(/\s+/g, " ")}"); the place of business is Stellenbosch, Western Cape. Bloemfontein only as a labelled registered office.`);
    }
  }
}

if (args.has("--map")) {
  console.log("| Page | Line | Gate | Ledger id / host | Status | On atteste.art |");
  console.log("|---|---|---|---|---|---|");
  for (const r of map) {
    console.log(`| ${r.file} | ${r.line} | ${r.kind} | \`${r.value}\` | ${r.status} | ${r.shown ? "yes" : "**staged**"} |`);
  }
  console.log();
}

for (const w of warn) console.log(`warn  ${w}`);
const shown = map.filter((r) => r.shown).length;
console.log(`claim gate: ${files.length} files · ${map.length} gated blocks (${shown} shown, ${map.length - shown} staged) · ${hosts.size} proven hosts [${[...hosts].join(", ")}] · snapshot @ ${String(snapshot.source_sha).slice(0, 8)}`);
if (fail.length) {
  for (const f of fail) console.error(`FAIL  ${f}`);
  console.error(`\n${fail.length} claim-gate violation(s).`);
  process.exit(1);
}
console.log("✓ no violations");
