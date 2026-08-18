#!/usr/bin/env python3
"""Add or remove the site-bot widget tag across the site, idempotently.

Twelve hand-edits was fine for the help-centre pilot. Site-wide it isn't:
pages get added, and a rollback needs to be one command rather than a careful
sweep. So the tag placement is a script.

  python3 scripts/bot/inject_widget.py            # apply the policy below
  python3 scripts/bot/inject_widget.py --check    # report drift, change nothing
  python3 scripts/bot/inject_widget.py --remove   # pull the widget off every page

`--check` exits non-zero when a page's state disagrees with the policy, so it
can gate CI once a new page is added without the tag.

This script owns PRESENCE only, never the ?v= query — that belongs to
scripts/asset-versions.mjs, which derives it from the asset's own bytes. Same
contract as scripts/inject_attribution.py, and for the same reason: a
hand-maintained version here overwrites the content hash and re-points every
page at a version that does not match the file. Inject bare, then run
`node scripts/asset-versions.mjs` to stamp any newly added tag.

Rollback note: removing the tag needs a deploy. The instant kill is the
`SITE_CHAT_ENABLED=false` env var, which 503s the endpoint and makes the
widget hide itself with no deploy at all. Reach for that first.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parents[2]
# Deliberately no ?v= — see the module docstring. asset-versions.mjs stamps it.
TAG = '  <script defer src="/assets/js/chat-widget.js"></script>\n'
# Matches the tag at ANY version (or none), so presence and idempotence never
# depend on the query string.
TAG_RE = re.compile(r'[ \t]*<script[^>]*src="/assets/js/chat-widget\.js[^"]*"[^>]*></script>\n?')

# Pages that deliberately do NOT get the widget, and why. Everything else
# public gets it — the bot is only useful where prospects actually land.
EXCLUDE = {
    "r/index.html": "referral redemption landing — single-CTA conversion page, "
                    "the visitor arrives with intent and a chat bubble only competes with it",
    "thanks.html": "post-conversion confirmation; nothing left to ask, and it "
                   "fires a Meta Lead event we should not clutter",
    "delete-account.html": "someone here has decided to leave. Offering a chat "
                           "bubble reads as friction in front of a data-subject right.",
}

# Certificate pages are public verification views for real artworks. They are
# reached by scanning a QR or tapping an NFC tag on a physical work, often by
# someone who is not a user at all — exactly the curious stranger the bot is
# for. Include them.


def targets() -> list[Path]:
    out = []
    for p in sorted(SITE.rglob("*.html")):
        rel = p.relative_to(SITE).as_posix()
        if rel.startswith((".git/", ".claude/", "node_modules/", "legacy/")):
            continue
        out.append(p)
    return out


def wanted(rel: str) -> bool:
    return rel not in EXCLUDE


def apply(path: Path, want: bool) -> str:
    """Return 'added' | 'removed' | 'ok' | 'no-body'."""
    text = path.read_text(encoding="utf-8")
    present = TAG_RE.search(text)

    if want and not present:
        if "</body>" not in text:
            return "no-body"
        path.write_text(text.replace("</body>", TAG + "</body>", 1), encoding="utf-8")
        return "added"

    if want and present:
        return "ok"  # already there — whatever ?v= it carries is not ours to touch

    if not want and present:
        path.write_text(TAG_RE.sub("", text), encoding="utf-8")
        return "removed"

    return "ok"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="report drift, change nothing")
    ap.add_argument("--remove", action="store_true", help="strip the widget from every page")
    args = ap.parse_args()

    counts: dict[str, int] = {}
    drift: list[str] = []

    for path in targets():
        rel = path.relative_to(SITE).as_posix()
        want = False if args.remove else wanted(rel)

        if args.check:
            present = bool(TAG_RE.search(path.read_text(encoding="utf-8")))
            state = "ok" if present == want else ("missing" if want else "unexpected")
            if state != "ok":
                drift.append(f"  {state:<11} {rel}")
            counts[state] = counts.get(state, 0) + 1
            continue

        result = apply(path, want)
        counts[result] = counts.get(result, 0) + 1
        if result not in ("ok",):
            print(f"  {result:<9} {rel}")

    print("\n" + "  ".join(f"{k}={v}" for k, v in sorted(counts.items())))

    if args.check and drift:
        print("\nDrift from policy:")
        print("\n".join(drift))
        print("\nRun without --check to fix.")
        sys.exit(1)

    if not args.check and not args.remove:
        print(f"\nexcluded on purpose ({len(EXCLUDE)}):")
        for rel, why in EXCLUDE.items():
            print(f"  {rel} — {why}")


if __name__ == "__main__":
    main()
