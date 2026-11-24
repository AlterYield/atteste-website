/* ==========================================================================
   Attesté cookie consent — POPIA-first, self-contained, no dependencies.

   Nothing non-essential loads before an explicit opt-in:
   - Analytics  = Google Analytics 4 (gtag.js)
   - Marketing  = Meta Pixel (fbevents.js), and Google's use of an analytics
                  visit for advertising (Consent Mode v2, see googleConsent)

   Declining is one click, same prominence as accepting. No choice = no
   cookies. There is deliberately NO <noscript> pixel fallback anywhere on
   the site — an image beacon would fire without consent.

   Include on a page with:
     <script defer src="/assets/js/consent.js?v=CONTENTHASH"></script>
   Optional attributes on the script tag:
     data-manage-only        don't auto-show the banner (policy pages);
                             only the preferences centre is available
     data-fb-events="Lead"   comma-separated extra Meta events fired after
                             PageView (e.g. on /thanks)
     data-fb-content="slug"  static page label sent as content_name with
                             ViewContent. Never a person's or artwork's data.
   Any element with [data-cookie-prefs] reopens the preferences centre. A page
   whose footer has none gets a "Cookie preferences" link added here, so the
   promise in the banner and the privacy notice holds on every page, generated
   ones included. A page with no <footer> fails scripts/inject_consent.py --check.

   Meta click events (only ever sent after marketing opt-in):
     data-fb-click="Contact" on any element tracks that event when clicked.
     App Store / Google Play links need no attribute: they are recognised by
     host, the same rule as attribution.js, so no store link can be forgotten.

   Google Analytics events (only ever sent after analytics opt-in, and the two
   choices are independent, so one never opens the other):
     data-fb-events="Lead" also sends generate_lead (GA_PAGE_EVENTS).
     A store link click also sends app_download_click with { store }.

   Google Consent Mode v2: every Google Analytics hit carries the visitor's two
   choices. Analytics grants analytics_storage only. Marketing grants ad_storage,
   ad_user_data and ad_personalization. All four are set to denied before
   Google's script is requested. gtag.js still loads only on an analytics yes,
   so with marketing alone Google receives nothing at all. No Google Ads tag
   belongs on this site: the only Google id here is the Analytics one.

   This file is the ONLY place allowed to touch fbq or gtag. Which pages may load it
   is policy, not habit: see scripts/inject_consent.py (CI-enforced).
   ========================================================================== */
(function () {
  'use strict';

  // "Atteste Pixel" dataset in Meta Events Manager, owned by the
  // Yield SPM Business portfolio, 1769024997391775 (verified 2026-11-04).
  // If ever emptied, the pixel simply never loads — even for visitors
  // who opt in; their consent is stored and honoured once an ID lands.
  var META_PIXEL_ID = '2040419150235877';

  var GA_ID = 'G-6VBQZX830K';
  // Bump when the banner promises something new. A stored yes to marketing under
  // the old wording no longer counts, so that visitor is asked again; a no stands,
  // because a refusal of less is a refusal of more. See retireOldConsent.
  // v3 (2026-11-12): Marketing now also covers Google advertising.
  var STORAGE_KEY = 'atteste_consent_v3';
  var OLD_STORAGE_KEYS = ['atteste_consent_v2', 'atteste_consent_v1']; // newest first

  // Everything else goes through trackCustom: fbq('track') rejects a name
  // that is not on Meta's standard list.
  var FB_STANDARD_EVENTS = [
    'AddPaymentInfo', 'AddToCart', 'AddToWishlist', 'CompleteRegistration',
    'Contact', 'CustomizeProduct', 'Donate', 'FindLocation', 'InitiateCheckout',
    'Lead', 'PageView', 'Purchase', 'Schedule', 'Search', 'StartTrial',
    'SubmitApplication', 'Subscribe', 'ViewContent'
  ];
  var STORE_HOSTS = { 'apps.apple.com': 'app_store', 'play.google.com': 'google_play' };

  // Page events Google Analytics also receives, by the name GA4 recommends.
  // A page event with no entry here stays Meta-only.
  var GA_PAGE_EVENTS = { Lead: 'generate_lead' };

  var script = document.currentScript;
  var manageOnly = script && script.hasAttribute('data-manage-only');
  var fbExtraEvents = (script && script.getAttribute('data-fb-events') || '')
    .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  var fbContent = script && script.getAttribute('data-fb-content') || '';

  var loaded = { analytics: false, marketing: false };
  var banner = null;

  function readConsent() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (typeof parsed.analytics !== 'boolean' || typeof parsed.marketing !== 'boolean') return null;
      return parsed;
    } catch (e) { return null; }
  }

  function writeConsent(analytics, marketing) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        analytics: analytics,
        marketing: marketing,
        ts: new Date().toISOString()
      }));
    } catch (e) { /* storage blocked — treat as no consent */ }
  }

  function retireOldConsent() {
    OLD_STORAGE_KEYS.forEach(function (key) {
      try {
        var raw = localStorage.getItem(key);
        if (!raw) return;
        localStorage.removeItem(key);
        var old = JSON.parse(raw);
        if (old.marketing === false && typeof old.analytics === 'boolean' && !readConsent()) {
          writeConsent(old.analytics, false);
        }
      } catch (e) { /* unreadable old record: ask again */ }
    });
  }

  // The four Consent Mode v2 signals for a choice. The three advertising signals
  // follow the Marketing tick and nothing else, so an analytics yes alone never
  // lets Google use a visit for advertising.
  function googleConsent(consent) {
    var ads = consent.marketing ? 'granted' : 'denied';
    return {
      ad_storage: ads,
      ad_user_data: ads,
      ad_personalization: ads,
      analytics_storage: consent.analytics ? 'granted' : 'denied'
    };
  }

  function loadAnalytics(consent) {
    if (loaded.analytics) return;
    loaded.analytics = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    // Denied first, then the visitor's choice. Both are queued before Google's
    // script is requested, so it never runs without them.
    window.gtag('consent', 'default', googleConsent({ analytics: false, marketing: false }));
    window.gtag('consent', 'update', googleConsent(consent));
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
    fbExtraEvents.forEach(function (ev) {
      if (GA_PAGE_EVENTS[ev]) window.gtag('event', GA_PAGE_EVENTS[ev]);
    });
  }

  function loadPixel() {
    if (loaded.marketing) return;
    if (!META_PIXEL_ID) return; // consent recorded; pixel activates when the ID is configured
    loaded.marketing = true;
    /* Meta Pixel base code (script part only — no noscript beacon, see header) */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0';
      n.queue = []; t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    // Automatic configuration stays on by Charl's ruling (2026-11-05), so Meta also
    // receives button clicks and page details, disclosed in privacy 10.4 and cookies
    // 2.4. A page carrying the pixel must show only public content: see EXCLUDE in
    // scripts/inject_consent.py. Automatic website matching must stay off in Events
    // Manager: Meta's script reads form values when it is on, and the notices say
    // typed text is not sent.
    window.fbq('init', META_PIXEL_ID);
    fbTrack('PageView');
    fbExtraEvents.forEach(function (ev) {
      fbTrack(ev, ev === 'ViewContent' && fbContent ? { content_name: fbContent } : undefined);
    });
  }

  function fbTrack(name, params) {
    var method = FB_STANDARD_EVENTS.indexOf(name) === -1 ? 'trackCustom' : 'track';
    if (params) window.fbq(method, name, params);
    else window.fbq(method, name);
  }

  // Parameters are fixed values chosen here. Link text, hrefs and page data
  // never reach Meta or Google through this path.
  function trackClick(target) {
    if (!target || !target.closest) return;
    var link = target.closest('a[href]');
    var store = link && STORE_HOSTS[link.hostname];
    if (store && loaded.analytics) window.gtag('event', 'app_download_click', { store: store });
    if (!loaded.marketing) return;
    var tagged = target.closest('[data-fb-click]');
    if (tagged) fbTrack(tagged.getAttribute('data-fb-click'), store ? { store: store } : undefined);
    else if (store) fbTrack('AppDownloadClick', { store: store });
  }

  // Taking a yes away reloads the page (see decide), so the only change that can
  // reach a running Google tag is marketing being added after analytics.
  function applyConsent(consent) {
    if (consent.analytics) {
      if (loaded.analytics) window.gtag('consent', 'update', googleConsent(consent));
      else loadAnalytics(consent);
    }
    if (consent.marketing) loadPixel();
  }

  /* ---------------- banner / preferences centre ---------------- */

  function injectStyles() {
    if (document.getElementById('atteste-consent-css')) return;
    var css = [
      '#atteste-consent{position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:16px;',
      'font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}',
      '#atteste-consent .ac-card{max-width:680px;margin:0 auto;background:#1a1a2e;color:#f0ece3;',
      'border:1px solid rgba(201,169,110,.45);border-radius:14px;padding:22px 24px;',
      'box-shadow:0 12px 40px rgba(0,0,0,.45);}',
      '#atteste-consent h2{margin:0 0 8px;font-size:17px;color:#c9a96e;font-weight:600;}',
      '#atteste-consent p{margin:0 0 14px;font-size:14px;line-height:1.55;color:#d8d3c6;}',
      '#atteste-consent a{color:#c9a96e;}',
      '#atteste-consent .ac-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;}',
      '#atteste-consent button{font:inherit;font-size:14px;font-weight:600;border-radius:8px;',
      'padding:10px 18px;cursor:pointer;border:1px solid transparent;}',
      '#atteste-consent .ac-accept{background:#c9a96e;color:#1a1a2e;}',
      '#atteste-consent .ac-essential{background:#f0ece3;color:#1a1a2e;}',
      '#atteste-consent .ac-deny{background:#f0ece3;color:#1a1a2e;}',
      '#atteste-consent .ac-save{background:#c9a96e;color:#1a1a2e;display:none;}',
      '#atteste-consent button:hover{filter:brightness(1.08);}',
      '#atteste-consent .ac-panel{display:none;margin:4px 0 14px;border-top:1px solid rgba(201,169,110,.25);padding-top:14px;}',
      '#atteste-consent.ac-mode-prefs .ac-panel{display:block;}',
      '#atteste-consent.ac-mode-prefs .ac-save{display:inline-block;}',
      '#atteste-consent.ac-mode-prefs .ac-essential{display:none;}',
      '#atteste-consent label{display:flex;gap:10px;align-items:flex-start;font-size:14px;',
      'line-height:1.5;color:#d8d3c6;margin:0 0 10px;cursor:pointer;}',
      '#atteste-consent input[type=checkbox]{margin-top:3px;accent-color:#c9a96e;width:16px;height:16px;}',
      '#atteste-consent .ac-note{font-size:12px;color:#a09a8a;margin:10px 0 0;}',
      '@media (max-width:480px){#atteste-consent .ac-actions{flex-direction:column;align-items:stretch;}',
      '#atteste-consent button{width:100%;}}'
    ].join('');
    var style = document.createElement('style');
    style.id = 'atteste-consent-css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function removeBanner() {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  // Static markup only — nothing user- or network-supplied is interpolated.
  // Copy stays category-based (no cookie counts) so adding a category later
  // doesn't invalidate the wording.
  var BANNER_MARKUP =
    '<div class="ac-card">' +
    '<h2>Your call on cookies</h2>' +
    '<p>We&rsquo;d love to use optional cookies to see how the site is doing (analytics) and to help ' +
    'our ads reach the right people (marketing). None are set unless you say yes &mdash; and ' +
    '&ldquo;no&rdquo; is one tap too. If you accept marketing, Meta receives the pages you view, ' +
    'details from those pages and the actions you take here, and Google may use your visits for advertising. ' +
    'Details in our <a href="/cookies.html">Cookie Policy</a>.</p>' +
    '<div class="ac-panel">' +
    '<label><input type="checkbox" class="ac-cb-analytics"><span><strong>Analytics</strong> &mdash; e.g. Google Analytics. ' +
    'Helps us see which pages resonate. Off by default.</span></label>' +
    '<label><input type="checkbox" class="ac-cb-marketing"><span><strong>Marketing</strong> &mdash; the Meta Pixel and Google advertising. ' +
    'Measures our Facebook, Instagram and Google ads and enables retargeting. Meta receives the pages you view, ' +
    'details from those pages and the actions you take here. Google may use what Google Analytics records ' +
    'here for advertising, if Analytics is on too. Off by default.</span></label>' +
    '</div>' +
    '<div class="ac-actions">' +
    '<button type="button" class="ac-save">Save choices</button>' +
    '<button type="button" class="ac-accept">Accept all</button>' +
    '<button type="button" class="ac-essential">Accept essential</button>' +
    '<button type="button" class="ac-deny">Deny</button>' +
    '</div>' +
    '<p class="ac-note">Essential cookies (sign-in, security) always work and need no consent. ' +
    '<a href="#" class="ac-open-prefs">Manage individual choices</a>, or change your mind any time via ' +
    '&ldquo;Cookie preferences&rdquo; in the footer or on the Cookie Policy page.</p>' +
    '</div>';

  // mode: 'banner' (first ask — Accept all / Accept essential / Deny) or
  //       'prefs'  (preferences centre — per-category toggles + Save)
  function showBanner(mode, prefill) {
    injectStyles();
    removeBanner();
    banner = document.createElement('div');
    banner.id = 'atteste-consent';
    banner.className = mode === 'prefs' ? 'ac-mode-prefs' : '';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.appendChild(document.createRange().createContextualFragment(BANNER_MARKUP));
    document.body.appendChild(banner);

    var cbA = banner.querySelector('.ac-cb-analytics');
    var cbM = banner.querySelector('.ac-cb-marketing');

    if (prefill) {
      cbA.checked = !!prefill.analytics;
      cbM.checked = !!prefill.marketing;
    }

    function decide(analytics, marketing) {
      var prev = readConsent();
      writeConsent(analytics, marketing);
      removeBanner();
      var revoked = (prev && ((prev.analytics && !analytics) || (prev.marketing && !marketing))) ||
        (!analytics && loaded.analytics) || (!marketing && loaded.marketing);
      if (revoked) {
        // Trackers can't be unloaded in place — reload so nothing keeps running.
        location.reload();
        return;
      }
      applyConsent({ analytics: analytics, marketing: marketing });
    }

    banner.querySelector('.ac-accept').addEventListener('click', function () { decide(true, true); });
    // "Accept essential" and "Deny" mean the same thing here: essential
    // cookies never needed consent, so both store a no to everything optional.
    banner.querySelector('.ac-essential').addEventListener('click', function () { decide(false, false); });
    banner.querySelector('.ac-deny').addEventListener('click', function () { decide(false, false); });
    banner.querySelector('.ac-save').addEventListener('click', function () { decide(cbA.checked, cbM.checked); });
    banner.querySelector('.ac-open-prefs').addEventListener('click', function (e) {
      e.preventDefault();
      banner.className = 'ac-mode-prefs';
    });
  }

  window.attesteConsent = {
    open: function () { showBanner('prefs', readConsent() || undefined); },
    status: readConsent
  };

  // Next to the Cookie Policy link where there is one, else after the last
  // link. A block or flex-item link stacks; an inline one needs a separator.
  function addFooterControl() {
    var footers = document.querySelectorAll('footer');
    var footer = footers[footers.length - 1];
    if (!footer || footer.querySelector('[data-cookie-prefs]')) return;
    var link = document.createElement('a');
    link.href = '#';
    link.setAttribute('data-cookie-prefs', '');
    link.textContent = 'Cookie preferences';
    var links = footer.querySelectorAll('a[href]');
    var anchor = footer.querySelector('a[href*="cookies"]') || links[links.length - 1];
    if (!anchor) { footer.appendChild(link); return; }
    anchor.parentNode.insertBefore(link, anchor.nextSibling);
    if (window.getComputedStyle(anchor).display === 'inline') {
      anchor.parentNode.insertBefore(document.createTextNode(' \u00b7 '), link);
    }
  }

  function init() {
    retireOldConsent();
    addFooterControl();
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest && e.target.closest('[data-cookie-prefs]');
      if (el) { e.preventDefault(); window.attesteConsent.open(); }
      trackClick(e.target);
    });
    var consent = readConsent();
    if (consent) {
      applyConsent(consent);
    } else if (!manageOnly) {
      showBanner();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
