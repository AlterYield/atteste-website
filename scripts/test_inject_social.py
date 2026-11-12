#!/usr/bin/env python3
"""Proves scripts/inject_social.py adds the block once and --check fails when it
should. A guard that has never been seen to fail is not a guard. No network."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from inject_social import CSS_MARK, anchors, apply, audit  # noqa: E402

LINKS = anchors()
ROW = '<div class="att-social-row">' + "".join(LINKS) + "</div>"
STYLE = "<head><style>\n  footer { color: #333; }\n</style></head>"
PLAIN = STYLE + "<body>\n    <footer>\n      <p>Operator</p>\n    </footer>\n</body>"
ONE_LINE = STYLE + '<body>\n<footer class="footer">Text <a href="/">home</a></footer>\n</body>'
COLUMNS = ('<head><link rel="stylesheet" href="/assets/css/site.css?v=1"></head><body>\n<footer class="footer">\n'
           '  <div class="footer-inner">\n    <div class="footer-col">\n      <h4>Legal</h4>\n    </div>\n  </div>\n'
           '  <div class="footer-bottom">\n    <div>&copy;</div>\n  </div>\n</footer>\n</body>')
NO_STYLE = '<head><link rel="stylesheet" href="/assets/css/coa.css?v=1"></head><body><footer class="coa-foot"><p>x</p></footer></body>'
SHEETS = {"assets/css/site.css": ".att-social-row .att-social { }", "assets/css/coa.css": ".att-social-row { }",
          "assets/css/bare.css": "body { }"}


def applied(html):
    return apply(html, LINKS)[0]


def has(problems, word):
    return any(p.startswith(word) for p in problems) if word else not problems


plain, one_line, columns = applied(PLAIN), applied(ONE_LINE), applied(COLUMNS)
CASES = [
    # name, passed
    ("the source footer yields five links", len(LINKS) == 5),
    ("no link is a placeholder or commented out", not any("REPLACE_" in a for a in LINKS)),
    ("every link opens safely with a label",
     all('rel="noopener"' in a and 'target="_blank"' in a and "aria-label=" in a for a in LINKS)),
    ("plain footer gains the row and its CSS", "att-social-row" in plain and CSS_MARK in plain
     and audit("terms.html", plain, LINKS) == []),
    ("row is the first child of a plain footer", plain.index("att-social-row") < plain.index("<p>Operator")),
    ("one-line footer keeps its text after the row",
     one_line.index("att-social-row\"") < one_line.index("Text <a") and audit("notes/x.html", one_line, LINKS) == []),
    ("columns footer gains a Connect column inside .footer-inner",
     "<h4>Connect</h4>" in columns and columns.index("<h4>Connect</h4>") < columns.index("footer-bottom")
     and CSS_MARK not in columns and audit("compare/x.html", columns, LINKS, SHEETS) == []),
    ("applying twice changes nothing", applied(plain) == plain and applied(columns) == columns
     and apply(plain, LINKS)[1] == "ok"),
    ("a page without a footer is left alone", apply("<body></body>", LINKS) == ("<body></body>", "no-footer")),
    ("check: footer without the links fails", has(audit("terms.html", PLAIN, LINKS), "missing")),
    ("check: one link re-pointed fails",
     has(audit("terms.html", plain.replace("instagram.com/attesteart", "instagram.com/other"), LINKS), "missing")),
    ("check: links outside the footer do not count",
     has(audit("terms.html", ROW + PLAIN, LINKS), "missing")),
    ("check: the privacy notice is exempt", audit("privacy.html", PLAIN, LINKS) == []),
    ("check: page without a footer passes", audit("404.html", "<body></body>", LINKS) == []),
    ("check: row with no CSS anywhere fails",
     has(audit("coa/index.html", applied(NO_STYLE).replace("coa.css", "bare.css"), LINKS, SHEETS), "unstyled")),
    ("check: row styled by a linked stylesheet passes", audit("coa/index.html", applied(NO_STYLE), LINKS, SHEETS) == []),
    ("check: a TikTok link fails anywhere", has(audit("404.html", '<a href="https://www.tiktok.com/@x">', LINKS), "forbidden")),
    ("check: a Facebook link to any other Page fails",
     has(audit("terms.html", plain + '<a href="https://www.facebook.com/1234567890">', LINKS), "forbidden")),
    ("check: a mobile Facebook link to another Page fails",
     has(audit("404.html", '<a href="https://m.facebook.com/someoneelse/">', LINKS), "forbidden")),
    ("check: Meta's own policy pages are allowed",
     audit("terms.html", plain + '<a href="https://www.facebook.com/privacy/policy/">x</a>'
           '<a href="https://www.facebook.com/policies/cookies/">y</a>', LINKS) == []),
    ("check: the privacy notice is not exempt from forbidden links",
     has(audit("privacy.html", '<a href="https://tiktok.com/@x">', LINKS), "forbidden")),
]

failed = [name for name, ok in CASES if not ok]
for name, ok in CASES:
    print(("ok    " if ok else "FAIL  ") + name)
print(f"\n{len(CASES) - len(failed)}/{len(CASES)} passed")
sys.exit(1 if failed else 0)
