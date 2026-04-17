#!/usr/bin/env python3
"""
Attesté Public Provenance Graph — Certificate Page Generator
============================================================
Usage:
  python3 scripts/generate-cert-page.py scripts/demo-certs/demo-001.json
  python3 scripts/generate-cert-page.py --all

Reads a JSON cert file, computes the canonical SHA-256 hash, and emits a
production-quality static HTML page at cert/{16-char-hash-prefix}.html.

Requirements: Python 3.8+ stdlib only (no third-party deps).
"""

import hashlib
import json
import os
import sys
import glob
import re
from datetime import datetime, timezone


# ---------------------------------------------------------------------------
# Safe format_map helper — missing keys produce empty string, not KeyError
# ---------------------------------------------------------------------------
class SafeDict(dict):
    def __missing__(self, key):
        return ""


def fmt(template, **kwargs):
    """Fill template with kwargs; missing keys → empty string."""
    return template.format_map(SafeDict(kwargs))


# ---------------------------------------------------------------------------
# Hash computation
# ---------------------------------------------------------------------------
def canonical_json(data: dict) -> bytes:
    """Produce canonical UTF-8 JSON bytes for hashing.
    sort_keys=True, no extra spaces, compact separators."""
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def compute_hash(data: dict) -> str:
    """Return full 64-char hex SHA-256 of canonical JSON."""
    return hashlib.sha256(canonical_json(data)).hexdigest()


# ---------------------------------------------------------------------------
# Data extraction helpers
# ---------------------------------------------------------------------------
def get(d, *keys, default=""):
    """Safe deep-get from nested dicts/lists."""
    cur = d
    for k in keys:
        if isinstance(cur, dict):
            cur = cur.get(k, default)
        elif isinstance(cur, list) and isinstance(k, int) and k < len(cur):
            cur = cur[k]
        else:
            return default
    return cur if cur is not None else default


def format_zar(amount):
    """Format an integer ZAR amount as R 1,234,567"""
    try:
        return "R {:,}".format(int(amount))
    except (ValueError, TypeError):
        return str(amount)


def provenance_html(entries):
    """Build an accessible <ol> provenance timeline."""
    if not entries:
        return "<p>No provenance entries recorded.</p>"
    items = []
    for entry in entries:
        date = entry.get("date", "")
        event = entry.get("event", "").title()
        source = entry.get("source", "")
        notes = entry.get("notes", "")
        items.append(
            f"""<li class="prov-item">
  <div class="prov-date">{date}</div>
  <div class="prov-body">
    <div class="prov-event">{event}</div>
    <div class="prov-source">{source}</div>
    {f'<div class="prov-notes">{notes}</div>' if notes else ""}
  </div>
</li>"""
        )
    return "<ol class='prov-list'>\n" + "\n".join(items) + "\n</ol>"


def valuations_html(entries):
    """Build valuation cards."""
    if not entries:
        return "<p>No valuations recorded.</p>"
    cards = []
    for v in entries:
        date = v.get("date", "")
        amount = format_zar(v.get("amount_zar", ""))
        assessor = v.get("assessor", "")
        confidence = v.get("confidence", "")
        notes = v.get("notes", "")
        cards.append(
            f"""<div class="val-card">
  <div class="val-amount">{amount}</div>
  <div class="val-meta">{date} · {assessor}</div>
  {f'<div class="val-confidence">Confidence: {confidence}</div>' if confidence else ""}
  {f'<div class="val-notes">{notes}</div>' if notes else ""}
</div>"""
        )
    return "\n".join(cards)


def condition_html(entries):
    """Build condition report card."""
    if not entries:
        return "<p>No condition reports recorded.</p>"
    parts = []
    for c in entries:
        date = c.get("date", "")
        state = c.get("state", "").title()
        notes = c.get("notes", "")
        assessor = c.get("assessor", "")
        parts.append(
            f"""<div class="cond-card">
  <div class="cond-state cond-{c.get('state','').replace(' ','-')}">{state}</div>
  <div class="cond-meta">{date} · {assessor}</div>
  {f'<div class="cond-notes">{notes}</div>' if notes else ""}
</div>"""
        )
    return "\n".join(parts)


def html_escape(s):
    """Minimal HTML-escape for text that will be inserted into attributes or body."""
    return (str(s)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&#39;"))


def sister_works_html(sisters):
    """Build the sister-artworks grid (or placeholder if empty).

    `sisters` is a list of dicts: { hash, similarity, title, artist, year, medium, image_url, url }
    Written by scripts/compute-sister-works.py.
    """
    if not sisters:
        return (
            '<div class="sister-placeholder">'
            "Sister artworks will appear here once the graph has more certificates. "
            "These are determined by cosine similarity over the 768-dimensional "
            "embeddings of the full Attesté provenance graph."
            "</div>"
        )

    parts = [
        '<p class="sister-intro">These certificates sit closest to this one in the Attesté graph '
        'by semantic similarity over 768-dimensional embeddings of artist, medium, period and provenance.</p>',
        '<div class="sister-grid" role="list">',
    ]
    for s in sisters:
        title = html_escape(s.get("title", "Untitled"))
        artist = html_escape(s.get("artist", "Unknown"))
        year = html_escape(s.get("year", ""))
        medium = html_escape(s.get("medium", ""))
        image = html_escape(s.get("image_url", ""))
        url = html_escape(s.get("url") or f"/cert/{s.get('hash', '')}.html")
        sim = s.get("similarity", 0)
        try:
            sim_pct = f"{float(sim) * 100:.0f}% match"
        except Exception:
            sim_pct = ""

        meta_line = artist
        if year:
            meta_line += f" · {year}"

        parts.append(
            f'<a class="sister-card" href="{url}" role="listitem" '
            f'aria-label="Sister artwork: {title} by {artist}">'
            f'<img class="sister-card-image" src="{image}" alt="{title} by {artist}" '
            f'loading="lazy" width="400" height="300">'
            f'<div class="sister-card-body">'
            f'<div class="sister-card-title">{title}</div>'
            f'<div class="sister-card-artist">{meta_line}</div>'
            f'<div class="sister-card-meta">'
            f'<span>{html_escape(medium)}</span>'
            f'<span class="sister-card-sim">{sim_pct}</span>'
            f'</div>'
            f'</div>'
            f'</a>'
        )
    parts.append('</div>')
    return "\n".join(parts)


def faq_jsonld(title, artist, short_hash):
    """Return a FAQPage JSON-LD dict for this specific certificate."""
    url = f"https://atteste.art/cert/{short_hash}.html"
    return {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": f"What does the Attesté Certificate for '{title}' prove?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": (
                        f"This certificate proves that the provenance record for '{title}' by {artist} was "
                        "cryptographically hashed using SHA-256 at the time of issuance. The hash links the "
                        "artwork's metadata — title, artist, dimensions, medium, provenance chain, valuations, "
                        "and condition reports — to a single tamper-evident fingerprint. Any change to the "
                        "underlying data would produce a different hash, making tampering detectable. "
                        "Attesté does not assert the authenticity of the physical artwork itself."
                    ),
                },
            },
            {
                "@type": "Question",
                "name": "Who can verify an Attesté Certificate?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": (
                        "Anyone can verify this certificate. The page embeds the canonical JSON data and a "
                        "client-side SHA-256 verification button that re-computes the hash in your browser "
                        "using the Web Crypto API and checks it against the displayed hash. No login or "
                        "account is required. Galleries, auction houses, insurers, and researchers can "
                        f"cite this URL ({url}) as the canonical reference."
                    ),
                },
            },
            {
                "@type": "Question",
                "name": "Can I share this certificate URL publicly?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": (
                        f"Yes. The URL {url} is permanent and publicly indexable. "
                        "It is edge-cached on Netlify's CDN and will remain live as long as the Attesté "
                        "platform operates. If the collector ever revokes the public opt-in, the page "
                        "will serve an HTTP 410 notice; the hash and metadata are retained in Firestore "
                        "for audit purposes only and are no longer publicly displayed."
                    ),
                },
            },
            {
                "@type": "Question",
                "name": "Does Attesté authenticate the artwork's physical authenticity?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": (
                        "No. Attesté Certificates record and cryptographically seal the provenance information "
                        "as reported by the owner. Attesté asserts: 'the owner reported these facts; the hash "
                        "chain is intact.' Physical authenticity, attribution, and forgery detection require "
                        "specialist art-historical and scientific analysis beyond the scope of this certificate. "
                        "Always consult a qualified conservator or auction house specialist for authenticity opinions."
                    ),
                },
            },
        ],
    }


# ---------------------------------------------------------------------------
# HTML template
# ---------------------------------------------------------------------------
TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<!-- Primary SEO -->
<title>{title} by {artist} &mdash; Attesté Certificate</title>
<meta name="description" content="{meta_description}">
<meta name="author" content="Yield SPM (Pty) Ltd">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
<meta name="theme-color" content="#1A1A2E">
<meta name="generator" content="Attesté Certificate Generator v1.0">

<!-- Canonical + hreflang -->
<link rel="canonical" href="https://atteste.art/cert/{short_hash}.html">
<link rel="alternate" hreflang="en" href="https://atteste.art/cert/{short_hash}.html">
<link rel="alternate" hreflang="x-default" href="https://atteste.art/cert/{short_hash}.html">

<!-- Open Graph -->
<meta property="og:type" content="article">
<meta property="og:url" content="https://atteste.art/cert/{short_hash}.html">
<meta property="og:site_name" content="Attesté">
<meta property="og:title" content="{title} by {artist} &mdash; Attesté Certificate">
<meta property="og:description" content="{meta_description}">
<meta property="og:image" content="{image_url}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="1200">
<meta property="og:locale" content="en_ZA">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@atteste_art">
<meta name="twitter:title" content="{title} by {artist} &mdash; Attesté Certificate">
<meta name="twitter:description" content="{meta_description}">
<meta name="twitter:image" content="{image_url}">

<!-- Fonts -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">

<!-- Sitemap -->
<link rel="sitemap" type="application/xml" href="/sitemap.xml">

<!-- JSON-LD: VisualArtwork -->
<script type="application/ld+json">
{jsonld_artwork}
</script>

<!-- JSON-LD: BreadcrumbList -->
<script type="application/ld+json">
{jsonld_breadcrumb}
</script>

<!-- JSON-LD: ClaimReview -->
<script type="application/ld+json">
{jsonld_claimreview}
</script>

<!-- JSON-LD: FAQPage -->
<script type="application/ld+json">
{jsonld_faq}
</script>

<!-- Canonical JSON-LD for client-side verification -->
<script type="application/json" id="cert-canonical-data">
{canonical_json_blob}
</script>

<style>
/* =============================================
   Attesté Certificate Page — Inline Styles
   Brand: #1A1A2E navy, #C9A96E gold, #F5F0E8 cream
   ============================================= */
*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}

:root {{
  --navy: #1A1A2E;
  --navy-light: #232340;
  --navy-mid: #2a2a4a;
  --gold: #C9A96E;
  --gold-light: #e8c98a;
  --cream: #F5F0E8;
  --cream-dark: #e8e0d4;
  --teal: #4a8fa8;
  --teal-light: #5ba5c0;
  --text-primary: #F5F0E8;
  --text-secondary: rgba(245,240,232,0.72);
  --text-muted: rgba(245,240,232,0.45);
  --border: rgba(201,169,110,0.18);
  --border-subtle: rgba(201,169,110,0.08);
  --radius: 8px;
  --radius-lg: 16px;
  --shadow: 0 4px 24px rgba(0,0,0,0.32);
}}

body {{
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  background: var(--navy);
  color: var(--text-primary);
  font-size: 16px;
  line-height: 1.6;
  min-height: 100vh;
}}

/* ---- Layout ---- */
.site-header {{
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(26,26,46,0.94);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--border);
  padding: 0 24px;
}}
.header-inner {{
  max-width: 840px;
  margin: 0 auto;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}}
.wordmark {{
  font-family: 'Playfair Display', serif;
  font-size: 1.25rem;
  color: var(--cream);
  text-decoration: none;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}}
.wordmark span {{ color: var(--gold); }}

.breadcrumb {{
  font-size: 0.8rem;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}}
.breadcrumb a {{ color: var(--text-muted); text-decoration: none; }}
.breadcrumb a:hover {{ color: var(--gold); }}
.breadcrumb .sep {{ color: var(--text-muted); opacity: 0.5; }}

.share-btn {{
  background: none;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 0.8rem;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;
  font-family: 'Inter', sans-serif;
}}
.share-btn:hover {{ border-color: var(--gold); color: var(--gold); }}

.content {{
  max-width: 840px;
  margin: 0 auto;
  padding: 0 24px 80px;
}}

/* ---- DEMO Banner ---- */
.demo-banner {{
  background: rgba(201,169,110,0.12);
  border: 1px solid var(--gold);
  border-radius: var(--radius);
  padding: 12px 20px;
  margin: 24px 0 0;
  font-size: 0.82rem;
  color: var(--gold-light);
  line-height: 1.5;
}}
.demo-banner strong {{ color: var(--gold); }}

/* ---- Hero ---- */
.hero {{
  padding: 32px 0 0;
}}
.hero-image-wrap {{
  position: relative;
  width: 100%;
  aspect-ratio: 1/1;
  max-height: 480px;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--navy-mid);
  margin-bottom: 28px;
}}
.hero-image {{
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  border-radius: var(--radius-lg);
}}
.demo-badge {{
  position: absolute;
  top: 16px;
  left: 16px;
  background: rgba(201,169,110,0.92);
  color: var(--navy);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 4px 12px;
  border-radius: 20px;
}}
.cert-label {{
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--teal);
  margin-bottom: 8px;
}}
.hero-title {{
  font-family: 'Playfair Display', serif;
  font-size: clamp(1.6rem, 4vw, 2.4rem);
  font-weight: 700;
  color: var(--cream);
  line-height: 1.2;
  margin-bottom: 12px;
}}
.hero-meta {{
  color: var(--text-secondary);
  font-size: 1rem;
  margin-bottom: 6px;
}}
.hero-meta strong {{ color: var(--cream); }}
.hero-dims {{
  font-size: 0.88rem;
  color: var(--text-muted);
  margin-top: 4px;
}}

.demo-disclosure {{
  margin-top: 20px;
  font-size: 0.8rem;
  color: var(--text-muted);
  font-style: italic;
  border-left: 2px solid var(--border);
  padding-left: 12px;
  line-height: 1.5;
}}

/* ---- Section headings ---- */
.section {{
  margin-top: 48px;
}}
.section-head {{
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}}
.section-icon {{
  font-size: 1.1rem;
  flex-shrink: 0;
}}
.section-title {{
  font-family: 'Playfair Display', serif;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--cream);
  letter-spacing: 0.02em;
}}

/* ---- Crypto panel ---- */
.crypto-panel {{
  background: var(--navy-mid);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px 28px;
}}
.hash-label {{
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 8px;
}}
.hash-value {{
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.78rem;
  color: var(--teal-light);
  word-break: break-all;
  background: rgba(0,0,0,0.25);
  padding: 10px 14px;
  border-radius: var(--radius);
  border: 1px solid rgba(91,165,192,0.25);
  margin-bottom: 20px;
  line-height: 1.7;
}}
.crypto-meta {{
  display: flex;
  gap: 32px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}}
.crypto-meta-item {{
  display: flex;
  flex-direction: column;
  gap: 2px;
}}
.crypto-meta-item .label {{
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}}
.crypto-meta-item .value {{
  font-size: 0.9rem;
  color: var(--cream);
  font-weight: 500;
}}
.verify-btn {{
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--teal);
  color: white;
  border: none;
  padding: 10px 22px;
  border-radius: 24px;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  font-family: 'Inter', sans-serif;
  transition: background 0.2s;
  letter-spacing: 0.04em;
}}
.verify-btn:hover {{ background: var(--teal-light); }}
.verify-result {{
  margin-top: 14px;
  font-size: 0.88rem;
  min-height: 1.4em;
  font-weight: 500;
}}
.verify-ok {{ color: #5dd67a; }}
.verify-fail {{ color: #f47070; }}

/* ---- Provenance ---- */
.prov-list {{
  list-style: none;
  position: relative;
  padding-left: 0;
}}
.prov-item {{
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 16px;
  padding: 16px 0;
  border-bottom: 1px solid var(--border-subtle);
  position: relative;
}}
.prov-item:last-child {{ border-bottom: none; }}
.prov-date {{
  font-size: 0.82rem;
  color: var(--gold);
  font-weight: 600;
  padding-top: 2px;
}}
.prov-event {{
  font-weight: 600;
  color: var(--cream);
  margin-bottom: 2px;
  font-size: 0.95rem;
}}
.prov-source {{
  font-size: 0.88rem;
  color: var(--text-secondary);
}}
.prov-notes {{
  font-size: 0.82rem;
  color: var(--text-muted);
  margin-top: 4px;
  font-style: italic;
}}

/* ---- Valuations & Condition ---- */
.two-col {{
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}}
@media (max-width: 580px) {{
  .two-col {{ grid-template-columns: 1fr; }}
  .prov-item {{ grid-template-columns: 80px 1fr; gap: 10px; }}
  .crypto-meta {{ gap: 20px; }}
}}
.val-card, .cond-card {{
  background: var(--navy-mid);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px 20px;
}}
.val-amount {{
  font-family: 'Playfair Display', serif;
  font-size: 1.5rem;
  color: var(--gold);
  font-weight: 700;
  margin-bottom: 6px;
}}
.val-meta, .cond-meta {{
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-bottom: 6px;
}}
.val-confidence, .val-notes, .cond-notes {{
  font-size: 0.82rem;
  color: var(--text-secondary);
  margin-top: 4px;
}}
.cond-state {{
  font-size: 1.05rem;
  font-weight: 700;
  margin-bottom: 6px;
  text-transform: capitalize;
}}
.cond-excellent {{ color: #5dd67a; }}
.cond-very-good {{ color: #8fd4a0; }}
.cond-good {{ color: #b8d48a; }}
.cond-fair {{ color: #e8c97a; }}
.cond-poor {{ color: #f47070; }}

/* ---- Context ---- */
.context-para {{
  font-size: 0.95rem;
  color: var(--text-secondary);
  line-height: 1.75;
}}
.context-attribution {{
  margin-top: 12px;
  font-size: 0.75rem;
  color: var(--text-muted);
  font-style: italic;
}}

/* ---- Sister artworks ---- */
.sister-placeholder {{
  background: var(--navy-mid);
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  padding: 32px 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.88rem;
  line-height: 1.6;
}}
.sister-intro {{
  font-size: 0.88rem;
  color: var(--text-muted);
  margin: 0 0 16px 0;
  line-height: 1.6;
}}
.sister-grid {{
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 18px;
  margin-top: 12px;
}}
.sister-card {{
  display: flex;
  flex-direction: column;
  background: var(--navy-mid);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  text-decoration: none;
  color: inherit;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}}
.sister-card:hover,
.sister-card:focus-visible {{
  transform: translateY(-3px);
  border-color: var(--accent-teal);
  box-shadow: 0 10px 32px rgba(0,0,0,0.32);
  outline: none;
}}
.sister-card-image {{
  aspect-ratio: 4 / 3;
  width: 100%;
  object-fit: cover;
  background: var(--navy-deep);
  display: block;
}}
.sister-card-body {{
  padding: 14px 14px 16px 14px;
}}
.sister-card-title {{
  font-family: 'Playfair Display', serif;
  font-size: 1.02rem;
  line-height: 1.3;
  margin: 0 0 4px 0;
  color: var(--cream);
}}
.sister-card-artist {{
  font-size: 0.82rem;
  color: var(--text-secondary);
  margin: 0 0 10px 0;
}}
.sister-card-meta {{
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.74rem;
  color: var(--text-muted);
  font-family: 'SF Mono', Menlo, monospace;
  letter-spacing: 0.02em;
}}
.sister-card-sim {{
  background: rgba(2,128,125,0.15);
  color: var(--accent-teal);
  padding: 2px 7px;
  border-radius: 3px;
  font-size: 0.7rem;
}}

/* ---- About ---- */
.about-text {{
  font-size: 0.92rem;
  color: var(--text-secondary);
  line-height: 1.75;
}}
.about-text a {{
  color: var(--teal-light);
  text-decoration: underline;
  text-underline-offset: 2px;
}}
.about-text a:hover {{ color: var(--gold); }}

/* ---- Footer ---- */
.footer {{
  background: var(--navy-light);
  border-top: 1px solid var(--border);
  padding: 48px 24px 32px;
  margin-top: 80px;
}}
.footer-inner {{
  max-width: 840px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr;
  gap: 40px;
}}
@media (max-width: 700px) {{
  .footer-inner {{ grid-template-columns: 1fr 1fr; gap: 24px; }}
}}
@media (max-width: 420px) {{
  .footer-inner {{ grid-template-columns: 1fr; gap: 20px; }}
}}
.footer-brand {{
  font-family: 'Playfair Display', serif;
  font-size: 1.4rem;
  color: var(--cream);
  margin-bottom: 10px;
}}
.footer-brand span {{ color: var(--gold); }}
.footer-tagline {{
  font-size: 0.82rem;
  color: var(--text-muted);
  line-height: 1.6;
}}
.footer-col h4 {{
  font-size: 0.75rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--gold);
  margin-bottom: 12px;
  font-weight: 600;
}}
.footer-col a {{
  display: block;
  font-size: 0.85rem;
  color: var(--text-muted);
  text-decoration: none;
  margin-bottom: 8px;
  transition: color 0.15s;
}}
.footer-col a:hover {{ color: var(--gold-light); }}
.footer-bottom {{
  max-width: 840px;
  margin: 32px auto 0;
  padding-top: 20px;
  border-top: 1px solid var(--border-subtle);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.78rem;
  color: var(--text-muted);
  flex-wrap: wrap;
  gap: 8px;
}}

/* ---- Print ---- */
@media print {{
  .site-header, .share-btn, .verify-btn, .footer {{ display: none; }}
  body {{ background: white; color: black; }}
  .hash-value {{ color: #004466; background: #f0f8ff; border-color: #99ccdd; }}
  .hero-image {{ filter: grayscale(1); }}
  .section {{ break-inside: avoid; }}
  .demo-disclosure {{ color: #666; }}
  .val-card, .cond-card, .crypto-panel {{ background: #f9f9f9; border-color: #ddd; }}
  .val-amount {{ color: #7a5c00; }}
  .prov-date {{ color: #7a5c00; }}
  .hero-title {{ color: black; }}
}}
</style>
</head>

<body>

<!-- HEADER -->
<header class="site-header" role="banner">
  <div class="header-inner">
    <a href="https://atteste.art/" class="wordmark" aria-label="Attesté home">Attest<span>é</span></a>
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="https://atteste.art/">Home</a>
      <span class="sep" aria-hidden="true">›</span>
      <a href="https://atteste.art/cert/">Certificates</a>
      <span class="sep" aria-hidden="true">›</span>
      <span aria-current="page">{short_title}</span>
    </nav>
    <button class="share-btn" onclick="shareOrCopy()" aria-label="Share this certificate">Share</button>
  </div>
</header>

<main class="content" id="main">

  {demo_banner}

  <!-- HERO -->
  <section class="hero" aria-labelledby="artwork-title">
    <div class="hero-image-wrap">
      <img
        src="{image_url}"
        alt="{image_alt}"
        class="hero-image"
        width="840"
        height="840"
        loading="lazy"
      >
      {demo_badge}
    </div>

    <div class="cert-label">Attesté Certificate</div>
    <h1 class="hero-title" id="artwork-title">{title}</h1>
    <p class="hero-meta">by <strong>{artist}</strong>{year_str}</p>
    <p class="hero-meta">{medium}{dims_str}</p>

    <p class="demo-disclosure">This is a DEMO certificate. No real artwork, collector, or gallery is represented. It exists to illustrate the Attesté public provenance graph.</p>
  </section>

  <!-- CRYPTOGRAPHIC INTEGRITY -->
  <section class="section" aria-labelledby="crypto-heading" id="verify">
    <div class="section-head">
      <span class="section-icon" aria-hidden="true">🔒</span>
      <h2 class="section-title" id="crypto-heading">Cryptographic Integrity</h2>
    </div>
    <div class="crypto-panel">
      <div class="hash-label">SHA-256 Hash (full 64-char)</div>
      <div class="hash-value" id="cert-hash" aria-label="Certificate SHA-256 hash">{hash_full}</div>
      <div class="crypto-meta">
        <div class="crypto-meta-item">
          <span class="label">Issued</span>
          <span class="value">{issued_date}</span>
        </div>
        <div class="crypto-meta-item">
          <span class="label">Version</span>
          <span class="value">{cert_version}</span>
        </div>
        <div class="crypto-meta-item">
          <span class="label">Status</span>
          <span class="value">{cert_status_display}</span>
        </div>
      </div>
      <button class="verify-btn" onclick="verifyCert()" aria-label="Verify certificate hash in browser">
        <span>Verify</span>
      </button>
      <div class="verify-result" id="verify-result" role="status" aria-live="polite"></div>
    </div>
  </section>

  <!-- PROVENANCE CHAIN -->
  <section class="section" aria-labelledby="prov-heading" id="provenance">
    <div class="section-head">
      <span class="section-icon" aria-hidden="true">📜</span>
      <h2 class="section-title" id="prov-heading">Provenance Chain</h2>
    </div>
    {provenance_html}
  </section>

  <!-- VALUATIONS + CONDITION -->
  <section class="section" aria-labelledby="val-heading">
    <div class="section-head">
      <span class="section-icon" aria-hidden="true">📊</span>
      <h2 class="section-title" id="val-heading">Valuations &amp; Condition</h2>
    </div>
    <div class="two-col">
      <div>
        <h3 style="font-size:0.8rem;letter-spacing:.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:12px;">Valuations</h3>
        {valuations_html}
      </div>
      <div>
        <h3 style="font-size:0.8rem;letter-spacing:.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:12px;">Condition</h3>
        {condition_html}
      </div>
    </div>
  </section>

  <!-- CONTEXT -->
  <section class="section" aria-labelledby="ctx-heading">
    <div class="section-head">
      <span class="section-icon" aria-hidden="true">🎨</span>
      <h2 class="section-title" id="ctx-heading">Art-Historical Context</h2>
    </div>
    <p class="context-para">{context_paragraph}</p>
    <p class="context-attribution">Generated by {context_model} &middot; audited 2026-04-17 &middot; confidence {context_confidence}</p>
  </section>

  <!-- SISTER ARTWORKS -->
  <section class="section" aria-labelledby="sister-heading">
    <div class="section-head">
      <span class="section-icon" aria-hidden="true">🔗</span>
      <h2 class="section-title" id="sister-heading">Sister Artworks</h2>
    </div>
    {sister_works_html}
  </section>

  <!-- ABOUT THIS CERTIFICATE -->
  <section class="section" aria-labelledby="about-heading">
    <div class="section-head">
      <span class="section-icon" aria-hidden="true">ℹ</span>
      <h2 class="section-title" id="about-heading">About This Certificate</h2>
    </div>
    <div class="about-text">
      <p>An <strong>Attesté Certificate</strong> is a cryptographically-secured public record of an artwork's provenance, issued by the <a href="https://atteste.art/" rel="noopener">Attesté platform</a> on behalf of a consenting collector. Every certificate includes the artwork's title, artist, dimensions, medium, provenance chain, valuations, and condition reports — all hashed together into a single SHA-256 fingerprint.</p>
      <p style="margin-top:12px;">The certificate's hash binds the data to a point in time. Any modification to the underlying record would produce a different hash, making tampering detectable by anyone who runs the verify function above. Attesté asserts: <em>"the owner reported these facts; the hash chain is intact."</em> Attesté does not claim to authenticate the physical artwork itself.</p>
      <p style="margin-top:12px;">Galleries, auction houses, insurers, and researchers may cite this URL as the canonical provenance reference. This page is edge-cached globally and permanently indexed by search engines. To issue certificates for your own collection, visit <a href="https://atteste.art/" rel="noopener">atteste.art</a> or download the app from <a href="https://atteste-b6409.web.app" rel="noopener">atteste-b6409.web.app</a>.</p>
    </div>
  </section>

  <!-- FAQ (structured, screen-reader visible but visually subtle) -->
  <section class="section" aria-labelledby="faq-heading">
    <div class="section-head">
      <span class="section-icon" aria-hidden="true">❓</span>
      <h2 class="section-title" id="faq-heading">Frequently Asked Questions</h2>
    </div>
    {faq_html}
  </section>

</main>

<!-- FOOTER -->
<footer class="footer" role="contentinfo">
  <div class="footer-inner">
    <div>
      <div class="footer-brand">Attest<span>é</span></div>
      <p class="footer-tagline">Your art collection deserves a memory. AI-powered provenance, discovery, and community for collectors who care about the story behind every piece.</p>
    </div>
    <div class="footer-col">
      <h4>Platform</h4>
      <a href="https://atteste.art/#features">Features</a>
      <a href="https://atteste.art/#pricing">Pricing</a>
      <a href="https://atteste.art/#provenance">Provenance</a>
      <a href="https://atteste.art/galleries.html">For Galleries</a>
      <a href="https://atteste.art/cert/">Certificates</a>
    </div>
    <div class="footer-col">
      <h4>Company</h4>
      <a href="https://atteste.art/#story">Our Story</a>
      <a href="mailto:info@atteste.art">Contact</a>
      <a href="https://atteste.art/privacy.html">Privacy Policy</a>
      <a href="https://atteste.art/terms.html">Terms of Service</a>
    </div>
    <div class="footer-col">
      <h4>Connect</h4>
      <a href="https://www.instagram.com/atteste.art" target="_blank" rel="noopener noreferrer">Instagram</a>
      <a href="https://www.linkedin.com/company/atteste" target="_blank" rel="noopener noreferrer">LinkedIn</a>
      <a href="mailto:info@atteste.art">info@atteste.art</a>
    </div>
  </div>
  <div class="footer-bottom">
    <div>&copy; 2026 Attesté. All rights reserved.</div>
    <div>Made with care in South Africa</div>
  </div>
</footer>

<!-- INLINE SCRIPTS -->
<script>
/* Share / Copy URL */
function shareOrCopy() {{
  const url = window.location.href;
  if (navigator.share) {{
    navigator.share({{ title: document.title, url: url }}).catch(() => {{}});
  }} else if (navigator.clipboard) {{
    navigator.clipboard.writeText(url).then(() => {{
      const btn = document.querySelector('.share-btn');
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => {{ btn.textContent = orig; }}, 2000);
    }}).catch(() => {{}});
  }}
}}

/* Client-side hash verification via Web Crypto */
async function verifyCert() {{
  const resultEl = document.getElementById('verify-result');
  const expectedHash = document.getElementById('cert-hash').textContent.trim();
  resultEl.textContent = 'Verifying...';
  resultEl.className = 'verify-result';

  try {{
    const jsonEl = document.getElementById('cert-canonical-data');
    if (!jsonEl) {{
      resultEl.textContent = '⚠ Canonical data block not found.';
      return;
    }}
    const rawJson = jsonEl.textContent.trim();
    // Re-serialise with sorted keys to match Python's json.dumps(sort_keys=True)
    const parsed = JSON.parse(rawJson);
    const canonical = sortedStringify(parsed);
    const enc = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(canonical));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    if (hashHex === expectedHash) {{
      resultEl.innerHTML = '&#x2705; Hash verified — cryptographic record is intact.';
      resultEl.className = 'verify-result verify-ok';
    }} else {{
      resultEl.innerHTML = '&#x274C; Hash mismatch — record may have been modified.';
      resultEl.className = 'verify-result verify-fail';
    }}
  }} catch (err) {{
    resultEl.textContent = '⚠ Verification error: ' + err.message;
  }}
}}

/* Recursively sort object keys for canonical JSON serialisation */
function sortedStringify(value) {{
  if (Array.isArray(value)) {{
    return '[' + value.map(sortedStringify).join(',') + ']';
  }}
  if (value !== null && typeof value === 'object') {{
    const keys = Object.keys(value).sort();
    const pairs = keys.map(k => JSON.stringify(k) + ':' + sortedStringify(value[k]));
    return '{{' + pairs.join(',') + '}}';
  }}
  return JSON.stringify(value);
}}
</script>

</body>
</html>
"""


def faq_html_from_jsonld(faq_dict):
    """Render FAQ items as accessible HTML (schema.org data mirrored in DOM)."""
    items = faq_dict.get("mainEntity", [])
    parts = []
    for q in items:
        question = q.get("name", "")
        answer = q.get("acceptedAnswer", {}).get("text", "")
        parts.append(
            f"""<details style="margin-bottom:14px;border-bottom:1px solid rgba(201,169,110,0.12);padding-bottom:14px;">
  <summary style="cursor:pointer;font-weight:600;color:var(--cream);font-size:0.95rem;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:12px;" aria-label="{question}">
    {question}
    <span style="color:var(--gold);font-size:0.8rem;flex-shrink:0;">&#9660;</span>
  </summary>
  <p style="margin-top:10px;font-size:0.88rem;color:var(--text-secondary);line-height:1.7;">{answer}</p>
</details>"""
        )
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Main render
# ---------------------------------------------------------------------------
def render_cert(cert_path: str, out_dir: str = "cert") -> str:
    """Render a cert JSON to an HTML file. Returns the output path."""
    with open(cert_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # ---- Hash verification ----
    hash_full = compute_hash(data)
    # If the JSON already has a hash_full set and it's non-empty, verify it
    declared = data.get("hash_full", "")
    if declared and declared != hash_full:
        raise ValueError(
            f"Hash mismatch in {cert_path}:\n"
            f"  declared:  {declared}\n"
            f"  computed:  {hash_full}"
        )
    # Stamp the computed hash into a copy for embedding
    data_with_hash = dict(data)
    data_with_hash["hash_full"] = hash_full

    short_hash = hash_full[:16]

    # ---- Extract fields ----
    artwork = data.get("artwork", {})
    title = get(artwork, "title", default="Untitled")
    artist_name = get(artwork, "artist", "name", default="Unknown Artist")
    year = get(artwork, "year", default="")
    medium = get(artwork, "medium", default="")
    surface = get(artwork, "surface", default="")
    dims = artwork.get("dimensions_cm", {})
    dim_w = dims.get("width", "")
    dim_h = dims.get("height", "")
    location_created = get(artwork, "location_created", default="")
    image_url = get(artwork, "image_url", default="")
    status = data.get("status", "active")
    version = data.get("version", "1.0")
    issued_at = data.get("issued_at", "")
    try:
        issued_date = datetime.fromisoformat(issued_at.replace("Z", "+00:00")).strftime("%d %B %Y")
    except Exception:
        issued_date = issued_at

    context_block = data.get("context", {})
    context_paragraph = context_block.get("paragraph", "")
    context_model = context_block.get("generated_by", "gemma2:9b")
    context_confidence = str(context_block.get("confidence", ""))
    if context_confidence:
        try:
            context_confidence = f"{float(context_confidence):.0%}"
        except Exception:
            pass

    # ---- Derived display strings ----
    year_str = f", {year}" if year else ""
    dims_str = ""
    if dim_w and dim_h:
        dims_str = f" · {dim_w} × {dim_h} cm"
    medium_surface = medium
    if surface and surface.lower() != medium.lower():
        medium_surface = f"{medium} on {surface}"

    short_title = title[:40] + ("…" if len(title) > 40 else "")
    image_alt = f"{title} by {artist_name}{year_str} — Attesté provenance certificate"

    meta_description = (
        f"Attesté Certificate for '{title}' by {artist_name} ({year}). "
        f"Cryptographic provenance on Attesté — SHA-256 verified, publicly indexed."
    )
    if len(meta_description) > 155:
        meta_description = meta_description[:152] + "..."

    cert_status_display = {"demo": "DEMO", "active": "Active", "superseded": "Superseded", "revoked": "Revoked"}.get(
        status, status.title()
    )

    # ---- Demo-specific HTML ----
    demo_banner = ""
    demo_badge = ""
    if status == "demo":
        demo_banner = (
            '<div class="demo-banner" role="note">'
            "<strong>DEMO CERTIFICATE</strong> — This page is a demonstration of the Attesté public provenance graph format. "
            "No real artwork, artist, collector, or gallery is represented. All data is fictional."
            "</div>"
        )
        demo_badge = '<div class="demo-badge" aria-label="Demo certificate">DEMO</div>'

    # ---- JSON-LD blocks ----
    jsonld_artwork = {
        "@context": "https://schema.org",
        "@type": "VisualArtwork",
        "@id": f"https://atteste.art/cert/{short_hash}.html",
        "name": title,
        "headline": f"{title} by {artist_name} — Attesté Certificate",
        "creator": {"@type": "Person", "name": artist_name},
        "dateCreated": str(year),
        "artMedium": medium,
        "artworkSurface": surface,
        "image": image_url,
        "identifier": [
            {"@type": "PropertyValue", "propertyID": "sha256", "value": hash_full},
            {
                "@type": "PropertyValue",
                "propertyID": "attesté-cert-url",
                "value": f"https://atteste.art/cert/{short_hash}.html",
            },
        ],
        "provenance": f"See provenance chain at https://atteste.art/cert/{short_hash}.html#provenance",
        "publisher": {"@id": "https://atteste.art/#organization"},
    }
    if dim_w:
        jsonld_artwork["width"] = {"@type": "QuantitativeValue", "value": dim_w, "unitCode": "CMT"}
    if dim_h:
        jsonld_artwork["height"] = {"@type": "QuantitativeValue", "value": dim_h, "unitCode": "CMT"}
    if location_created:
        jsonld_artwork["locationCreated"] = {"@type": "Place", "name": location_created}

    jsonld_breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://atteste.art/"},
            {
                "@type": "ListItem",
                "position": 2,
                "name": "Certificates",
                "item": "https://atteste.art/cert/",
            },
            {
                "@type": "ListItem",
                "position": 3,
                "name": title,
                "item": f"https://atteste.art/cert/{short_hash}.html",
            },
        ],
    }

    jsonld_claimreview = {
        "@context": "https://schema.org",
        "@type": "ClaimReview",
        "url": f"https://atteste.art/cert/{short_hash}.html",
        "claimReviewed": "This artwork's provenance record is cryptographically intact",
        "itemReviewed": {
            "@type": "VisualArtwork",
            "name": title,
            "creator": {"@type": "Person", "name": artist_name},
        },
        "author": {
            "@type": "Organization",
            "name": "Attesté",
            "url": "https://atteste.art/",
        },
        "reviewRating": {
            "@type": "Rating",
            "ratingValue": "5",
            "bestRating": "5",
            "worstRating": "1",
            "alternateName": "Intact",
        },
        "datePublished": issued_at[:10] if issued_at else "2026-04-17",
    }

    faq_dict = faq_jsonld(title, artist_name, short_hash)

    # ---- Embed canonical JSON for client-side verify ----
    # We embed the data WITH hash_full stamped in, as a sorted-keys JSON blob.
    # The JS sortedStringify must reproduce what Python's sort_keys=True produces.
    canonical_json_blob = json.dumps(data_with_hash, sort_keys=True, indent=2, ensure_ascii=False)

    # ---- Assemble HTML sub-blocks ----
    prov_html = provenance_html(data.get("provenance", []))
    val_html = valuations_html(data.get("valuations", []))
    cond_html = condition_html(data.get("condition_reports", []))
    faq_html_block = faq_html_from_jsonld(faq_dict)
    sister_works_block = sister_works_html(data.get("sister_artworks", []))

    # ---- Render template ----
    html = fmt(
        TEMPLATE,
        title=title,
        artist=artist_name,
        year=str(year),
        year_str=year_str,
        medium=medium,
        surface=surface,
        medium_surface=medium_surface,
        dims_str=dims_str,
        image_url=image_url,
        image_alt=image_alt,
        short_hash=short_hash,
        hash_full=hash_full,
        issued_date=issued_date,
        cert_version=version,
        cert_status_display=cert_status_display,
        short_title=short_title,
        meta_description=meta_description,
        demo_banner=demo_banner,
        demo_badge=demo_badge,
        provenance_html=prov_html,
        valuations_html=val_html,
        condition_html=cond_html,
        context_paragraph=context_paragraph,
        context_model=context_model,
        context_confidence=context_confidence,
        faq_html=faq_html_block,
        jsonld_artwork=json.dumps(jsonld_artwork, indent=2, ensure_ascii=False),
        jsonld_breadcrumb=json.dumps(jsonld_breadcrumb, indent=2, ensure_ascii=False),
        jsonld_claimreview=json.dumps(jsonld_claimreview, indent=2, ensure_ascii=False),
        jsonld_faq=json.dumps(faq_dict, indent=2, ensure_ascii=False),
        canonical_json_blob=canonical_json_blob,
        sister_works_html=sister_works_block,
    )

    # ---- Write output ----
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{short_hash}.html")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"[ok] {out_path} · {title} by {artist_name}")
    return out_path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    args = sys.argv[1:]
    if not args:
        print("Usage:")
        print("  python3 scripts/generate-cert-page.py scripts/demo-certs/demo-001.json")
        print("  python3 scripts/generate-cert-page.py --all")
        sys.exit(1)

    # Resolve paths relative to the script location so the script can be run
    # from any directory.
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)
    cert_out_dir = os.path.join(repo_root, "cert")

    if args[0] == "--all":
        pattern = os.path.join(script_dir, "demo-certs", "*.json")
        files = sorted(glob.glob(pattern))
        if not files:
            print(f"No JSON files found matching {pattern}")
            sys.exit(1)
        for f in files:
            render_cert(f, out_dir=cert_out_dir)
    else:
        cert_file = args[0]
        if not os.path.isabs(cert_file):
            cert_file = os.path.join(os.getcwd(), cert_file)
        render_cert(cert_file, out_dir=cert_out_dir)


if __name__ == "__main__":
    main()
