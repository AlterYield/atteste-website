# CLAUDE.md — Attesté Project Context

## What is Attesté?

Attesté is an art collection management platform (atteste.art) targeting art collectors, artists, galleries, advisors, and institutions. It offers provenance tracking, AI-powered art discovery, certificates of attestation, and collection management tools.

**B2C (Collectors)** — USD primary pricing on App Store + Play Store:
- Explorer (free, forever)
- Collector ($9.99/mo or $99.99/yr — save ~17%)
- Premium ($19.99/mo or $199.99/yr — save ~17%)
- Patron (free by invitation; resolves to Premium + patron badge)

**B2A (Artists)** — pure annual + monthly subscriptions:
- Studio ($14.99/mo or $149.99/yr · 14-day free trial · 50 works · 5 source certs/mo)
- Professional ($24.99/mo or $249.99/yr · 500 works · unlimited certs · analytics)
- Represented (free, gallery-paid; provisioned by Pro/Enterprise galleries)

**B2B (Galleries)** — pure annual subscriptions, no physical kit, no setup fees:
- Boutique ($495/yr · ~$41/mo equivalent · 50 artworks · 6 exhibitions · 30% off year 1 for first 25 founding galleries)
- Professional ($1,188/yr · ~$99/mo · 200 artworks · 12 exhibitions · AI social posts)
- Enterprise ($1,908/yr · ~$159/mo · unlimited artworks/exhibitions · promotion push to matched collectors · priority support)

The previous "Gallery Launch Kit" (R5,000 once-off) was deprecated 2026-04-24 and removed from all live pages.

## Project Structure

- `index.html` — Main marketing website homepage
- `features.html` — Features page
- `galleries.html` — Dedicated gallery page (Boutique / Professional / Enterprise annual tiers, ROI, founding gallery discount)
- `artists.html` — Dedicated artists page (Studio / Professional / Represented tiers, source certificates, public profile)
- `_headers` — Netlify HTTP security headers
- `_redirects` — Netlify redirect rules
- `marketing/` — All marketing strategy documents (personas, FOMO tactics, content calendar, launch plan)

## Marketing Personas (11 total)

All persona definitions live in `marketing/`. Always reference these when doing marketing, copywriting, or UX work.

### Consumer Personas (C1–C8)

| ID | Name | Archetype | Age | Tier |
|----|------|-----------|-----|------|
| C1 | Mia Chen | The Art-Curious Explorer | 22–30 | Free |
| C2 | James Whitfield | The Weekend Gallery Hopper | 28–38 | Free → Collector |
| C3 | Priya Naidoo | The Emerging Collector | 30–42 | Collector ($9.99/mo) |
| C4 | David Park | The Digital-Native Collector | 27–40 | Collector ($9.99/mo) |
| C5 | Catherine Harrington-Lloyd | The Serious Collector | 42–60 | Collector → Premium |
| C6 | Richard de Villiers | The Legacy Collector | 55–75 | Premium ($19.99/mo) |
| C7 | Zanele Khumalo | The Art World Traveller | 30–50 | Collector → Premium |
| C8 | Thabo Mokoena | The Art Fair Addict | 32–55 | Collector ($9.99/mo) |

### B2A Personas (Artists)

| ID | Name | Archetype | Tier |
|----|------|-----------|------|
| A1 | _Working artist_ | Studio practitioner publishing source certificates | Studio ($14.99/mo, 14-day trial) |
| A2 | _Professional artist_ | Established practice with archive + analytics | Professional ($24.99/mo) |
| A3 | _Represented artist_ | Gallery-paid, no direct billing | Represented (free, gallery-paid) |

### B2B Personas (B1–B3)

| ID | Name | Archetype | Tier |
|----|------|-----------|------|
| B1 | Sarah van der Merwe | The Gallery Director | Gallery: Boutique → Professional ($495/yr → $1,188/yr) |
| B2 | Michael Hartley | The Art Advisor | Gallery: Professional ($1,188/yr) |
| B3 | Nomsa Dlamini | The Institutional Curator | Gallery: Enterprise ($1,908/yr) |

### Persona Detail Files

- `marketing/01-persona-spectrum.md` — Master overview, journey map, feature mapping matrix, revenue potential
- `marketing/02a-personas-c1-c2.md` — Mia (C1) and James (C2) full profiles
- `marketing/02b-personas-c3-c4.md` — Priya (C3) and David (C4) full profiles
- `marketing/02c-persona-c5.md` — Catherine (C5) full profile
- `marketing/02d-persona-c6.md` — Richard (C6) full profile
- `marketing/02e-persona-c7.md` — Zanele (C7) full profile
- `marketing/02f-persona-c8.md` — Thabo (C8) full profile
- `marketing/02g-persona-b1.md` — Sarah (B1) full profile
- `marketing/02h-persona-b2.md` — Michael (B2) full profile
- `marketing/02i-persona-b3.md` — Nomsa (B3) full profile

### Marketing Strategy Files

- `marketing/03a-fomo-platform-strategy.md` — Channel strategy (Instagram, Twitter/X, LinkedIn, Google, Email, Partnerships)
- `marketing/03b-fomo-content-calendar.md` — 12-month content plan
- `marketing/03c-fomo-content-templates.md` — Persona-specific messaging matrix, ad copy, email subject lines
- `marketing/03d-fomo-launch-sequence.md` — Pre-launch through post-launch execution plan
- `marketing/03e-fomo-tactics.md` — Psychological FOMO mechanics and ethics charter
- `marketing/03f-fomo-metrics-kpis.md` — KPIs, funnel metrics, budget allocation

## Key Markets

- **Primary (Launch):** South Africa, United Kingdom, United States
- **Secondary (6–12 months):** Australia, Netherlands, Germany, UAE
- **Tertiary (12–24 months):** France, Italy, Japan, South Korea, Nigeria, Kenya

## Working with Marketing Content

When asked to create copy, campaigns, emails, ads, or any marketing material:
1. Read the relevant persona files in `marketing/` for tone, pain points, desires, and FOMO triggers
2. Reference `marketing/03c-fomo-content-templates.md` for the messaging matrix
3. Match content to the appropriate persona segment and tier
4. Follow the FOMO ethics charter in `marketing/03e-fomo-tactics.md`
