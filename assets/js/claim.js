/**
 * /claim/ — shows the record carried in the URL fragment of a COA's QR code.
 * Decoding is local; nothing is sent anywhere. All values are rendered with
 * textContent only (no HTML writes): the payload is untrusted input.
 */
(function () {
  'use strict';
  var COA = window.AttesteCOA;
  var $ = function (id) { return document.getElementById(id); };

  var ERRORS = {
    'missing': 'This link has no certificate record in it. The part after the # is missing.',
    'too-long': 'This link is longer than any certificate record we issue.',
    'malformed': 'The record in this link is damaged, or part of it was cut off.',
    'unsupported-version': 'This record was made by a newer version of the generator. Reload the page and try again.',
    'bad-hash': 'The image fingerprint in this record is incomplete.',
    'missing-title': 'This record has no title.',
    'missing-artist': 'This record has no artist.'
  };

  function set(id, value, labelId) {
    var el = $(id);
    if (!el) return;
    var v = value && String(value).trim();
    if (labelId && !v) {
      el.hidden = true;
      if ($(labelId)) $(labelId).hidden = true;
      return;
    }
    el.hidden = false;
    if (labelId && $(labelId)) $(labelId).hidden = false;
    el.textContent = v || '—';
  }

  function formatDate(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return iso;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (isNaN(d)) return iso;
    try { return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }); }
    catch (e) { return iso; }
  }

  function render() {
    $('claim-loading').hidden = true;
    var raw = location.hash.replace(/^#/, '');
    var res = COA ? COA.decodePayload(raw) : { ok: false, error: 'malformed' };
    if (!res.ok) {
      $('claim-view').hidden = true;
      $('claim-error').hidden = false;
      $('claim-error-detail').textContent = ERRORS[res.error] || ERRORS.malformed;
      document.title = 'Certificate link not readable — Attesté';
      return;
    }
    var r = res.record;
    set('c-title', r.t);
    set('c-artist', r.a);
    set('c-year', r.y);
    set('c-medium', r.m);
    set('c-dims', r.d, 'c-dims-l');
    set('c-edition', r.e, 'c-edition-l');
    set('c-issued', formatDate(r.i));
    set('c-hash', r.h);
    // Same payload, untouched, in the fragment (shared contract).
    $('claim-import').href = COA.importUrl(raw);
    document.title = r.t.slice(0, 60) + ' by ' + r.a.slice(0, 40) + ' — certificate record · Attesté';
    $('claim-error').hidden = true;
    $('claim-view').hidden = false;
  }

  render();
  window.addEventListener('hashchange', render);
})();
