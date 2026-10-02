# kkumaresan.com font scheme

Researched 2026-10-02 from the live site's HTML, stylesheet, and font CSS. Covers the serif/sans pairing only.

## Findings

- **Serif (display): Playfair Display** — all display type: hero name (`.hero-name`, 400, clamp 54–106 px), section H2s, pull-quote, work titles, page/article/post titles, footer CTA, prose H2s. Body token: `--display: "Playfair Display", Georgia, "Times New Roman", serif`.
- **Sans-serif (body/UI): Geist** — default body face (`body { font-family: var(--sans) }`, 16.5 px/1.75), subsection headings (`.sub`, 13 px/500), meta values. Body token: `--sans: "Geist", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`.
- Loaded together via one Google Fonts request: Geist 400/500/600 + Playfair Display upright 400/500/600 and italic 400/500.
- Supporting role (not part of the serif/sans pair): **Geist Mono** for eyebrow labels, topbar, stat numerals, and meta rows (`--mono`).

## Primary sources

- Homepage HTML (font `<link>`): https://kkumaresan.com/
- Live stylesheet (tokens + role selectors): https://kkumaresan.com/assets/css/main.css?v=1787886116
- Font-face definitions (proves both families/weights): https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400;1,500&display=swap
