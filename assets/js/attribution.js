/**
 * Attribution pass-through — keep the TRUE acquisition source alive across
 * the atteste.art → app/store hop.
 *
 * The problem this solves: every CTA on this site is hard-coded
 * `utm_source=website`. So a visitor who arrives from an explainer video
 * (`atteste.art/?utm_source=youtube&utm_campaign=provenance`) and then taps
 * "Open the app" hands the app `utm_source=website` — and the app dutifully
 * stamps `website` on `users/{uid}.attribution`. Every channel that routes
 * through the site collapses into one indistinguishable bucket, which makes
 * the six explainer films impossible to tell apart, or to tell apart from
 * Instagram.
 *
 * So: remember the first touch, and rewrite the outbound links to carry it.
 *
 * Three link families, three different mechanisms — they are NOT
 * interchangeable:
 *   web app      → utm_source / utm_medium / utm_campaign, read in-app by the
 *                  first-touch snippet in the Flutter app's web/index.html
 *   Google Play  → the whole utm string packed URL-encoded into `referrer=`,
 *                  which survives store install and is read via the Play
 *                  Install Referrer API on first open
 *   App Store    → `ct` (paired with the existing `pt` provider token).
 *                  Apple reports this in App Store Connect ONLY; it never
 *                  reaches the app, which is why iOS signups stamp
 *                  'ios-organic' and lean on the in-app self-report instead.
 *
 * First touch wins, matching the app's own semantics: a visitor who arrives
 * from a video and comes back a week later via a Google search is still a
 * signup the video earned.
 *
 * Channel metadata only — never anything identifying. Referrer query strings
 * are dropped; only the host is kept.
 */
(function () {
  'use strict';

  var KEY = 'atteste_src_v1';
  var MAX = 100;

  /** Lowercase, strip anything outside a safe slug charset, cap length. */
  function clean(value) {
    if (!value) return null;
    var s = String(value).toLowerCase().replace(/[^a-z0-9._~-]/g, '-');
    s = s.replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
    if (!s) return null;
    return s.length > MAX ? s.slice(0, MAX) : s;
  }

  function read() {
    try {
      var raw = window.localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function save(touch) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(touch));
    } catch (e) {
      /* private mode — pass-through still works for this pageview */
    }
  }

  /**
   * The first touch: an explicit utm_source, else an external referrer host
   * (medium 'referral'), else nothing at all. Returning null is deliberate —
   * an untagged direct visit must leave the authored `utm_source=website`
   * links exactly as they are.
   */
  function resolveTouch() {
    var stored = read();
    if (stored && stored.source) return stored;

    var params = new URLSearchParams(window.location.search);
    var touch = null;

    var utmSource = clean(params.get('utm_source'));
    if (utmSource) {
      touch = {
        source: utmSource,
        medium: clean(params.get('utm_medium')),
        campaign: clean(params.get('utm_campaign')),
      };
    } else {
      var ref = document.referrer;
      if (ref) {
        try {
          var host = new URL(ref).hostname.replace(/^www\./, '');
          // Ignore self-referrals — in-site navigation is not a channel.
          if (host && host !== window.location.hostname.replace(/^www\./, '')) {
            touch = { source: clean(host), medium: 'referral', campaign: null };
          }
        } catch (e) {
          /* unparseable referrer — treat as direct */
        }
      }
    }

    if (touch && touch.source) {
      save(touch);
      return touch;
    }
    return null;
  }

  /** Apple's `ct` is one flat token, so fold campaign into it. */
  function appleToken(touch) {
    return clean(touch.campaign ? touch.source + '-' + touch.campaign : touch.source);
  }

  /**
   * Rewrite one href, or return null if it isn't an outbound app/store link.
   *
   * The inbound channel deliberately OVERWRITES the authored
   * `utm_source=website&utm_medium=<placement>`: knowing the signup came from
   * a specific video matters more than knowing which button on this page they
   * pressed, and the app only reads source/medium/campaign.
   */
  function rewrite(href, touch) {
    var url;
    try {
      url = new URL(href, window.location.href);
    } catch (e) {
      return null;
    }
    var host = url.hostname.replace(/^www\./, '');

    if (host === 'play.google.com') {
      var parts = ['utm_source=' + touch.source];
      if (touch.medium) parts.push('utm_medium=' + touch.medium);
      if (touch.campaign) parts.push('utm_campaign=' + touch.campaign);
      url.searchParams.set('referrer', parts.join('&'));
      return url.toString();
    }

    if (host === 'apps.apple.com') {
      // Leave `pt` alone — `ct` without its provider token does not report.
      url.searchParams.set('ct', appleToken(touch));
      return url.toString();
    }

    if (host === 'atteste-b6409.web.app' || host === 'atteste-galleria.web.app') {
      url.searchParams.set('utm_source', touch.source);
      if (touch.medium) url.searchParams.set('utm_medium', touch.medium);
      else url.searchParams.delete('utm_medium');
      if (touch.campaign) url.searchParams.set('utm_campaign', touch.campaign);
      else url.searchParams.delete('utm_campaign');
      return url.toString();
    }

    return null;
  }

  function apply(touch, root) {
    var links = (root || document).querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var next = rewrite(links[i].getAttribute('href'), touch);
      if (next) links[i].setAttribute('href', next);
    }
  }

  function init() {
    var touch = resolveTouch();
    if (!touch) return;
    apply(touch, document);

    // Catch links injected after load (the chat widget, and anything else
    // that renders late) by re-checking at click time. Capture phase, so the
    // href is corrected before the browser follows it.
    document.addEventListener(
      'click',
      function (event) {
        var a = event.target && event.target.closest
          ? event.target.closest('a[href]')
          : null;
        if (!a) return;
        var next = rewrite(a.getAttribute('href'), touch);
        if (next) a.setAttribute('href', next);
      },
      true,
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
