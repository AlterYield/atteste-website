# CLAUDE.md — Attesté Project Context

## What is Attesté?

Attesté is an art collection management platform (atteste.art) targeting art collectors, galleries, advisors, and institutions. It offers provenance tracking, AI-powered art discovery, certificates of attestation, and collection management tools across freemium tiers (Free / Collector $9/mo / Premium $19/mo / B2B plans).

## Project Structure

- `index.html` — Main marketing website homepage
- `features.html` — Features page
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
| C3 | Priya Naidoo | The Emerging Collector | 30–42 | Collector ($9/mo) |
| C4 | David Park | The Digital-Native Collector | 27–40 | Collector ($9/mo) |
| C5 | Catherine Harrington-Lloyd | The Serious Collector | 42–60 | Collector → Premium |
| C6 | Richard de Villiers | The Legacy Collector | 55–75 | Premium ($19/mo) |
| C7 | Zanele Khumalo | The Art World Traveller | 30–50 | Collector → Premium |
| C8 | Thabo Mokoena | The Art Fair Addict | 32–55 | Collector ($9/mo) |

### B2B Personas (B1–B3)

| ID | Name | Archetype | Tier |
|----|------|-----------|------|
| B1 | Sarah van der Merwe | The Gallery Director | Gallery: Insights ($29/mo) |
| B2 | Michael Hartley | The Art Advisor | Gallery: Bridge ($79/mo) |
| B3 | Nomsa Dlamini | The Institutional Curator | Custom/Enterprise |

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
