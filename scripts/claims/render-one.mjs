#!/usr/bin/env node
/**
 * Print one site file as production would publish it (claim gate applied).
 * Used by scripts/bot/build_knowledge.py so the chat bot never learns staged copy.
 *
 *   node scripts/claims/render-one.mjs galleries.html
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadSnapshot, provenHosts, judge, pageClaim, renderHtml, renderText } from "./lib.mjs";

const f = process.argv[2];
const src = readFileSync(join(ROOT, f), "utf8");
const snap = loadSnapshot();
const hosts = provenHosts();
if (f.endsWith(".html")) {
  const pc = pageClaim(src);
  if (pc && !judge("claim", pc, snap, hosts).ok) process.exit(3); // production deletes this page
  process.stdout.write(renderHtml(src, "production", snap, hosts).html);
} else {
  process.stdout.write(renderText(src, "production", snap, hosts).text);
}
