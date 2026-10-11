#!/usr/bin/env node
// Self-test: the SEO/GEO gate must reject a broken page and accept a complete one.
import assert from 'node:assert/strict';
import { checkPage, fails, urlToFile } from './check.mjs';

const good = `<html><head><title>Attesté — Your art, connected.</title>
<meta name="description" content="Give every artwork a signed certificate anyone can check, and keep its whole story in one app.">
<link rel="canonical" href="https://atteste.art/x">
<meta property="og:title" content="t"><meta property="og:description" content="d">
<meta property="og:image" content="i"><meta property="og:url" content="u"><meta name="twitter:card" content="summary">
<script type="application/ld+json">{"@type":"WebPage"}</script></head><body><h1>One</h1></body></html>`;

fails.length = 0; checkPage('good.html', 'https://atteste.art/x', good);
assert.deepEqual(fails, [], 'complete page must pass');

const cases = {
  'two h1': good.replace('<h1>One</h1>', '<h1>A</h1><h1>B</h1>'),
  'no h1': good.replace('<h1>One</h1>', ''),
  'long description': good.replace(/content="Give[^"]*"/, `content="${'x'.repeat(200)}"`),
  'wrong canonical': good.replace('https://atteste.art/x"', 'https://atteste.art/y"'),
  'no og:image': good.replace('<meta property="og:image" content="i">', ''),
  'no twitter card': good.replace(/<meta name="twitter:card"[^>]*>/, ''),
  'broken JSON-LD': good.replace('{"@type":"WebPage"}', '{"@type":'),
  'noindex in sitemap': good.replace('</head>', '<meta name="robots" content="noindex"></head>'),
};
for (const [name, html] of Object.entries(cases)) {
  fails.length = 0; checkPage('bad.html', 'https://atteste.art/x', html);
  assert.ok(fails.length > 0, `gate must reject: ${name}`);
}
assert.equal(urlToFile('https://atteste.art/'), 'index.html');
assert.equal(urlToFile('https://atteste.art/help/'), 'help/index.html');
console.log(`SEO/GEO gate self-test: 1 pass case + ${Object.keys(cases).length} reject cases OK`);
