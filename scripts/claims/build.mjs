#!/usr/bin/env node
/**
 * Claim gate — the Netlify build step (netlify.toml [build].command).
 *
 *   node scripts/claims/build.mjs                       # in place; mode from $CONTEXT
 *   node scripts/claims/build.mjs --mode production --out /tmp/site
 *
 * Netlify sets CONTEXT to production | deploy-preview | branch-deploy | dev.
 * Only `production` strips: every other context renders staged blocks with a
 * STAGED label so Charl can review copy before its ledger entry flips.
 * Unknown or missing CONTEXT falls back to production — the safe direction.
 *
 * Production also deletes pages gated by <meta name="atteste:claim">, drops
 * their <url> from sitemap.xml, and removes the ledger snapshot from the
 * publish directory (it is a build input, not content).
 */

import { readFileSync, writeFileSync, rmSync, cpSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT, STAGED_CSS, loadSnapshot, provenHosts, judge, pageClaim, renderHtml, renderText, siteFiles } from "./lib.mjs";

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };

const ctx = opt("--mode") ?? process.env.CONTEXT ?? "production";
const mode = ["deploy-preview", "branch-deploy", "dev", "preview"].includes(ctx) ? "preview" : "production";
const out = opt("--out");

const snapshot = loadSnapshot();
const hosts = provenHosts();

let site = ROOT;
if (out) {
  rmSync(out, { recursive: true, force: true });
  cpSync(ROOT, out, { recursive: true, filter: (src) => !/\/(\.git|node_modules)(\/|$)/.test(src) });
  site = out;
}

const report = { mode, context: ctx, removed: [], staged: [], deletedPages: [] };

for (const f of siteFiles(site)) {
  const path = join(site, f);
  const src = readFileSync(path, "utf8");
  if (f.endsWith(".html")) {
    const pc = pageClaim(src);
    if (pc && mode === "production" && !judge("claim", pc, snapshot, hosts).ok) {
      rmSync(path);
      report.deletedPages.push(f);
      continue;
    }
    const r = renderHtml(src, mode, snapshot, hosts);
    if (pc && mode === "preview" && !judge("claim", pc, snapshot, hosts).ok) {
      r.html = r.html.replace(/<body([^>]*)>/i, `<body$1>\n<div data-claim-staged="STAGED PAGE · ${pc} · not on atteste.art" style="padding:10px 16px;background:#f3e3bf;color:#1a1a2e;font:600 13px/1.4 ui-monospace,Menlo,monospace;text-align:center"></div>`);
      if (!r.html.includes(STAGED_CSS)) r.html = r.html.replace(/<\/head>/i, `${STAGED_CSS}\n</head>`);
      report.staged.push({ file: f, value: pc, kind: "page" });
    }
    if (r.html !== src) writeFileSync(path, r.html);
    report.removed.push(...r.removed.map((e) => ({ file: f, value: e.value, kind: e.kind, status: e.status })));
    report.staged.push(...r.staged.map((e) => ({ file: f, value: e.value, kind: e.kind, status: e.status })));
  } else {
    const r = renderText(src, mode, snapshot, hosts);
    if (r.text !== src) writeFileSync(path, r.text);
    report.removed.push(...r.removed.map((e) => ({ file: f, value: e.value, kind: e.kind, status: e.status })));
  }
}

if (mode === "production" && report.deletedPages.length) {
  const sm = join(site, "sitemap.xml");
  if (existsSync(sm)) {
    let xml = readFileSync(sm, "utf8");
    for (const p of report.deletedPages) {
      const slug = p.replace(/\.html$/, "");
      xml = xml.replace(new RegExp(`\\s*<url>\\s*<loc>https://atteste\\.art/${slug}(\\.html)?</loc>[\\s\\S]*?</url>`, "g"), "");
    }
    writeFileSync(sm, xml);
  }
}
if (mode === "production") rmSync(join(site, "claims"), { recursive: true, force: true });

console.log(`claim gate build: ${mode} (CONTEXT=${ctx})${out ? ` → ${relative(process.cwd(), out) || out}` : " in place"}`);
console.log(`  ${mode === "production" ? "removed" : "staged "} ${mode === "production" ? report.removed.length : report.staged.length} block(s)` +
  (report.deletedPages.length ? `, deleted page(s): ${report.deletedPages.join(", ")}` : ""));
for (const r of mode === "production" ? report.removed : report.staged) console.log(`   - ${r.file}: ${r.kind} ${r.value} (${r.status ?? "staged"})`);
