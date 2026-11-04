#!/usr/bin/env node
/**
 * COA generator self-test. No dependencies, no network.
 *   node scripts/coa/test-coa.mjs
 *
 * 1. SHA-256 against the FIPS 180-2 known vectors (via the same coa-core.js the page uses).
 * 2. Payload encode/decode round-trip, incl. non-ASCII text and contract key order.
 * 3. QR fitting: drops d and e first, never h, t or a; typical records fit at 30 mm.
 * 4. /claim/: claim.js against a stub DOM — a missing or malformed fragment shows the
 *    error panel and never the record; a good one renders and links /import-coa#<same payload>.
 * 5. The pages: ANCHOR_ENDPOINT ships null; /claim/ is noindex; no banned wording.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const COA = require(join(ROOT, "assets/js/coa-core.js"));
const qrcode = require(join(ROOT, "assets/js/qrcode-generator-1.4.4.js"));

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log(`ok  ${name}`); };

// 1 ────────────────────────────────────────────────────────────────────────
await test("sha256: empty input", async () => {
  assert.equal(await COA.sha256Hex(new Uint8Array(0)), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});
await test("sha256: 'abc' (FIPS 180-2)", async () => {
  assert.equal(await COA.sha256Hex(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
await test("sha256: 448-bit vector (FIPS 180-2)", async () => {
  assert.equal(await COA.sha256Hex(new TextEncoder().encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
});
await test("sha256: accepts an ArrayBuffer (what File.arrayBuffer() returns)", async () => {
  const buf = new TextEncoder().encode("abc").buffer;
  assert.equal(await COA.sha256Hex(buf), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

// 2 ────────────────────────────────────────────────────────────────────────
const H = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const full = COA.buildRecord({ h: H.toUpperCase(), t: "  Morning over the Boland ", a: "Zanele Khumalo", y: "2026", m: "Oil on linen", d: "60 × 80 cm", e: "Unique", i: "2026-11-04" });

await test("payload: contract shape and key order", async () => {
  assert.deepEqual(Object.keys(full), ["v", "h", "t", "a", "y", "m", "d", "e", "i"]);
  assert.equal(full.v, 1);
  assert.equal(full.h, H, "hash is lowercased");
  assert.equal(full.t, "Morning over the Boland", "whitespace trimmed");
  const json = COA.base64urlDecode(COA.encodePayload(full));
  assert.ok(json.startsWith('{"v":1,"h":"' + H + '","t":'), json);
});
await test("payload: base64url alphabet only, no padding", async () => {
  const p = COA.encodePayload(full);
  assert.match(p, /^[A-Za-z0-9_-]+$/);
});
await test("payload: round-trip, incl. accents, CJK and emoji", async () => {
  const rec = COA.buildRecord({ h: H, t: "Été — 夏 🌅", a: "Thabo Mokoena", y: "c. 1970", m: "Gouache", i: "2026-11-04" });
  const back = COA.decodePayload("#" + COA.encodePayload(rec));
  assert.equal(back.ok, true, back.error);
  assert.deepEqual(back.record, rec);
});
await test("payload: empty optional fields omitted, required kept", async () => {
  const rec = COA.buildRecord({ h: H, t: "T", a: "A", y: "", m: "", d: "", e: "", i: "" });
  assert.deepEqual(Object.keys(rec), ["v", "h", "t", "a"]);
  assert.equal(COA.decodePayload(COA.encodePayload(rec)).ok, true);
});
await test("payload: decodes the browser's btoa output of the same JSON", async () => {
  const json = JSON.stringify({ v: 1, h: H, t: "Untitled", a: "A. Artist", y: "2025", m: "Ink", i: "2026-01-02" });
  const std = Buffer.from(json, "utf8").toString("base64url");
  const r = COA.decodePayload(std);
  assert.equal(r.ok, true);
  assert.equal(r.record.t, "Untitled");
});
await test("claim URL uses the fragment, never the query string", async () => {
  const p = COA.encodePayload(full);
  assert.equal(COA.claimUrl(p), "https://atteste.art/claim/#" + p);
  assert.equal(COA.importUrl(p), "https://atteste-b6409.web.app/import-coa#" + p);
  assert.ok(!COA.claimUrl(p).includes("?"));
});

// 2b malformed payloads ───────────────────────────────────────────────────
const b64 = (s) => Buffer.from(s, "utf8").toString("base64url");
const BAD = {
  "": "missing",
  "#": "missing",
  "   ": "missing",
  "not base64!!": "malformed",
  "abcde": "malformed",                          // length % 4 === 1
  [b64("not json")]: "malformed",
  [b64("[1,2]")]: "malformed",
  [b64("null")]: "malformed",
  [b64('{"v":2,"h":"' + H + '","t":"T","a":"A"}')]: "unsupported-version",
  [b64('{"v":1,"h":"abc","t":"T","a":"A"}')]: "bad-hash",
  [b64('{"v":1,"h":"' + H.toUpperCase() + '","t":"T","a":"A"}')]: "bad-hash",
  [b64('{"v":1,"h":"' + H + '","t":"","a":"A"}')]: "missing-title",
  [b64('{"v":1,"h":"' + H + '","t":"T"}')]: "missing-artist",
  [b64('{"v":1,"h":"' + H + '","t":"T","a":"A","y":{"x":1}}')]: "malformed",
  [Buffer.from([0xff, 0xfe, 0x00]).toString("base64url")]: "malformed", // invalid UTF-8
  ["A".repeat(5000)]: "too-long",
};
await test("decodePayload: every malformed input fails cleanly with a reason, never throws", async () => {
  for (const [input, want] of Object.entries(BAD)) {
    const r = COA.decodePayload(input);
    assert.equal(r.ok, false, `expected failure for ${JSON.stringify(input.slice(0, 40))}`);
    assert.equal(r.error, want, `input ${JSON.stringify(input.slice(0, 40))}`);
  }
  assert.equal(COA.decodePayload(undefined).ok, false);
  assert.equal(COA.decodePayload(null).ok, false);
});
await test("decodePayload: a truncated QR link fails rather than half-renders", async () => {
  const p = COA.encodePayload(full);
  for (const cut of [10, 40, p.length - 3]) assert.equal(COA.decodePayload(p.slice(0, cut)).ok, false, `cut at ${cut}`);
});

// 3 ────────────────────────────────────────────────────────────────────────
const MAX_MODULES = 65;
const fits = (url) => {
  for (const lvl of ["M", "L"]) {
    try { const q = qrcode(0, lvl); q.addData(url, "Byte"); q.make(); if (q.getModuleCount() <= MAX_MODULES) return lvl; } catch {}
  }
  return null;
};
await test("QR: a typical full record fits at 30 mm", async () => {
  const f = COA.fitPayload(full, fits);
  assert.ok(f.level, "fits");
  assert.equal(COA.decodePayload(f.payload).ok, true);
});
await test("QR: a dense record drops d and e first, keeps h, t, a", async () => {
  const dense = COA.buildRecord({ h: H, t: "A fairly long title for a work on paper, part two", a: "Catherine Harrington-Lloyd", y: "2019–2021",
    m: "Graphite, charcoal and gouache on paper", d: "Image 40 × 60 cm, sheet 50 × 70 cm, framed 62 × 82 cm", e: "Edition of 25 plus 5 AP and 2 PP", i: "2026-11-04" });
  assert.equal(fits(COA.claimUrl(COA.encodePayload(dense))), null, "precondition: too dense in full");
  const f = COA.fitPayload(dense, fits);
  assert.deepEqual(f.dropped.slice(0, 2), ["d", "e"]);
  for (const k of ["h", "t", "a"]) assert.equal(f.record[k], dense[k]);
  assert.ok(f.level, "fits after dropping");
  assert.equal(full.d, "60 × 80 cm", "input record untouched");
});
await test("QR: even maximal-length h/t/a are never dropped", async () => {
  const huge = COA.buildRecord({ h: H, t: "T".repeat(90), a: "A".repeat(70), y: "2026", m: "M".repeat(80), d: "D".repeat(80), e: "E".repeat(40), i: "2026-11-04" });
  const f = COA.fitPayload(huge, fits);
  for (const k of ["h", "t", "a"]) assert.equal(f.record[k], huge[k]);
  assert.deepEqual(f.dropped.slice(0, 2), ["d", "e"]);
});

// 4 /claim/ against a stub DOM ─────────────────────────────────────────────
const claimSrc = readFileSync(join(ROOT, "assets/js/claim.js"), "utf8");
const IDS = ["claim-loading", "claim-error", "claim-error-detail", "claim-view", "claim-import",
  "c-title", "c-artist", "c-year", "c-medium", "c-dims", "c-dims-l", "c-edition", "c-edition-l", "c-issued", "c-hash"];
function runClaim(hash) {
  const els = Object.fromEntries(IDS.map((id) => [id, { id, hidden: id !== "claim-loading", textContent: "", href: "" }]));
  els["claim-view"].hidden = true; els["claim-error"].hidden = true;
  const ctx = {
    AttesteCOA: COA,
    location: { hash },
    document: { title: "", getElementById: (id) => els[id] ?? null },
    addEventListener: () => {},
    Date, isNaN, String,
  };
  ctx.window = ctx;
  vm.runInNewContext(claimSrc, ctx);
  return { els, title: ctx.document.title };
}
await test("/claim/: missing fragment shows the error panel only", async () => {
  for (const h of ["", "#"]) {
    const { els } = runClaim(h);
    assert.equal(els["claim-error"].hidden, false);
    assert.equal(els["claim-view"].hidden, true);
    assert.equal(els["claim-loading"].hidden, true);
    assert.match(els["claim-error-detail"].textContent, /missing/i);
  }
});
await test("/claim/: malformed fragments show the error panel, never a record", async () => {
  for (const input of Object.keys(BAD)) {
    const { els } = runClaim("#" + input);
    assert.equal(els["claim-error"].hidden, false, input.slice(0, 30));
    assert.equal(els["claim-view"].hidden, true, input.slice(0, 30));
    assert.equal(els["c-title"].textContent, "");
    assert.ok(els["claim-error-detail"].textContent.length > 10);
  }
});
await test("/claim/: a good fragment renders the record and links /import-coa#<same payload>", async () => {
  const p = COA.encodePayload(full);
  const { els, title } = runClaim("#" + p);
  assert.equal(els["claim-view"].hidden, false);
  assert.equal(els["claim-error"].hidden, true);
  assert.equal(els["c-title"].textContent, "Morning over the Boland");
  assert.equal(els["c-artist"].textContent, "Zanele Khumalo");
  assert.equal(els["c-hash"].textContent, H);
  assert.equal(els["c-medium"].textContent, "Oil on linen");
  assert.equal(els["claim-import"].href, "https://atteste-b6409.web.app/import-coa#" + p);
  assert.match(title, /Morning over the Boland/);
});
await test("/claim/: markup in the payload stays text", async () => {
  const rec = COA.buildRecord({ h: H, t: '<img src=x onerror="alert(1)">', a: "<script>x</script>", i: "2026-11-04" });
  const { els } = runClaim("#" + COA.encodePayload(rec));
  assert.equal(els["c-title"].textContent, '<img src=x onerror="alert(1)">');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(claimSrc), "claim.js must not write HTML");
});
await test("/claim/: optional fields absent → their rows hidden", async () => {
  const rec = COA.buildRecord({ h: H, t: "T", a: "A", y: "2026", m: "Oil", i: "2026-11-04" });
  const { els } = runClaim("#" + COA.encodePayload(rec));
  assert.equal(els["c-dims"].hidden, true);
  assert.equal(els["c-dims-l"].hidden, true);
  assert.equal(els["c-edition"].hidden, true);
});

// 5 pages ─────────────────────────────────────────────────────────────────
await test("ANCHOR_ENDPOINT ships null", async () => {
  const src = readFileSync(join(ROOT, "assets/js/coa.js"), "utf8");
  assert.match(src, /var ANCHOR_ENDPOINT = null;/);
});
await test("/claim/ is noindex; generator pages are indexable", async () => {
  assert.match(readFileSync(join(ROOT, "claim/index.html"), "utf8"), /<meta name="robots" content="noindex/);
  for (const p of ["coa", "coa/painting", "coa/photography", "coa/prints", "coa/sculpture"]) {
    assert.doesNotMatch(readFileSync(join(ROOT, p, "index.html"), "utf8"), /noindex/, p);
  }
});
await test("no verify/authenticate/prove or blockchain/token/crypto/NFT wording on the COA pages", async () => {
  const files = ["coa/index.html", "coa/painting/index.html", "coa/photography/index.html", "coa/prints/index.html",
    "coa/sculpture/index.html", "claim/index.html", "assets/js/coa.js", "assets/js/claim.js"];
  const banned = /\b(verif(y|ies|ied|ication)|authenticat(e|es|ed|ion|ing)|proves?|proven|blockchain|token|crypto\w*|NFTs?|web3)\b/i;
  for (const f of files) {
    let src = readFileSync(join(ROOT, f), "utf8");
    // Allowed: "artist's proof(s)" (a print term), JS identifiers, ASC campaign token params.
    src = src.replace(/<script[^>]*src=[^>]*><\/script>/g, "").replace(/crypto\.subtle|root\.crypto|globalThis\.crypto/g, "");
    const m = src.match(banned);
    assert.equal(m, null, `${f}: "${m && m[0]}"`);
  }
});

console.log(`\n${n} COA tests passed`);
