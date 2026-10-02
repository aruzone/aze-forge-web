# Reference-site patterns (neon.com, duckdb.org, omp.sh)

Researched 2026-10-02 from the live sites. Section 1 is direct observation;
Section 2 is recommendation. Nothing here copies any site's brand identity.

## 1. Observations

### neon.com — home (2026-10-02)
- Dark-only surface: `body` background `rgb(0, 0, 0)`, `color-scheme: dark`,
  H1 white `rgb(255,255,255)`, 42 px, weight 400, Inter.
- Top: thin announcement bar ("Lakebase Search is GA…") above a minimal
  header (logo left, hamburger right on narrow widths; full nav exposes Docs,
  Pricing, product-group dropdowns, Blog, Changelog, Community, Status).
- Hero: one-sentence H1 ("The backend for apps and agents, built to scale on
  Lakebase Postgres."), dual CTA — solid white pill "Get started" plus
  outline "Read the docs" — over a dark animated-bar backdrop.
- Trust strip: muted customer-logo marquee (Replit, DoorDash, BCG, Retool…)
  directly under the hero CTAs.
- Body: numbered sections ("01 BUILD YOUR BACKEND", "02 OPERATE IT WITH
  AGENTS", "03 SCALE YOUR APP AND AGENT"), each with an H2, a 3-item feature
  list, and product imagery; single mint accent observed (`rgb(52,213,154)`)
  used sparingly.
- Sources: live homepage screenshot + computed-style extraction (body/H1/
  CTA colors, Inter + GeistMono stacks), aria snapshot of nav/section order.

### neon.com — docs (`/docs/introduction`)
- Same dark shell; header collapses to logo + "Docs" + search icon +
  hamburger. Persistent search affordance in header.
- Landing leads with outcome-first copy ("Neon is the backend for apps and
  agents.") then a "Getting started" fork: two large cards, QUICK ~5 MIN
  (one-command setup: `$ npx neon@latest init` in a light copyable command
  bar) vs GUIDED ~10 MIN (full-backend tutorial).
- Left sidebar is deep and grouped (Concepts, product areas, Building on
  Neon, AI agents, APIs & SDKs, 20+ framework entries); cards carry small
  monospace eyebrow labels with a red triangle marker.
- Sources: live docs screenshot + sidebar/top-nav link extraction.

### duckdb.org — home (2026-10-02)
- Dark surface `rgb(13,13,13)` (near-black, slightly lifted vs neon's pure
  black); H1 `rgb(242,242,242)`, 44 px, weight 600, SuisseIntl.
- Dismissible announcement bar on top ("releasing DuckDB v2.0 this month…").
- Header: logo left; right cluster is a single yellow pill "Support" CTA plus
  theme-toggle and menu icons — one accent, one action.
- Hero is centered: H1 ("Your universal data wrangling tool"), dual CTA
  (yellow solid "Get DuckDB" + outline "Read the docs"), then a 2×2 grid of
  rounded cards (Database anywhere / Friendly SQL / Extensible / Native
  clients), each with icon + one-line description + "→" link.
- Install is one line (`curl https://install.duckdb.org | bash`); 22 `<pre>`
  blocks found on the homepage crawl, i.e. code is ambient, not hidden.
- Sources: live homepage screenshot + computed-style extraction (body/H1/
  fonts), nav-link and `<pre>` inventory.

### duckdb.org — docs
- Dense, broad top nav (Documentation, Getting Started, Installation, Guides,
  Data Import, Client APIs, SQL Introduction, Why DuckDB, Resources, Blog…);
  search affordance present in header. Stable-versioned URL tree
  (`/docs/stable/…`, `/docs/current/…` with redirect).
- Sources: live header-link extraction; one versioned deep link 404'd and
  redirected to `/docs/current/…` (noted, not relied on).

### omp.sh — home (2026-10-02)
- Pure black `rgb(0,0,0)`, `class="dark"` + `color-scheme: dark light`;
  H1 oklch(0.97 0 0), ~47 px, weight 500, Geist. Accent is a pink/magenta
  gradient on one hero phrase ("IDE wired in.") plus a diagonal particle
  field — decorative, low-contrast, never behind body copy.
- Header is the sparest of the three: logo left; right is just DOCS +
  Discord/GitHub icon links. No marketing nav.
- Install block is the hero's second element: package-manager tabs
  (CURL / BREW / BUN / PSI / MISE) over one copyable command
  (`curl -fsSL https://omp.sh/install | sh`) with a COPY button; below it a
  "COMPATIBLE" provider-icon strip and a numbered 8-cell capability strip
  (01–08 icons).
- Sources: live homepage screenshot + computed-style extraction (body/H1/
  code-block `rgb(10,10,12)` + JetBrains Mono), `<head>` metadata
  (dark-first theme-color `#000000`).

### omp.sh — docs (`/docs`)
- Single-column reading width, generous line length, section headers styled
  `§ 01 START` with a hairline rule and a right-aligned next-link
  ("Quickstart →"); breadcrumb eyebrow ("DOCS · OVERVIEW").
- Code blocks dark (`rgb(10,10,12)`, JetBrains Mono) with horizontal scroll
  rather than wrap; prose is task-first ("Start with a real task",
  "Give it a concrete task in ordinary language:").
- Left index is flat and task-named (Quickstart, Slash commands, Keybindings,
  Run modes, Sessions, Plan mode, Subagents…), ~25 entries observed.
- Sources: live docs screenshot + sidebar/top-nav extraction.

### Cross-site pattern table
| Concern | neon.com | duckdb.org | omp.sh |
|---|---|---|---|
| Page bg | pure black `#000` | near-black `#0d0d0d` | pure black `#000` |
| Hero H1 | left, 42 px/400 | centered, 44 px/600 | left, ~47 px/500 |
| Primary CTA | white pill | yellow pill | install command itself |
| Secondary CTA | outline "Read the docs" | outline "Read the docs" | docs link in header |
| Accent use | one mint sparingly | one yellow, CTA-only | one magenta gradient, decoration-only |
| Announcement | thin bar above header | dismissible bar above header | none |
| Trust strip | logo marquee under hero | n/a (cards instead) | provider icons under install |
| Install | one-command card in docs | one-liner on home | tabbed one-liner in hero |
| Docs nav | deep grouped sidebar + search | broad top nav + versioned tree | flat task-named index |

## 2. Recommendations for a dark-only, Ferrari-red AzeForge site

1. Adopt the shared skeleton all three converge on: announcement bar (only
   when there is news) → minimal header → one-sentence hero + dual CTA
   (solid "Get started/install" + outline "Read the docs") → trust or
   capability strip → numbered/carded feature sections → install-first docs
   landing. This is layout, not identity.
2. Keep one accent only (Ferrari red): reserve it for the primary CTA fill,
   active install tab, and copy-button feedback — the way DuckDB reserves
   yellow and omp reserves magenta. Keep body text near-white on black for
   contrast; never put body copy over decorative fields.
3. Make install the second hero element with manager tabs + copy button
   (omp pattern), and mirror it as a "quick vs guided" fork on `/docs`
   (neon pattern): one-command AzeMark setup vs full tutorial.
4. Use DuckDB's dense card grid on `/` for capabilities/use-cases/examples
   (icon + one line + → link), and omp's flat task-named sidebar plus
   `§ NN` section headers on `/docs` for human/agent skimmability.
5. Keep the header as sparse as omp's (logo, Docs, Playground, GitHub) and
   put search in the docs header (neon/DuckDB pattern); version the docs
   URL tree (DuckDB pattern) so agents can pin `/docs/current/…`.
6. Explicitly not carried over: neon's mint, DuckDB's yellow, omp's magenta
   gradient/particle field, any logo marquee content, SuisseIntl/Inter-only
   type stacks — AzeForge keeps its own type choice and red accent.
