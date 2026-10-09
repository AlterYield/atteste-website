/**
 * Claim gate — shared logic. Zero dependencies on purpose: it runs in the
 * Netlify build image, in CI and in the bot's knowledge build.
 *
 * The rule (Brain goal G12, "Claim ceilings"): every block of copy that makes
 * a product claim carries the Promise-Ledger id it depends on —
 *
 *   <section data-claim="g-111-trade-payments"> … </section>
 *
 * A production build removes every block whose entry is not `live` or
 * `shipping`. A preview build keeps it and labels it STAGED. When the ledger
 * moves an entry to shipping and the snapshot is re-synced, the block appears
 * on atteste.art with no copy change.
 *
 * Three more gates use the same machinery:
 *   data-claim="unledgered:<slug>"  copy with no ledger entry yet. Never shipped.
 *   data-claim="<id> hold:<name>"   backed copy held off the site while
 *                                   claims/holds.json lists <name>.
 *   data-host="<host>"              names an AI host. Shipped only when a proof
 *                                   file docs/host-proofs/<host>-YYYY-MM-DD*.{md,json,png,txt}
 *                                   exists (Lane H: never name an unproven host).
 *   <meta name="atteste:claim" content="<id>">  gates a whole page: production
 *                                   deletes the file, and every link to it must
 *                                   itself sit inside a block with a gate that is off.
 * Text files (llms*.txt) use comment fences:
 *   <!-- claim:g-111-trade-payments --> … <!-- /claim -->
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SNAPSHOT = join(ROOT, "claims", "ledger-snapshot.json");
export const PROOFS = join(ROOT, "docs", "host-proofs");
export const HOLDS = join(ROOT, "claims", "holds.json");

export const CLAIMABLE = new Set(["live", "shipping"]);

/** The ledger snapshot, with site-level holds attached as snapshot.holds. */
export function loadSnapshot(path = SNAPSHOT, holdsPath = HOLDS) {
  const snap = JSON.parse(readFileSync(path, "utf8"));
  snap.holds = existsSync(holdsPath) ? JSON.parse(readFileSync(holdsPath, "utf8")).holds ?? {} : {};
  return snap;
}

/** Hosts with at least one recorded end-to-end proof. */
export function provenHosts(dir = PROOFS) {
  if (!existsSync(dir)) return new Set();
  const out = new Set();
  for (const f of readdirSync(dir)) {
    const m = f.match(/^([a-z0-9-]+?)-\d{4}-\d{2}-\d{2}.*\.(md|json|png|jpg|txt)$/);
    if (m) out.add(m[1]);
  }
  return out;
}

/**
 * Decide one gate. Returns {ok, status, reason}.
 * A claim value may hold several space-separated ids: every one must be claimable.
 */
export function judge(kind, value, snapshot, hosts) {
  if (kind === "host") {
    const ok = hosts.has(value);
    return { ok, status: ok ? "proven" : "unproven", reason: ok ? "" : `no proof in docs/host-proofs for host "${value}"` };
  }
  const ids = value.split(/\s+/).filter(Boolean);
  for (const id of ids) {
    if (id.startsWith("unledgered:")) return { ok: false, status: "unledgered", reason: `${id} has no ledger entry` };
    if (id.startsWith("hold:")) {
      if (snapshot.holds?.[id.slice(5)]) return { ok: false, status: "on hold", reason: `${id}: ${snapshot.holds[id.slice(5)].reason}` };
      continue; // hold lifted: the block is judged on its other ids
    }
    const e = snapshot.entries[id];
    if (!e) return { ok: false, status: "unknown", reason: `${id} is not in the ledger snapshot` };
    if (!CLAIMABLE.has(e.status)) return { ok: false, status: e.status, reason: `${id} is ${e.status}` };
  }
  const led = ids.filter((id) => !id.startsWith("hold:"));
  if (!led.length) return { ok: false, status: "unknown", reason: `${value}: a hold must sit beside a ledger id` };
  return { ok: true, status: snapshot.entries[led.at(-1)].status, reason: "" };
}

// ── HTML scanning ────────────────────────────────────────────────────────────

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "title"]);
const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

function attr(attrs, name) {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? (m[2] ?? m[3]) : null;
}

/**
 * Every gated element in `html`: {kind, value, tag, start, openEnd, end}.
 * `end` is the index just past the matching close tag. Nested gates are all
 * returned, outermost first.
 */
export function gatedElements(html) {
  const out = [];
  const stack = []; // {tag, start, openEnd, gates}
  let skipUntil = -1; // inside <script>/<style>: tags there are text
  for (const m of html.matchAll(TAG)) {
    if (m.index < skipUntil) continue;
    if (m[0].startsWith("<!--")) continue;
    const [, close, rawName, attrs] = m;
    const tag = rawName.toLowerCase();
    const after = m.index + m[0].length;
    if (!close) {
      const selfClosing = /\/\s*$/.test(attrs) || VOID.has(tag);
      const gates = [];
      const c = attr(attrs, "data-claim");
      const h = attr(attrs, "data-host");
      if (c) gates.push({ kind: "claim", value: c.trim() });
      if (h) gates.push({ kind: "host", value: h.trim().toLowerCase() });
      if (selfClosing) {
        for (const g of gates) out.push({ ...g, tag, start: m.index, openEnd: after, end: after });
        continue;
      }
      stack.push({ tag, start: m.index, openEnd: after, gates });
      if (RAW.has(tag)) {
        const closeAt = html.toLowerCase().indexOf(`</${tag}`, after);
        if (closeAt === -1) throw new Error(`unclosed <${tag}> at ${m.index}`);
        skipUntil = closeAt;
      }
    } else {
      // Pop to the matching open tag (tolerates the odd unclosed <p>/<li>).
      let i = stack.length - 1;
      while (i >= 0 && stack[i].tag !== tag) i--;
      if (i < 0) continue;
      while (stack.length > i) {
        const el = stack.pop();
        const end = stack.length === i ? after : m.index;
        for (const g of el.gates) out.push({ ...g, tag: el.tag, start: el.start, openEnd: el.openEnd, end });
      }
    }
  }
  for (const el of stack) {
    if (el.gates.length) throw new Error(`gated <${el.tag}> at ${el.start} is never closed`);
  }
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}

/** Page-level gate: <meta name="atteste:claim" content="…">. */
export function pageClaim(html) {
  const m = html.match(/<meta\s+name=["']atteste:claim["']\s+content=["']([^"']+)["']/i);
  return m ? m[1].trim() : null;
}

/** Text-file fences: <!-- claim:<id> --> … <!-- /claim --> */
const FENCE = /<!--\s*claim:([^>]+?)\s*-->([\s\S]*?)<!--\s*\/claim\s*-->\n?/g;

export function textFences(text) {
  return [...text.matchAll(FENCE)].map((m) => ({ kind: "claim", value: m[1].trim(), start: m.index, end: m.index + m[0].length, body: m[2] }));
}

// ── Rendering ────────────────────────────────────────────────────────────────

export const STAGED_CSS = `<style id="claim-gate-staged">
[data-claim-staged]{outline:2px dashed #c9a96e;outline-offset:6px}
[data-claim-staged]::before{content:attr(data-claim-staged);display:block;font:600 11px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.03em;color:#1a1a2e;background:#f3e3bf;border-radius:4px;padding:4px 8px;margin:0 0 10px;width:max-content;max-width:100%;white-space:normal;text-transform:none}
</style>`;

/**
 * Render one HTML document for a context.
 *   "production": gated-off blocks removed.
 *   "preview":    everything kept; gated-off blocks labelled STAGED.
 * Returns {html, removed, staged}.
 */
export function renderHtml(html, mode, snapshot, hosts) {
  const removed = [];
  const staged = [];
  const edits = [];
  let coveredUntil = -1;
  for (const el of gatedElements(html)) {
    const v = judge(el.kind, el.value, snapshot, hosts);
    if (v.ok) continue;
    if (mode === "production") {
      if (el.start < coveredUntil) continue; // inside a block already removed
      edits.push({ start: el.start, end: el.end, text: "" });
      coveredUntil = el.end;
      removed.push({ ...el, ...v });
    } else {
      const label = `STAGED · ${el.kind === "host" ? "host " : ""}${el.value} · ${v.status} — not on atteste.art`;
      let at = el.openEnd - 1;
      if (html[at - 1] === "/") at -= 1;
      edits.push({ start: at, end: at, text: ` data-claim-staged="${label.replace(/"/g, "&quot;")}"` });
      staged.push({ ...el, ...v });
    }
  }
  let out = html;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  if (mode !== "production" && staged.length) out = out.replace(/<\/head>/i, `${STAGED_CSS}\n</head>`);
  return { html: out, removed, staged };
}

export function renderText(text, mode, snapshot, hosts) {
  const removed = [];
  let out = text;
  for (const f of textFences(text).reverse()) {
    const v = judge(f.kind, f.value, snapshot, hosts);
    let body = f.body.replace(/^\n/, "");
    if (!v.ok) {
      removed.push({ ...f, ...v });
      body = mode === "production" ? "" : `[STAGED · ${f.value} · ${v.status} — not on atteste.art]\n${body}`;
    }
    out = out.slice(0, f.start) + body + out.slice(f.end);
  }
  return { text: out, removed };
}

/**
 * Visible text of an HTML document, JSON-LD and meta content included.
 * Block boundaries become newlines so a table cell or list item is never
 * read as one sentence with its neighbours.
 */
export function visibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|li|td|th|tr|h[1-6]|div|section|article|blockquote|dd|dt|figcaption)>|<br\s*\/?>/gi, "\n")
    .replace(/<(style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<script(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<meta\s[^>]*content=["']([^"']*)["'][^>]*>/gi, " $1 ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&mdash;|&#8212;/g, "—")
    .replace(/&rsquo;|&#8217;/g, "’")
    .replace(/&amp;/g, "&")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n");
}

/** Every publishable file the gate cares about, relative to ROOT. */
export function siteFiles(root = ROOT) {
  const out = [];
  const skip = new Set(["node_modules", "scripts", "netlify", "docs", "claims"]);
  const walk = (rel) => {
    for (const d of readdirSync(join(root, rel), { withFileTypes: true })) {
      if (d.name.startsWith(".") && d.name !== ".well-known") continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) { if (!skip.has(d.name)) walk(r); continue; }
      if (/\.(html|txt|xml)$/.test(d.name)) out.push(r);
    }
  };
  walk("");
  return out.sort();
}
