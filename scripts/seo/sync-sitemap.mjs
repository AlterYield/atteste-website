#!/usr/bin/env node
// Refresh <lastmod> in sitemap.xml from git: each URL gets the date of its file's last commit,
// or today if the file has uncommitted changes. Run before committing any page edit
// (scripts/seo/check.mjs fails when a lastmod is older than its file's last commit).
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { urlToFile } from './check.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const today = new Date().toISOString().slice(0, 10);
const dirty = new Set(git('status', '--porcelain').split('\n').filter(Boolean).map((l) => l.slice(3)));
const path = join(ROOT, 'sitemap.xml');
let changed = 0;
const out = readFileSync(path, 'utf8').replace(/<url>([\s\S]*?)<\/url>/g, (block, inner) => {
  const loc = (inner.match(/<loc>([^<]*)<\/loc>/) || [])[1];
  if (!loc) return block;
  const file = urlToFile(loc);
  const date = dirty.has(file) ? today : git('log', '-1', '--format=%cs', '--', file);
  const cur = (inner.match(/<lastmod>([^<]*)<\/lastmod>/) || [])[1];
  if (!date || (cur && cur >= date)) return block;
  changed++;
  return cur ? block.replace(`<lastmod>${cur}</lastmod>`, `<lastmod>${date}</lastmod>`)
             : block.replace(/(<loc>[^<]*<\/loc>)/, `$1\n    <lastmod>${date}</lastmod>`);
});
writeFileSync(path, out);
console.log(`sitemap.xml: ${changed} lastmod value(s) refreshed`);
