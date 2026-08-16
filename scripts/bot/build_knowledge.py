#!/usr/bin/env python3
"""Build the site bot's knowledge pack from the site's own source.

Phase 0 of the atteste.art onboarding bot. Design doc:
  Brain wiki/concepts/atteste-site-onboarding-bot-stack.md

Why a build step instead of a crawler: the site is static HTML in git, so the
bot's knowledge can be generated from the same commit that ships the pages.
That makes it versioned, reviewable in a PR, and structurally unable to drift
from the site. A hosted bot re-crawls on a timer and is stale by construction.

Inputs
  - the public HTML pages listed in PAGES (headings + prose, no CSS/JS/nav)
  - the two Promise Ledgers in ~/Projects/Atteste/contracts/
  - tier_pricing out of those same ledgers (never hand-mirrored)

Output
  scripts/bot/knowledge.json — chunks + pricing + a NEVER_CLAIM list.

  It lands under scripts/ deliberately: `_redirects` 404s /scripts/*, so the
  pack is not publicly fetchable. That matters because NEVER_CLAIM enumerates
  what we have NOT built, which is not something to serve to competitors.

Usage
  python3 scripts/bot/build_knowledge.py            # write knowledge.json
  python3 scripts/bot/build_knowledge.py --stats    # report sizes, write nothing
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from html import unescape
from pathlib import Path

import yaml

SITE = Path(__file__).resolve().parents[2]
OUT = SITE / "scripts" / "bot" / "knowledge.json"

LEDGER_DIR = Path(
    os.environ.get("ATTESTE_CONTRACTS", Path.home() / "Projects/Atteste/contracts")
)

# Pages the bot may ground answers in, with the audience each one serves.
# `weight` is a nudge for the retrieval stage added in v2 — unused in Phase 0,
# where the whole pack goes into every prompt.
PAGES: list[tuple[str, str, str]] = [
    ("help/index.html", "help", "all"),
    ("help/getting-started-collectors.html", "help", "collector"),
    ("help/getting-started-artists.html", "help", "artist"),
    ("help/getting-started-galleries.html", "help", "gallery"),
    ("help/provenance-and-certificates.html", "help", "all"),
    ("help/nfc-tags.html", "help", "all"),
    ("help/ai-features.html", "help", "all"),
    ("help/subscriptions-and-billing.html", "help", "all"),
    ("help/account-and-data.html", "help", "all"),
    ("help/gallery-tools.html", "help", "gallery"),
    ("help/troubleshooting.html", "help", "all"),
    ("help/contact.html", "help", "all"),
    ("glossary.html", "reference", "all"),
    ("features.html", "marketing", "all"),
    ("artists.html", "marketing", "artist"),
    ("galleries.html", "marketing", "gallery"),
    ("index.html", "marketing", "collector"),
    ("compare/artwork-archive-alternative.html", "compare", "all"),
    ("compare/art-galleria-alternative.html", "compare", "all"),
    ("compare/artwork-archive-vs-art-galleria.html", "compare", "all"),
]

# Statuses a claim must hold before the bot may state it as fact.
CLAIMABLE = {"live", "shipping"}

BLOCK_TAGS = re.compile(
    r"<(script|style|svg|noscript|template)\b[^>]*>.*?</\1>", re.S | re.I
)
NAV_TAGS = re.compile(r"<(nav|footer|header)\b[^>]*>.*?</\1>", re.S | re.I)
HEADING = re.compile(r"<h([1-6])\b[^>]*>(.*?)</h\1>", re.S | re.I)
TAG = re.compile(r"<[^>]+>")
WS = re.compile(r"[ \t\r\f\v]+")
BLANKS = re.compile(r"\n{3,}")


def text_of(fragment: str) -> str:
    """HTML fragment -> readable plain text."""
    fragment = re.sub(r"<(br|/p|/li|/div|/h[1-6])\s*/?>", "\n", fragment, flags=re.I)
    fragment = re.sub(r"<li\b[^>]*>", "\n- ", fragment, flags=re.I)
    out = unescape(TAG.sub(" ", fragment))
    out = WS.sub(" ", out)
    out = "\n".join(line.strip() for line in out.split("\n"))
    return BLANKS.sub("\n\n", out).strip()


def page_title(html: str, fallback: str) -> str:
    m = re.search(r"<title\b[^>]*>(.*?)</title>", html, re.S | re.I)
    if not m:
        return fallback
    # "Help Centre — Attesté" -> "Help Centre"
    return re.split(r"\s+[—|]\s+", unescape(TAG.sub("", m.group(1))).strip())[0].strip()


def url_for(rel: str) -> str:
    path = rel[: -len("index.html")] if rel.endswith("index.html") else rel
    if path.endswith(".html"):
        path = path[: -len(".html")]
    return f"https://atteste.art/{path}".rstrip("/") or "https://atteste.art/"


def chunk_page(rel: str, kind: str, audience: str) -> list[dict]:
    """Split one page into section-sized chunks on its h2 boundaries.

    Sections, not whole pages: it keeps citations precise and gives the v2
    retrieval stage something granular to score. Phase 0 sends them all.
    """
    raw = (SITE / rel).read_text(encoding="utf-8")
    body = NAV_TAGS.sub(" ", BLOCK_TAGS.sub(" ", raw))
    title = page_title(raw, rel)
    url = url_for(rel)

    marks = [(m.start(), m.end(), int(m.group(1)), text_of(m.group(2))) for m in HEADING.finditer(body)]
    splits = [m for m in marks if m[2] == 2] or marks[:1]

    chunks: list[dict] = []
    for i, (start, end, _lvl, heading) in enumerate(splits):
        stop = splits[i + 1][0] if i + 1 < len(splits) else len(body)
        section = text_of(body[end:stop])
        if len(section) < 60:  # nav stubs, empty shells
            continue
        chunks.append(
            {
                "id": f"{rel}#{i}",
                "page": rel,
                "url": url,
                "title": title,
                "heading": heading,
                "kind": kind,
                "audience": audience,
                "text": section,
            }
        )

    if not chunks:  # page with no usable h2 — keep it whole rather than lose it
        section = text_of(body)
        if len(section) >= 60:
            chunks.append(
                {
                    "id": f"{rel}#0",
                    "page": rel,
                    "url": url,
                    "title": title,
                    "heading": title,
                    "kind": kind,
                    "audience": audience,
                    "text": section,
                }
            )
    return chunks


def load_ledgers() -> tuple[list[dict], list[dict], dict]:
    """Return (claimable, never_claim, pricing) from both Promise Ledgers.

    The ledger is the authority on what the bot may say, and on prices. The
    site's own copy is NOT — see the standing rule that an RC flag flip is not
    a deploy: a feature can be `live` on main and absent from every device.
    """
    claimable: list[dict] = []
    never: list[dict] = []
    pricing: dict = {}

    for name, audience in (("gallery-promises.yaml", "gallery"), ("artist-promises.yaml", "artist")):
        path = LEDGER_DIR / name
        if not path.exists():
            sys.exit(
                f"FATAL: Promise Ledger missing at {path}.\n"
                "The bot must not be built without it — an ungrounded bot will invent features.\n"
                "Set ATTESTE_CONTRACTS to the contracts/ directory."
            )
        doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        pricing[audience] = {
            "tiers": doc.get("tier_pricing", {}),
            "ledger_version": doc.get("version"),
            "last_audit": str(doc.get("last_audit", "")),
        }
        for p in doc.get("promises", []) or []:
            entry = {
                "id": p.get("id"),
                "audience": audience,
                "status": p.get("status"),
                "claim": (p.get("promise") or "").strip(),
                "category": p.get("category"),
            }
            (claimable if p.get("status") in CLAIMABLE else never).append(entry)

    return claimable, never, pricing


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stats", action="store_true", help="report sizes, write nothing")
    args = ap.parse_args()

    chunks: list[dict] = []
    for rel, kind, audience in PAGES:
        if not (SITE / rel).exists():
            print(f"  ! missing, skipped: {rel}", file=sys.stderr)
            continue
        chunks.extend(chunk_page(rel, kind, audience))

    claimable, never, pricing = load_ledgers()

    words = sum(len(c["text"].split()) for c in chunks)
    pack = {
        "generated_from": "atteste-website @ build time",
        "chunk_count": len(chunks),
        "word_count": words,
        # ~1.33 tokens/word is the usual English ballpark; this is a budget
        # signal for the prompt, not an accounting figure.
        "approx_tokens": round(words * 1.33),
        "pricing": pricing,
        "claimable": claimable,
        "never_claim": never,
        "chunks": chunks,
    }

    print(f"pages     {len(PAGES)}")
    print(f"chunks    {len(chunks)}")
    print(f"words     {words:,}  (~{pack['approx_tokens']:,} tokens)")
    print(f"claimable {len(claimable)}   never_claim {len(never)}")
    for e in never:
        print(f"  NEVER   [{e['status']:>8}] {e['id']}")

    if args.stats:
        return

    OUT.write_text(json.dumps(pack, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nwrote {OUT.relative_to(SITE)}  ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
