#!/usr/bin/env python3
"""build-notes.py — generate the Atelier Journal (atteste.art/notes/).

Reads notes/notes.json and writes one page per note with "published": true,
plus notes/index.html listing them (newest first). Pages are self-contained
(inline styles, site design tokens) like every other page in this repo.

Governance (do not weaken):
- A note enters notes.json ONLY after Karel approves it on the Brain week
  queue (wiki/_atelier-notes-week1.json contract). This repo is PUBLIC —
  unapproved artist content must never be committed here, main or branch.
- The read is containment-guarded upstream (every proper noun byte-verified
  against the CC store row). Never edit a read here; regenerate upstream.
- No prices, valuations, sales or condition claims — editorial only.
- Takedown: set "published": false, rerun, commit — the page 410s via
  _redirects if listed there, or simply disappears from index; also add the
  artist to the loop's doNotContact. Same-day.

Usage:  python3 scripts/build-notes.py   (from repo root or scripts/)
"""
import html
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOTES_DIR = os.path.join(ROOT, "notes")
DATA = os.path.join(NOTES_DIR, "notes.json")
SITE = "https://atteste.art"

PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Atelier Notes № {n} — on ‘{title_esc}’ by {name_esc} | Attesté</title>
<meta name="description" content="The Attesté Atelier read ‘{title_esc}’ by {name_esc}. {desc_esc}">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
<meta name="theme-color" content="#1A1A2E">
<link rel="canonical" href="{site}/notes/{slug}">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<meta property="og:type" content="article">
<meta property="og:url" content="{site}/notes/{slug}">
<meta property="og:site_name" content="Attesté">
<meta property="og:title" content="Atelier Notes № {n} — on ‘{title_esc}’ by {name_esc}">
<meta property="og:description" content="{desc_esc}">
<meta property="og:image" content="{site}/notes/cards/{card}">
<meta property="og:image:width" content="1080">
<meta property="og:image:height" content="1350">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">
{jsonld}
</script>
<style>
  :root {{ --navy:#1A1A2E; --navy-mid:#232340; --gold:#C9A96E; --gold-light:#E0CFA6; --cream:#FAF8F5; --text-body:#3D3D3D; --text-muted:#6B6B6B; }}
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  body {{ font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif; background:var(--cream); color:var(--text-body); line-height:1.6; }}
  a {{ color:var(--gold); }}
  .nav {{ background:var(--navy); padding:18px 32px; display:flex; align-items:center; justify-content:space-between; }}
  .nav-logo {{ font-family:Georgia,'Times New Roman',serif; font-size:24px; color:var(--cream); text-decoration:none; letter-spacing:.06em; }}
  .nav-logo span {{ color:var(--gold); }}
  .nav a.back {{ color:var(--gold-light); text-decoration:none; font-size:14px; letter-spacing:.08em; }}
  .hero {{ background:var(--navy); color:var(--cream); text-align:center; padding:64px 24px 56px; }}
  .eyebrow {{ font-size:12px; letter-spacing:.3em; text-transform:uppercase; color:var(--gold); margin-bottom:18px; }}
  h1 {{ font-family:Georgia,'Times New Roman',serif; font-style:italic; font-weight:600; font-size:clamp(30px,5vw,52px); line-height:1.15; }}
  .byline {{ margin-top:16px; font-size:14px; letter-spacing:.18em; text-transform:uppercase; color:var(--gold-light); }}
  .byline a {{ color:var(--gold-light); text-decoration:none; border-bottom:1px solid rgba(201,169,110,.4); }}
  .dateline {{ margin-top:10px; font-size:13px; color:rgba(250,248,245,.55); }}
  .wrap {{ max-width:720px; margin:0 auto; padding:0 24px; }}
  .card-shot {{ margin:-36px auto 0; max-width:520px; padding:0 24px; }}
  .card-shot img {{ width:100%; border-radius:12px; box-shadow:0 18px 60px rgba(26,26,46,.35); display:block; }}
  .read {{ font-family:Georgia,'Times New Roman',serif; font-style:italic; font-size:clamp(20px,2.6vw,26px); line-height:1.55; color:var(--navy); padding:56px 0 8px; }}
  .read::first-letter {{ color:var(--gold); }}
  .provenance {{ margin:36px 0; padding:22px 26px; background:#fff; border:1px solid #E8E2D8; border-radius:10px; font-size:14px; color:var(--text-muted); }}
  .provenance b {{ color:var(--navy); }}
  .claim {{ background:var(--navy); color:var(--cream); border-radius:14px; padding:40px 32px; margin:48px 0; }}
  .claim h2 {{ font-family:Georgia,serif; font-size:26px; margin-bottom:10px; }}
  .claim p {{ color:rgba(250,248,245,.75); font-size:15px; margin-bottom:24px; }}
  .field {{ margin-bottom:16px; }}
  .field label {{ display:block; font-size:13px; letter-spacing:.06em; margin-bottom:6px; color:var(--gold-light); }}
  .field input[type=text], .field input[type=email] {{ width:100%; padding:12px 14px; border-radius:8px; border:1px solid rgba(201,169,110,.4); background:rgba(250,248,245,.06); color:var(--cream); font-size:15px; }}
  .consent {{ display:flex; gap:10px; align-items:flex-start; font-size:13px; color:rgba(250,248,245,.75); margin:18px 0 22px; }}
  .consent a {{ color:var(--gold-light); }}
  .btn {{ display:inline-block; width:100%; text-align:center; background:var(--gold); color:var(--navy); font-weight:600; font-size:16px; padding:14px 28px; border:none; border-radius:8px; cursor:pointer; }}
  .smallprint {{ font-size:13px; color:var(--text-muted); margin:40px 0 64px; }}
  .footer {{ background:var(--navy); color:rgba(250,248,245,.6); text-align:center; padding:36px 24px; font-size:13px; }}
  .footer a {{ color:var(--gold-light); }}
</style>
</head>
<body>
<nav class="nav"><a href="/index.html" class="nav-logo">Attest<span>é</span></a><a class="back" href="/notes/">← All Atelier Notes</a></nav>

<header class="hero">
  <div class="eyebrow">Atelier Notes · № {n}</div>
  <h1>‘{title_esc}’</h1>
  <div class="byline">{name_esc} · <a href="https://www.instagram.com/{ig}" target="_blank" rel="noopener">@{ig}</a></div>
  <div class="dateline">Read by the Attesté Atelier · {date_h}</div>
</header>

<div class="card-shot"><img src="/notes/cards/{card}" alt="Atelier Notes № {n} card — a typeset curatorial read of ‘{title_esc}’ by {name_esc}. The imagery is Attesté studio backdrop art, not the artwork itself." width="1080" height="1350"></div>

<main class="wrap">
  <p class="read">{read_esc}</p>

  <div class="provenance">
    <b>About this note.</b> The Atelier is Attesté&rsquo;s curatorial engine. Each note is a short
    editorial read of one work by a working artist, grounded only in the public record of that
    work &mdash; never a price, a valuation, or a condition claim. The imagery on the card is
    Attesté studio backdrop art; <b>‘{title_esc}’ itself lives with the artist.</b>
  </div>

  <section class="claim" id="claim">
    <h2>Is this your work?</h2>
    <p>Claim this note. The Atelier will read another of your works &mdash; and your studio gets
    first access to the tools we build for working artists.</p>
    <form name="artist-early-access" method="POST" action="/thanks.html" data-netlify="true" netlify-honeypot="bot-field" aria-label="Claim this Atelier note">
      <input type="hidden" name="form-name" value="artist-early-access">
      <input type="hidden" name="ref" value="note-{n}-{slug}">
      <input type="hidden" name="source" value="atelier-journal">
      <p style="display:none;" aria-hidden="true"><label>Don&rsquo;t fill this in if you&rsquo;re human: <input name="bot-field" tabindex="-1" autocomplete="off"></label></p>
      <div class="field"><label for="claim-name">Name</label><input type="text" id="claim-name" name="name" autocomplete="name" placeholder="How you sign your work"></div>
      <div class="field"><label for="claim-email">Email</label><input type="email" id="claim-email" name="email" autocomplete="email" required placeholder="you@example.com"></div>
      <label class="consent"><input type="checkbox" name="consent" value="yes" required><span>I&rsquo;d like Attest&eacute; to email me about early access to new artist features and occasional studio updates &mdash; <a href="/privacy.html">Privacy Policy</a>.</span></label>
      <button type="submit" class="btn">Claim this note</button>
    </form>
  </section>

  <p class="smallprint">Are you {name_esc}, and would you like this note amended or taken down?
  Email <a href="mailto:info@atteste.art">info@atteste.art</a> &mdash; we act the same day, no questions asked.</p>
</main>

<footer class="footer">Attest&eacute; &mdash; provenance, cataloguing and discovery for the art world. <a href="/index.html">atteste.art</a> · <a href="/privacy.html">Privacy</a> · <a href="/ai-disclosure.html">AI disclosure</a></footer>
</body>
</html>
"""

INDEX_HEAD = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Atelier Notes — daily curatorial reads by the Attesté Atelier</title>
<meta name="description" content="One work by one working artist, read closely by the Attesté Atelier — most days. A public journal of contemporary art, starting with South Africa.">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
<meta name="theme-color" content="#1A1A2E">
<link rel="canonical" href="https://atteste.art/notes/">
<link rel="icon" type="image/png" href="/favicon.png">
<meta property="og:type" content="website">
<meta property="og:url" content="https://atteste.art/notes/">
<meta property="og:site_name" content="Attesté">
<meta property="og:title" content="Atelier Notes — daily curatorial reads by the Attesté Atelier">
<meta property="og:description" content="One work by one working artist, read closely — most days. A public journal of contemporary art, starting with South Africa.">
<style>
  :root { --navy:#1A1A2E; --gold:#C9A96E; --gold-light:#E0CFA6; --cream:#FAF8F5; --text-body:#3D3D3D; --text-muted:#6B6B6B; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif; background:var(--cream); color:var(--text-body); line-height:1.6; }
  .nav { background:var(--navy); padding:18px 32px; display:flex; align-items:center; justify-content:space-between; }
  .nav-logo { font-family:Georgia,serif; font-size:24px; color:var(--cream); text-decoration:none; letter-spacing:.06em; }
  .nav-logo span { color:var(--gold); }
  .nav a.home { color:var(--gold-light); text-decoration:none; font-size:14px; letter-spacing:.08em; }
  .hero { background:var(--navy); color:var(--cream); text-align:center; padding:72px 24px; }
  .eyebrow { font-size:12px; letter-spacing:.3em; text-transform:uppercase; color:var(--gold); margin-bottom:18px; }
  h1 { font-family:Georgia,serif; font-size:clamp(32px,5vw,54px); line-height:1.12; }
  .sub { max-width:560px; margin:18px auto 0; color:rgba(250,248,245,.72); font-size:17px; }
  .wrap { max-width:760px; margin:0 auto; padding:48px 24px 72px; }
  .note { display:block; text-decoration:none; color:inherit; background:#fff; border:1px solid #E8E2D8; border-radius:12px; padding:26px 30px; margin-bottom:18px; transition:box-shadow .15s; }
  .note:hover { box-shadow:0 10px 34px rgba(26,26,46,.12); }
  .note .no { font-size:12px; letter-spacing:.26em; text-transform:uppercase; color:var(--gold); }
  .note h2 { font-family:Georgia,serif; font-style:italic; font-size:24px; color:var(--navy); margin:6px 0 2px; }
  .note .who { font-size:14px; color:var(--text-muted); }
  .empty { text-align:center; color:var(--text-muted); padding:56px 0; font-size:16px; }
  .footer { background:var(--navy); color:rgba(250,248,245,.6); text-align:center; padding:36px 24px; font-size:13px; }
  .footer a { color:var(--gold-light); }
</style>
</head>
<body>
<nav class="nav"><a href="/index.html" class="nav-logo">Attest<span>é</span></a><a class="home" href="/artists.html">For Artists →</a></nav>
<header class="hero">
  <div class="eyebrow">The Attesté Atelier</div>
  <h1>Atelier Notes</h1>
  <p class="sub">One work by one working artist, read closely — most days. A public journal of
  contemporary art, starting with South Africa. Editorial only: never a price, never a valuation.</p>
</header>
<main class="wrap">
"""

INDEX_FOOT = """</main>
<footer class="footer">Attest&eacute; &mdash; provenance, cataloguing and discovery for the art world. <a href="/index.html">atteste.art</a> · <a href="/privacy.html">Privacy</a> · <a href="/ai-disclosure.html">AI disclosure</a></footer>
</body>
</html>
"""


def jsonld(note):
    return json.dumps({
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": f"Atelier Notes № {note['n']} — on ‘{note['workTitle']}’ by {note['name']}",
        "datePublished": note["date"],
        "author": {"@type": "Organization", "name": "The Attesté Atelier", "url": SITE},
        "publisher": {"@type": "Organization", "name": "Attesté", "url": SITE},
        "about": {"@type": "Person", "name": note["name"]},
        "url": f"{SITE}/notes/{note['slug']}",
        "image": f"{SITE}/notes/cards/{note['card']}",
    }, ensure_ascii=False, indent=1)


def human_date(iso):
    from datetime import date
    d = date.fromisoformat(iso)
    return d.strftime("%-d %B %Y")


def build():
    notes = json.load(open(DATA))
    published = [n for n in notes if n.get("published")]
    published.sort(key=lambda n: n["n"])
    for n in published:
        page = PAGE.format(
            n=n["n"], slug=n["slug"], site=SITE, card=n["card"],
            ig=n["igHandle"].lstrip("@"),
            title_esc=html.escape(n["workTitle"]),
            name_esc=html.escape(n["name"]),
            read_esc=html.escape(n["read"]),
            desc_esc=html.escape(n["read"].split("—")[0].strip()[:150]),
            date_h=human_date(n["date"]),
            jsonld=jsonld(n),
        )
        out = os.path.join(NOTES_DIR, f"{n['slug']}.html")
        open(out, "w").write(page)
        print("wrote", os.path.relpath(out, ROOT))

    items = []
    for n in reversed(published):
        items.append(
            f'<a class="note" href="/notes/{n["slug"]}">'
            f'<div class="no">№ {n["n"]} · {human_date(n["date"])}</div>'
            f'<h2>‘{html.escape(n["workTitle"])}’</h2>'
            f'<div class="who">{html.escape(n["name"])}</div></a>'
        )
    if not items:
        items.append('<div class="empty">The first notes land 11 August 2026. '
                     'The Atelier is already reading.</div>')
    open(os.path.join(NOTES_DIR, "index.html"), "w").write(
        INDEX_HEAD + "\n".join(items) + "\n" + INDEX_FOOT)
    print("wrote notes/index.html —", len(published), "published note(s)")


if __name__ == "__main__":
    build()
