#!/usr/bin/env node
/**
 * Content-hash the ?v= query on shared assets.
 *
 * Why this exists, precisely:
 *
 *   _headers serves /assets/js/* and /assets/css/* as
 *     Cache-Control: public, max-age=31536000, immutable
 *
 *   A year, and `immutable` tells the browser not to revalidate even on a
 *   normal reload. The only thing separating a visitor from a year-old file
 *   is the ?v= query in the script tag. That makes ?v= load-bearing, and on
 *   2026-08-16 it silently failed to bear the load:
 *
 *     13:15  chat-widget.js shipped site-wide as ?v=20260816 — broken palette
 *     14:33  the palette was fixed in the .js — ?v= left at 20260816
 *
 *   Same URL, immutable, so every browser that visited in those 78 minutes
 *   kept the broken widget. The server was correct and the fix was live; it
 *   just could not reach anyone who had already looked. A hand-maintained
 *   version string fails exactly this way — it depends on remembering.
 *
 * So ?v= is now derived from the file's own bytes. Change the file and the
 * URL changes with it; leave it alone and nothing churns.
 *
 * Usage:
 *   node scripts/asset-versions.mjs           rewrite stale ?v= in place
 *   node scripts/asset-versions.mjs --check   exit 1 if any are stale (CI)
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHECK = process.argv.includes("--check");

const SKIP_DIRS = new Set([".git", "node_modules", ".netlify", ".claude", "scripts", "netlify", "docs"]);

/** Short content hash — 8 hex chars is ample for cache busting. */
function hashOf(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex").slice(0, 8);
}

/** Build { "/assets/js/chat-widget.js": "a1b2c3d4", ... } */
function assetHashes() {
  const map = new Map();
  for (const sub of ["assets/js", "assets/css"]) {
    let entries;
    try { entries = readdirSync(join(ROOT, sub)); } catch { continue; }
    for (const f of entries) {
      if (!/\.(js|css)$/.test(f)) continue;
      map.set(`/${sub}/${f}`, hashOf(join(ROOT, sub, f)));
    }
  }
  return map;
}

function htmlFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) htmlFiles(full, out);
    } else if (entry.endsWith(".html")) out.push(full);
  }
  return out;
}

const hashes = assetHashes();
const stale = [];
let rewritten = 0;

for (const file of htmlFiles(ROOT)) {
  const before = readFileSync(file, "utf8");
  // src="/assets/js/foo.js?v=XXXX"  /  href="/assets/css/bar.css?v=XXXX"
  const after = before.replace(
    /((?:src|href)=")(\/assets\/(?:js|css)\/[A-Za-z0-9._-]+\.(?:js|css))(\?v=[A-Za-z0-9]+)?(")/g,
    (whole, pre, path, query, post) => {
      const want = hashes.get(path);
      if (!want) return whole;                    // asset not on disk — leave alone
      const have = query ? query.slice(3) : null;
      if (have === want) return whole;
      stale.push({ file: relative(ROOT, file), path, have: have ?? "(none)", want });
      return `${pre}${path}?v=${want}${post}`;
    }
  );
  if (after !== before && !CHECK) { writeFileSync(file, after); rewritten++; }
}

if (!stale.length) {
  console.log(`OK — every ?v= matches its file's content hash (${hashes.size} assets)`);
  process.exit(0);
}

// Group for a readable report: one line per asset, not per page.
const byAsset = new Map();
for (const s of stale) {
  const k = `${s.path}  ${s.have} -> ${s.want}`;
  byAsset.set(k, (byAsset.get(k) ?? 0) + 1);
}

if (CHECK) {
  console.error(`\nFAIL — ${stale.length} stale ?v= reference(s):\n`);
  for (const [k, n] of byAsset) console.error(`  ${k}   (${n} page${n > 1 ? "s" : ""})`);
  console.error(`\n  These assets are served immutable for a year. A stale ?v= means`);
  console.error(`  returning visitors keep the OLD file indefinitely.`);
  console.error(`  Fix:  node scripts/asset-versions.mjs\n`);
  process.exit(1);
}

console.log(`Updated ${rewritten} file(s):\n`);
for (const [k, n] of byAsset) console.log(`  ${k}   (${n} page${n > 1 ? "s" : ""})`);
