#!/usr/bin/env python3
"""Put the footer social links on every page that has a footer, idempotently.

Sibling of inject_attribution.py and inject_consent.py, for the same reason: a
block that belongs on every page does not survive as a hand-edit sweep. On
2026-11-12 the five profile links were on the homepage, features, artists and
galleries and on none of the legal, help, compare, notes or COA pages.

  python3 scripts/inject_social.py            # add the block where it is missing
  python3 scripts/inject_social.py --check    # report drift, change nothing

`--check` exits non-zero on drift and gates CI (.github/workflows/asset-versions.yml).
It also fails on a TikTok link, or a Facebook link to any Page but the one in
the source footer, anywhere on a page.

One source: the anchors are read from the footer of classic.html, the footer the
homepage build copies verbatim (scripts/landing/build.py). To add, remove or
re-point a profile, edit classic.html, rebuild the homepage, then run this
script. No link is typed twice, so no page can point at a different account.

Two footer shapes are handled:
  columns  <footer> with .footer-inner (site.css): a "Connect" column is added,
           the same one the homepage has.
  simple   anything else: the row becomes the first child of the footer, and
           the page's inline <style> gains FOOTER_CSS. A page with no inline
           <style> must link a stylesheet that styles the row (coa.css does).

The builders (scripts/build-notes.py, scripts/coa/build.py) pass each page
through apply(), so a rebuild keeps the block.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parents[1]
SOURCE = SITE / "classic.html"
SKIP_DIRS = (".git/", ".claude/", "node_modules/", "legacy/", "docs/", "scripts/", "netlify/")

# Pages with a footer that must NOT be touched by this script, each with a reason.
EXEMPT = {
    "privacy.html": "the privacy notice changes only through legal review; add the block "
                    "with the next reviewed version of the notice, not from this script",
}

# Never link these from any page, in a footer or anywhere else.
FORBIDDEN = {
    "tiktok.com": "Attesté has no TikTok presence to link",
}
# The only Facebook URLs a page may carry: the Page in the source footer, and
# Meta's own policy pages, which the notices cite. Any other facebook.com URL is
# a link to an account that is not Attesté's.
FACEBOOK_RE = re.compile(r'https?://(?:[\w-]+\.)?facebook\.com/[^\s"\'<>)]*')
FACEBOOK_OK_PATHS = ("policies/", "privacy/")

CSS_MARK = "/* Footer social links. Written by scripts/inject_social.py. */"
# Colour comes from the footer's own text colour, so one block reads correctly on
# the light legal and help pages, in their dark mode, and on the navy notes footer.
FOOTER_CSS = (
    CSS_MARK,
    ".att-social-row { display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin:0 0 1rem; }",
    ".att-social-row .att-social { display:inline-flex; align-items:center; justify-content:center; "
    "width:42px; height:42px; border-radius:50%; border:1px solid rgba(201,169,110,.6); "
    "background:none; box-shadow:none; color:inherit; }",
    ".att-social-row .att-social:hover, .att-social-row .att-social:focus-visible "
    "{ border-color:#c9a96e; background:rgba(201,169,110,.16); box-shadow:none; color:inherit; }",
    ".att-social-row .att-social svg { width:19px; height:19px; fill:currentColor; display:block; }",
    "@media print { .att-social-row { display:none; } }",
)

FOOTER_RE = re.compile(r"<footer\b[^>]*>")
ANCHOR_RE = re.compile(r'<a class="att-social"[^>]*>.*?</a>', re.S)
COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
LOCAL_CSS_RE = re.compile(r'<link[^>]*href="/?(assets/css/[\w.-]+\.css)')


def anchors(source: str | None = None) -> list[str]:
    """The profile links, verbatim, from the footer of classic.html."""
    html = SOURCE.read_text(encoding="utf-8") if source is None else source
    foot = footer_of(html) or ""
    found = ANCHOR_RE.findall(COMMENT_RE.sub("", foot))
    if not found:
        sys.exit(f"inject_social: no att-social links found in the footer of {SOURCE.name}")
    return found


def footer_of(html: str) -> str | None:
    m = FOOTER_RE.search(html)
    if not m:
        return None
    end = html.find("</footer>", m.end())
    return html[m.start():end if end != -1 else len(html)]


def row(indent: str, links: list[str]) -> str:
    lines = [f'{indent}<div class="att-social-row">']
    lines += [f"{indent}  {a}" for a in links]
    lines.append(f"{indent}</div>")
    return "\n".join(lines) + "\n"


def line_indent(html: str, pos: int) -> str:
    start = html.rfind("\n", 0, pos) + 1
    return re.match(r"[ \t]*", html[start:pos]).group(0)


def has_block(html: str, links: list[str]) -> bool:
    foot = footer_of(html)
    return foot is not None and all(a in foot for a in links)


def apply(html: str, links: list[str] | None = None) -> tuple[str, str]:
    """Return (html, 'added' | 'ok' | 'no-footer')."""
    links = anchors() if links is None else links
    m = FOOTER_RE.search(html)
    if not m:
        return html, "no-footer"
    if has_block(html, links):
        return html, "ok"
    end = html.find("</footer>", m.end())
    foot = html[m.start():end]

    if "footer-inner" in foot and 'class="footer-bottom"' in foot:
        # columns: close of .footer-inner is the last </div> before .footer-bottom
        bottom = m.start() + foot.index('<div class="footer-bottom"')
        close = html.rfind("</div>", m.end(), bottom)
        cols = re.findall(r'^([ \t]*)<div class="footer-col">', foot, re.M)
        ind = cols[-1] if cols else line_indent(html, close) + "  "
        column = (f'{ind}<div class="footer-col">\n{ind}  <h4>Connect</h4>\n'
                  + row(ind + "  ", links)
                  + f'{ind}  <a href="mailto:info@atteste.art">info@atteste.art</a>\n{ind}</div>\n')
        at = html.rfind("\n", 0, close) + 1
        return html[:at] + column + html[at:], "added"

    # simple: first child of the footer
    ind = line_indent(html, m.start()) + "  "
    block = row(ind, links)
    after = m.end()
    if html[after] == "\n":
        html = html[:after + 1] + block + html[after + 1:]
    else:  # the footer is written on one line
        html = html[:after] + "\n" + block + html[after:]
    style_end = html.find("</style>")
    if style_end != -1 and style_end < m.start() and CSS_MARK not in html:
        css_ind = line_indent(html, style_end) + "  "
        at = html.rfind("\n", 0, style_end) + 1
        html = html[:at] + "".join(f"{css_ind}{line}\n" for line in FOOTER_CSS) + html[at:]
    return html, "added"


def audit(rel: str, html: str, links: list[str], stylesheets: dict[str, str] | None = None) -> list[str]:
    """Problems on one page. stylesheets maps 'assets/css/x.css' to its text."""
    problems = []
    for needle, why in FORBIDDEN.items():
        if needle in html.lower():
            problems.append(f"forbidden   {rel}: contains {needle} ({why})")
    ours = {u.rstrip("/") for a in links for u in FACEBOOK_RE.findall(a)}
    for url in sorted(set(FACEBOOK_RE.findall(html))):
        path = url.split("facebook.com/", 1)[1]
        if url.rstrip("/") not in ours and not path.startswith(FACEBOOK_OK_PATHS):
            problems.append(f"forbidden   {rel}: links {url}, which is not the Facebook Page "
                            f"in the footer of {SOURCE.name}")
    foot = footer_of(html)
    if foot is None or rel in EXEMPT:
        return problems
    missing = [a for a in links if a not in foot]
    if missing:
        which = "" if len(missing) == len(links) else " (" + ", ".join(
            re.search(r'href="([^"]*)"', a).group(1) for a in missing) + ")"
        problems.append(f"missing     {rel}: footer lacks {len(missing)} of {len(links)} "
                        f"social links{which}")
        return problems
    linked = "".join((stylesheets or {}).get(p, "") for p in LOCAL_CSS_RE.findall(html))
    if ".att-social" not in html.replace('class="att-social', "") and ".att-social" not in linked:
        problems.append(f"unstyled    {rel}: the row is there but no CSS styles .att-social, "
                        "so the icons would render at full width")
    return problems


def targets() -> list[tuple[str, Path]]:
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

    links = anchors()
    sheets = {p.relative_to(SITE).as_posix(): p.read_text(encoding="utf-8")
              for p in (SITE / "assets" / "css").glob("*.css")}
    counts: dict[str, int] = {}
    problems: list[str] = []
    for rel, path in targets():
        html = path.read_text(encoding="utf-8")
        if not args.check and rel not in EXEMPT:
            new, status = apply(html, links)
            if status == "added":
                path.write_text(new, encoding="utf-8")
                html = new
                print(f"  added  {rel}")
        else:
            status = "exempt" if rel in EXEMPT else ("ok" if has_block(html, links) else
                                                     "no-footer" if footer_of(html) is None else "missing")
        counts[status] = counts.get(status, 0) + 1
        problems += audit(rel, html, links, sheets)

    print("  ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    for rel, why in EXEMPT.items():
        print(f"  exempt {rel}: {why}")
    if problems:
        print("\n" + "\n".join(problems), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
