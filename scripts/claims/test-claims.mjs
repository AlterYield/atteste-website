#!/usr/bin/env node
/**
 * Claim gate self-test. No network, no dependencies.
 *
 *   node scripts/claims/test-claims.mjs
 *
 * Two halves:
 *   A. unit cases on a fixture snapshot (planned, shipping, retired, unknown,
 *      unledgered, hosts, nesting, page gates, text fences, ceilings)
 *   B. the REAL site: build production and preview into temp dirs and assert
 *      that no planned-id block survives production, and that every staged
 *      block is present and labelled in preview.
 */

import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  ROOT, judge, gatedElements, renderHtml, renderText, pageClaim, loadSnapshot, provenHosts, siteFiles, visibleText,
} from "./lib.mjs";
import { CEILINGS, RETIRED_PHRASES } from "./rules.mjs";

let pass = 0;
let failCount = 0;
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`\x1b[32m✓\x1b[0m ${name}`); }
  else { failCount++; console.log(`\x1b[31m✗\x1b[0m ${name}`); }
};

// ── A. fixture ───────────────────────────────────────────────────────────────
const snap = { entries: {
  "g-111-trade-payments": { status: "planned" },
  "f-agent-connector-t0-verify": { status: "shipping" },
  "f-shared-cert-view": { status: "live" },
  "g-091-no-commission": { status: "retired" },
} };
const hosts = new Set(["claude"]);

ok(judge("claim", "f-shared-cert-view", snap, hosts).ok, "live entry is claimable");
ok(judge("claim", "f-agent-connector-t0-verify", snap, hosts).ok, "shipping entry is claimable");
ok(!judge("claim", "g-111-trade-payments", snap, hosts).ok, "planned entry is not claimable");
ok(!judge("claim", "g-091-no-commission", snap, hosts).ok, "retired entry is not claimable");
ok(judge("claim", "g-nope", snap, hosts).status === "unknown", "unknown id is reported as unknown");
ok(judge("claim", "unledgered:t1-account", snap, hosts).status === "unledgered", "unledgered: prefix never ships");
ok(!judge("claim", "f-shared-cert-view g-111-trade-payments", snap, hosts).ok, "multi-id block needs every id claimable");
ok(judge("host", "claude", snap, hosts).ok && !judge("host", "grok", snap, hosts).ok, "host gate follows proofs");

const page = `<html><head><title>x</title></head><body>
<p>Always here.</p>
<section data-claim="g-111-trade-payments"><h2>Sell &amp; get paid</h2><div><p>Escrow holds it.</p></div></section>
<div data-claim="f-agent-connector-t0-verify"><p>Ask your AI to verify.</p>
  <ul><li data-host="grok">Grok steps</li><li data-host="claude">Claude steps</li></ul>
  <img data-claim="g-111-trade-payments" src="x.png" alt="">
</div>
<script>const s = '<section data-claim="g-111-trade-payments">not markup</section>';</script>
</body></html>`;

const prod = renderHtml(page, "production", snap, hosts).html;
ok(!prod.includes("Sell &amp; get paid") && !prod.includes("Escrow holds it"), "production: planned block removed with all its children");
ok(prod.includes("Always here.") && prod.includes("Ask your AI to verify."), "production: ungated + shipping blocks kept");
ok(!prod.includes("Grok steps") && prod.includes("Claude steps"), "production: unproven host removed, proven host kept");
ok(!/<img[^>]*g-111/.test(prod), "production: self-closing gated element removed");
ok(prod.includes("not markup"), "production: tags inside <script> are text, untouched");
ok(gatedElements(prod).every((g) => judge(g.kind, g.value, snap, hosts).ok), "production: no gated-off element survives");

const prev = renderHtml(page, "preview", snap, hosts);
ok(prev.html.includes("Sell &amp; get paid") && prev.html.includes("Grok steps"), "preview: staged blocks visible");
ok(/data-claim-staged="STAGED · g-111-trade-payments · planned/.test(prev.html), "preview: staged block labelled with id + status");
ok(prev.html.includes('id="claim-gate-staged"'), "preview: staged style injected once");
ok(prev.staged.length === 3, `preview: 3 staged blocks reported (got ${prev.staged.length})`);
ok(renderHtml("<p>plain</p>", "production", snap, hosts).html === "<p>plain</p>", "ungated document is byte-identical");

ok(pageClaim('<meta name="atteste:claim" content="g-111-trade-payments">') === "g-111-trade-payments", "page-level gate is read");

const txt = "Intro\n<!-- claim:g-111-trade-payments -->\nSell inside Attesté.\n<!-- /claim -->\n<!-- claim:f-shared-cert-view -->\nCertificates.\n<!-- /claim -->\nEnd\n";
const tp = renderText(txt, "production", snap, hosts).text;
ok(!tp.includes("Sell inside") && tp.includes("Certificates.") && !tp.includes("claim:"), "text fences: planned dropped, live kept, fences stripped");
ok(renderText(txt, "preview", snap, hosts).text.includes("[STAGED · g-111-trade-payments"), "text fences: preview labels staged text");

ok(gatedElements('<div data-claim="a"><p>one<p>two</div>').length === 1, "tolerates unclosed <p> inside a gated block");
let threw = false;
try { gatedElements('<section data-claim="a"><p>never closed'); } catch { threw = true; }
ok(threw, "an unclosed gated block is an error, not a silent pass");

// Ceilings and retired wording.
const hits = (s) => CEILINGS.filter((c) => !c.raw && !c.sentence && c.re.test(s)).map((c) => c.id);
ok(hits("Attesté holds the buyer's money until delivery.").length > 0, "ceiling: 'Attesté holds the buyer's money' fails");
ok(hits("A licensed escrow agent holds the buyer's money.").length === 0, "ceiling: escrow agent holding money passes");
ok(hits("Every artist on Attesté is a verified artist.").length > 0, "ceiling: 'verified artist' fails");
ok(hits("We pay with TradeSafe.").length > 0, "ceiling: TradeSafe fails");
ok(hits("A tamper-proof record.").length > 0, "ceiling: tamper-proof fails");
const nfc = CEILINGS.find((c) => c.id.startsWith("C4 NFC"));
ok(nfc.a.test("Tap the NFC tag, it proves authenticity") && nfc.b.test("Tap the NFC tag, it proves authenticity"), "ceiling: NFC + authenticity in one sentence fails");
ok(!(nfc.a.test("The NFC tag points at the record.") && nfc.b.test("The NFC tag points at the record.")), "ceiling: NFC points-at-the-record passes");
ok(RETIRED_PHRASES["g-091-no-commission"].some((r) => r.test("No commission on artwork sales")), "retired g-091 wording is caught");
ok(visibleText("<td>NFC</td><td>authentic</td>").split("\n").length >= 2, "table cells are separate sentences");

// ── B. the real site ─────────────────────────────────────────────────────────
const realSnap = loadSnapshot();
const realHosts = provenHosts();
const dirs = {};
for (const mode of ["production", "preview"]) {
  dirs[mode] = mkdtempSync(join(tmpdir(), `claims-${mode}-`));
  const r = spawnSync(process.execPath, [join(ROOT, "scripts/claims/build.mjs"), "--mode", mode, "--out", dirs[mode]], { encoding: "utf8" });
  ok(r.status === 0, `real site: ${mode} build succeeds`);
  if (r.status !== 0) console.log(r.stderr);
}

let plannedInSource = 0;
let survivors = 0;
let stagedMissing = 0;
for (const f of siteFiles(ROOT).filter((f) => f.endsWith(".html"))) {
  const src = readFileSync(join(ROOT, f), "utf8");
  const off = gatedElements(src).filter((g) => !judge(g.kind, g.value, realSnap, realHosts).ok);
  const pc = pageClaim(src);
  const pageOff = pc && !judge("claim", pc, realSnap, realHosts).ok;
  plannedInSource += off.length + (pageOff ? 1 : 0);

  const prodPath = join(dirs.production, f);
  if (pageOff) { if (existsSync(prodPath)) survivors++; continue; }
  const p = readFileSync(prodPath, "utf8");
  survivors += gatedElements(p).filter((g) => !judge(g.kind, g.value, realSnap, realHosts).ok).length;

  const v = readFileSync(join(dirs.preview, f), "utf8");
  stagedMissing += off.length - (v.match(/data-claim-staged="STAGED ·/g) ?? []).length;
}
ok(survivors === 0, `real site: 0 planned/unproven blocks in the production build (of ${plannedInSource} in source)`);
ok(stagedMissing <= 0, "real site: every staged block is present and labelled in the preview build");
ok(!existsSync(join(dirs.production, "claims")), "real site: production publish dir has no ledger snapshot");

const planned = Object.entries(realSnap.entries).find(([, e]) => e.status === "planned")?.[0];
ok(planned && !judge("claim", planned, realSnap, realHosts).ok, `real snapshot: a planned id (${planned}) is gated off`);

console.log(`\n${pass}/${pass + failCount} passed`);
process.exit(failCount ? 1 : 0);
