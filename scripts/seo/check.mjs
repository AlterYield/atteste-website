#!/usr/bin/env node
// SEO/GEO gate — every change to atteste.art must keep search and AI-search basics intact.
// Standard since 2026-10-11 (Charl): a website upgrade is not done until this passes.
//
// Per page in sitemap.xml: one <h1>, title + meta description in range, canonical = sitemap URL,
// Open Graph + Twitter card, every JSON-LD block parses, and <lastmod> no older than the file's
// last commit. Site-wide: robots.txt allows the AI search crawlers and points at the sitemap,
// llms.txt exists, and every indexable top-level page is in the sitemap.
//
//   node scripts/seo/check.mjs          → exit 1 on any failure
//   node scripts/seo/sync-sitemap.mjs   → refresh <lastmod> from git before committing
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const ORIGIN = 'https://atteste.art';
// Top-level pages deliberately kept out of the sitemap.
const NOT_INDEXED = {
  '404.html': 'error page',
  'thanks.html': 'post-form confirmation',
  'sell.html': 'staged on g-111/a-055 — production build drops it (claim gate)',
  'classic.html': 'previous homepage, kept for rollback at /classic (noindex, canonical /)',
};
const AI_CRAWLERS = ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended'];
export const fails = [];
const fail = (where, msg) => fails.push(`${where}: ${msg}`);

export function urlToFile(loc) {
  let p = loc.replace(ORIGIN, '').replace(/^\//, '');
  if (p === '') return 'index.html';
  if (p.endsWith('/')) return p + 'index.html';
  if (p.endsWith('.html')) return p;
  return existsSync(join(ROOT, p + '.html')) ? p + '.html' : p + '/index.html';
}

function attr(html, re) { const m = html.match(re); return m ? m[1].trim() : null; }
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&mdash;/g, '—').replace(/&middot;/g, '·');

export function checkPage(file, loc, html) {
  const h1 = (html.match(/<h1[\s>]/gi) || []).length;
  if (h1 !== 1) fail(file, `expected exactly one <h1>, found ${h1}`);
  const title = attr(html, /<title>([^<]*)<\/title>/i);
  if (!title) fail(file, 'missing <title>');
  else {
    // Titles built from artwork data (certificates, Atelier Notes) may run longer than hand-written ones.
    const max = /^(cert|notes)\//.test(file) ? 90 : 70;
    const n = decode(title).length;
    if (n < 15 || n > max) fail(file, `title length ${n} (want 15–${max}): "${title}"`);
  }
  const desc = attr(html, /<meta\s+name="description"\s+content="([^"]*)"/i);
  if (!desc) fail(file, 'missing meta description');
  else if (decode(desc).length < 50 || decode(desc).length > 170) fail(file, `meta description length ${decode(desc).length} (want 50–170)`);
  const canon = attr(html, /<link\s+rel="canonical"\s+href="([^"]*)"/i);
  if (!canon) fail(file, 'missing canonical');
  else if (canon !== loc) fail(file, `canonical ${canon} ≠ sitemap ${loc}`);
  for (const p of ['og:title', 'og:description', 'og:image', 'og:url']) {
    if (!new RegExp(`property="${p}"`, 'i').test(html)) fail(file, `missing ${p}`);
  }
  if (!/name="twitter:card"/i.test(html)) fail(file, 'missing twitter:card');
  const blocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  if (blocks.length === 0) fail(file, 'no JSON-LD');
  blocks.forEach((b, i) => { try { JSON.parse(b[1]); } catch (e) { fail(file, `JSON-LD block ${i + 1} does not parse: ${e.message}`); } });
  if (/noindex/i.test(attr(html, /<meta\s+name="robots"\s+content="([^"]*)"/i) || '')) fail(file, 'in sitemap but marked noindex');
}

function lastCommitDate(file) {
  try { return execFileSync('git', ['log', '-1', '--format=%cs', '--', file], { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch { return ''; }
}

function main() {
  const sitemap = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
  const entries = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
    loc: attr(m[1], /<loc>([^<]*)<\/loc>/), lastmod: attr(m[1], /<lastmod>([^<]*)<\/lastmod>/),
  }));
  const inSitemap = new Set();
  for (const { loc, lastmod } of entries) {
    const file = urlToFile(loc);
    inSitemap.add(file);
    if (!existsSync(join(ROOT, file))) { fail(file, `sitemap URL ${loc} has no file`); continue; }
    checkPage(file, loc, readFileSync(join(ROOT, file), 'utf8'));
    const touched = lastCommitDate(file);
    if (!lastmod) fail(file, 'sitemap entry has no <lastmod>');
    else if (touched && lastmod < touched) fail(file, `sitemap lastmod ${lastmod} older than last commit ${touched} — run scripts/seo/sync-sitemap.mjs`);
  }
  for (const f of execFileSync('git', ['ls-files', '*.html'], { cwd: ROOT, encoding: 'utf8' }).split('\n')) {
    if (!f || f.includes('/') || NOT_INDEXED[f] || inSitemap.has(f)) continue;
    fail(f, 'top-level page missing from sitemap.xml (or add it to NOT_INDEXED with a reason)');
  }
  const robots = readFileSync(join(ROOT, 'robots.txt'), 'utf8');
  if (!/^Sitemap:\s*https:\/\/atteste\.art\/sitemap\.xml/m.test(robots)) fail('robots.txt', 'no Sitemap line');
  for (const bot of AI_CRAWLERS) {
    const m = robots.match(new RegExp(`User-agent:\\s*${bot}\\s*\\n([^\\n]*)`, 'i'));
    if (!m || !/Allow:\s*\//i.test(m[1])) fail('robots.txt', `${bot} not explicitly allowed`);
  }
  if (!existsSync(join(ROOT, 'llms.txt'))) fail('llms.txt', 'missing');
  if (fails.length) { console.error(`SEO/GEO gate: ${fails.length} failure(s)\n` + fails.map((f) => '  ✗ ' + f).join('\n')); process.exit(1); }
  console.log(`SEO/GEO gate: ${entries.length} sitemap pages + robots.txt + llms.txt — all pass`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
