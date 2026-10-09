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

const URL = process.env.ATTESTE_MCP_URL ?? "https://mcp.atteste.art/mcp";
const res = await fetch(URL, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
});
if (!res.ok) { console.error(`FAIL  ${URL} tools/list → HTTP ${res.status}`); process.exit(1); }
const served = (await res.json()).result.tools.map((t) => t.name).sort();

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
