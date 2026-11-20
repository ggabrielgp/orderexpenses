# Gastos Controlados — design system (synced)

Source: `src/client/design-tokens.css` (read-only sync, 2026-11-20). Only values found in the source are recorded.
Fonts declared there (Inter, Sora, Material Symbols) load from Google Fonts; artboards use system stacks instead.

## Colors — product

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--color-canvas` | `#f6f5f2` | App background | `src/client/design-tokens.css` |
| `--color-surface` | `#ffffff` | Cards, dialogs | `src/client/design-tokens.css` |
| `--color-surface-subtle` | `#f1f0ec` | Subtle fills | `src/client/design-tokens.css` |
| `--color-surface-pressed` | `#e8e7e2` | Pressed state | `src/client/design-tokens.css` |
| `--color-ink` | `#131b2e` | Primary text | `src/client/design-tokens.css` |
| `--color-ink-secondary` | `#3f4b63` | Secondary text | `src/client/design-tokens.css` |
| `--color-ink-muted` | `#59647a` | Muted text | `src/client/design-tokens.css` |
| `--color-blue-deep` | `#003594` | Primary action | `src/client/design-tokens.css` |
| `--color-blue-standard` | `#004ac6` | Primary hover / container | `src/client/design-tokens.css` |
| `--color-blue-bright` | `#2878e5` | Highlights | `src/client/design-tokens.css` |
| `--color-blue-soft` | `#e7f1ff` | Soft blue fill | `src/client/design-tokens.css` |
| `--color-violet` | `#6553aa` | Secondary accent | `src/client/design-tokens.css` |
| `--color-violet-soft` | `#eeebff` | Soft violet fill | `src/client/design-tokens.css` |
| `--color-success` | `#087c61` | Positive state | `src/client/design-tokens.css` |
| `--color-success-soft` | `#eaf8f3` | Positive fill | `src/client/design-tokens.css` |
| `--color-warning` | `#9a6700` | Warning state | `src/client/design-tokens.css` |
| `--color-warning-soft` | `#fff7df` | Warning fill | `src/client/design-tokens.css` |
| `--color-danger` | `#b42318` | Danger state | `src/client/design-tokens.css` |
| `--color-danger-soft` | `#fff1f0` | Danger fill | `src/client/design-tokens.css` |
| `--color-line` | `#e3e1dc` | Dividers | `src/client/design-tokens.css` |
| `--color-line-strong` | `#d2d0ca` | Strong dividers | `src/client/design-tokens.css` |
| `--color-focus` | `#004ac6` | Focus ring | `src/client/design-tokens.css` |

## Colors — marketing

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--marketing-canvas` | `#faf8ff` | Landing background | `src/client/design-tokens.css` |
| `--marketing-surface` | `#ffffff` | Landing cards | `src/client/design-tokens.css` |
| `--marketing-surface-subtle` | `#f1f2fc` | Landing subtle fill | `src/client/design-tokens.css` |
| `--marketing-primary` | `#174ea6` | Landing CTA | `src/client/design-tokens.css` |
| `--marketing-primary-hover` | `#0d3f91` | Landing CTA hover | `src/client/design-tokens.css` |
| `--marketing-ink` | `#182033` | Landing text | `src/client/design-tokens.css` |
| `--marketing-muted` | `#687086` | Landing muted text | `src/client/design-tokens.css` |
| `--marketing-line` | `#e3e5ef` | Landing dividers | `src/client/design-tokens.css` |

## Colors — dark anchor

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--anchor-background-raised` | `#1b2942` | Raised dark surface | `src/client/design-tokens.css` |
| `--anchor-text` | `#f8fbff` | Text on dark | `src/client/design-tokens.css` |
| `--anchor-text-secondary` | `#c5cede` | Secondary text on dark | `src/client/design-tokens.css` |
| `--anchor-accent` | `#9ec1ff` | Accent on dark | `src/client/design-tokens.css` |

## Typography

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--font-body` | `"Inter", sans-serif` | Interface text | `src/client/design-tokens.css` |
| `--font-display` | `"Sora", sans-serif` | Display only | `src/client/design-tokens.css` |
| `--font-mono` | `"Inter", sans-serif` | Numbers (not a real mono) | `src/client/design-tokens.css` |
| `--text-xs` | `0.72rem` | Small labels | `src/client/design-tokens.css` |
| `--text-sm` | `0.85rem` | Secondary text | `src/client/design-tokens.css` |
| `--text-md` | `0.95rem` | Body | `src/client/design-tokens.css` |

## Spacing

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--space-1` | `4px` | Tight | `src/client/design-tokens.css` |
| `--space-2` | `8px` | Small | `src/client/design-tokens.css` |
| `--space-3` | `12px` | Medium | `src/client/design-tokens.css` |
| `--space-4` | `16px` | Default | `src/client/design-tokens.css` |
| `--space-5` | `24px` | Section | `src/client/design-tokens.css` |

## Radius

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--radius-control` | `12px` | Buttons, inputs | `src/client/design-tokens.css` |
| `--radius-card` | `16px` | Cards | `src/client/design-tokens.css` |
| `--radius-featured` | `20px` | Featured surfaces, dialogs | `src/client/design-tokens.css` |
| `--radius-pill` | `999px` | Pills | `src/client/design-tokens.css` |

## Shadows and motion

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--shadow-card` | `0 3px 14px rgba(30, 38, 52, 0.05)` | Cards | `src/client/design-tokens.css` |
| `--shadow-panel` | `0 8px 30px rgba(30, 38, 52, 0.06)` | Panels | `src/client/design-tokens.css` |
| `--shadow-sm` | `0 1px 5px rgba(30, 38, 52, 0.05)` | Small elevation | `src/client/design-tokens.css` |
| `--shadow-xl` | `0 20px 56px rgba(30, 52, 100, 0.14), 0 2px 8px rgba(30, 52, 100, 0.06)` | Dialogs | `src/client/design-tokens.css` |
| `--shadow-glow` | `0 0 0 4px rgba(0, 74, 198, 0.13)` | Focus glow | `src/client/design-tokens.css` |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Playful motion | `src/client/design-tokens.css` |
| `--ease-out-expo` | `cubic-bezier(0.16, 1, 0.3, 1)` | Entrances | `src/client/design-tokens.css` |

## Component rules (observed)

- Controls use `--radius-control`, cards `--radius-card`, dialogs `--radius-featured`.
- Primary action is `--color-blue-deep`; focus uses `--color-focus` plus `--shadow-glow`.
- Status always pairs a soft fill with its strong color (success / warning / danger).
- Single dark anchor surface (`--anchor-*`) for the featured KPI.
- Amounts are formatted `es-CL` CLP (`$912.430`).

## Note for the identity exploration (`design/identidad-gastos/`)

Those artboards deliberately propose **new** identity tokens; deviations from this system are the point of the exercise and are listed per artboard.
