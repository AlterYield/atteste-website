#!/usr/bin/env node
/**
 * The tool table on /agents (as production publishes it) must equal the
 * live connector's tools/list — no more, no fewer. Network: one request.
 *
 *   node scripts/claims/check-connector.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadSnapshot, provenHosts, renderHtml } from "./lib.mjs";

const rpc = async (method, params = {}) => {
  const r = await fetch(URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok) { console.error(`FAIL  ${URL} ${method} → HTTP ${r.status}`); process.exit(1); }
  return (await r.json()).result;
};

const URL = process.env.ATTESTE_MCP_URL ?? "https://mcp.atteste.art/mcp";
const served = (await rpc("tools/list")).tools.map((t) => t.name).sort();

const html = renderHtml(readFileSync(join(ROOT, "agents.html"), "utf8"), "production", loadSnapshot(), provenHosts()).html;
const table = html.slice(html.indexOf("<h2>Tools</h2>"), html.indexOf("</table>", html.indexOf("<h2>Tools</h2>")));
const published = [...table.matchAll(/<td><code>([a-z_]+)<\/code><\/td>/g)].map((m) => m[1]).sort();

const missing = served.filter((t) => !published.includes(t));
const extra = published.filter((t) => !served.includes(t));
console.log(`served:    ${served.join(", ")}\npublished: ${published.join(", ")}`);
if (missing.length || extra.length) {
  console.error(`FAIL  /agents tool table drifted — missing ${JSON.stringify(missing)}, not served ${JSON.stringify(extra)}`);
  process.exit(1);
}
console.log(`✓ /agents lists exactly the ${served.length} tools the connector serves`);

// A host proof must be recorded against a server whose own instructions are
// true. Until AlterYield/Atteste#627 is deployed, the initialize instructions
// tell every host it can "search artworks …" while discovery is off — a proof
// recorded then would show a host repeating that overclaim (G12, coordinator
// 2026-10-09). So: any proof on file + "search" in the live instructions = fail.
const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "atteste-website-ci", version: "1" } });
const overclaims = /\bsearch/i.test(init.instructions ?? "");
const proofs = provenHosts();
console.log(`server ${init.serverInfo?.version}: instructions ${overclaims ? "STILL mention search" : "do not mention search"}; host proofs on file: ${[...proofs].join(", ") || "none"}`);
if (overclaims && proofs.size) {
  console.error("FAIL  host proof(s) on file while the live connector instructions still claim search — re-record after Atteste#627 is deployed");
  process.exit(1);
}
