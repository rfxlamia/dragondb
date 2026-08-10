# Creative Brief — DragonDB

## Brand Persona
- Character: Professional, friendly, and precise — a calm, native-feeling desktop tool on every platform, making databases approachable without dumbing them down.
- Tone of Voice: Neutral-friendly. Clear, warm, plain language. Sentence case. Lead with verbs. No slang, no emoji in product UI, sparing exclamation.
- Emotional Goal: After using DragonDB, the user should feel **“tidak takut SQL lagi”** (no longer afraid of SQL).
- One-liner: Multi-database client with a visual SQL builder — so beginners can query without writing syntax.
- Audience: Data/business analysts and data scientists who are early in SQL fluency; occasional developers checking a DB; students/bootcamp learners. Grounding over intimidation.
- Platform: Cross-platform desktop — Tauri v2 (web frontend + Rust core) on macOS, Windows, and Linux. Platform class for scale purposes: **data-dense desktop app**.
- Inspirations: n8n (visual blocks/workflows) + the systemic calm of Apple HIG, applied platform-neutrally rather than as Mac-specific chrome.
- Structure vs warmth: Precise + professional win on structure (hue, radius, chroma). Friendly wins on tone and emotional goal.

## Color System (OKLCH)

Primary hue **245°** (ocean blue from brand direction). Chroma base **0.13**.  
**CTA fill uses primary-600**, not 500 — white on 500 fails AA (3.33:1); white on 600 passes (4.81:1). Gate 3 auto-adjust.

`oklch()` is native CSS, so every value below is used verbatim as a custom property — no conversion, no recomputation.

### Primary
| Shade | OKLCH | Hex | White text | Black text |
|-------|-------|-----|------------|------------|
| 100 | oklch(0.97 0.013 245) | #EEF6FD | — | — |
| 200 | oklch(0.92 0.038 245) | #D0E8FD | — | — |
| 300 | oklch(0.84 0.085 245) | #9CD1FF | — | — |
| 400 | oklch(0.74 0.111 245) | #6CB2EC | 2.28:1 ❌ | 9.20:1 ✅ AAA |
| 500 | oklch(0.64 0.130 245) | #3B93D5 | 3.33:1 ❌ | 6.31:1 ✅ AA |
| **600** | **oklch(0.55 0.123 245)** | **#2177B4** | **4.81:1 ✅ AA** | 4.37:1 (large only) |
| 700 | oklch(0.46 0.111 245) | #0C5C91 | 7.07:1 ✅ AAA | — |
| 800 | oklch(0.37 0.091 245) | #03436C | 10.37:1 ✅ AAA | — |
| 900 | oklch(0.28 0.061 245) | #082B45 | 14.54:1 ✅ AAA | — |

- Hover (from CTA): primary-600 → primary-700
- Active/pressed: primary-800
- Links / text on white: primary-600 minimum (AA); prefer primary-700 (AAA)

### Neutrals (H 245°, C ≈ 0.01 — black/white with blue hint)
| Shade | OKLCH | Hex | Notes |
|-------|-------|-----|-------|
| 100 | oklch(0.97 0.006 245) | #F2F6F9 | page / panel bg |
| 200 | oklch(0.92 0.007 245) | #E1E5E9 | disabled bg, dividers |
| 300 | oklch(0.84 0.008 245) | #C6CBD0 | default borders |
| 400 | oklch(0.74 0.009 245) | #A6ACB0 | hover borders |
| 500 | oklch(0.64 0.010 245) | #878D92 | muted icons |
| 600 | oklch(0.55 0.010 245) | #6D7277 | placeholder / disabled text (on white 4.84:1 ✅ AA) |
| 700 | oklch(0.46 0.009 245) | #54595D | secondary labels (on white 7.12:1 ✅ AAA) |
| 800 | oklch(0.37 0.009 245) | #3C4044 | strong secondary |
| 900 | oklch(0.28 0.008 245) | #26292D | body text (on n-100 13.38:1 ✅ AAA) |

### Semantic Colors
| Role | Tint | Solid | Text-on-tint | White on solid |
|------|------|-------|--------------|----------------|
| success | oklch(0.95 0.045 145) #DCF7DC | oklch(0.55 0.123 145) #3C8441 | oklch(0.35 0.091 145) 9.56:1 ✅ | 4.60:1 ✅ AA |
| warning | oklch(0.95 0.045 85) #FDEDCD | oklch(0.55 0.103 85) #8D6C19 | oklch(0.35 0.071 85) 9.82:1 ✅ | 4.89:1 ✅ AA |
| error | oklch(0.95 0.015 25) #F9EBE9 | oklch(0.55 0.123 25) #AE514C | oklch(0.35 0.091 25) 10.14:1 ✅ | 5.16:1 ✅ AA |
| info | oklch(0.95 0.025 245) #E1F1FF | oklch(0.55 0.123 245) #2177B4 | oklch(0.35 0.081 245) 9.75:1 ✅ | 4.81:1 ✅ AA |

## Typography Scale

- Body font: **Inter**, bundled with the app — not loaded from a CDN (a Tauri artifact must work offline) and not left to the OS. Bundling buys identical metrics on all three platforms and reliable `font-variant-numeric: tabular-nums`, which the result grid depends on and the Windows system font does not deliver dependably.
- Fallback stack: `"Inter", -apple-system, "Segoe UI Variable Text", "Segoe UI", system-ui, "Cantarell", "Ubuntu", sans-serif`
- Mono font: **JetBrains Mono**, bundled — used by the SQL editor and the Generated SQL inspector.
  Fallback: `"JetBrains Mono", ui-monospace, SFMono-Regular, "Cascadia Mono", "Liberation Mono", monospace`
- Base: 16px | Ratio: **1.20** (Minor Third — data-dense desktop). The ratio follows the platform class, not the font, so it is unchanged from the SF Pro era.
- Line-height: body ≈ 1.5 · headings ≈ 1.1–1.25
- Base radius: **4px** (precise ∩ professional)

| Name | Size |
|------|------|
| xs | 11px |
| sm | 13px |
| base | 16px |
| md | 19px |
| lg | 23px |
| xl | 28px |
| 2xl | 33px |
| 3xl | 40px |

Result-grid numeric cells set `font-variant-numeric: tabular-nums` so digits align across rows.

## Atoms

### Button — Primary
| State | Background | Text | Border | Shadow | Cursor | Focus ring |
|-------|------------|------|--------|--------|--------|------------|
| Default | oklch(0.55 0.123 245) | oklch(1 0 0) 4.81:1 ✅ | none | sm | pointer | — |
| Hover | oklch(0.46 0.111 245) | oklch(1 0 0) 7.07:1 ✅ | none | sm | pointer | — |
| Focus | oklch(0.55 0.123 245) | oklch(1 0 0) | none | sm | pointer | 2px solid primary-600 offset 2px (≥3:1) |
| Disabled | oklch(0.92 0.007 245) | oklch(0.55 0.010 245) 3.83:1 ✅ UI | none | none | not-allowed | — |
| Error | oklch(0.55 0.123 25) | oklch(1 0 0) 5.16:1 ✅ | none | sm | pointer | — |

### Button — Secondary
| State | Background | Text | Border | Shadow | Cursor | Focus ring |
|-------|------------|------|--------|--------|--------|------------|
| Default | oklch(0.97 0.006 245) | oklch(0.28 0.008 245) 13.38:1 ✅ | 1px solid neutral-300 | none | pointer | — |
| Hover | oklch(0.92 0.007 245) | oklch(0.28 0.008 245) | 1px solid neutral-400 | none | pointer | — |
| Focus | oklch(0.97 0.006 245) | oklch(0.28 0.008 245) | 1px solid neutral-300 | none | pointer | 2px solid primary-600 offset 2px |
| Disabled | oklch(0.92 0.007 245) | oklch(0.55 0.010 245) | 1px solid neutral-200 | none | not-allowed | — |
| Error | oklch(0.95 0.015 25) | oklch(0.35 0.091 25) | 1px solid error-solid | none | pointer | — |

### Button — Ghost
| State | Background | Text | Border | Shadow | Cursor | Focus ring |
|-------|------------|------|--------|--------|--------|------------|
| Default | transparent | oklch(0.55 0.123 245) 4.81:1 ✅ | none | none | pointer | — |
| Hover | oklch(0.97 0.013 245) | oklch(0.46 0.111 245) 6.49:1 ✅ | none | none | pointer | — |
| Focus | transparent | oklch(0.55 0.123 245) | none | none | pointer | 2px solid primary-600 offset 2px |
| Disabled | transparent | oklch(0.55 0.010 245) | none | none | not-allowed | — |
| Error | oklch(0.95 0.015 25) | oklch(0.35 0.091 25) | none | none | pointer | — |

### Input / Text Field
| State | Background | Text | Border | Shadow | Cursor | Focus ring |
|-------|------------|------|--------|--------|--------|------------|
| Default | oklch(1 0 0) | oklch(0.28 0.008 245) 14.58:1 ✅ | 1px solid neutral-300 | none | text | — |
| Hover | oklch(1 0 0) | oklch(0.28 0.008 245) | 1px solid neutral-400 | none | text | — |
| Focus | oklch(1 0 0) | oklch(0.28 0.008 245) | 1px solid primary-600 | none | text | 2px solid primary-600 offset 2px |
| Disabled | oklch(0.97 0.006 245) | oklch(0.55 0.010 245) | 1px solid neutral-200 | none | not-allowed | — |
| Error | oklch(1 0 0) | oklch(0.28 0.008 245) | 1px solid error-solid | none | text | — |

Placeholder text: neutral-600 on white (4.84:1 ✅ AA). Helper error text: error-text on white/tint.

### Badge / Tag
| State | Background | Text | Border | Shadow | Cursor | Focus ring |
|-------|------------|------|--------|--------|--------|------------|
| Default | info-tint | info-text 9.75:1 ✅ | none | none | default | — |
| Hover | info-tint (slightly darker) | info-text | none | none | pointer (if clickable) | — |
| Focus | info-tint | info-text | none | none | pointer | 2px solid primary-600 offset 2px |
| Disabled | neutral-200 | neutral-600 | none | none | not-allowed | — |
| Error | error-tint | error-text | none | none | default | — |

Semantic badge variants may use success/warning/error tints with matching text-on-tint colors.

### Link
| State | Background | Text | Border | Shadow | Cursor | Focus ring |
|-------|------------|------|--------|--------|--------|------------|
| Default | transparent | oklch(0.55 0.123 245) 4.81:1 ✅ | none | none | pointer | — |
| Hover | transparent | oklch(0.46 0.111 245) 7.07:1 ✅ + underline | none | none | pointer | — |
| Focus | transparent | primary-600 | none | none | pointer | 2px solid primary-600 offset 2px |
| Disabled | transparent | neutral-600 | none | none | not-allowed | — |
| Error | transparent | error-text | none | none | pointer | — |

### Focus ring — single rule for all atoms

A webview has no system focus ring, so every ring is drawn explicitly:

```css
outline: 2px solid var(--primary-600);
outline-offset: 2px;
```

The 2px offset gap renders the page background, so the governing contrast is ring-against-background:

| Ring on | Ratio | Threshold (UI component) |
|---------|-------|--------------------------|
| white | 4.81:1 | 3:1 ✅ |
| neutral-100 panel | 4.43:1 | 3:1 ✅ |

Do not implement the ring as an inset `box-shadow` — on a primary button that puts primary-600 against primary-600 and the ring disappears.

## Copy Guidelines
- Register: **Neutral-friendly**
- CTA style: verb-led, 1–3 words — “Connect database”, “Run query”, “Add block”
- Secondary: “Cancel”, “Not now”
- Placeholder: concrete examples — “Host (e.g. localhost)”, “Search tables”
- Errors: what happened + how to fix; never blame the user; no internal codes in UI
  - Validation: “That host doesn’t look reachable. Check the address and try again.”
  - Failed action: “Couldn’t run this query. Check the blocks, then try again.”
- Empty state: “No tables yet — connect a database to get started.”
- Success: “Connected.” / “Query finished.”
- Language: product UI strings in **English** (repo convention); keep calm and precise — visual builder sits on defined SQL, not a new dynamic language.

## Molecules (examples)
- **Connection Form** = Label + Input (+ Error helper) + Button Primary (“Connect database”) + Button Secondary (“Cancel”)
- **Query Canvas Toolbar** = Button Ghost (“Add block”) + Button Primary (“Run query”) + Link (“View generated SQL”)
- **Engine Filter Row** = Badge ×N (PostgreSQL, MySQL, …) + Link (“Clear filters”)

## Implementation Notes — CSS / Tauri (primary target)
- Emit every value above as CSS custom properties on `:root`. `oklch()` is native CSS; use the values verbatim rather than converting to hex at call sites. Hex codes in this brief are reference only.
- Name tokens `--primary-600`, `--neutral-900`, `--error-solid`, matching this brief's shade names, so a review can diff brief against stylesheet by name.
- Corner radius: `--radius: 4px` base; badges may use 8px.
- Focus: follow the single focus-ring rule above. Never rely on the browser default outline — it differs across WebKit (macOS), WebView2 (Windows), and WebKitGTK (Linux).
- Fonts: bundle Inter and JetBrains Mono as local assets and declare them with `@font-face`. No CDN reference — a strict-CSP or offline Tauri artifact would silently fall back to the OS font and break the type metrics.
- Cross-platform rendering: WebKitGTK on Linux is the least consistent of the three engines. Any new component gets checked there before it is called done.
- Do not invent new hues or radii without refining this brief (preview → confirm → update).

## Implementation Notes — SwiftUI (legacy, frozen macOS app)
Retained because the Swift app stays alive on bugfix-only maintenance during the Tauri transition. Do not build new roadmap phases against it.
- Map OKLCH/hex into `Color` assets or `Color(red:green:blue:)` / Asset Catalog; prefer named tokens (`DragonPrimary600`, etc.) over raw literals at call sites.
- Accent / tint alignment: set app accent toward primary-600 (`#2177B4`).
- Corner radius: 4pt base; badges may use 8pt.
- Focus: system focus rings are available here and should be used; ensure custom controls meet ≥3:1 against surroundings.

## Known Gaps
- **Dark mode is not defined.** Multi-theme support is an explicit later extension of brand-design. Until it is refined in, the app ships light-only on all three platforms. This was inherited for free from system appearance in SwiftUI and is not free in a webview.

---
Preview confirmed: `docs/pocket/rule/creative-brief-preview.html` (2026-08-10, cross-platform amendment)
Prior confirmation: 2026-08-09 (original, macOS/SwiftUI)
