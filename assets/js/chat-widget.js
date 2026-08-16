/* ==========================================================================
   Attesté site bot — first-party chat widget. No dependencies, no build step.

   Deliberately first-party and same-origin. A third-party widget would need
   its script origin and websocket added to the site CSP, and — because
   consent.js blocks all non-essential third-party loading — would have to sit
   behind the cookie banner, so most visitors would never see it. This one
   talks to /api/chat on atteste.art and stores nothing but a sessionStorage
   transcript, so it is functional rather than tracking and needs no consent.

   Include on a page with:
     <script defer src="/assets/js/chat-widget.js?v=20260816"></script>

   Phase 1 scope: help pages only, plain Q&A. The persona router, screenshot
   and video cards, and deep links are Phase 2.
   ========================================================================== */
(function () {
  'use strict';

  var ENDPOINT = '/api/chat';
  var STORE_KEY = 'atteste_chat_v1';
  var CID_KEY = 'atteste_chat_cid';
  var MAX_CHARS = 600;

  // Conversation id: a random per-TAB grouping key so the logs can reconstruct
  // "these six questions were one person's session". Deliberately in
  // sessionStorage, not localStorage or a cookie — it dies when the tab closes,
  // never follows anyone between visits, and so is not tracking and needs no
  // consent. Do not promote it to a durable identifier.
  var cid;
  try {
    cid = sessionStorage.getItem(CID_KEY);
    if (!cid) {
      cid = (crypto && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2))
        .replace(/-/g, '').slice(0, 16);
      sessionStorage.setItem(CID_KEY, cid);
    }
  } catch (e) { cid = null; }

  // Honour the same reduced-motion contract the rest of the site should.
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var history = [];
  var busy = false;
  var open = false;
  var root, panel, log, input, sendBtn, launcher, liveRegion;

  try {
    var saved = sessionStorage.getItem(STORE_KEY);
    if (saved) history = JSON.parse(saved) || [];
  } catch (e) { history = []; }

  function persist() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(history.slice(-16))); } catch (e) {}
  }

  // ── Styles. Scoped under #atteste-chat, using the help pages' own tokens
  //    with fallbacks so the widget looks native wherever it is dropped. ────
  // ── Styles ────────────────────────────────────────────────────────────
  //
  // SELF-CONTAINED PALETTE. An earlier version inherited the host page's
  // --ink/--bg tokens and added a prefers-color-scheme override. That shipped
  // broken: the help pages define those tokens AND flip them on OS dark mode,
  // but the marketing pages (assets/css/site.css) define neither — they use
  // --navy/--cream and have no dark mode at all. So on a marketing page with
  // the OS in dark mode the override fired against a permanently-light page
  // and painted #1a1a2e text on a #1a1a2e pill. The launcher was invisible.
  //
  // A floating overlay must own its colours. It reads nothing from the page
  // and has no colour-scheme media query, so it renders identically on both
  // page families. Brand values are hard-coded from site.css deliberately:
  // copies of three hex codes beat a dependency on tokens that do not exist
  // everywhere the widget is mounted.
  //
  // Contrast (WCAG AA needs 4.5:1 for body text):
  //   navy #1A1A2E on gold #C9A96E ....... ~7.6:1  launcher
  //   navy #1A1A2E on white  ............. ~16:1   bot text
  //   #3D3D3D on white ................... ~10:1   body
  //   #6B6B6B on white ................... ~5.7:1  muted/secondary
  //   white on navy #1A1A2E .............. ~16:1   user bubble
  var CSS = [
    '#atteste-chat{--navy:#1A1A2E;--navy-mid:#232340;--gold:#C9A96E;--cream:#FAF8F5;',
    '--white:#fff;--body:#3D3D3D;--muted:#6B6B6B;--rule:#E4DFD5;',
    'position:fixed;right:1.25rem;bottom:1.25rem;z-index:2147483000;',
    // Base text colour, not just backgrounds. Without this the widget inherits
    // the HOST page's colour: on the dark help pages that is #F0ECE3, which
    // lands on our cream panel at 1.11:1. Nothing is visibly broken today only
    // because every element below happens to set its own colour — so this is
    // here to make the next element added without one readable by default.
    'color:var(--body);',
    'font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.5}',
    '#atteste-chat *{box-sizing:border-box;font-family:inherit}',

    // Gold pill with navy text: the one combination that reads on both the
    // cream marketing pages and the navy hero sections.
    // Solid navy border, not just a shadow. The gold fill is only ~2.1:1
    // against the cream marketing background — below the 3:1 WCAG wants for a
    // UI component's boundary — and shadows do not count toward that. The
    // border defines the pill on light pages; on the dark help pages the gold
    // fill already carries ~7.6:1 on its own. One static rule, both cases, no
    // colour-scheme detection to get wrong again.
    '#ac-launch{display:flex;align-items:center;gap:.5rem;background:var(--gold);color:var(--navy);',
    'border:2px solid var(--navy);border-radius:999px;padding:.64rem 1.15rem;font-size:15px;font-weight:600;cursor:pointer;',
    'box-shadow:0 4px 18px rgba(26,26,46,.28)}',
    '#ac-launch:hover{background:#D8BC85}',
    '#ac-launch:focus-visible,#atteste-chat button:focus-visible,#ac-input:focus-visible{outline:3px solid var(--gold);outline-offset:2px}',

    '#ac-panel{display:none;flex-direction:column;width:min(23rem,calc(100vw - 2.5rem));',
    'height:min(31rem,calc(100vh - 6rem));background:var(--cream);border:1px solid var(--rule);',
    'border-radius:14px;overflow:hidden;box-shadow:0 18px 52px rgba(26,26,46,.28)}',
    '#atteste-chat[data-open="true"] #ac-panel{display:flex}',
    '#atteste-chat[data-open="true"] #ac-launch{display:none}',

    '#ac-head{display:flex;align-items:center;justify-content:space-between;gap:.5rem;',
    'padding:.8rem .9rem;background:var(--navy);color:var(--white)}',
    '#ac-head strong{display:block;font-weight:600;font-size:.95rem;color:var(--white)}',
    '#ac-head span{display:block;font-size:.75rem;color:rgba(255,255,255,.72);font-weight:400}',
    '#ac-close{background:none;border:0;font-size:1.5rem;line-height:1;color:rgba(255,255,255,.72);',
    'cursor:pointer;padding:.1rem .35rem;border-radius:6px}',
    '#ac-close:hover{color:var(--white)}',

    '#ac-log{flex:1;overflow-y:auto;padding:.9rem;display:flex;flex-direction:column;gap:.7rem;background:var(--cream)}',
    '.ac-msg{max-width:88%;padding:.62rem .78rem;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14.5px}',
    '.ac-user{align-self:flex-end;background:var(--navy);color:var(--white);border-bottom-right-radius:4px}',
    '.ac-bot{align-self:flex-start;background:var(--white);color:var(--navy);border:1px solid var(--rule);border-bottom-left-radius:4px}',
    '.ac-src{display:block;margin-top:.5rem;padding-top:.45rem;border-top:1px solid var(--rule);font-size:.76rem;color:var(--muted)}',
    '.ac-src a{color:var(--muted);text-decoration:underline;text-underline-offset:2px}',
    '.ac-src a:hover{color:var(--navy)}',
    '.ac-note{align-self:center;text-align:center;font-size:.78rem;color:var(--muted);max-width:92%}',
    '.ac-dots span{display:inline-block;width:5px;height:5px;margin-right:3px;border-radius:50%;background:var(--muted);opacity:.4}',
    reduceMotion ? '' : '.ac-dots span{animation:ac-b 1.1s infinite}.ac-dots span:nth-child(2){animation-delay:.15s}.ac-dots span:nth-child(3){animation-delay:.3s}@keyframes ac-b{0%,60%,100%{opacity:.25}30%{opacity:.9}}',

    '#ac-form{display:flex;gap:.5rem;padding:.7rem;border-top:1px solid var(--rule);background:var(--white)}',
    '#ac-input{flex:1;border:1px solid var(--rule);border-radius:9px;padding:.58rem .7rem;font-size:15px;',
    'color:var(--navy);background:var(--white);resize:none;max-height:5.5rem}',
    '#ac-input::placeholder{color:var(--muted)}',
    '#ac-send{background:var(--navy);color:var(--white);border:0;border-radius:9px;padding:0 1rem;',
    'font-size:15px;font-weight:600;cursor:pointer}',
    '#ac-send:hover{background:var(--navy-mid)}',
    '#ac-send[disabled]{opacity:.45;cursor:default}',
    '@media (max-width:480px){#atteste-chat{right:.75rem;bottom:.75rem;left:.75rem}#ac-panel{width:auto}}'
  ].join('');

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }

  function addMessage(role, text, sources) {
    var node = el('div', { class: 'ac-msg ' + (role === 'user' ? 'ac-user' : 'ac-bot') }, text);
    if (sources && sources.length) {
      var wrap = el('span', { class: 'ac-src' });
      wrap.appendChild(document.createTextNode(sources.length > 1 ? 'Sources: ' : 'Source: '));
      sources.forEach(function (url, i) {
        if (i) wrap.appendChild(document.createTextNode(' · '));
        var a = el('a', { href: url }, url.replace('https://atteste.art', '') || '/');
        wrap.appendChild(a);
      });
      node.appendChild(wrap);
    }
    log.appendChild(node);
    log.scrollTop = log.scrollHeight;
    return node;
  }

  function addNote(text) {
    log.appendChild(el('div', { class: 'ac-note' }, text));
    log.scrollTop = log.scrollHeight;
  }

  function thinking() {
    var n = el('div', { class: 'ac-msg ac-bot ac-dots' });
    n.appendChild(el('span')); n.appendChild(el('span')); n.appendChild(el('span'));
    log.appendChild(n);
    log.scrollTop = log.scrollHeight;
    return n;
  }

  async function send(text) {
    if (busy || !text) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = '';
    addMessage('user', text);
    history.push({ role: 'user', text: text });
    var pending = thinking();

    try {
      var res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: history.slice(0, -1).slice(-8),
          cid: cid,
          page: location.pathname
        })
      });

      pending.remove();

      if (res.status === 503) {           // kill switch flipped mid-session
        addNote('The assistant is offline right now. The team is at atteste.art/help/contact.');
        root.setAttribute('data-open', 'false');
        return;
      }

      var data = await res.json().catch(function () { return null; });
      var answer = (data && data.answer) || "I couldn't reach the assistant. The team is at https://atteste.art/help/contact";
      addMessage('bot', answer, data && data.sources);
      history.push({ role: 'model', text: answer });
      persist();
      if (liveRegion) liveRegion.textContent = answer;
    } catch (e) {
      pending.remove();
      addNote('Connection problem. Try again, or reach the team at atteste.art/help/contact.');
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  function build() {
    var style = el('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    root = el('div', { id: 'atteste-chat', 'data-open': 'false' });

    launcher = el('button', { id: 'ac-launch', type: 'button', 'aria-expanded': 'false' }, 'Ask about Attesté');

    panel = el('div', { id: 'ac-panel', role: 'dialog', 'aria-label': 'Ask about Attesté' });

    var head = el('div', { id: 'ac-head' });
    var title = el('div');
    title.appendChild(el('strong', null, 'Ask about Attesté'));
    title.appendChild(el('span', null, 'Answers from our help pages'));
    var close = el('button', { id: 'ac-close', type: 'button', 'aria-label': 'Close' }, '×');
    head.appendChild(title); head.appendChild(close);

    log = el('div', { id: 'ac-log' });
    liveRegion = el('div', { 'aria-live': 'polite', 'aria-atomic': 'false',
      style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)' });

    var form = el('form', { id: 'ac-form' });
    input = el('textarea', { id: 'ac-input', rows: '1', placeholder: 'How do certificates work?',
      maxlength: String(MAX_CHARS), 'aria-label': 'Your question' });
    sendBtn = el('button', { id: 'ac-send', type: 'submit' }, 'Send');
    form.appendChild(input); form.appendChild(sendBtn);

    panel.appendChild(head); panel.appendChild(log); panel.appendChild(liveRegion); panel.appendChild(form);
    root.appendChild(launcher); root.appendChild(panel);
    document.body.appendChild(root);

    if (history.length) {
      history.forEach(function (h) { addMessage(h.role === 'user' ? 'user' : 'bot', h.text); });
    } else {
      addMessage('bot', "Hi — ask me anything about Attesté: what it does, what it costs, how to get started.\n\nI can't see your account, and I don't give valuations or authenticity opinions.");
    }

    launcher.addEventListener('click', function () { toggle(true); });
    close.addEventListener('click', function () { toggle(false); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      send(input.value.trim());
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value.trim()); }
    });

    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 88) + 'px';
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) toggle(false);
    });

    gateOnConsentBanner();
  }

  // Stand clear of the cookie banner.
  //
  // consent.js pins #atteste-consent to the bottom of the viewport at the same
  // z-index we use. The help pages don't load it, so this only surfaced when
  // the widget went site-wide: the launcher landed on top of the banner, and
  // sitting over a "Deny" button is a consent problem, not a cosmetic one.
  //
  // The launcher stays hidden while a consent banner is on screen and appears
  // once the visitor has answered. Pages that load consent.js in manage-only
  // mode never show a banner, so they get the launcher immediately.
  function gateOnConsentBanner() {
    var CONSENT_ID = 'atteste-consent';
    var tries = 0;

    function bannerVisible() {
      var b = document.getElementById(CONSENT_ID);
      if (!b) return false;
      // NOT offsetParent: it is null for every position:fixed element, and the
      // consent banner is fixed — so an offsetParent check silently reports
      // "no banner" always, and the gate would never fire. Measure instead.
      var cs = getComputedStyle(b);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      return b.getBoundingClientRect().height > 0;
    }

    function settle() {
      if (!bannerVisible()) {
        root.style.visibility = '';
        return true;
      }
      root.style.visibility = 'hidden';
      return false;
    }

    if (settle()) return;

    // consent.js injects and removes the banner without firing an event, so
    // watch the DOM rather than guessing. Bounded so a stuck banner can never
    // leave an observer running for the life of the page.
    var obs = new MutationObserver(function () {
      if (settle() || ++tries > 200) obs.disconnect();
    });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  }

  function toggle(next) {
    open = next;
    root.setAttribute('data-open', String(next));
    launcher.setAttribute('aria-expanded', String(next));
    if (next) { input.focus(); log.scrollTop = log.scrollHeight; }
    else launcher.focus();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
