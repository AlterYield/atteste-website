# atteste.art site bot — Phase 0

Pre-sale onboarding / FAQ / guidance bot for atteste.art. **This is Phase 0: no
UI, no endpoint, nothing public.** It exists to prove one thing before any
widget gets built — that grounded, ledger-safe answers are actually achievable
from the site's own content. If that can't be shown here, no amount of front-end
polish saves it.

Design doc: Brain `wiki/concepts/atteste-site-onboarding-bot-stack.md`

## What's here

| File | Does |
|---|---|
| `build_knowledge.py` | Site HTML + both Promise Ledgers → `knowledge.json` |
| `knowledge.json` | The generated pack. Committed on purpose — it's the reviewable artifact |
| `lib/knowledge.mjs` | Pack loading + chunk selection (BM25 present but dormant) |
| `lib/prompt.mjs` | System prompt, grounding contract, refusals, pricing block |
| `lib/ledger.mjs` | Post-generation Promise Ledger scan + the withheld-answer fallback |
| `lib/model.mjs` | Gemini / Claude adapter, pinned model ids, cost accounting |
| `ask.mjs` | Ask one question |
| `golden.mjs` | 50-case evaluation set |
| `eval.mjs` | Run the set, report pass rate / ledger violations / cost / latency |
| `test-ledger.mjs` | Self-test for the ledger guard — no key, no network |

`lib/*.mjs` is zero-dependency ESM on purpose: Phase 1's
`netlify/functions/chat.mjs` imports these files **verbatim**. There is no port
step between Phase 0 and a live endpoint.

## Run it

```bash
python3 scripts/bot/build_knowledge.py     # regenerate the pack
node scripts/bot/test-ledger.mjs           # guard tests — no key needed
node scripts/bot/eval.mjs --dry-run        # validate the golden set — no key needed
```

Anything that calls a model needs a key. The real one lives in Firebase
secrets, not on disk — the repo's `.env` holds empty placeholders:

```bash
export GEMINI_API_KEY=$(firebase functions:secrets:access GEMINI_API_KEY --project atteste-b6409)
node scripts/bot/ask.mjs --list-models                    # pin a real model id first
node scripts/bot/ask.mjs "is there a free plan?"
node scripts/bot/eval.mjs --json /tmp/eval.json
```

To compare providers — the open question Phase 0 is meant to settle:

```bash
node scripts/bot/eval.mjs --model gemini-flash-lite --json /tmp/gemini.json
node scripts/bot/eval.mjs --model claude-haiku      --json /tmp/claude.json
```

## Baseline — first live run, 2026-08-16

`gemini-3.5-flash-lite`, 53 cases: **53/53 passed, 0 ledger violations, 7/7
ledger traps clean, 5/5 refusals correct, median 1.56s, $0.37 per full run
(~$0.028/conversation at 4 turns).** Full transcript in `eval-baseline.json`
— re-run and diff it before shipping any prompt change.

Three things the first runs caught, none of which were model failures:

1. **Untiered ledger claims lose to page copy.** `g-010`'s text is "Up to 50
   artworks in inventory." with no tier named, so the model could not bind it
   to Boutique and correctly preferred `galleries.html`, which says 250.
   `g-013` (exhibitions) names its tiers inline and was obeyed — the same run
   got one right and one wrong for the same reason. Fix: render the promise id
   alongside the claim, since the id carries the tier. Cases `c01`–`c03` lock
   this in.
2. **Two golden assertions were wrong, not the answers.** `x03` banned the word
   "planned", which appears in a correct refusal ("I cannot share unreleased or
   planned feature details"). `r06` demanded a human handoff for an account
   deletion, but the bot's self-serve answer — in-app path, email fallback, and
   a warning that deletion does not cancel a store subscription — was better.
   Both cases were rewritten to assert the thing that actually matters.
3. **A live site/ledger contradiction, unresolved.** See below.

## Unresolved: artwork caps disagree

The ledger says Boutique **50** artworks and Professional **100**
(`g-010`/`g-011`). `galleries.html` says **250** and **500**. Exhibition caps
agree (6/12/unlimited), and so does pricing, so this is isolated to inventory.

The bot follows the ledger, per the ledger's own rule that no artifact may
contradict it. **That has not been ruled on** — if the site is right and the
ledger is stale, the bot is now quoting caps 5× too low to prospects, which
would cost sales. Worth ten minutes with the tier-gating code.

## The one gate that matters

**Ledger violations must be zero.** `eval.mjs` exits non-zero if any answer
states something the Promise Ledger marks `planned`, `gap`, or `regressed`.
Everything else in the report is a judgement call; this isn't.

The reasoning: a public bot answers in real time, unreviewed, to a stranger who
is deciding whether to pay. One confident "yes, Attesté drafts your invoices" is
a refund and a trust event — strictly worse than the same error in an outreach
email, which at least gets read by a human before it goes out.

Six claims are currently forbidden (1 `gap`, 5 `planned`). Seven golden cases
(`l01`–`l07`) bait them directly, including one compound leading question that
stacks three at once, because agreeableness is the failure mode.

## Things that will bite

- **The pack is not publicly served, deliberately.** `_redirects` 404s
  `/scripts/*`. Keep it that way: `never_claim` enumerates what we haven't
  built, which is not something to hand a competitor.
- **Model ids are pinned, never aliased.** The in-house default elsewhere is
  `gemini-flash-latest`, whose own code comment notes it can drift ~5× in cost
  when it rotates. Fine for a metered internal call, not for an uncapped public
  endpoint. Override with `GEMINI_MODEL_ID` / `CLAUDE_MODEL_ID`.
- **Rebuild the pack whenever site copy or a ledger changes.** In Phase 1 this
  becomes a build step so the two can't drift; today it's manual.
- **Prices come from the ledger, never from page prose.** The website repo's
  own `CLAUDE.md` still claims annual gallery tiers ($495 / $1,188 / $1,908/yr);
  the ledger and the live pages both say monthly ($64.99 / $158.99 / $259.00).
  Cases `p01` and `p05` exist to catch the stale numbers if they resurface.
- **The eval costs real money.** ~50 calls at roughly 22k prompt tokens each.
  On `gemini-flash-lite` that's a few cents per full run; the report prints the
  exact figure.

## Not built yet (Phase 1+)

Widget, `/api/chat` Netlify Function, streaming, the Collector/Artist/Gallery
router, screenshot and video cards, agentic tools (cert verify, book-a-call,
lead capture), conversation logging. Phase 0 stops at the CLI on purpose.
