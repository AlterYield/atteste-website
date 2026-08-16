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
  var MAX_CHARS = 600;

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
  var CSS = [
    // --c-surface and --c-on-ink are the widget's own; everything else is
    // inherited from the host page so the widget follows its theme. They must
    // NOT be hard-coded #fff/#000: the help pages flip --ink to a light cream
    // under prefers-color-scheme:dark, so a literal white bubble ends up with
    // near-white text on white. Caught in the browser; no headless test sees it.
    '#atteste-chat{--c-ink:var(--ink,#1a1a2e);--c-muted:var(--ink-muted,#4a4a6e);--c-bg:var(--bg,#faf8f5);',
    '--c-surface:#fff;--c-on-ink:#fff;',
    '--c-gold:var(--gold,#c9a96e);--c-rule:var(--rule,#e6e0d4);position:fixed;right:1.25rem;bottom:1.25rem;',
    'z-index:9999;font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",Roboto,sans-serif;font-size:15px}',
    '#atteste-chat *{box-sizing:border-box}',
    '@media (prefers-color-scheme:dark){#atteste-chat{--c-surface:#242440;--c-on-ink:#1a1a2e}}',
    '#ac-launch{display:flex;align-items:center;gap:.5rem;background:var(--c-ink);color:var(--c-on-ink);border:0;',
    'border-radius:999px;padding:.7rem 1.15rem;font:inherit;font-weight:500;cursor:pointer;',
    'box-shadow:0 6px 22px rgba(26,26,46,.22)}',
    '#ac-launch:hover{filter:brightness(1.15)}',
    '#ac-launch:focus-visible,#atteste-chat button:focus-visible,#ac-input:focus-visible{outline:2px solid var(--c-gold);outline-offset:2px}',
    '#ac-panel{display:none;flex-direction:column;width:min(23rem,calc(100vw - 2.5rem));height:min(31rem,calc(100vh - 6rem));',
    'background:var(--c-bg);border:1px solid var(--c-rule);border-radius:14px;overflow:hidden;',
    'box-shadow:0 18px 48px rgba(26,26,46,.2)}',
    '#atteste-chat[data-open="true"] #ac-panel{display:flex}',
    '#atteste-chat[data-open="true"] #ac-launch{display:none}',
    '#ac-head{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.75rem .9rem;',
    'border-bottom:1px solid var(--c-rule);background:var(--c-surface)}',
    '#ac-head strong{font-weight:600;color:var(--c-ink);font-size:.95rem}',
    '#ac-head span{display:block;font-size:.75rem;color:var(--c-muted);font-weight:400}',
    '#ac-close{background:none;border:0;font-size:1.4rem;line-height:1;color:var(--c-muted);cursor:pointer;padding:.15rem .35rem;border-radius:6px}',
    '#ac-close:hover{color:var(--c-ink)}',
    '#ac-log{flex:1;overflow-y:auto;padding:.9rem;display:flex;flex-direction:column;gap:.7rem}',
    '.ac-msg{max-width:88%;padding:.6rem .75rem;border-radius:11px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.ac-user{align-self:flex-end;background:var(--c-ink);color:var(--c-on-ink);border-bottom-right-radius:3px}',
    '.ac-bot{align-self:flex-start;background:var(--c-surface);border:1px solid var(--c-rule);color:var(--c-ink);border-bottom-left-radius:3px}',
    '.ac-src{display:block;margin-top:.5rem;padding-top:.45rem;border-top:1px solid var(--c-rule);font-size:.76rem;line-height:1.5}',
    '.ac-src a{color:var(--c-muted);text-decoration:underline;text-underline-offset:2px}',
    '.ac-src a:hover{color:var(--c-ink)}',
    '.ac-note{align-self:center;text-align:center;font-size:.78rem;color:var(--c-muted);max-width:92%;line-height:1.5}',
    '.ac-dots span{display:inline-block;width:5px;height:5px;margin-right:3px;border-radius:50%;background:var(--c-muted);opacity:.4}',
    reduceMotion ? '' : '.ac-dots span{animation:ac-b 1.1s infinite}.ac-dots span:nth-child(2){animation-delay:.15s}.ac-dots span:nth-child(3){animation-delay:.3s}@keyframes ac-b{0%,60%,100%{opacity:.25}30%{opacity:.9}}',
    '#ac-form{display:flex;gap:.5rem;padding:.7rem;border-top:1px solid var(--c-rule);background:var(--c-surface)}',
    '#ac-input{flex:1;border:1px solid var(--c-rule);border-radius:9px;padding:.55rem .7rem;font:inherit;color:var(--c-ink);background:var(--c-bg);resize:none;max-height:5.5rem}',
    '#ac-send{background:var(--c-ink);color:var(--c-on-ink);border:0;border-radius:9px;padding:0 .95rem;font:inherit;font-weight:500;cursor:pointer}',
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
        body: JSON.stringify({ message: text, history: history.slice(0, -1).slice(-8) })
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
