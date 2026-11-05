#!/usr/bin/env python3
"""Proves scripts/inject_consent.py --check fails when it should. A guard that
has never been seen to fail is not a guard. Needs no network or browser."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from inject_consent import PIXEL_DISCLOSURE, audit_csp, audit_notice, audit_page, audit_script  # noqa: E402

FOOT = "<footer></footer>"
NO_FOOT = '<head><script defer src="/assets/js/consent.js?v=abc"></script></head>'
BARE = NO_FOOT + FOOT
MANAGE = '<head><script defer src="/assets/js/consent.js?v=abc" data-manage-only></script></head>' + FOOT
VIEW = ('<head><script defer src="/assets/js/consent.js?v=abc" data-fb-events="ViewContent" '
        'data-fb-content="features"></script></head>' + FOOT)
NONE = "<head></head>"
CSP = ("Content-Security-Policy: default-src 'self'; script-src 'self' https://connect.facebook.net; "
       "img-src https://www.facebook.com; connect-src https://www.facebook.com")
NOTICE = " ".join(PIXEL_DISCLOSURE)
BANNER = "details from those pages"

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
    ("COA generator stays clean", audit_page("coa/index.html", NONE), ""),
    ("COA generator gains the tag", audit_page("coa/index.html", BARE), "forbidden"),
    ("referral lander gains the tag", audit_page("r/index.html", BARE), "forbidden"),
    ("404 gains the tag", audit_page("404.html", BARE), "forbidden"),
    ("a new cert page gains the tag", audit_page("cert/abc.html", BARE), "forbidden"),
    ("private page gains a click event",
     audit_page("cert/abc.html", '<a data-fb-click="Lead">x</a>'), "forbidden"),
    ("privacy notice is manage-only", audit_page("privacy.html", MANAGE), ""),
    ("privacy notice shows the banner", audit_page("privacy.html", BARE), "attributes"),
    ("privacy notice loses the tag", audit_page("privacy.html", NONE + FOOT), "missing"),
    ("page with the banner has no footer", audit_page("help/index.html", NO_FOOT), "no-footer"),
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
    ("login on a pixel page", audit_page("help/index.html", BARE + '<input id="p" type="password">'), "private-ui"),
    ("file picker on a pixel page", audit_page("help/index.html", BARE + '<input type="file">'), "private-ui"),
    ("email form on a pixel page is fine", audit_page("help/index.html", BARE + '<input type="email">'), ""),
    ("notice carries the disclosure", audit_notice("privacy.html", NOTICE), ""),
    ("cookie policy carries it", audit_notice("cookies.html", NOTICE), ""),
    ("notice loses extra page details",
     audit_notice("privacy.html", NOTICE.replace("Extra page details.", "")), "disclosure"),
    ("cookie policy loses on-device measurement",
     audit_notice("cookies.html", NOTICE.replace("Measuring ads on your device.", "")), "disclosure"),
    ("old promise comes back", audit_notice("privacy.html", NOTICE + " We do not send Meta your name"), "disclosure"),
    ("notice loses the automatic data paragraph",
     audit_notice("privacy.html", NOTICE.replace("Automatic button and page data.", "")), "disclosure"),
    ("cookie policy loses the form sentence",
     audit_notice("cookies.html", NOTICE.replace("It does not send what you type into a form.", "")), "disclosure"),
    ("switched-off line comes back",
     audit_notice("cookies.html", NOTICE + " We have switched off Meta's automatic form and button capture"), "disclosure"),
    ("banner names the new data", audit_notice("assets/js/consent.js", BANNER), ""),
    ("banner loses the new data", audit_notice("assets/js/consent.js", "the pages you view"), "disclosure"),
    ("autoConfig false comes back",
     audit_notice("assets/js/consent.js", BANNER + " window.fbq('set', 'autoConfig', false, ID)"), "disclosure"),
    ("stored consent version goes back",
     audit_notice("assets/js/consent.js", BANNER + " var STORAGE_KEY = 'atteste_consent_v1'"), "disclosure"),
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
