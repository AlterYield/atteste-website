/* ==========================================================================
   Attesté cookie consent — POPIA-first, self-contained, no dependencies.

   Nothing non-essential loads before an explicit opt-in:
   - Analytics  = Google Analytics 4 (gtag.js)
   - Marketing  = Meta Pixel (fbevents.js)

   Declining is one click, same prominence as accepting. No choice = no
   cookies. There is deliberately NO <noscript> pixel fallback anywhere on
   the site — an image beacon would fire without consent.

   Include on a page with:
     <script defer src="/assets/js/consent.js?v=20260801"></script>
   Optional attributes on the script tag:
     data-manage-only        don't auto-show the banner (policy pages);
                             only the preferences centre is available
     data-fb-events="Lead"   comma-separated extra Meta standard events
                             fired after PageView (e.g. on /thanks)
   Any element with [data-cookie-prefs] reopens the preferences centre.
   ========================================================================== */
(function () {
  'use strict';

  // Supplied by Karel from Meta Events Manager (Move 4 of the FB strategy).
  // While this is empty the Meta Pixel NEVER loads, even for visitors who
  // opt in — their consent is stored and honoured once the ID lands.
  var META_PIXEL_ID = '';

  var GA_ID = 'G-6VBQZX830K';
  var STORAGE_KEY = 'atteste_consent_v1';

  var script = document.currentScript;
  var manageOnly = script && script.hasAttribute('data-manage-only');
  var fbExtraEvents = (script && script.getAttribute('data-fb-events') || '')
    .split(',').map(function (s) { return s.trim(); }).filter(Boolean);

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

  function loadAnalytics() {
    if (loaded.analytics) return;
    loaded.analytics = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
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
    window.fbq('init', META_PIXEL_ID);
    window.fbq('track', 'PageView');
    fbExtraEvents.forEach(function (ev) { window.fbq('track', ev); });
  }

  function applyConsent(consent) {
    if (consent.analytics) loadAnalytics();
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
      '#atteste-consent .ac-decline{background:#f0ece3;color:#1a1a2e;}',
      '#atteste-consent .ac-manage{background:transparent;color:#d8d3c6;border-color:rgba(216,211,198,.4);}',
      '#atteste-consent button:hover{filter:brightness(1.08);}',
      '#atteste-consent .ac-panel{display:none;margin:4px 0 14px;border-top:1px solid rgba(201,169,110,.25);padding-top:14px;}',
      '#atteste-consent .ac-panel.open{display:block;}',
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
  var BANNER_MARKUP =
    '<div class="ac-card">' +
    '<h2>Your call on cookies</h2>' +
    '<p>We&rsquo;d love to set two optional cookies: Google Analytics (to see how the site is doing) ' +
    'and the Meta Pixel (so our ads reach the right people). Neither is set unless you say yes &mdash; ' +
    'and &ldquo;no&rdquo; is one tap too. Details in our <a href="/cookies.html">Cookie Policy</a>.</p>' +
    '<div class="ac-panel">' +
    '<label><input type="checkbox" class="ac-cb-analytics"><span><strong>Analytics</strong> &mdash; Google Analytics. ' +
    'Helps us see which pages resonate. Off by default.</span></label>' +
    '<label><input type="checkbox" class="ac-cb-marketing"><span><strong>Marketing</strong> &mdash; Meta Pixel. ' +
    'Measures our Facebook/Instagram ads and enables retargeting. Off by default.</span></label>' +
    '</div>' +
    '<div class="ac-actions">' +
    '<button type="button" class="ac-accept">Accept all</button>' +
    '<button type="button" class="ac-decline">Essential only</button>' +
    '<button type="button" class="ac-manage" aria-expanded="false">Manage choices</button>' +
    '</div>' +
    '<p class="ac-note">Change your mind any time via &ldquo;Cookie preferences&rdquo; in the footer or on the Cookie Policy page.</p>' +
    '</div>';

  function showBanner(prefill) {
    injectStyles();
    removeBanner();
    banner = document.createElement('div');
    banner.id = 'atteste-consent';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.appendChild(document.createRange().createContextualFragment(BANNER_MARKUP));
    document.body.appendChild(banner);

    var panel = banner.querySelector('.ac-panel');
    var cbA = banner.querySelector('.ac-cb-analytics');
    var cbM = banner.querySelector('.ac-cb-marketing');
    var manageBtn = banner.querySelector('.ac-manage');

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
    banner.querySelector('.ac-decline').addEventListener('click', function () { decide(false, false); });
    var saveMode = false;
    manageBtn.addEventListener('click', function () {
      if (!saveMode) {
        saveMode = true;
        panel.classList.add('open');
        manageBtn.setAttribute('aria-expanded', 'true');
        manageBtn.textContent = 'Save choices';
      } else {
        decide(cbA.checked, cbM.checked);
      }
    });
  }

  window.attesteConsent = {
    open: function () { showBanner(readConsent() || undefined); },
    status: readConsent
  };

  function init() {
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest && e.target.closest('[data-cookie-prefs]');
      if (el) { e.preventDefault(); window.attesteConsent.open(); }
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
