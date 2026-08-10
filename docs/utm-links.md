# Attesté tagged acquisition links

Companion to the app's acquisition-attribution capture (Atteste PR #404):
web signups stamp `utm_*` params onto `users/{uid}.attribution`, Android
signups read the Play `referrer=` string, iOS reports only in App Store
Connect. **Use these links — never paste bare store/app URLs into bios,
emails, or posts,** or the signup arrives unattributed.

Taxonomy: `utm_source` = channel (`website`, `instagram`, `consent-email`,
`referral`), `utm_medium` = placement, `utm_campaign` = optional push name.
Lowercase, hyphenated. Channel data only — never put personal data in URL
params.

## Web app (fully attributable in-app)

| Placement | Link |
|---|---|
| Instagram bio | `https://atteste-b6409.web.app/?utm_source=instagram&utm_medium=bio` |
| Instagram post/story | `https://atteste-b6409.web.app/?utm_source=instagram&utm_medium=post&utm_campaign=<campaign>` |
| Consent / outreach email | `https://atteste-b6409.web.app/?utm_source=consent-email&utm_medium=email&utm_campaign=<campaign>` |
| Lifecycle email CTA | `https://atteste-b6409.web.app/?utm_source=lifecycle-email&utm_medium=email` |
| Website (tagged in-page) | `https://atteste-b6409.web.app/?utm_source=website&utm_medium=<placement>` |

## Google Play (survives store install via Install Referrer)

Wrap the UTMs URL-encoded inside `referrer=`:

| Placement | Link |
|---|---|
| Website badge (in-page) | `https://play.google.com/store/apps/details?id=art.atteste.atteste&referrer=utm_source%3Dwebsite%26utm_medium%3Dstore-badge` |
| Instagram bio | `https://play.google.com/store/apps/details?id=art.atteste.atteste&referrer=utm_source%3Dinstagram%26utm_medium%3Dbio` |
| Consent / outreach email | `https://play.google.com/store/apps/details?id=art.atteste.atteste&referrer=utm_source%3Dconsent-email%26utm_medium%3Demail` |

## Apple App Store (reports in ASC only — never in-app)

iOS has no install referrer; every iOS signup stamps `ios-organic` in-app.
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
