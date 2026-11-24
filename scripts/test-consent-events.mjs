#!/usr/bin/env node
// Proves assets/js/consent.js sends each event only to the service the visitor
// said yes to. Runs the real file against a stub page: needs no browser, network
// or dependency. A guard that has never been seen to fail is not a guard, so the
// same checks then run against broken copies and must catch every one.
//
// It also proves the Google Consent Mode v2 signals: for each of the four tick
// combinations, stored or chosen in the banner, what Google is told and whether
// Google's script is requested at all.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../assets/js/consent.js', import.meta.url), 'utf8');
const KEY = 'atteste_consent_v3';
const SIGNALS = ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage'];

function link(hostname) {
  const el = { hostname, closest: (sel) => (sel === 'a[href]' ? el : null) };
  return el;
}

// Runs consent.js once with a stored choice (null = never answered).
// `stored` seeds other storage keys, for records written under older wording.
function page(source, { consent = null, fbEvents = '', stored = {} } = {}) {
  const store = new Map(Object.entries(stored).map(([k, v]) => [k, JSON.stringify(v)]));
  if (consent) store.set(KEY, JSON.stringify(consent));
  const handlers = [];
  const tags = [];
  let banner = null;
  let reloads = 0;
  // An element remembers its children by selector, so the banner's ticks and
  // buttons can be driven the way a visitor drives them.
  const anEl = () => {
    const kids = new Map();
    return {
      setAttribute() {}, appendChild() {},
      querySelector(sel) {
        if (!kids.has(sel)) {
          const listeners = [];
          kids.set(sel, { checked: false, listeners, addEventListener: (t, fn) => listeners.push(fn) });
        }
        return kids.get(sel);
      },
      parentNode: { insertBefore() {}, removeChild() {} },
    };
  };
  const document = {
    readyState: 'complete',
    currentScript: {
      hasAttribute: () => false,
      getAttribute: (n) => (n === 'data-fb-events' ? fbEvents : null),
    },
    // What was already queued for Google when its script was requested.
    head: { appendChild(el) {
      if (el.src) tags.push({ src: el.src, queued: Array.from(window.dataLayer || [], (a) => `${a[0]}:${a[1]}`) });
    } },
    body: { appendChild(el) { banner = el; } },
    createElement: anEl,
    createRange: () => ({ createContextualFragment: () => ({}) }),
    getElementById: () => ({}),
    getElementsByTagName: () => [anEl()],
    querySelectorAll: () => [],
    addEventListener: (type, fn) => { if (type === 'click') handlers.push(fn); },
  };
  const window = { document };
  const sandbox = {
    window, document, location: { reload() { reloads += 1; } }, Date, JSON,
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
    googleTags: () => tags.filter((t) => t.src.includes('googletagmanager.com')),
    // Every consent command queued for Google, in order, e.g.
    // "update ad_storage=denied ad_user_data=denied ad_personalization=denied analytics_storage=granted".
    consent: () => Array.from(window.dataLayer || [])
      .map((a) => Array.from(a))
      .filter((a) => a[0] === 'consent')
      .map(([, kind, state]) => {
        assert.deepEqual(Object.keys(state).sort(), [...SIGNALS].sort(), 'exactly the four v2 signals');
        return `${kind} ${SIGNALS.map((k) => `${k}=${state[k]}`).join(' ')}`;
      }),
    commands: () => Array.from(window.dataLayer || []).map((a) => a[0]),
    // The visitor's side of the banner.
    press: (sel) => banner.querySelector(sel).listeners.forEach((fn) => fn({ preventDefault() {} })),
    save(choice) {
      banner.querySelector('.ac-cb-analytics').checked = choice.analytics;
      banner.querySelector('.ac-cb-marketing').checked = choice.marketing;
      this.press('.ac-save');
    },
    reopen: () => window.attesteConsent.open(),
    reloads: () => reloads,
    stored: () => (store.has(KEY) ? JSON.parse(store.get(KEY)) : null),
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

const g = (ads, analytics) =>
  `ad_storage=${ads} ad_user_data=${ads} ad_personalization=${ads} analytics_storage=${analytics}`;
const DENIED = `default ${g('denied', 'denied')}`;
// The four tick combinations: what Google must be told, or null when Google's
// script must not be requested at all (it loads only on an analytics yes).
const COMBOS = [
  ['neither tick', NEITHER, null, false],
  ['analytics only', ANALYTICS, [DENIED, `update ${g('denied', 'granted')}`], false],
  ['marketing only', MARKETING, null, true],
  ['both ticks', BOTH, [DENIED, `update ${g('granted', 'granted')}`], true],
];

function assertCombo(p, signals, metaLoads) {
  if (signals) {
    assert.deepEqual(p.consent(), signals);
    assert.equal(p.googleTags().length, 1, 'Google script requested once');
    // Default and update were both queued before the script was requested,
    // and both come before the config that sends the first hit.
    assert.deepEqual(p.googleTags()[0].queued, ['consent:default', 'consent:update']);
    assert.deepEqual(p.commands().slice(0, 4), ['consent', 'consent', 'js', 'config']);
  } else {
    assert.equal(p.gaLoaded(), false, 'nothing queued for Google');
    assert.deepEqual(p.googleTags(), [], 'Google script not requested');
  }
  assert.equal(p.meta().includes('PageView'), metaLoads, 'Meta Pixel follows the marketing tick only');
}

const CHECKS = {
  ...Object.fromEntries(COMBOS.flatMap(([name, choice, signals, metaLoads]) => [
    [`consent mode, ${name}, stored from an earlier visit`, (src) => {
      assertCombo(page(src, { consent: choice }), signals, metaLoads);
    }],
    [`consent mode, ${name}, chosen in the banner`, (src) => {
      const p = page(src);
      assert.equal(p.gaLoaded(), false, 'nothing before a button press');
      p.save(choice);
      assert.deepEqual({ analytics: p.stored().analytics, marketing: p.stored().marketing }, choice);
      assertCombo(p, signals, metaLoads);
    }],
  ])),
  'consent mode, Accept all grants all four'(src) {
    const p = page(src);
    p.press('.ac-accept');
    assertCombo(p, COMBOS[3][2], true);
  },
  'consent mode, Deny and Accept essential leave Google unrequested'(src) {
    for (const button of ['.ac-deny', '.ac-essential']) {
      const p = page(src);
      p.press(button);
      assertCombo(p, null, false);
    }
  },
  'consent mode, marketing added later updates the running tag'(src) {
    const p = page(src);
    p.save(ANALYTICS);
    p.reopen();
    p.save(BOTH);
    assert.equal(p.reloads(), 0);
    assert.equal(p.googleTags().length, 1);
    assert.deepEqual(p.consent(), [DENIED, `update ${g('denied', 'granted')}`, `update ${g('granted', 'granted')}`]);
  },
  'consent mode, taking marketing away reloads rather than leaving it granted'(src) {
    const p = page(src);
    p.save(BOTH);
    p.reopen();
    p.save(ANALYTICS);
    assert.equal(p.reloads(), 1);
    assert.deepEqual({ analytics: p.stored().analytics, marketing: p.stored().marketing }, ANALYTICS);
  },
  'a yes to marketing under the old wording is asked again'(src) {
    for (const key of ['atteste_consent_v2', 'atteste_consent_v1']) {
      const p = page(src, { stored: { [key]: BOTH } });
      assert.equal(p.stored(), null);
      assertCombo(p, null, false);
    }
  },
  'a no to marketing under the old wording stands'(src) {
    const p = page(src, { stored: { atteste_consent_v2: ANALYTICS } });
    assert.deepEqual({ analytics: p.stored().analytics, marketing: p.stored().marketing }, ANALYTICS);
    assertCombo(p, COMBOS[1][2], false);
  },
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
  'analytics load ignores the stored choice': ['if (consent.analytics) {\n      if (loaded.analytics)', 'if (true) {\n      if (loaded.analytics)'],
  'advertising granted on an analytics yes alone': ["var ads = consent.marketing ? 'granted' : 'denied';", "var ads = consent.analytics ? 'granted' : 'denied';"],
  'advertising never granted': ["var ads = consent.marketing ? 'granted' : 'denied';", "var ads = 'denied';"],
  'analytics_storage follows the marketing tick': ["analytics_storage: consent.analytics ? 'granted' : 'denied'", "analytics_storage: ads"],
  'one advertising signal left out': ['      ad_personalization: ads,\n', ''],
  'default is the choice, not denied': ["window.gtag('consent', 'default', googleConsent({ analytics: false, marketing: false }));", "window.gtag('consent', 'default', googleConsent(consent));"],
  'no default before the Google tag': ["window.gtag('consent', 'default', googleConsent({ analytics: false, marketing: false }));\n", ''],
  'choice not sent before the Google tag': ["    window.gtag('consent', 'update', googleConsent(consent));\n    var s", '    var s'],
  'Google tag requested before the consent state': ["    window.gtag('consent', 'default', googleConsent({ analytics: false, marketing: false }));\n    window.gtag('consent', 'update', googleConsent(consent));\n    var s = document.createElement('script');\n    s.async = true;\n    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;\n    document.head.appendChild(s);\n", "    var s = document.createElement('script');\n    s.async = true;\n    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;\n    document.head.appendChild(s);\n    window.gtag('consent', 'default', googleConsent({ analytics: false, marketing: false }));\n    window.gtag('consent', 'update', googleConsent(consent));\n"],
  'marketing added later never reaches Google': ["if (loaded.analytics) window.gtag('consent', 'update', googleConsent(consent));\n      else loadAnalytics(consent);", 'loadAnalytics(consent);'],
  'Google tag loads on a marketing yes alone': ['if (consent.marketing) loadPixel();\n  }', 'if (consent.marketing) { loadPixel(); loadAnalytics(consent); }\n  }'],
  'old yes to marketing carried over': ["if (old.marketing === false && typeof old.analytics === 'boolean' && !readConsent()) {", "if (typeof old.analytics === 'boolean' && !readConsent()) {\n          writeConsent(old.analytics, old.marketing);\n          return;"],
  'previous storage key still honoured': ["var STORAGE_KEY = 'atteste_consent_v3';", "var STORAGE_KEY = 'atteste_consent_v2';"],
  'link text sent to Google': ['{ store: store });\n    if (!loaded.marketing)', "{ store: store, text: 'x' });\n    if (!loaded.marketing)"],
};
for (const [name, [from, to]] of Object.entries(BROKEN)) {
  assert.ok(SRC.includes(from), `stale mutation: ${name}`);
  assert.notDeepEqual(failures(SRC.replace(from, to)), [], `not caught: ${name}`);
  console.log(`PASS  caught: ${name}`);
}
console.log(`${Object.keys(CHECKS).length} checks, ${Object.keys(BROKEN).length} broken copies caught`);
