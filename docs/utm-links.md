# Attesté tagged acquisition links

Companion to the app's acquisition-attribution capture (Atteste PR #404):
web signups stamp `utm_*` params onto `users/{uid}.attribution`, Android
signups read the Play `referrer=` string, iOS reports only in App Store
Connect. **Use these links — never paste bare store/app URLs into bios,
emails, or posts,** or the signup arrives unattributed.

Taxonomy: `utm_source` = channel (`website`, `instagram`, `youtube`,
`consent-email`, `referral`), `utm_medium` = placement, `utm_campaign` =
optional push name. Lowercase, hyphenated. Channel data only — never put
personal data in URL params.

## Pass-through: tag the LANDING page, not just the app link

`assets/js/attribution.js` (loaded on all 37 funnel pages) remembers the
first touch and rewrites every outbound app/store link on the page to carry
it — the web-app `utm_*`, the Play `referrer=` payload, and the Apple `ct`
token all get the true source. Without it, this site's hard-coded
`utm_source=website` overwrites the real channel on the hop and every
inbound source collapses into one bucket.

So a video only needs its own tagged **landing** link:

```
https://atteste.art/?utm_source=youtube&utm_medium=video&utm_campaign=<video-slug>
```

…and a viewer who lands there and then taps any store badge or "Open the
app" button arrives tagged `youtube / video / <video-slug>`. Rules:

- **First touch wins.** A visitor who arrives from a video and returns a
  week later via Google still counts as the video's signup.
- **Untagged direct visits are left alone** — the authored
  `utm_source=website` links stay exactly as written.
- Give **each film its own `utm_campaign` slug** (table below), or they are
  indistinguishable from one another.
- Links pasted straight into social/email still need full tags from the
  tables below — pass-through only helps traffic that lands on this site.

## The six films — campaign slugs

Slugs are fixed here so a film keeps one identity everywhere it is posted.
**Never reuse a slug for a re-cut** — append `-v2` instead, or the two cuts'
numbers merge and you can't tell which one worked.

Read the three params as three separate questions:

| Param | Question | Value |
|---|---|---|
| `utm_source` | **Where did they watch it?** | `youtube`, `website`, `instagram`, `consent-email` — whatever actually hosted it |
| `utm_medium` | What kind of thing was it? | always `video` |
| `utm_campaign` | **Which film?** | the slug below |

Source is *not* always `youtube` — the same film embedded on atteste.art is
`utm_source=website&utm_medium=video&utm_campaign=meet-atteste`. That split is
the point: it separates "which film" from "which channel", so you can see that
the gallery tour converts on YouTube but not in email.

| Film | Track | Slug |
|---|---|---|
| V-W1 — "Meet Attesté" landing feature film | website showcase | `meet-atteste` |
| V-W2 — "See the gallery desk" demo teaser | website showcase | `gallery-desk` |
| O-1 — Gallery tour (priority sales film) | onboarding | `gallery-tour` |
| O-2 — Adding inventory | onboarding | `add-inventory` |
| O-3 — Collector app basics | onboarding | `collector-basics` |
| O-4 — Activation-code redemption | onboarding | `activation-code` |
| V-W3 — Hero device loop refresh | website showcase, *optional* | `hero-loop` (reserved — V-W3 is deprioritised; slug exists so it doesn't get improvised later) |

Source of truth for the films themselves:
`atteste-command-centre/docs/marketing-plan/video-production/`.

**Paste-ready** — landing links, one per film. Prefer these: they land on the
site, and the pass-through carries the film through to the app and both stores.

```
https://atteste.art/?utm_source=youtube&utm_medium=video&utm_campaign=meet-atteste
https://atteste.art/?utm_source=youtube&utm_medium=video&utm_campaign=gallery-desk
https://atteste.art/?utm_source=youtube&utm_medium=video&utm_campaign=gallery-tour
https://atteste.art/?utm_source=youtube&utm_medium=video&utm_campaign=add-inventory
https://atteste.art/?utm_source=youtube&utm_medium=video&utm_campaign=collector-basics
https://atteste.art/?utm_source=youtube&utm_medium=video&utm_campaign=activation-code
```

Swap `utm_source` when the film lives somewhere other than YouTube. The four
onboarding films (O-1…O-4) are async **sales** material sent to gallery
prospects, so theirs usually go out as `utm_source=consent-email`.

Read the results with `node scripts/attribution_report.js` in the Atteste repo —
the source/medium/campaign table breaks signups down per film.

## Web app (fully attributable in-app)

| Placement | Link |
|---|---|
| Instagram bio | `https://atteste-b6409.web.app/?utm_source=instagram&utm_medium=bio` |
| Instagram post/story | `https://atteste-b6409.web.app/?utm_source=instagram&utm_medium=post&utm_campaign=<campaign>` |
| Consent / outreach email | `https://atteste-b6409.web.app/?utm_source=consent-email&utm_medium=email&utm_campaign=<campaign>` |
| Lifecycle email CTA | `https://atteste-b6409.web.app/?utm_source=lifecycle-email&utm_medium=email` |
| Website (tagged in-page) | `https://atteste-b6409.web.app/?utm_source=website&utm_medium=<placement>` |
| Explainer video (description/pinned comment) | `https://atteste-b6409.web.app/?utm_source=youtube&utm_medium=video&utm_campaign=<video-slug>` |
| Explainer video → site landing (preferred) | `https://atteste.art/?utm_source=youtube&utm_medium=video&utm_campaign=<video-slug>` |

## Google Play (survives store install via Install Referrer)

Wrap the UTMs URL-encoded inside `referrer=`:

| Placement | Link |
|---|---|
| Website badge (in-page) | `https://play.google.com/store/apps/details?id=art.atteste.atteste&referrer=utm_source%3Dwebsite%26utm_medium%3Dstore-badge` |
| Instagram bio | `https://play.google.com/store/apps/details?id=art.atteste.atteste&referrer=utm_source%3Dinstagram%26utm_medium%3Dbio` |
| Consent / outreach email | `https://play.google.com/store/apps/details?id=art.atteste.atteste&referrer=utm_source%3Dconsent-email%26utm_medium%3Demail` |

## Apple App Store (reports in ASC only — never in-app)

iOS has no install referrer; every iOS signup stamps `ios-organic` in-app.
The only in-app iOS channel signal is the user's own onboarding answer to
"How did you hear about Attesté?", which has a **"A video"** option — so
iOS video attribution reads out of `users/{uid}.acquisition`, not
`attribution`. `scripts/attribution_report.js` in the app repo shows both.
Campaign splits live in App Store Connect → App Analytics → Acquisition →
Campaigns, keyed by `ct` token paired with the provider token
**`pt=128824584`** (read from the ASC campaign-link generator 2026-08-10).
Keep every iOS campaign link in the full `/app/apple-store/` + `pt` + `ct`
form below — `ct` without `pt` does not report.

| Placement | Link |
|---|---|
| Website badge (in-page) | `https://apps.apple.com/app/apple-store/id6763944507?pt=128824584&ct=website&mt=8` |
| Instagram bio (full form) | `https://apps.apple.com/app/apple-store/id6763944507?pt=128824584&ct=instagram-bio&mt=8` |
| Consent / outreach email (full form) | `https://apps.apple.com/app/apple-store/id6763944507?pt=128824584&ct=consent-email&mt=8` |

## Notes

- `cert/<id>.html` pages are generated artifacts — their app links pick up
  tags when the generator template is updated, not by hand-editing.
- The referral lander (`r/index.html`) tags `utm_source=referral`; the
  referral code itself is tracked separately by the app.
- Netlify auto-deploy is still broken (2026-04-30 org transfer): these
  links go live only after a manual `netlify deploy --prod --dir=.`.
