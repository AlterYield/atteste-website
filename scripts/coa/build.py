#!/usr/bin/env python3
"""Build the free COA generator pages (2026-11-04).

  coa/index.html               the generator
  coa/{painting,photography,prints,sculpture}/index.html   medium guides
  claim/index.html             QR landing (noindex)

Shared head, top bar, footer and JSON-LD live here so the six pages cannot
drift. Edit this file, then run:

  python3 scripts/coa/build.py && node scripts/asset-versions.mjs

(asset-versions stamps the ?v= content hash on every /assets/js|css link.)

Claim rules (scripts/claims): the tool never "authenticates", "verifies" or
"proves" anything. A COA from here is the artist's own statement of record;
the SHA-256 only shows the image file is unchanged since issue. Any sentence
about the Attesté app sits in a data-claim block on a live|shipping entry.
"""
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ORIGIN = "https://atteste.art"
OG_IMAGE = f"{ORIGIN}/assets/3d/atteste-og-banner.jpg"

APP_STORE = "https://apps.apple.com/app/apple-store/id6763944507?pt=128824584&amp;ct={ct}&amp;mt=8"
PLAY = "https://play.google.com/store/apps/details?id=art.atteste.atteste&amp;referrer=utm_source%3D{src}%26utm_medium%3D{med}"
WEB_APP = "https://atteste-b6409.web.app/?utm_source={src}&amp;utm_medium={med}"

MEDIA = [
    ("painting", "Painting", "Support, signature, varnish, framed vs unframed size"),
    ("photography", "Photography", "Print process, print date, edition across sizes"),
    ("prints", "Prints", "Edition numbering, AP / PP / BAT, the matrix"),
    ("sculpture", "Sculpture", "Casts, foundry, patina, weight and base"),
]


def consent_tag(content):
    """Banner, GA and Pixel for the public guide pages. /claim/ must never get this,
    because its URL fragment is the certificate, and nor must the generator, which
    shows what the visitor enters. Policy: scripts/inject_consent.py."""
    return f'<script defer src="/assets/js/consent.js" data-fb-events="ViewContent" data-fb-content="{content}"></script>\n'


def esc(s):
    return s.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")


def store_badges(src, med, ct):
    return f"""<div class="store-badges">
          <a href="{APP_STORE.format(ct=ct)}" target="_blank" rel="noopener" aria-label="Download Attesté on the App Store"><img src="/assets/badges/app-store-badge.svg" alt="Download on the App Store" width="132" height="44"></a>
          <a href="{PLAY.format(src=src, med=med)}" target="_blank" rel="noopener" aria-label="Get Attesté on Google Play"><img src="/assets/badges/google-play-badge.png" alt="Get it on Google Play" width="148" height="44"></a>
          <a class="btn btn-ghost" href="{WEB_APP.format(src=src, med=med)}" target="_blank" rel="noopener">Open the web app</a>
        </div>"""


def head(*, path, title, desc, jsonld, robots="index, follow, max-snippet:-1, max-image-preview:large", extra=""):
    url = ORIGIN + path
    blocks = "\n".join(
        f'<script type="application/ld+json">\n{json.dumps(b, indent=2, ensure_ascii=False)}\n</script>' for b in jsonld)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<meta name="robots" content="{robots}">
<link rel="canonical" href="{url}">
<meta name="theme-color" content="#1A1A2E">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Attesté">
<meta property="og:url" content="{url}">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:image" content="{OG_IMAGE}">
<meta property="og:image:alt" content="Attesté — Your art, connected.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@atteste_art">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(desc)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,500;1,600&amp;family=Inter:wght@400;500;600&amp;display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/coa.css">
{extra}{blocks}
</head>
<body>
<header class="coa-top">
  <a class="coa-logo" href="/">Attest<span>é</span></a>
  <nav aria-label="COA generator">
    <a href="/coa/">COA generator</a>
    <a href="/artists.html">For artists</a>
    <a href="/help/">Help</a>
  </nav>
</header>
"""


def foot(scripts):
    tags = "".join(f'<script defer src="{s}"></script>\n' for s in scripts)
    guides = " · ".join(f'<a href="/coa/{slug}/">{name}</a>' for slug, name, _ in MEDIA)
    return f"""<footer class="coa-foot">
  <p><a href="/coa/">Free COA generator</a> · Guides: {guides}</p>
  <p>Attesté does not examine artworks or check what a certificate says. A certificate made here is the artist's own statement of record.</p>
  <p>Operator: Yield SPM (Pty) Ltd, Republic of South Africa · <a href="mailto:info@atteste.art">info@atteste.art</a> · <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></p>
</footer>
{tags}</body>
</html>
"""


def software_app(url, name, desc):
    return {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "name": name,
        "description": desc,
        "url": url,
        "applicationCategory": "DesignApplication",
        "operatingSystem": "Any (web browser)",
        "isAccessibleForFree": True,
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
        "publisher": {"@type": "Organization", "name": "Attesté", "url": f"{ORIGIN}/", "logo": f"{ORIGIN}/icon-512.png"},
    }


def howto(url, name, steps, supplies=None):
    h = {
        "@context": "https://schema.org",
        "@type": "HowTo",
        "name": name,
        "url": url,
        "totalTime": "PT5M",
        "estimatedCost": {"@type": "MonetaryAmount", "currency": "USD", "value": "0"},
        "tool": [{"@type": "HowToTool", "name": "A web browser"}],
        "step": [{"@type": "HowToStep", "position": i + 1, "name": n, "text": t} for i, (n, t) in enumerate(steps)],
    }
    if supplies:
        h["supply"] = [{"@type": "HowToSupply", "name": s} for s in supplies]
    return h


def breadcrumbs(items):
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": n, "item": ORIGIN + p} for i, (n, p) in enumerate(items)],
    }


GEN_STEPS = [
    ("Enter the work's details", "Title, artist, year and medium are required; dimensions, edition and a short statement are optional."),
    ("Add one image of the work", "Choose a JPEG or PNG. Your browser computes its SHA-256 fingerprint on your device; the image is not uploaded. Only that fingerprint is sent, to get a timestamp receipt."),
    ("Download the PDF", "The A4 certificate prints the details, the image, the fingerprint and a QR code labelled Register this work on Attesté."),
    ("Sign it and keep the original file", "Sign the printed certificate by hand, and keep the exact image file you used: the fingerprint matches only that file."),
]

# ── The generator form (only on /coa/) ──────────────────────────────────────
FORM = f"""<section class="coa-app" aria-labelledby="gen-h">
  <h2 id="gen-h" style="margin-top:0">Create your certificate</h2>
  <form id="coa-form" novalidate autocomplete="off">
    <div class="coa-grid">
      <div class="coa-field full"><label for="coa-title">Title of the work *</label>
        <input id="coa-title" name="title" required maxlength="90" placeholder="e.g. Morning over the Boland"></div>
      <div class="coa-field"><label for="coa-artist">Artist *</label>
        <input id="coa-artist" name="artist" required maxlength="70" placeholder="Your name as you sign it"></div>
      <div class="coa-field"><label for="coa-year">Year *</label>
        <input id="coa-year" name="year" required maxlength="20" placeholder="e.g. 2026"></div>
      <div class="coa-field"><label for="coa-medium">Medium *</label>
        <input id="coa-medium" name="medium" required maxlength="80" placeholder="e.g. Oil on canvas"></div>
      <div class="coa-field"><label for="coa-dims">Dimensions</label>
        <input id="coa-dims" name="dimensions" maxlength="80" placeholder="e.g. 60 × 80 cm"></div>
      <div class="coa-field"><label for="coa-edition">Edition</label>
        <input id="coa-edition" name="edition" maxlength="40" placeholder="e.g. Unique, 3/25, AP 1/5"></div>
      <div class="coa-field"><span class="hint">Issue date: <strong id="coa-date">today</strong></span></div>
      <div class="coa-field full"><label for="coa-statement">Statement (optional)</label>
        <textarea id="coa-statement" name="statement" maxlength="600" placeholder="A few lines in your own words: materials, signature, anything the next owner should know."></textarea>
        <span class="hint">Printed on the certificate only. Not put in the QR code.</span></div>
      <div class="coa-field full"><label for="coa-image">Image of the work *</label>
        <input id="coa-image" name="image" type="file" accept="image/jpeg,image/png,image/webp" required>
        <span class="hint">JPEG or PNG. The fingerprint is taken from this exact file, so keep it unchanged.</span>
        <div class="coa-preview"><img id="coa-preview-img" alt="Preview of the selected image" hidden><span id="coa-preview-hash" class="coa-hash"></span></div></div>
    </div>
    <div class="coa-actions">
      <button id="coa-submit" class="btn btn-gold" type="submit">Download my certificate (PDF)</button>
      <span id="coa-status" class="coa-status" role="status" aria-live="polite"></span>
    </div>
  </form>
  <noscript><p class="coa-status error">The generator runs in your browser and needs JavaScript switched on.</p></noscript>
  <div id="coa-done" class="coa-done" hidden>
    <h3>Your certificate has downloaded</h3>
    <p>Image fingerprint (SHA-256): <span id="coa-done-hash" class="coa-hash"></span></p>
    <p>The QR code opens <a id="coa-done-claim" href="/claim/" target="_blank" rel="noopener">this page</a>, which shows the record printed on the certificate. Try it before you print.</p>
    <p id="coa-done-note" class="small"></p>
    <div data-claim="f-collector-add-artwork f-collector-collection-list a-001-free-to-download">
      <h3>Keep the record going in Attesté</h3>
      <p>When the work sells, the new owner can scan the QR code and add the work to their Attesté collection. Attesté is free to download.</p>
      {store_badges("coa", "generator-cta", "coa")}
    </div>
  </div>
</section>"""


def page_generator():
    path = "/coa/"
    url = ORIGIN + path
    title = "Free Certificate of Authenticity Generator for Artists | Attesté"
    desc = "Make a certificate of authenticity for your artwork in minutes, free, no sign-up: an A4 PDF with a SHA-256 image fingerprint and QR code. Your image stays on your device."
    jsonld = [
        software_app(url, "Attesté COA generator", desc),
        howto(url, "How to create a certificate of authenticity for an artwork", GEN_STEPS, ["One image of the work (JPEG or PNG)"]),
        breadcrumbs([("Attesté", "/"), ("COA generator", path)]),
    ]
    guides = "\n".join(
        f'    <a href="/coa/{slug}/"><strong>{name}</strong><span>{blurb}</span></a>' for slug, name, blurb in MEDIA)
    body = f"""<main>
  <p class="eyebrow">Free tool · No sign-up</p>
  <h1>Free certificate of authenticity generator</h1>
  <p class="lede">Create a certificate of authenticity (COA) for an artwork you made, free and without an account. Enter the details, add one image, and download an A4 PDF that prints the SHA-256 fingerprint of that image and a QR code the next owner can scan. The image is processed in your browser and never leaves your device.</p>
  <div class="privacy-note"><span aria-hidden="true">🔒</span><div><strong>Your image stays on this device.</strong> The fingerprint and the PDF are made by your own browser. Nothing you type and no image is uploaded, and this page adds no analytics. Only the fingerprint, a 64-character code that cannot be turned back into your image, is sent to Attesté to get a timestamp receipt for your PDF.</div></div>

{FORM}

  <div class="prose">
  <h2>What should a certificate of authenticity include?</h2>
  <p>A COA is a written record, issued by the artist (or the artist's estate, publisher or gallery), that describes one specific work. Buyers, insurers and later owners look for:</p>
  <ul>
    <li><strong>Title, artist and year</strong> — the year the work was finished.</li>
    <li><strong>Medium and support</strong> — "oil on linen", not just "painting".</li>
    <li><strong>Dimensions</strong> — height × width (× depth), and whether they include the frame or base.</li>
    <li><strong>Edition</strong> — "Unique", or this impression's number out of the total, plus any proofs.</li>
    <li><strong>An image</strong> of the work, so the certificate cannot be mistaken for another piece.</li>
    <li><strong>A signed statement</strong> from the artist, and the date it was issued.</li>
  </ul>
  <p>Each medium adds its own details. The guides below say what to add for each.</p>

  <h2>Guides by medium</h2>
  <div class="medium-links">
{guides}
  </div>

  <h2>What does the SHA-256 fingerprint show?</h2>
  <p>SHA-256 turns a file into a 64-character code. The same file always gives the same code, and changing even one pixel, or re-saving the JPEG, gives a different one. Printing the code on the certificate ties it to the exact image file you chose.</p>
  <p>That is all it shows: that an image file is unchanged since the certificate was issued. It says nothing about who made the work or whether the statement is true. The certificate is your own statement of record, and Attesté does not examine the work or check what you write.</p>

  <h2>What does the QR code do?</h2>
  <p>The QR code opens a page on atteste.art that shows the record printed on the certificate: title, artist, year, medium, fingerprint and issue date. The record travels inside the link itself, so nothing is stored on a server. If a long title makes the code too dense to scan at 30 mm, the code leaves out dimensions and edition first; the PDF always prints every field.</p>

  <h2>Who should issue a COA?</h2>
  <p>The artist, or someone with the standing to speak for the work: the artist's estate, the publisher of an edition, or a gallery acting for the artist. A COA written by a seller with no link to the artist adds little. Sign every certificate by hand and keep a copy.</p>
  </div>
</main>
"""
    scripts = ["/assets/js/jspdf-4.2.1.umd.min.js", "/assets/js/qrcode-generator-1.4.4.js",
               "/assets/js/coa-core.js", "/assets/js/coa.js", "/assets/js/attribution.js"]
    return head(path=path, title=title, desc=desc, jsonld=jsonld) + body + foot(scripts)


# ── Medium guides ───────────────────────────────────────────────────────────
GUIDES = {
    "painting": {
        "title": "Certificate of Authenticity for a Painting: What to Include",
        "desc": "What a painting's certificate of authenticity should record: support, ground, signature, verso, framed size, varnish. Free COA generator, no sign-up.",
        "h1": "Certificate of authenticity for a painting",
        "lede": "A painting's certificate of authenticity should name the medium and the support separately, give the unframed size (height first), say where the work is signed and what is on the reverse, and carry a clear photograph of the whole painting. The free generator below makes the A4 PDF; this guide covers what to put in it.",
        "sections": [
            ("What details does a painting COA need?", """<ul>
    <li><strong>Medium and support, separately.</strong> "Oil on Belgian linen", "acrylic on gesso panel", "watercolour on 300 gsm cotton paper". The support matters for conservation and insurance.</li>
    <li><strong>Size, unframed, height × width.</strong> Add depth for deep stretchers or cradled panels. If you sell it framed, give the framed size as a second measurement and say so.</li>
    <li><strong>Edition: "Unique".</strong> A painting is one of one; say it plainly so nobody wonders about copies.</li>
    <li><strong>Year completed.</strong> If the painting was worked on over years, write the span, e.g. "2023–2025".</li>
  </ul>"""),
            ("Where should I describe the signature and the reverse?", """<p>Use the statement field. Say where you signed (for example "signed lower right recto") and record everything on the back: inscriptions, the title as written, stretcher stamps, gallery or exhibition labels. Collectors and later owners compare these details with the painting itself, so be exact.</p>"""),
            ("Should I mention varnish, retouching or framing?", """<p>Yes, briefly. Note whether the painting is varnished, with what and when, or whether it is left unvarnished on purpose. Mention any later work you did on it, such as retouching or restretching. If you chose the frame, say so. A conservator decades from now will thank you.</p>"""),
            ("How should I photograph a painting for its certificate?", """<p>Shoot the whole painting square-on, out of its frame if you can, in even, glare-free light, with colours as close to the real thing as you can manage. Crop to the edge of the canvas. Then save that file and never edit it: the fingerprint on the certificate matches only that exact file. Keep detail shots of the signature and the reverse alongside it.</p>"""),
            ("Do I need one certificate per painting?", """<p>Yes. One certificate describes one work. For a diptych or a series sold together, list every panel in the statement and give the total size, or issue one certificate per panel if they could ever be sold apart.</p>"""),
        ],
        "steps": [
            ("Photograph the painting", "Square-on, unframed, even light, cropped to the canvas edge. Keep the file unchanged."),
            ("Enter medium and support", "For example: Oil on linen. Add the unframed size, height first."),
            ("Describe signature and verso", "Use the statement field for signature placement, inscriptions and labels on the back."),
            ("Download, sign and keep the file", "Sign the printed PDF by hand and archive the exact image file you used."),
        ],
    },
    "photography": {
        "title": "Certificate of Authenticity for Photography: What to Include",
        "desc": "What a photograph's COA should record: print process, paper, print date vs capture date, who printed it, edition across every size. Free generator.",
        "h1": "Certificate of authenticity for a photograph",
        "lede": "A photographic print's certificate of authenticity should say how and when the print was made, not only when the picture was taken. Record the print process and paper, the print date, who printed it, the image and sheet sizes, and this print's number within the edition, counting every size. The free generator below makes the A4 PDF.",
        "sections": [
            ("What makes a photography COA different?", """<p>A photograph can be printed many times, so the certificate has to describe this one physical print. Collectors look for:</p>
  <ul>
    <li><strong>Print process.</strong> Archival pigment print, gelatin silver print, chromogenic (C-type) print, platinum-palladium print, dye sublimation on aluminium.</li>
    <li><strong>Paper or substrate, and mounting.</strong> For example Hahnemühle Photo Rag 308 gsm; face-mounted to acrylic; dibond backing.</li>
    <li><strong>Two dates.</strong> When the image was made, and when this print was made. A print made years later is a different object from a print made at the time.</li>
    <li><strong>Who printed it.</strong> You, or a named lab or master printer.</li>
    <li><strong>Image size and sheet size.</strong> Borders matter on photographic paper.</li>
  </ul>"""),
            ("How do I number a photographic edition?", """<p>Write this print's number and the total, for example "3/10", and state the whole edition across every size in the statement: "Edition of 10 at 50 × 70 cm and 5 at 100 × 140 cm, plus 2 artist's proofs in each size." Buyers value a photograph partly by how many prints can ever exist. If you commit to never printing the image again beyond the edition, say so.</p>"""),
            ("Where should a photograph be signed?", """<p>Usually on the back of the print or on the margin, in pencil or archival ink, sometimes with a label. Say where in the statement, and avoid ink that can bleed through the paper.</p>"""),
            ("Which image file should I use for the fingerprint?", """<p>Use a reference image of the edition, a photograph of this print or a dedicated JPEG export, rather than your working master file, which you may need to edit later. The fingerprint on the certificate matches only the exact file you choose, so archive that file unchanged.</p>"""),
            ("One certificate per print?", """<p>Yes. Each print in the edition gets its own certificate with its own number. The image and fingerprint can be the same across the edition; the edition number is what tells the certificates apart.</p>"""),
        ],
        "steps": [
            ("Record the print, not just the image", "Note the print process, paper, mounting, who printed it and the print date."),
            ("Enter the edition number", "This print's number over the total, e.g. 3/10. Put the whole edition across sizes in the statement."),
            ("Choose a reference image", "A photo of this print or a dedicated JPEG export. Keep that file unchanged."),
            ("Download, sign and keep the file", "Sign the PDF by hand and keep one certificate per print."),
        ],
    },
    "prints": {
        "title": "COA for Prints: Edition Numbering, AP and PP Explained",
        "desc": "How to write a certificate of authenticity for a print: edition numbering, artist's proofs (AP), printer's proofs (PP), BAT, the printer and the plate.",
        "h1": "Certificate of authenticity for prints and editions",
        "lede": "A certificate of authenticity for a print should state the technique, this impression's number within the edition, and the full count of proofs outside it: artist's proofs (AP), printer's proofs (PP), the bon à tirer (BAT). Add the printer or workshop, the paper, and what happened to the plate, block or screen. The free generator below makes the A4 PDF.",
        "sections": [
            ("How does edition numbering work?", """<p>An edition number like <strong>12/50</strong> means this is impression number 12 of an edition of 50. The number identifies the impression; it does not have to match the order the sheets came off the press. Write the number exactly as it appears in pencil on the print, usually in the lower-left margin, with the signature at lower right.</p>"""),
            ("What are AP, PP, BAT, TP and HC?", """<ul>
    <li><strong>AP — artist's proof</strong> (also E.A., épreuve d'artiste). Impressions kept by the artist, outside the numbered edition. Conventionally around 10% of the edition. Number them too: "AP 2/5".</li>
    <li><strong>PP — printer's proof.</strong> Impressions given to the printer or workshop.</li>
    <li><strong>BAT — bon à tirer.</strong> The approved proof the edition was matched against. Usually one.</li>
    <li><strong>TP — trial proof.</strong> Working proofs pulled before the edition was fixed, often different from it.</li>
    <li><strong>HC — hors commerce.</strong> Impressions marked "not for sale", traditionally for exhibition or archive.</li>
  </ul>
  <p>Put the full count in the statement, for example "Edition of 50, plus 5 AP, 2 PP and 1 BAT". A buyer can then see every impression that exists, not only the numbered ones.</p>"""),
            ("What else belongs on a print's certificate?", """<ul>
    <li><strong>Technique.</strong> Etching, aquatint, drypoint, lithograph, screenprint, woodcut, linocut, or giclée/pigment print for digital editions. Name every technique used.</li>
    <li><strong>Paper.</strong> Maker, name and weight, e.g. Somerset Satin 300 gsm.</li>
    <li><strong>Plate or image size and sheet size.</strong></li>
    <li><strong>Printer, workshop and publisher</strong>, and any chop mark (blind stamp) on the sheet.</li>
    <li><strong>The matrix.</strong> Whether the plate was cancelled or destroyed, the screens cleared, or the file retired after the edition.</li>
  </ul>"""),
            ("One certificate per impression?", """<p>Yes. Each impression gets its own certificate carrying its own number, "12/50" on one and "13/50" on the next. Proofs get theirs too. The image and fingerprint can be the same across the edition.</p>"""),
        ],
        "steps": [
            ("Enter the technique", "e.g. Etching and aquatint on Somerset paper. Add plate and sheet sizes."),
            ("Enter this impression's number", "Exactly as pencilled on the sheet, e.g. 12/50 or AP 2/5."),
            ("List every proof in the statement", "Edition total plus AP, PP, BAT and HC counts, the printer, and the fate of the matrix."),
            ("Download, sign and repeat per impression", "One certificate per impression, each with its own number."),
        ],
    },
    "sculpture": {
        "title": "Certificate of Authenticity for Sculpture: Casts and Foundry",
        "desc": "What a sculpture's COA should record: material and process, foundry, cast number and artist's casts, patina, size and weight, base, care. Free generator.",
        "h1": "Certificate of authenticity for sculpture",
        "lede": "A sculpture's certificate of authenticity should give the material and how it was made, the foundry or fabricator, the cast number within the edition, the patina or finish, height × width × depth with the weight, and whether the base is part of the work. The free generator below makes the A4 PDF; this guide covers what to put in it.",
        "sections": [
            ("How do I number cast editions?", """<p>Write the cast's number over the total, for example <strong>Cast 3/8</strong>. Artist's casts sit outside the numbered edition and are marked AC, AP or E.A. ("E.A. 1/4"). In the statement, give the total of everything cast from the mould, "Edition of 8 plus 4 artist's casts", so a buyer knows how many exist. If a cast was made after the model was finished, give both dates; any posthumous cast must say so.</p>"""),
            ("What should I say about the foundry?", """<p>Name the foundry or fabricator and the city, the casting process (lost-wax, sand casting, fabricated steel, 3D-printed and cast), and where the foundry mark sits on the piece. Foundry records are often where later owners and researchers go to trace a cast, so the name matters.</p>"""),
            ("Which other details matter for sculpture?", """<ul>
    <li><strong>Material and finish.</strong> "Bronze, brown patina", "Carrara marble", "stoneware, wood-fired". For carved or modelled unique pieces, the edition is "Unique".</li>
    <li><strong>Size and weight.</strong> Height × width × depth, with and without the base, and the weight. Shippers and insurers need both.</li>
    <li><strong>Base or plinth.</strong> Whether it is part of the work, who made it, and how the work attaches.</li>
    <li><strong>Signature and marks.</strong> Where the signature, number and foundry mark are, often on the base or the back.</li>
    <li><strong>Care and siting.</strong> Indoor or outdoor, waxing schedule for patinas, mounting hardware, number of parts if it assembles.</li>
  </ul>"""),
            ("How should I photograph a sculpture for its certificate?", """<p>Choose one primary view, the angle you would put in a catalogue, against a plain background with soft light. That single file is what the fingerprint covers. Keep other angles and close-ups of the marks with your own records.</p>"""),
        ],
        "steps": [
            ("Photograph the primary view", "One catalogue angle on a plain background. Keep that file unchanged."),
            ("Enter material, process and cast number", "e.g. Bronze, lost-wax cast, brown patina; Cast 3/8."),
            ("Record foundry, size and weight", "Name the foundry and mark location in the statement; give H × W × D and weight."),
            ("Download, sign and keep the file", "One certificate per cast, signed by hand."),
        ],
    },
}


def page_guide(slug):
    g = GUIDES[slug]
    name = next(n for s, n, _ in MEDIA if s == slug)
    path = f"/coa/{slug}/"
    url = ORIGIN + path
    jsonld = [
        software_app(f"{ORIGIN}/coa/", "Attesté COA generator", "Free, no-sign-up certificate of authenticity generator that runs in the browser."),
        howto(url, g["h1"][0].upper() + g["h1"][1:], g["steps"]),
        breadcrumbs([("Attesté", "/"), ("COA generator", "/coa/"), (name, path)]),
    ]
    sections = "\n".join(f"  <h2>{h}</h2>\n  {body}" for h, body in g["sections"])
    others = " · ".join(f'<a href="/coa/{s}/">{n}</a>' for s, n, _ in MEDIA if s != slug)
    body = f"""<main>
  <p class="eyebrow"><a href="/coa/">COA generator</a> · {name}</p>
  <h1>{g["h1"]}</h1>
  <p class="lede">{g["lede"]}</p>
  <div class="coa-actions"><a class="btn btn-gold" href="/coa/?for={slug}">Create a {name.lower()} COA, free</a><span class="small">No sign-up. Your image stays on your device.</span></div>
  <div class="prose">
{sections}
  <h2>How does the free generator help?</h2>
  <p>It lays out the details above on an A4 certificate, prints the SHA-256 fingerprint of your image, and adds a QR code that opens the record on atteste.art. The fingerprint shows only that the image file is unchanged since you issued the certificate; the certificate itself is your own statement of record. <a href="/coa/?for={slug}">Open the generator</a>.</p>
  <p class="small">Other guides: {others}</p>
  </div>
</main>
"""
    return head(path=path, title=g["title"], desc=g["desc"], jsonld=jsonld, extra=consent_tag(f"coa-{slug}")) + body + foot(["/assets/js/attribution.js"])


def page_claim():
    path = "/claim/"
    title = "Certificate record — Attesté"
    desc = "The record printed on an artist-issued certificate of authenticity, opened from its QR code. Add the work to your Attesté collection."
    jsonld = [{
        "@context": "https://schema.org", "@type": "WebPage", "name": title, "description": desc,
        "url": ORIGIN + path, "isPartOf": {"@type": "WebSite", "name": "Attesté", "url": f"{ORIGIN}/"},
    }]
    body = f"""<main>
  <div id="claim-loading" class="claim-error"><p>Reading the certificate record…</p>
    <noscript><p>This page reads the record from the QR link in your browser and needs JavaScript switched on.</p></noscript></div>

  <div id="claim-error" class="claim-error" hidden>
    <h2>We couldn't read this certificate link</h2>
    <p id="claim-error-detail">The link is missing its record, or part of it was cut off.</p>
    <p>Scan the QR code on the certificate again, or copy the whole link. If the link came in a message, it may have been shortened on the way.</p>
    <p>Artist? <a href="/coa/">Make a free certificate of authenticity</a>.</p>
  </div>

  <article id="claim-view" hidden>
    <div class="cert">
      <p class="eyebrow">Certificate of authenticity · record</p>
      <h1 id="c-title"></h1>
      <p class="by">by <span id="c-artist"></span></p>
      <dl>
        <dt>Year</dt><dd id="c-year"></dd>
        <dt>Medium</dt><dd id="c-medium"></dd>
        <dt id="c-dims-l">Dimensions</dt><dd id="c-dims"></dd>
        <dt id="c-edition-l">Edition</dt><dd id="c-edition"></dd>
        <dt>Issued</dt><dd id="c-issued"></dd>
        <dt>Image SHA-256</dt><dd id="c-hash" class="coa-hash"></dd>
      </dl>
      <p class="note">Issued by the artist as their own statement of record. The SHA-256 fingerprint matches one specific image file: it shows that file is unchanged since issue, and nothing more. Attesté did not examine the work and does not check this statement.</p>
    </div>
    <h2 style="text-align:center">Own this work? Keep its record.</h2>
    <div class="claim-actions" data-claim="f-collector-add-artwork f-collector-collection-list a-001-free-to-download">
      <p><a id="claim-import" class="btn btn-gold" href="https://atteste-b6409.web.app/import-coa" rel="noopener">Add this work to my Attesté collection</a></p>
      <p class="small">Attesté is free to download.</p>
      {store_badges("coa-claim", "claim-page", "coa-claim")}
    </div>
  </article>
</main>
"""
    return head(path=path, title=title, desc=desc, jsonld=jsonld, robots="noindex, follow") + body + foot(
        ["/assets/js/coa-core.js", "/assets/js/claim.js", "/assets/js/attribution.js"])


def write(rel, html):
    p = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    # Keep any ?v= hashes asset-versions.mjs already stamped, so a rebuild is a no-op.
    if os.path.exists(p):
        old = open(p, encoding="utf-8").read()
        stamps = dict(re.findall(r'"(/assets/(?:js|css)/[A-Za-z0-9._-]+)\?v=([A-Za-z0-9]+)"', old))
        html = re.sub(r'"(/assets/(?:js|css)/[A-Za-z0-9._-]+)"',
                      lambda m: f'"{m.group(1)}?v={stamps[m.group(1)]}"' if m.group(1) in stamps else m.group(0), html)
    open(p, "w", encoding="utf-8").write(html)
    print("wrote", rel)


if __name__ == "__main__":
    write("coa/index.html", page_generator())
    for slug, _, _ in MEDIA:
        write(f"coa/{slug}/index.html", page_guide(slug))
    write("claim/index.html", page_claim())
