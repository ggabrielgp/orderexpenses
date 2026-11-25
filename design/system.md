# Gastos Controlados — design system (synced)

Sources: `src/client/design-tokens.css`, `src/client/dark-mode.css`, `src/client/identity-b.css` (read-only sync, 2026-11-25). Only values found in the sources are recorded.
Fonts declared in `design-tokens.css` (Inter, Sora, Material Symbols) load from Google Fonts; artboards use system stacks instead.

## Colors — product (light)

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--color-canvas` | `#f6f5f2` | App background | `src/client/design-tokens.css` |
| `--color-surface` | `#ffffff` | Cards, dialogs | `src/client/design-tokens.css` |
| `--color-surface-subtle` | `#f1f0ec` | Subtle fills | `src/client/design-tokens.css` |
| `--color-surface-pressed` | `#e8e7e2` | Pressed state | `src/client/design-tokens.css` |
| `--color-ink` | `#131b2e` | Primary text and Identity B primary action | `src/client/design-tokens.css` |
| `--color-ink-secondary` | `#3f4b63` | Secondary text | `src/client/design-tokens.css` |
| `--color-ink-muted` | `#59647a` | Muted text | `src/client/design-tokens.css` |
| `--color-blue-deep` | `#003594` | Legacy primary action | `src/client/design-tokens.css` |
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
| `--color-focus` | `#004ac6` | Default focus ring | `src/client/design-tokens.css` |
| `--control-border` | `#8b94a6` | Control border (summary polish) | `src/client/design-tokens.css` |
| `--accent-hover` | `#26324d` | Identity B ink button hover | `src/client/identity-b.css` |

## Colors — Semáforo sereno & categories (light)

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--state-calm` | `#0b7a6b` | Month pace calm state | `src/client/design-tokens.css` |
| `--state-calm-soft` | `#e2f3ef` | Calm soft fill | `src/client/design-tokens.css` |
| `--state-tight` | `#9a6700` | Month pace tight state | `src/client/design-tokens.css` |
| `--state-tight-strong` | `#8f5f00` | Tight text on soft fill | `src/client/design-tokens.css` |
| `--state-tight-soft` | `#fdf3d8` | Tight soft fill | `src/client/design-tokens.css` |
| `--state-over` | `#b4412f` | Month pace over state | `src/client/design-tokens.css` |
| `--state-over-soft` | `#fbe9e5` | Over soft fill | `src/client/design-tokens.css` |
| `--color-track` | `#efeee9` | Neutral gauge & bar track | `src/client/design-tokens.css` |
| `--cat-1` | `#5a67a0` | Category chart color 1 | `src/client/design-tokens.css` |
| `--cat-2` | `#94678c` | Category chart color 2 | `src/client/design-tokens.css` |
| `--cat-3` | `#6f93ad` | Category chart color 3 | `src/client/design-tokens.css` |
| `--cat-4` | `#8e897f` | Category chart color 4 | `src/client/design-tokens.css` |
| `--channel-1` | `#131b2e` | Channel ink (purchases) | `src/client/design-tokens.css` |
| `--channel-2` | `#59647a` | Channel ink (transfers) | `src/client/design-tokens.css` |
| `--channel-3` | `#8b94a6` | Channel ink (payments) | `src/client/design-tokens.css` |

## Colors — product (dark mode)

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--color-canvas` | `#0f1522` | Dark app background | `src/client/dark-mode.css` |
| `--color-surface` | `#161e2e` | Dark cards, dialogs | `src/client/dark-mode.css` |
| `--color-surface-subtle` | `#1d273b` | Dark subtle fills | `src/client/dark-mode.css` |
| `--color-surface-pressed` | `#25324a` | Dark pressed state | `src/client/dark-mode.css` |
| `--color-ink` | `#dce3ee` | Dark primary text | `src/client/dark-mode.css` |
| `--color-ink-secondary` | `#a6b3c7` | Dark secondary text | `src/client/dark-mode.css` |
| `--color-ink-muted` | `#7f8ea6` | Dark muted text | `src/client/dark-mode.css` |
| `--color-line` | `#27344d` | Dark dividers | `src/client/dark-mode.css` |
| `--color-line-strong` | `#374766` | Dark strong dividers | `src/client/dark-mode.css` |
| `--color-focus` | `#5cc9b8` | Dark focus ring | `src/client/dark-mode.css` |
| `--dark-action-bg` | `#1e7f71` | Dark primary action fill | `src/client/dark-mode.css` |
| `--dark-action-hover` | `#259685` | Dark primary action hover | `src/client/dark-mode.css` |
| `--dark-action-text` | `#eaf3f2` | Dark primary action text | `src/client/dark-mode.css` |
| `--dark-active-bg` | `#293854` | Dark active pill fill | `src/client/dark-mode.css` |
| `--dark-active-border` | `#43587e` | Dark active pill border | `src/client/dark-mode.css` |
| `--dark-active-text` | `#e3e9f3` | Dark active pill text | `src/client/dark-mode.css` |
| `--state-calm` | `#2ab5a0` | Dark calm state | `src/client/dark-mode.css` |
| `--state-calm-soft` | `rgb(42 181 160 / 0.15)` | Dark calm fill | `src/client/dark-mode.css` |
| `--state-tight` | `#e2b14d` | Dark tight state | `src/client/dark-mode.css` |
| `--state-tight-strong` | `#ecc36a` | Dark tight strong text | `src/client/dark-mode.css` |
| `--state-tight-soft` | `rgb(226 177 77 / 0.15)` | Dark tight fill | `src/client/dark-mode.css` |
| `--state-over` | `#e57a6b` | Dark over state | `src/client/dark-mode.css` |
| `--state-over-soft` | `rgb(229 122 107 / 0.15)` | Dark over fill | `src/client/dark-mode.css` |
| `--color-track` | `#2a3650` | Dark neutral track | `src/client/dark-mode.css` |
| `--control-border` | `#4b5e82` | Dark control border | `src/client/dark-mode.css` |
| `--cat-1` | `#7e8fd1` | Dark category 1 | `src/client/dark-mode.css` |
| `--cat-2` | `#bd8cb3` | Dark category 2 | `src/client/dark-mode.css` |
| `--cat-3` | `#80abc4` | Dark category 3 | `src/client/dark-mode.css` |
| `--cat-4` | `#a39e94` | Dark category 4 | `src/client/dark-mode.css` |

## Colors — marketing & dark anchor

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
| `--anchor-background-raised` | `#1b2942` | Raised dark surface | `src/client/design-tokens.css` |
| `--anchor-text` | `#f8fbff` | Text on dark | `src/client/design-tokens.css` |
| `--anchor-text-secondary` | `#c5cede` | Secondary text on dark | `src/client/design-tokens.css` |
| `--anchor-accent` | `#9ec1ff` | Accent on dark | `src/client/design-tokens.css` |

## Typography

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--font-body` | `"Inter", sans-serif` | Interface text | `src/client/design-tokens.css` |
| `--font-display` | `"Sora", sans-serif` | Display only | `src/client/design-tokens.css` |
| `--font-mono` | `"Inter", sans-serif` | Numbers (tabular-nums) | `src/client/design-tokens.css` |
| `--text-xs` | `0.72rem` | Small labels | `src/client/design-tokens.css` |
| `--text-sm` | `0.85rem` | Secondary text | `src/client/design-tokens.css` |
| `--text-md` | `0.95rem` | Body | `src/client/design-tokens.css` |
| `--type-title` | `28px` | Page title (summary) | `src/client/design-tokens.css` |
| `--type-section` | `18px` | Section heading | `src/client/design-tokens.css` |
| `--type-body` | `15px` | Summary body | `src/client/design-tokens.css` |
| `--type-min` | `12px` | Minimum readable label | `src/client/design-tokens.css` |
| `--gauge-number-size` | `48px` | Hero gauge figure (desktop) | `src/client/design-tokens.css` |
| `--gauge-number-size-mobile` | `44px` | Hero gauge figure (mobile) | `src/client/design-tokens.css` |

## Spacing & layout

| Token | Value | Usage | Source |
| --- | --- | --- | --- |
| `--space-1` | `4px` | Tight | `src/client/design-tokens.css` |
| `--space-2` | `8px` | Small | `src/client/design-tokens.css` |
| `--space-3` | `12px` | Medium | `src/client/design-tokens.css` |
| `--space-4` | `16px` | Default | `src/client/design-tokens.css` |
| `--space-5` | `24px` | Section | `src/client/design-tokens.css` |
| `--layout-canvas-width` | `1340px` | Max content width | `src/client/design-tokens.css` |
| `--layout-canvas-gutter` | `64px` | Desktop outer gutter | `src/client/design-tokens.css` |
| `--layout-header-height` | `68px` | Header bar height | `src/client/design-tokens.css` |

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
| `--shadow-sm` | `0 1px 5px rgba(30, 38, 52, 0.05)` | Small elevation | `src/client/design-tokens.css` |
| `--shadow-card` | `0 3px 14px rgba(30, 38, 52, 0.05)` | Cards | `src/client/design-tokens.css` |
| `--card-shadow-soft` | `0 1px 2px rgba(15, 23, 42, 0.04), 0 6px 18px rgba(15, 23, 42, 0.05)` | Soft card elevation | `src/client/design-tokens.css` |
| `--shadow-panel` | `0 8px 30px rgba(30, 38, 52, 0.06)` | Panels | `src/client/design-tokens.css` |
| `--shadow-xl` | `0 20px 56px rgba(30, 52, 100, 0.14), 0 2px 8px rgba(30, 52, 100, 0.06)` | Dialogs | `src/client/design-tokens.css` |
| `--shadow-glow` | `0 0 0 4px rgba(0, 74, 198, 0.13)` | Focus glow | `src/client/design-tokens.css` |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Playful motion | `src/client/design-tokens.css` |
| `--ease-out-expo` | `cubic-bezier(0.16, 1, 0.3, 1)` | Entrances | `src/client/design-tokens.css` |
| `--duration-fast` | `150ms` | Routine transitions | `src/client/design-tokens.css` |
| `--duration-view` | `300ms` | View changes | `src/client/design-tokens.css` |
| `--duration-gauge` | `700ms` | Pace gauge arc | `src/client/design-tokens.css` |

## Component rules (observed)

- Active product identity is **Identity B ("Semáforo sereno")**: primary actions in light mode use `--color-ink` (`#131b2e`) with hover `#26324d` (no cobalt in product chrome); in dark mode primary actions use `--dark-action-bg` (`#1e7f71`) with `--dark-action-text` (`#eaf3f2`).
- Controls use `--radius-control`, cards `--radius-card`, featured surfaces and dialogs `--radius-featured`, chips/badges `--radius-pill`.
- State hues (`--state-calm`, `--state-tight`, `--state-over`) are reserved strictly for financial status/pace/discrepancy states, never for categories; always pair soft fill with strong text and a readable label.
- Categories use the muted categorical palette (`--cat-1` to `--cat-4`).
- Amounts are formatted `es-CL` CLP (`$912.430`) with `font-variant-numeric: tabular-nums`.
- Focus rings use `2px solid var(--color-ink)` in light product chrome (`--color-focus` in dark mode) with `outline-offset: 2px`.
