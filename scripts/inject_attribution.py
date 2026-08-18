#!/usr/bin/env python3
"""Add or remove the attribution pass-through tag across the site, idempotently.

Sibling of scripts/bot/inject_widget.py, and it exists for the same reason:
a tag that must be on every page cannot survive as a hand-edit sweep. Pages get
added, and a page that silently misses this script silently loses acquisition
data — which is exactly the failure that made the atteste.art → app hop
unattributable in the first place.

  python3 scripts/inject_attribution.py            # apply the policy below
  python3 scripts/inject_attribution.py --check    # report drift, change nothing
  python3 scripts/inject_attribution.py --remove   # pull it off every page

`--check` exits non-zero on drift and gates CI (.github/workflows/asset-versions.yml).

This script owns PRESENCE only, never the ?v= query — that belongs to
scripts/asset-versions.mjs, which derives it from the asset's own bytes. Two
owners for one string is how it goes stale: a hand-maintained VERSION here used
to overwrite the content hash and quietly re-point every page at a version that
does not match the file. So the tag is injected bare and left alone thereafter;
run `node scripts/asset-versions.mjs` afterwards to stamp any newly added tag.

Policy: EVERY public page, no exclusions. Deliberately unlike the chat widget,
which skips a few pages because a chat bubble competes with a single-CTA
conversion flow. This script renders nothing and costs the visitor nothing —
and the pages the widget skips (the referral lander above all) are precisely
the high-intent pages whose source is most worth keeping.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parents[1]
# Deliberately no ?v= — see the module docstring. asset-versions.mjs stamps it.
TAG = '  <script defer src="/assets/js/attribution.js"></script>\n'
# Matches the tag at ANY version (or none), so presence and idempotence never
# depend on the query string.
TAG_RE = re.compile(
    r'[ \t]*<script[^>]*src="/assets/js/attribution\.js[^"]*"[^>]*></script>\n?'
)

SKIP_DIRS = (".git/", ".claude/", "node_modules/", "legacy/")


def targets() -> list[Path]:
    out = []
    for p in sorted(SITE.rglob("*.html")):
        rel = p.relative_to(SITE).as_posix()
        if rel.startswith(SKIP_DIRS):
            continue
        out.append(p)
    return out


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
    ap.add_argument("--remove", action="store_true", help="strip the tag from every page")
    args = ap.parse_args()

    counts: dict[str, int] = {}
    drift: list[str] = []

    for path in targets():
        rel = path.relative_to(SITE).as_posix()
        want = not args.remove

        if args.check:
            present = bool(TAG_RE.search(path.read_text(encoding="utf-8")))
            state = "ok" if present == want else ("missing" if want else "unexpected")
            if state != "ok":
                drift.append(f"  {state:<11} {rel}")
            counts[state] = counts.get(state, 0) + 1
            continue

        result = apply(path, want)
        counts[result] = counts.get(result, 0) + 1
        if result != "ok":
            print(f"  {result:<9} {rel}")

    print("\n" + "  ".join(f"{k}={v}" for k, v in sorted(counts.items())))

    if args.check and drift:
        print("\nDrift from policy:")
        print("\n".join(drift))
        print("\nRun without --check to fix.")
        sys.exit(1)


if __name__ == "__main__":
    main()
