#!/usr/bin/env python3
"""Proves scripts/inject_consent.py --check fails when it should. A guard that
has never been seen to fail is not a guard. Needs no network or browser."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from inject_consent import audit_csp, audit_page, audit_script  # noqa: E402

BARE = '<head><script defer src="/assets/js/consent.js?v=abc"></script></head>'
MANAGE = '<head><script defer src="/assets/js/consent.js?v=abc" data-manage-only></script></head>'
VIEW = ('<head><script defer src="/assets/js/consent.js?v=abc" data-fb-events="ViewContent" '
        'data-fb-content="features"></script></head>')
NONE = "<head></head>"
CSP = ("Content-Security-Policy: default-src 'self'; script-src 'self' https://connect.facebook.net; "
       "img-src https://www.facebook.com; connect-src https://www.facebook.com")

CASES = [
    # name, problems found, the word expected in them ("" = must be clean)
    ("marketing page with the tag", audit_page("help/index.html", BARE), ""),
    ("marketing page without it", audit_page("help/index.html", NONE), "missing"),
    ("a brand-new page defaults to marketing", audit_page("new-page.html", NONE), "missing"),
    ("key page keeps ViewContent", audit_page("features.html", VIEW), ""),
    ("key page loses ViewContent", audit_page("features.html", BARE), "attributes"),
    ("policy page manage-only", audit_page("terms.html", MANAGE), ""),
    ("policy page shows the banner", audit_page("terms.html", BARE), "attributes"),
    ("thanks page loses Lead", audit_page("thanks.html", BARE), "attributes"),
    ("private page stays clean", audit_page("delete-account.html", NONE), ""),
    ("private page gains the tag", audit_page("delete-account.html", BARE), "forbidden"),
    ("claim page gains the tag", audit_page("claim/index.html", BARE), "forbidden"),
    ("referral lander gains the tag", audit_page("r/index.html", BARE), "forbidden"),
    ("404 gains the tag", audit_page("404.html", BARE), "forbidden"),
    ("a new cert page gains the tag", audit_page("cert/abc.html", BARE), "forbidden"),
    ("private page gains a click event",
     audit_page("cert/abc.html", '<a data-fb-click="Lead">x</a>'), "forbidden"),
    ("privacy.html held for PR #36, tag absent", audit_page("privacy.html", NONE), ""),
    ("privacy.html held for PR #36, tag present", audit_page("privacy.html", MANAGE), ""),
    ("inline fbq in a page", audit_page("help/index.html", BARE + "<script>fbq('init')</script>"), "pixel-ref"),
    ("noscript beacon in a page",
     audit_page("help/index.html", BARE + '<img src="https://www.facebook.com/tr?id=1">'), "pixel-ref"),
    ("fbevents loaded by a page",
     audit_page("help/index.html", BARE + '<script src="https://connect.facebook.net/en_US/fbevents.js">'),
     "pixel-ref"),
    ("bad click event name", audit_page("help/index.html", BARE + '<a data-fb-click="a b">x</a>'), "click"),
    ("good click event name", audit_page("help/index.html", BARE + '<a data-fb-click="Contact">x</a>'), ""),
    ("fbq in another script", audit_script("assets/js/chat-widget.js", "window.fbq('track')"), "pixel-ref"),
    ("fbq in consent.js is the rule", audit_script("assets/js/consent.js", "window.fbq('track')"), ""),
    ("CSP allows the Pixel", audit_csp(CSP), ""),
    ("CSP drops the Pixel script host", audit_csp(CSP.replace("https://connect.facebook.net", "")), "csp"),
    ("CSP drops the beacon host", audit_csp(CSP.replace("connect-src https://www.facebook.com", "connect-src 'self'")), "csp"),
]

failed = 0
for name, problems, expected in CASES:
    ok = not problems if not expected else any(expected in p for p in problems)
    if not ok:
        failed += 1
        print(f"FAIL  {name}: expected {expected or 'no problems'!r}, got {problems}")

print(f"{len(CASES) - failed}/{len(CASES)} guard cases pass")
sys.exit(1 if failed else 0)
