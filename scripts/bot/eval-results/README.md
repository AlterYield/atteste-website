# scripts/bot/eval-results

Written by `.github/workflows/bot-eval-weekly.yml`, committed so the numbers are
a diff rather than a CI run someone has to go and find.

| file | what |
|---|---|
| `latest.json` | the most recent full run: every case with its answer, `fails`, `costUsd`, `ms` |
| `history.jsonl` | one line per run: `{when, model, passed, total, ledgerViolations, skipped, costUsd, medianMs}` |

The shape of `latest.json` is exactly what `eval.mjs --json` writes, which is the
same shape as the hand-made `../eval-baseline.json` from 2026-08-16 — so the two
are directly comparable.

**`ledgerViolations` is the only hard gate.** It counts answers that stated
something the Promise Ledger does not support. Everything else is a judgement
call; that one costs money and trust.

**`skipped` is not zero-cost information.** A skipped case was cut by the
`--max-cost-usd` cap, so the run's coverage was incomplete — a run with skips
that otherwise looks green has not actually checked everything.

Neither file exists until the first successful workflow run. **An absent file
means no run has succeeded, not that the last run passed.**
