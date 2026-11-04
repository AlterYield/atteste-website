/**
 * COA generator — shared, side-effect-free core.
 *
 * Used by /coa/ (assets/js/coa.js), /claim/ (assets/js/claim.js) and the Node
 * test (scripts/coa/test-coa.mjs). No DOM, no network.
 *
 * SHARED CONTRACT — other code builds against this. Do not change it.
 *   payload = base64url(JSON) of
 *     {"v":1,"h":"<sha256 hex>","t":title,"a":artist,"y":year,"m":medium,
 *      "d":dimensions,"e":edition,"i":"<ISO date>"}
 *   carried in the URL FRAGMENT only, never the query string.
 *   QR target: https://atteste.art/claim/#<payload>
 *   When the QR is too dense at 30 mm, drop optional fields — d and e first.
 *   Never drop h, t or a.
 *
 * Field types as emitted here: every value is a string except v (number 1).
 * Optional fields that are empty are omitted rather than sent as "".
 */
(function (root) {
  'use strict';

  var CLAIM_BASE = 'https://atteste.art/claim/#';
  var IMPORT_BASE = 'https://atteste-b6409.web.app/import-coa#';
  var KEY_ORDER = ['v', 'h', 't', 'a', 'y', 'm', 'd', 'e', 'i'];
  var REQUIRED = ['h', 't', 'a'];
  // Drop order when the QR is too dense. d and e go first (contract); then the
  // other non-required fields. h, t, a are never dropped.
  var DROP_ORDER = [['d', 'e'], ['m'], ['y'], ['i']];
  var MAX_PAYLOAD_CHARS = 4096;

  function utf8Bytes(str) {
    return new TextEncoder().encode(str);
  }

  function bytesToBinary(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return s;
  }

  /** base64url without padding. */
  function base64urlEncode(str) {
    return btoa(bytesToBinary(utf8Bytes(str)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** Throws on anything that is not valid base64url of UTF-8. */
  function base64urlDecode(b64) {
    if (!/^[A-Za-z0-9_-]*$/.test(b64)) throw new Error('not base64url');
    if (b64.length % 4 === 1) throw new Error('bad base64url length');
    var std = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (std.length % 4) std += '=';
    var bin = atob(std);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  function hex(buffer) {
    var b = new Uint8Array(buffer);
    var out = '';
    for (var i = 0; i < b.length; i++) out += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return out;
  }

  /** SHA-256 of raw bytes (ArrayBuffer | Uint8Array), lowercase hex. */
  function sha256Hex(bytes) {
    return root.crypto.subtle.digest('SHA-256', bytes).then(hex);
  }

  function clean(v) {
    return v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
  }

  /** Build the record object in contract key order, omitting empty optionals. */
  function buildRecord(fields) {
    var rec = { v: 1 };
    for (var i = 1; i < KEY_ORDER.length; i++) {
      var k = KEY_ORDER[i];
      var val = k === 'h' ? clean(fields.h).toLowerCase() : clean(fields[k]);
      if (val || REQUIRED.indexOf(k) !== -1) rec[k] = val;
    }
    return rec;
  }

  function encodePayload(record) {
    var ordered = {};
    for (var i = 0; i < KEY_ORDER.length; i++) {
      var k = KEY_ORDER[i];
      if (record[k] !== undefined) ordered[k] = record[k];
    }
    return base64urlEncode(JSON.stringify(ordered));
  }

  /**
   * Decode and validate a payload, or a whole fragment ("#..." or "...").
   * Returns {ok:true, record} or {ok:false, error}. Never throws.
   */
  function decodePayload(input) {
    var raw = String(input == null ? '' : input).replace(/^#/, '').trim();
    if (!raw) return { ok: false, error: 'missing' };
    if (raw.length > MAX_PAYLOAD_CHARS) return { ok: false, error: 'too-long' };
    var obj;
    try { obj = JSON.parse(base64urlDecode(raw)); }
    catch (e) { return { ok: false, error: 'malformed' }; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'malformed' };
    if (obj.v !== 1) return { ok: false, error: 'unsupported-version' };
    if (typeof obj.h !== 'string' || !/^[0-9a-f]{64}$/.test(obj.h)) return { ok: false, error: 'bad-hash' };
    if (typeof obj.t !== 'string' || !obj.t.trim()) return { ok: false, error: 'missing-title' };
    if (typeof obj.a !== 'string' || !obj.a.trim()) return { ok: false, error: 'missing-artist' };
    var rec = { v: 1 };
    for (var i = 1; i < KEY_ORDER.length; i++) {
      var k = KEY_ORDER[i];
      var val = obj[k];
      if (val === undefined || val === null) continue;
      if (typeof val === 'number') val = String(val);
      if (typeof val !== 'string') return { ok: false, error: 'malformed' };
      rec[k] = val.slice(0, 500);
    }
    if (rec.i && !/^\d{4}-\d{2}-\d{2}/.test(rec.i)) delete rec.i;
    return { ok: true, record: rec };
  }

  function claimUrl(payload) { return CLAIM_BASE + payload; }
  function importUrl(payload) { return IMPORT_BASE + payload; }

  /**
   * Smallest-loss payload whose QR still fits. `fits(url)` returns an error
   * correction level ('M' | 'L') the url fits at, or null. Returns
   * {record, payload, url, level, dropped:[keys]}.
   */
  function fitPayload(record, fits) {
    var rec = {};
    for (var k in record) rec[k] = record[k];
    var dropped = [];
    for (var step = 0; step <= DROP_ORDER.length; step++) {
      var payload = encodePayload(rec);
      var url = claimUrl(payload);
      var level = fits(url);
      if (level) return { record: rec, payload: payload, url: url, level: level, dropped: dropped };
      if (step === DROP_ORDER.length) break;
      var keys = DROP_ORDER[step];
      for (var j = 0; j < keys.length; j++) {
        if (rec[keys[j]] !== undefined) { delete rec[keys[j]]; dropped.push(keys[j]); }
      }
    }
    var finalPayload = encodePayload(rec);
    return { record: rec, payload: finalPayload, url: claimUrl(finalPayload), level: null, dropped: dropped };
  }

  /** Today as YYYY-MM-DD in the visitor's own time zone. */
  function isoToday(d) {
    d = d || new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  var api = {
    CLAIM_BASE: CLAIM_BASE,
    IMPORT_BASE: IMPORT_BASE,
    KEY_ORDER: KEY_ORDER,
    base64urlEncode: base64urlEncode,
    base64urlDecode: base64urlDecode,
    sha256Hex: sha256Hex,
    buildRecord: buildRecord,
    encodePayload: encodePayload,
    decodePayload: decodePayload,
    claimUrl: claimUrl,
    importUrl: importUrl,
    fitPayload: fitPayload,
    isoToday: isoToday
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AttesteCOA = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
