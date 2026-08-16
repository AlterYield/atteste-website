/**
 * Provider adapter — Gemini and Claude behind one call.
 *
 * Two reasons this is an adapter rather than a direct call:
 *  1. The model choice is still open (Gemini shares the app's billing; Claude
 *     is stronger at refusal discipline, which is what the Promise Ledger
 *     needs). Phase 0 exists partly to decide it, so switching must be a flag.
 *  2. Model ids are PINNED here, never aliased. The in-house default elsewhere
 *     is `gemini-flash-latest`, whose own code comment notes it can drift ~5x
 *     in cost when it rotates. An uncapped public endpoint on a rotating alias
 *     is a billing surprise waiting to happen.
 *
 * Prices are USD per 1M tokens, checked 2026-08-16. They drive the cost line
 * in the eval report only — if they drift, the report is wrong, not the bot.
 */

export const MODELS = {
  "gemini-flash-lite": {
    provider: "gemini",
    id: process.env.GEMINI_MODEL_ID || "gemini-3.5-flash-lite",
    price: { in: 0.3, out: 2.5 },
  },
  "gemini-flash": {
    provider: "gemini",
    id: process.env.GEMINI_MODEL_ID || "gemini-3.7-flash",
    price: { in: 0.75, out: 3.75 }, // promotional through 2026-12-31
  },
  "claude-haiku": {
    provider: "claude",
    id: process.env.CLAUDE_MODEL_ID || "claude-haiku-4-5-20251001",
    price: { in: 1.0, out: 5.0 },
  },
};

export const DEFAULT_MODEL = "gemini-flash-lite";

function keyFor(provider) {
  const name = provider === "gemini" ? "GEMINI_API_KEY" : "CLAUDE_API_KEY";
  const key = (process.env[name] ?? "").trim();
  if (!key) {
    throw new Error(
      `${name} is not set.\n` +
        `  The real key lives in Firebase secrets, not on disk. Either:\n` +
        `    export ${name}=$(firebase functions:secrets:access ${name} --project atteste-b6409)\n` +
        `  or paste one for the session:\n` +
        `    export ${name}=...`
    );
  }
  return key;
}

/** List model ids the key can actually call. Use this to pin correctly. */
export async function listModels(provider = "gemini") {
  if (provider !== "gemini") throw new Error("listModels supports gemini only");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${keyFor("gemini")}`
  );
  if (!res.ok) throw new Error(`list models failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return (body.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .sort();
}

async function callGemini(model, turn, { temperature, maxTokens }) {
  const contents = [
    ...turn.history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: "user", parts: [{ text: `SOURCE MATERIAL\n\n${turn.context}\n\n---\n\nVISITOR: ${turn.question}` }] },
  ];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent?key=${keyFor("gemini")}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: turn.system }] },
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.text();
    if (res.status === 404) {
      throw new Error(
        `Model id "${model.id}" was rejected (404).\n` +
          `  Pin a real one — list them with:  node scripts/bot/ask.mjs --list-models\n` +
          `  then set GEMINI_MODEL_ID, or edit MODELS in scripts/bot/lib/model.mjs.\n  ${detail.slice(0, 300)}`
      );
    }
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 400)}`);
  }

  const body = await res.json();
  const text = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  const u = body.usageMetadata ?? {};
  return { text, usage: { in: u.promptTokenCount ?? 0, out: u.candidatesTokenCount ?? 0 } };
}

async function callClaude(model, turn, { temperature, maxTokens }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": keyFor("claude"),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model.id,
      max_tokens: maxTokens,
      temperature,
      system: turn.system,
      messages: [
        ...turn.history.map((h) => ({ role: h.role === "model" ? "assistant" : "user", content: h.text })),
        { role: "user", content: `SOURCE MATERIAL\n\n${turn.context}\n\n---\n\nVISITOR: ${turn.question}` },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const body = await res.json();
  return {
    text: (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("").trim(),
    usage: { in: body.usage?.input_tokens ?? 0, out: body.usage?.output_tokens ?? 0 },
  };
}

/** @returns {{text, usage, costUsd, model, ms}} */
export async function generate(turn, { model = DEFAULT_MODEL, temperature = 0.2, maxTokens = 600 } = {}) {
  const spec = MODELS[model];
  if (!spec) throw new Error(`unknown model "${model}" — one of: ${Object.keys(MODELS).join(", ")}`);

  const started = Date.now();
  const out =
    spec.provider === "gemini"
      ? await callGemini(spec, turn, { temperature, maxTokens })
      : await callClaude(spec, turn, { temperature, maxTokens });

  const costUsd = (out.usage.in / 1e6) * spec.price.in + (out.usage.out / 1e6) * spec.price.out;
  return { ...out, costUsd, model: `${model} (${spec.id})`, ms: Date.now() - started };
}
