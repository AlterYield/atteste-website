#!/usr/bin/env python3
"""Keep consent.js on the right pages, and only the right pages.

Sibling of scripts/inject_attribution.py and scripts/bot/inject_widget.py, but
this one is a privacy control as well as a coverage tag. It fails both ways:

  a marketing page without the tag has no banner, GA or Pixel, silently
  a private page WITH the tag can hand a person's URL to Google and Meta

  python3 scripts/inject_consent.py            # apply the policy below
  python3 scripts/inject_consent.py --check    # report drift, change nothing

`--check` exits non-zero on drift and gates CI (.github/workflows/asset-versions.yml).
It also fails if anything but assets/js/consent.js references the Meta Pixel,
if a tag carries a bad click event, or if the CSP stops allowing the Pixel.

The default is deliberate: a NEW page is treated as marketing and must carry
the tag. Deciding a page is private means adding it to EXCLUDE with a reason.

This script owns PRESENCE and data-* attributes, never the ?v= query, which
belongs to scripts/asset-versions.mjs. Inject bare, then run
`node scripts/asset-versions.mjs` to stamp any newly added tag.

Generated pages carry the tag in their generator, so a rebuild cannot drop it:
scripts/coa/build.py (coa/), scripts/build-notes.py (notes/). index.html copies
its head from classic.html (scripts/landing/build.py).
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parents[1]
TAG_RE = re.compile(
    r'[ \t]*<script\b[^>]*?\bsrc="(/assets/js/consent\.js[^"]*)"([^>]*)></script>\n?'
)
COMMENT_RE = re.compile(r'[ \t]*<!-- Consent-gated[^>]*?-->\n?')
SKIP_DIRS = (".git/", ".claude/", "node_modules/", "legacy/", "docs/", "scripts/", "netlify/")

# Never load GA or the Pixel here. Both send the full URL and referrer, so the
# test is what the URL or the page says about a person, not whether the page is
# indexed. A page in here must not gain the tag or any data-fb-* attribute.
EXCLUDE = {
    "claim/index.html": "the certificate payload (artist, title, image hash) sits in the URL "
                        "fragment, and the Pixel sends location.href with the fragment on it",
    "delete-account.html": "data-subject right in progress; no tracking on someone leaving",
    "r/index.html": "/r/{code} puts a member's referral code in the path, identifying the inviter",
    "404.html": "the URL is whatever was typed or mis-pasted, tokens included; not a marketing page",
}
EXCLUDE_PREFIXES = {
    "cert/": "public certificate records of a named artist's work, not marketing",
}

# Policy pages: no banner over legal text, preferences centre only.
MANAGE_ONLY = {
    "ai-disclosure.html",
    "community-guidelines.html",
    "cookies.html",
    "legacy-disclaimer.html",
    "privacy.html",
    "refunds.html",
    "terms.html",
}

# Key product, pricing and COA pages fire ViewContent. The value is a fixed
# label sent as content_name, never anything from the visitor or the URL.
VIEW_CONTENT = {
    "index.html": "home",
    "classic.html": "home",
    "features.html": "features",
    "artists.html": "artists",
    "galleries.html": "galleries",
    "sell.html": "sell",
    "compare/art-galleria-alternative.html": "compare-art-galleria",
    "compare/artwork-archive-alternative.html": "compare-artwork-archive",
    "compare/artwork-archive-vs-art-galleria.html": "compare-artwork-archive-vs-art-galleria",
    "coa/index.html": "coa-generator",
    "coa/painting/index.html": "coa-painting",
    "coa/photography/index.html": "coa-photography",
    "coa/prints/index.html": "coa-prints",
    "coa/sculpture/index.html": "coa-sculpture",
}

# Only consent.js may touch the Pixel. fbq in a page would bypass the opt-in.
PIXEL_REF_RE = re.compile(r'\bfbq\b|\b_fbq\b|fbevents|connect\.facebook\.net|facebook\.com/tr\b')
CLICK_RE = re.compile(r'\bdata-fb-click="([^"]*)"')
FB_ATTR_RE = re.compile(r'\bdata-fb-(?:click|events|content)\b')
FOOTER_RE = re.compile(r'<footer\b')
EVENT_NAME_RE = re.compile(r'^[A-Za-z][A-Za-z0-9]{1,39}$')

# (CSP directive, host) pairs the Pixel needs. _headers is the only CSP here.
CSP_NEEDS = (
    ("script-src", "https://connect.facebook.net"),
    ("connect-src", "https://www.facebook.com"),
    ("img-src", "https://www.facebook.com"),
)


def exclusion(rel: str) -> str | None:
    if rel in EXCLUDE:
        return EXCLUDE[rel]
    for prefix, reason in EXCLUDE_PREFIXES.items():
        if rel.startswith(prefix):
            return reason
    return None


def wanted_attrs(rel: str) -> str:
    """The attributes this page's tag must carry, in canonical order."""
    if rel in MANAGE_ONLY:
        return " data-manage-only"
    if rel == "thanks.html":
        return ' data-fb-events="Lead"'
    if rel in VIEW_CONTENT:
        return f' data-fb-events="ViewContent" data-fb-content="{VIEW_CONTENT[rel]}"'
    return ""


def audit_page(rel: str, text: str) -> list[str]:
    """Every way this page disagrees with the policy."""
    problems = []
    match = TAG_RE.search(text)

    if exclusion(rel):
        if match:
            problems.append(f"forbidden   {rel}: loads consent.js ({exclusion(rel)})")
        if FB_ATTR_RE.search(text):
            problems.append(f"forbidden   {rel}: carries a data-fb-* attribute")
    else:
        if not match:
            problems.append(f"missing     {rel}: no consent.js")
        elif match.group(2).rstrip() != wanted_attrs(rel):
            problems.append(f"attributes  {rel}: has '{match.group(2).strip()}', "
                            f"policy wants '{wanted_attrs(rel).strip()}'")
        if not FOOTER_RE.search(text):
            problems.append(f"no-footer   {rel}: consent.js adds the Cookie preferences link "
                            "to the <footer>, and this page has none")

    for name in CLICK_RE.findall(text):
        if not EVENT_NAME_RE.match(name):
            problems.append(f"click       {rel}: bad event name {name!r}")
    if PIXEL_REF_RE.search(text):
        problems.append(f"pixel-ref   {rel}: references the Pixel outside consent.js")
    return problems


def audit_script(rel: str, text: str) -> list[str]:
    if rel == "assets/js/consent.js" or not PIXEL_REF_RE.search(text):
        return []
    return [f"pixel-ref   {rel}: references the Pixel outside consent.js"]


def audit_csp(headers: str) -> list[str]:
    match = re.search(r'Content-Security-Policy:(.*)', headers)
    if not match:
        return []  # no CSP means nothing to allow
    directives = {d.strip().split(" ")[0]: d for d in match.group(1).split(";")}
    return [f"csp         _headers: {name} must allow {host}"
            for name, host in CSP_NEEDS if host not in directives.get(name, "")]


def apply(rel: str, path: Path) -> str:
    """Return 'added' | 'removed' | 'updated' | 'ok' | 'no-head'."""
    text = path.read_text(encoding="utf-8")
    match = TAG_RE.search(text)

    if exclusion(rel):
        if not match:
            return "ok"
        path.write_text(COMMENT_RE.sub("", TAG_RE.sub("", text)), encoding="utf-8")
        return "removed"
    if not match:
        if "</head>" not in text:
            return "no-head"
        tag = f'<script defer src="/assets/js/consent.js"{wanted_attrs(rel)}></script>\n'
        path.write_text(text.replace("</head>", tag + "</head>", 1), encoding="utf-8")
        return "added"
    if match.group(2).rstrip() != wanted_attrs(rel):
        tag = f'<script defer src="{match.group(1)}"{wanted_attrs(rel)}></script>\n'
        path.write_text(text[:match.start()] + tag + text[match.end():], encoding="utf-8")
        return "updated"
    return "ok"


def pages() -> list[tuple[str, Path]]:
    out = []
    for path in sorted(SITE.rglob("*.html")):
        rel = path.relative_to(SITE).as_posix()
        if not rel.startswith(SKIP_DIRS):
            out.append((rel, path))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="report drift, change nothing")
    args = ap.parse_args()

    if not args.check:
        counts: dict[str, int] = {}
        for rel, path in pages():
            result = apply(rel, path)
            counts[result] = counts.get(result, 0) + 1
            if result != "ok":
                print(f"  {result:<8} {rel}")
        print("\n" + "  ".join(f"{k}={v}" for k, v in sorted(counts.items())))
        print("Now run: node scripts/asset-versions.mjs")
        return

    problems: list[str] = []
    for rel, path in pages():
        problems += audit_page(rel, path.read_text(encoding="utf-8"))
    for path in sorted((SITE / "assets" / "js").glob("*.js")):
        problems += audit_script(path.relative_to(SITE).as_posix(), path.read_text(encoding="utf-8"))
    problems += audit_csp((SITE / "_headers").read_text(encoding="utf-8"))

    if problems:
        print("Consent policy violations:\n  " + "\n  ".join(problems))
        print("\nRun scripts/inject_consent.py to fix tags. A private page belongs in EXCLUDE.")
        sys.exit(1)
    print(f"OK: {len(pages())} pages match the consent policy; Pixel referenced only in consent.js")


if __name__ == "__main__":
    main()
