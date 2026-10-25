#!/usr/bin/env python3
"""Assemble the v2 homepage from the classic one (2026-10-25).

  index.html  = classic <head> (SEO meta, JSON-LD, consent) + body.part
                + the classic FAQ, email form, footer, social rail and site scripts, verbatim
  classic.html = the previous homepage, noindex, canonical to / (rollback lives at /classic)

Run from the repo root:  python3 scripts/landing/build.py
Rebuilding from a fresh classic.html is idempotent: the source of truth for the
shared parts is classic.html once it exists.
"""
import os, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HERE = os.path.dirname(os.path.abspath(__file__))
src_path = os.path.join(ROOT, "classic.html")
if not os.path.exists(src_path):
    old = open(os.path.join(ROOT, "index.html")).read()
    classic = old.replace(
        '<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">',
        '<meta name="robots" content="noindex, follow">\n<!-- Previous homepage, kept for rollback at /classic (2026-10-25). Canonical stays on /. -->')
    assert classic != old, "robots meta not found"
    open(src_path, "w").write(classic)
classic = open(src_path).read()


def between(text, start, end, include_end=True):
    i = text.index(start)
    j = text.index(end, i) + (len(end) if include_end else 0)
    return text[i:j]


head = classic[: classic.index('<link rel="stylesheet" href="assets/css/site.css')]
head = head.replace('<meta name="robots" content="noindex, follow">\n<!-- Previous homepage, kept for rollback at /classic (2026-10-25). Canonical stays on /. -->',
                    '<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">')
head += '<link rel="stylesheet" href="assets/css/site.css?v=20260717">\n'
head += '<link rel="preload" as="image" href="assets/landing/hero.jpg">\n'

faq = between(classic, '<div class="faq-list">', '    </details>\n  </div>')
form = between(classic, '<form name="atteste-updates"', '</form>')
footer = between(classic, '<!-- FOOTER -->', '</footer>')
rail = between(classic, '<!-- Floating social rail', '</nav>')
site_scripts = between(classic, '  <script defer src="/assets/js/attribution.js', '</body>', include_end=False)

body = open(os.path.join(HERE, "body.part")).read()
tiles = ["06", "01", "10", "03", "07", "11", "09", "08", "fynbos", "tablemountain", "jazz", "12"]
tile_html = "\n    ".join(
    f'<div class="lp-tile"><video muted loop playsinline preload="none" data-ambient poster="assets/landing/alive-{t}.jpg">'
    f'<source src="assets/landing/alive-{t}.mp4" type="video/mp4"></video></div>' for t in tiles * 2)
body = body.replace("<!--TILES-->", tile_html).replace("<!--FAQ-->", faq).replace("<!--FORM-->", form)

js = """
<script>
(() => {
  const nav = document.getElementById('nav');
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 40);
  onScroll(); window.addEventListener('scroll', onScroll, { passive: true });

  const burger = document.querySelector('.lp-burger'), links = document.getElementById('lp-links');
  burger.addEventListener('click', () => {
    const open = links.classList.toggle('open'); burger.setAttribute('aria-expanded', open);
  });
  links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => links.classList.remove('open')));

  // role switcher (tabs)
  const tabs = [...document.querySelectorAll('.lp-roles [role=tab]')];
  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(o => { const on = o === t; o.setAttribute('aria-selected', on);
      document.getElementById(o.getAttribute('aria-controls')).hidden = !on; });
  }));

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // reveal on scroll
  // reveal on scroll — position check, not IntersectionObserver alone (throttled tabs can skip
  // IO callbacks and leave content invisible); a timed fallback guarantees nothing stays hidden
  let rv = [...document.querySelectorAll('.lp-reveal')];
  const showAll = () => { rv.forEach(e => e.classList.add('in')); rv = []; };
  if (reduce) showAll();
  else {
    let ticking = false;
    const check = () => { ticking = false; const h = window.innerHeight * 0.94;
      rv = rv.filter(e => { if (e.getBoundingClientRect().top < h) { e.classList.add('in'); return false; } return true; }); };
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(check); } }, { passive: true });
    window.addEventListener('resize', check); check(); setTimeout(showAll, 4000);
  }

  // ambient films: play only while on screen, never with reduced motion
  const films = document.querySelectorAll('video[data-ambient]');
  if (reduce) films.forEach(v => v.pause());
  else if ('IntersectionObserver' in window) {
    const vo = new IntersectionObserver(es => es.forEach(e => { e.isIntersecting ? e.target.play().catch(() => {}) : e.target.pause(); }), { threshold: .1 });
    films.forEach(v => vo.observe(v));
  }
  if (reduce) document.querySelectorAll('.lp-hero video').forEach(v => { v.removeAttribute('autoplay'); v.pause(); });

  document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
    navigator.clipboard && navigator.clipboard.writeText(b.dataset.copy).then(() => { b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy', 1600); });
  }));
})();
</script>
"""

page = head + body + "\n" + footer + "\n" + js + "\n" + rail + "\n\n" + site_scripts + "</body>\n</html>\n"
open(os.path.join(ROOT, "index.html"), "w").write(page)
print(f"index.html {len(page):,} bytes, classic.html {len(classic):,} bytes")
