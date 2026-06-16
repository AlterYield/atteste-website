# Hero visual — 3D iPhone with Attesté on screen

The homepage hero (`index.html` → `.hero-visual` → `.hero-device`) is **reserved** for a
premium 3D iPhone render/video. Until that asset exists it shows `collector-explorer.mp4`
in a 2D CSS phone frame as the interim. Drop the final asset into `.hero-device` (swap the
`<video>` / `<img>` src) — the frame, shadow, and rise animation already match.

Target: a slowly-rotating / floating **3D iPhone** with the **real Attesté app** on screen.

---

## Option A — Rotato (recommended for a true app render)
Rotato turns a real screen recording into a 3D device mockup video — the screen shows the
*actual* app, not an AI guess.
1. Screen-record the app (Atelier camera view, a certificate, or the dashboard) at 1080×1920.
2. Import into Rotato → iPhone 15 Pro (titanium) → slow 3D orbit / float.
3. Lighting: dark studio, warm rim light; export transparent or on `#1A1A2E`.
4. Export 1000×1586 (matches `.hero-device` aspect 1000/1586), H.264 .mp4, loop, muted.

## Option B — Higgsfield (AI render; feed a real screenshot via `--image`)
Use a real app screenshot as the on-screen reference so the UI is accurate.

**Prompt:**
> Photorealistic 3D product render of a modern titanium iPhone floating at a gentle
> three-quarter angle, centered on a deep navy background (#1A1A2E). The screen shows a
> luxury art-collection app — dark UI with warm gold accents, an artwork and a provenance
> certificate. Cinematic studio lighting with soft warm-gold rim light along the titanium
> edges, subtle reflections, a soft realistic contact shadow beneath, shallow depth of field,
> faint radial gold glow behind the device. Premium Apple-keynote product-shot aesthetic,
> minimal, elegant, ultra-detailed, 8k. Slow, weightless float.

- Aspect 9:16 (or 1000:1586). Negative: "cluttered background, logos, text artifacts, plastic, toy-like, oversaturated."
- Put the real screen via the reference image (`--image <app-screenshot.png>`) so the UI reads true.

## Notes
- Keep the gold palette (#C9A96E / #E0CFA6) and navy (#1A1A2E) so it sits in the hero.
- Do NOT use the struck-seal medallion (`assets/3d/atteste-seal-3d.jpg`) as the hero — it's a
  brand mark, not hero material; it already serves as the small `.cta-seal` lower on the page.
