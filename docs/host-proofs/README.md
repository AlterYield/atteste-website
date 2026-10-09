# AI host proofs (Lane H, Brain goal G12)

atteste.art names an AI assistant only once someone has recorded that assistant
connecting to `https://mcp.atteste.art/mcp` and verifying a real certificate
end to end. Until then the site says "any MCP-compatible assistant".

This is enforced, not just written down. Copy that names a host sits inside
`data-host="<host>"`, and `scripts/claims/build.mjs` removes it from production
unless this folder holds a file named:

    <host>-YYYY-MM-DD[-anything].(md|json|png|jpg|txt)

| Host key | Gated copy | Proof on file |
|---|---|---|
| `claude`  | Claude steps on `/agents` and the homepage | none yet |
| `grok`    | Grok + xAI API steps on `/agents` and the homepage | none yet |
| `chatgpt` | ChatGPT steps on `/agents` and the homepage | none yet |
| `meta`    | none written. The consumer Meta AI app had no custom-MCP setting as of 2026-09. Meta Muse reportedly builds a client from an MCP URL, which is unverified. | none yet |

Adding a proof file is the whole switch. The next production deploy shows that
host's steps, with no copy edit.

## Precondition: hold until the connector stops claiming search

Do not record any proof yet. The live server's own `initialize` instructions
(0.5.1) still tell every host it can "search artworks their owners have opted
in to AI discovery", while discovery is switched off. A proof recorded now would
show a host repeating that. Record proofs only after **AlterYield/Atteste#627 is
merged and the connector has been redeployed** (Charl runs its `deploy.sh`).
Check with:

```bash
curl -s -X POST https://mcp.atteste.art/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}'
```

The `instructions` must not contain "search". CI enforces this:
`scripts/claims/check-connector.mjs` fails if any proof file is on file while
the live instructions still mention search.

## What counts as a proof

A transcript or screenshots from the host's own interface showing all of:

1. the connector added with the URL `https://mcp.atteste.art/mcp`;
2. the assistant calling `verify_certificate` on a real certificate (use the
   public canary `https://atteste.art/v/3PQTZtzN5AJw1srvkFZT`);
3. the answer, including the line that the seal holds but the artist's
   identity is not verified (`seal_valid_identity_unverified`).

A failed attempt is worth keeping too: name it `<host>-attempt-YYYY-MM-DD.md`,
which the gate reads as a different host key and ignores.

Name a successful run for the host and the date, e.g.
`claude-2026-10-09.png` or `grok-2026-10-10-transcript.md`. Check that it
shows no personal data (account name, other chats) before committing it: this
repo is public.

`protocol/2026-10-09-raw-mcp-transcript.json` is a scripted JSON-RPC exchange
with no AI host involved. It proves the server and its four tools, it is not a
host proof, and it sits in a subfolder so the gate ignores it.

## Steps for Charl (each takes about two minutes; a session must never type credentials)

**Claude (claude.ai or the Claude desktop app)**
1. Settings → Connectors → **Add custom connector**.
2. Name `Attesté`, URL `https://mcp.atteste.art/mcp`, then Add. No sign-in needed.
3. New chat, with the connector enabled: *"Verify this Attesté certificate and
   tell me what it does and doesn't prove: https://atteste.art/v/3PQTZtzN5AJw1srvkFZT"*
4. Screenshot the tool call and the answer → `claude-YYYY-MM-DD.png`.

Shortcut: Claude Code is also a Claude host. On a Mac where `claude` is logged
in, run:

```bash
claude -p "Verify the Attesté certificate https://atteste.art/v/3PQTZtzN5AJw1srvkFZT and explain what it proves and does not prove." --mcp-config '{"mcpServers":{"atteste":{"type":"http","url":"https://mcp.atteste.art/mcp"}}}' --strict-mcp-config --allowedTools "mcp__atteste__verify_certificate mcp__atteste__explain_attestation" --output-format stream-json --verbose > docs/host-proofs/claude-code-$(date +%F).json
```

On 2026-10-09 the session tried this on MacBook-Pro-2: the connector reported
`connected`, but the CLI's own login had expired ("OAuth session expired"), so
no model turn ran and the attempt does not count. `claude /login` first.

**Grok**
The session "Get Atteste into Grok's connector catalog" owns the catalog
submission. This proof is just one user connecting.
1. grok.com/connectors → **New Connector** → **Custom** → paste the URL → save.
   (Check that Custom is offered on the plan you're on.)
2. Ask the same question as above, then screenshot → `grok-YYYY-MM-DD.png`.

**ChatGPT**
1. Settings → Apps & Connectors → Advanced → turn on **Developer mode**.
2. Create a connector: URL `https://mcp.atteste.art/mcp`, authentication
   **none**.
3. In a new chat, add the connector from the + menu, ask the same question,
   then screenshot → `chatgpt-YYYY-MM-DD.png`.

**Meta**
Open Meta AI (app and web) and look for any custom connector or MCP setting.
If Meta Muse offers to build a client from an MCP URL, give it the URL and ask
the same question. Save a successful run as `meta-YYYY-MM-DD.*`. Record a
failed or impossible attempt as `meta-attempt-YYYY-MM-DD.md` instead: that name
does not switch anything on.
