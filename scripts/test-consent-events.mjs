#!/usr/bin/env node
// Proves assets/js/consent.js sends each event only to the service the visitor
// said yes to. Runs the real file against a stub page: needs no browser, network
// or dependency. A guard that has never been seen to fail is not a guard, so the
// same checks then run against broken copies and must catch every one.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../assets/js/consent.js', import.meta.url), 'utf8');
const KEY = 'atteste_consent_v2';

function link(hostname) {
  const el = { hostname, closest: (sel) => (sel === 'a[href]' ? el : null) };
  return el;
}

// Runs consent.js once with a stored choice (null = never answered).
function page(source, { consent = null, fbEvents = '' } = {}) {
  const store = new Map(consent ? [[KEY, JSON.stringify(consent)]] : []);
  const handlers = [];
  const anEl = () => ({
    setAttribute() {}, appendChild() {}, querySelector: () => ({ addEventListener() {} }),
    parentNode: { insertBefore() {} },
  });
  const document = {
    readyState: 'complete',
    currentScript: {
      hasAttribute: () => false,
      getAttribute: (n) => (n === 'data-fb-events' ? fbEvents : null),
    },
    head: { appendChild() {} },
    body: { appendChild() {} },
    createElement: anEl,
    createRange: () => ({ createContextualFragment: () => ({}) }),
    getElementById: () => ({}),
    getElementsByTagName: () => [anEl()],
    querySelectorAll: () => [],
    addEventListener: (type, fn) => { if (type === 'click') handlers.push(fn); },
  };
  const window = { document };
  const sandbox = {
    window, document, location: {}, Date, JSON,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
  };
  vm.runInNewContext(source, sandbox);
  return {
    click: (el) => handlers.forEach((fn) => fn({ target: el, preventDefault() {} })),
    ga: () => Array.from(window.dataLayer || [])
      .map((a) => Array.from(a))
      .filter((a) => a[0] === 'event')
      .map(([, name, params]) => (params ? `${name}:${JSON.stringify(params)}` : name)),
    gaLoaded: () => !!window.dataLayer,
    meta: () => Array.from(window.fbq ? window.fbq.queue : [])
      .map((a) => Array.from(a))
      .filter((a) => a[0] !== 'init')
      .map(([, name]) => name),
  };
}

const ANALYTICS = { analytics: true, marketing: false };
const MARKETING = { analytics: false, marketing: true };
const BOTH = { analytics: true, marketing: true };
const NEITHER = { analytics: false, marketing: false };
const LEAD = { fbEvents: 'Lead' };

const CHECKS = {
  // Arrays built inside the page are from another realm, so results are copied out.
  'no answer: Google never loads, nothing sent'(src) {
    const p = page(src, LEAD);
    p.click(link('apps.apple.com'));
    assert.equal(p.gaLoaded(), false);
    assert.deepEqual(p.meta(), []);
  },
  'said no to both: nothing sent'(src) {
    const p = page(src, { ...LEAD, consent: NEITHER });
    p.click(link('apps.apple.com'));
    assert.equal(p.gaLoaded(), false);
    assert.deepEqual(p.meta(), []);
  },
  'analytics only: lead reaches Google, not Meta'(src) {
    const p = page(src, { ...LEAD, consent: ANALYTICS });
    assert.deepEqual(p.ga(), ['generate_lead']);
    assert.deepEqual(p.meta(), []);
  },
  'analytics only: store click reaches Google, not Meta'(src) {
    const p = page(src, { consent: ANALYTICS });
    p.click(link('apps.apple.com'));
    assert.deepEqual(p.ga(), ['app_download_click:{"store":"app_store"}']);
    assert.deepEqual(p.meta(), []);
  },
  'marketing only: lead and click reach Meta, not Google'(src) {
    const p = page(src, { ...LEAD, consent: MARKETING });
    p.click(link('play.google.com'));
    assert.equal(p.gaLoaded(), false);
    assert.deepEqual(p.meta(), ['PageView', 'Lead', 'AppDownloadClick']);
  },
  'both: each service gets its own name for each moment'(src) {
    const p = page(src, { ...LEAD, consent: BOTH });
    p.click(link('play.google.com'));
    assert.deepEqual(p.ga(), ['generate_lead', 'app_download_click:{"store":"google_play"}']);
    assert.deepEqual(p.meta(), ['PageView', 'Lead', 'AppDownloadClick']);
  },
  'a page event with no Google name stays Meta-only'(src) {
    const p = page(src, { fbEvents: 'ViewContent', consent: BOTH });
    assert.deepEqual(p.ga(), []);
  },
  'a link to anywhere else sends nothing'(src) {
    const p = page(src, { consent: BOTH });
    p.click(link('example.com'));
    assert.deepEqual(p.ga(), []);
  },
};

function failures(src) {
  return Object.entries(CHECKS).filter(([, check]) => {
    try { check(src); return false; } catch { return true; }
  }).map(([name]) => name);
}

const clean = failures(SRC);
Object.entries(CHECKS).forEach(([name]) => console.log(`${clean.includes(name) ? 'FAIL' : 'PASS'}  ${name}`));
assert.deepEqual(clean, [], 'consent.js broke a consent rule');

const BROKEN = {
  'Google click sent without analytics consent': ['if (store && loaded.analytics) window.gtag(', 'if (store) window.gtag('],
  'Google click queued before consent': ['if (store && loaded.analytics) window.gtag(', "if (store) (window.dataLayer = window.dataLayer || []).push(['event', 'x']);\n    if (store && loaded.analytics) window.gtag("],
  'Google lead dropped': ["var GA_PAGE_EVENTS = { Lead: 'generate_lead' };", 'var GA_PAGE_EVENTS = {};'],
  'Meta click sent without marketing consent': ["if (!loaded.marketing) return;\n    var tagged", 'var tagged'],
  'analytics load ignores the stored choice': ['if (consent.analytics) loadAnalytics();', 'loadAnalytics();'],
  'link text sent to Google': ['{ store: store });\n    if (!loaded.marketing)', "{ store: store, text: 'x' });\n    if (!loaded.marketing)"],
};
for (const [name, [from, to]] of Object.entries(BROKEN)) {
  assert.ok(SRC.includes(from), `stale mutation: ${name}`);
  assert.notDeepEqual(failures(SRC.replace(from, to)), [], `not caught: ${name}`);
  console.log(`PASS  caught: ${name}`);
}
console.log(`${Object.keys(CHECKS).length} checks, ${Object.keys(BROKEN).length} broken copies caught`);
