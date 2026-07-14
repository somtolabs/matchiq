# MatchIQ UI Optimization Skill

## What This Skill Is

This is the design execution standard for MatchIQ. Every
UI decision made in this project must pass through this
skill before implementation. It is not a style guide. It
is a judgment framework for a specific product with a
specific user and a specific data model.

Read this entire file before writing a single line of UI
code. If a decision is not covered here, ask: does this
serve the data or does it serve the designer’s ego?
If the answer is the latter, remove it.

-----

## The Product in One Sentence

MatchIQ is a prediction intelligence platform that shows
its reasoning. The UI’s only job is to make that reasoning
easy to read and easy to trust.

-----

## The Design Token System

These are the only values permitted in the codebase.
Never hardcode a colour, font size, radius, or spacing
value that is not derived from these tokens.

```javascript
const DESIGN = {
  // Surfaces — four elevation levels
  surface0: "#0E0E0E",   // page background
  surface1: "#161616",   // primary card
  surface2: "#1E1E1E",   // elevated card, inputs
  surface3: "#262626",   // hover states, chips

  // Light mode surfaces
  lSurface0: "#F5F5F5",
  lSurface1: "#FFFFFF",
  lSurface2: "#F0F0F0",
  lSurface3: "#E8E8E8",

  // Borders
  border:    "rgba(255,255,255,0.07)",
  borderMd:  "rgba(255,255,255,0.12)",
  borderHi:  "rgba(255,255,255,0.20)",

  // Light mode borders
  lBorder:   "rgba(0,0,0,0.07)",
  lBorderMd: "rgba(0,0,0,0.12)",
  lBorderHi: "rgba(0,0,0,0.20)",

  // Accent — single accent, used sparingly
  // Only for: positive value, active states, 
  // live indicators, primary CTAs
  accent:       "#B8FF57",
  accentBg:     "rgba(184,255,87,0.10)",
  accentBorder: "rgba(184,255,87,0.25)",

  // Semantic colours
  positive: "#B8FF57",
  warning:  "#FFB340",
  danger:   "#FF5F57",
  info:     "#5E9EFF",
  live:     "#FFB340",

  // Dark mode text — four levels
  text0: "#FFFFFF",   // primary, headings
  text1: "#A0A0A0",   // secondary, body
  text2: "#606060",   // tertiary, labels
  text3: "#383838",   // disabled, hints

  // Light mode text
  lText0: "#111111",
  lText1: "#555555",
  lText2: "#888888",
  lText3: "#BBBBBB",

  // Typography
  mono: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
  sans: "-apple-system, 'Inter', system-ui, sans-serif",

  // Type scale (fontSize / lineHeight / fontWeight)
  typeDisplay: { fontSize: 28, lineHeight: 1.15, fontWeight: 800 },
  typeTitle:   { fontSize: 20, lineHeight: 1.25, fontWeight: 700 },
  typeBody:    { fontSize: 15, lineHeight: 1.55, fontWeight: 400 },
  typeLabel:   { fontSize: 12, lineHeight: 1.0,  fontWeight: 600 },
  typeCaption: { fontSize: 11, lineHeight: 1.4,  fontWeight: 400 },
  typeData:    { fontSize: 13, lineHeight: 1.0,  fontWeight: 500 },
  typeDataSm:  { fontSize: 11, lineHeight: 1.0,  fontWeight: 500 },

  // Spacing — 8px base grid, all values multiples of 4
  space: {
    tight:  4,
    base:   8,
    inner:  16,
    outer:  20,
    page:   24,
  },

  // Border radius
  radius: {
    sm:   6,
    md:   10,
    lg:   14,
    full: 999,
  },

  // Transitions
  transitionFast:    "150ms ease",
  transitionNormal:  "200ms ease",
  transitionSlow:    "300ms ease",
};
```

-----

## Typography Rules

Two font tracks. Never mix within the same visual unit.

**Sans** (`DESIGN.sans`): prose, labels, headings,
navigation, UI chrome.

**Mono** (`DESIGN.mono`): all numerical data, times,
percentages, odds, confidence values, counts, status
codes, competition codes, tags, section labels.

Type scale rules:

- Display: page-level headings only. One per screen max.
- Title: section headings. Sparingly.
- Body: readable prose. Never use for data values.
- Label: uppercase, letter-spacing 0.08em.
  Competition names, filter labels, section headers.
- Caption: supporting text below primary content.
- Data: monospace numerical values.
  Always paired with a Label above it.
- DataSm: monospace small labels, badges, chips.

Contrast rules:

- text0 on surface1: always passes WCAG AA
- text1 on surface1: must be #A0A0A0 minimum
- accent on surface0: always passes
- Never put text2 on surface2 without checking contrast

-----

## Spacing Rules

8px base grid. Every spacing value is a multiple of 4px.

Page horizontal padding: 16px mobile, 32px desktop.
Card internal padding: 16px.
Between cards: 12px.
Between sections: 24px.
Between inline elements: 4–8px.
Between label and value: 4px.

Never use margin alone to separate sections.
Always pair spacing with a visible border or
background colour change.

-----

## Component Standards

### Cards

- Background: surface1
- Border: 1px solid border
- Border radius: radius.lg (14px)
- Padding: 16px
- No box-shadow on dark backgrounds
- One hover exception: pick cards get
  `box-shadow: 0 0 0 1px accentBorder` on hover
- Transition: borderColor 150ms ease on hover

### Fixture Rows

- Height: 48px minimum
- Three zones: left (time), center (teams), right (status)
- Time: DataSm mono, text2 — text1 if LIVE
- Home team: Body, text0, weight 600
- “vs”: Caption, text2
- Away team: Body, text0, weight 400
- Live dot: 6px circle, live colour, left of time
- Live text: DataSm mono, accent colour, no badge
- Analyzed indicator: 20px circle, accent bg,
  ChevronRight SVG in surface0
- Border-bottom: 1px border on every row
- Hover: background surface2, transition 100ms

### Badges and Pills

- Background: surface3
- Border: 1px borderMd
- Border radius: radius.sm (6px) for tags,
  radius.full (999px) for status pills
- Typography: DataSm mono, text1
- Never use filled colour on a badge unless it
  communicates live status or positive value
- Accent-filled badge: reserved exclusively for
  positive value edge signal

### Buttons

- Primary: accent background, surface0 text,
  weight 700, radius.md
- Secondary: surface2 background, text0 text,
  1px borderMd border, radius.md
- Never border-only for primary actions
- All buttons: 150ms transition on background/color

### Inputs

- Background: surface2
- Border: 1px border, focus: 1px borderHi
- Border radius: radius.md
- Padding: 12px 16px
- Font: Data mono for search, Body sans for text
- Focus ring: 2px accent, 2px offset (via outline)

### Icons

All icons are inline SVG components.
Never use emoji, unicode arrows, or icon libraries.
Standard icons: ChevronRight, ChevronLeft, Search,
Bell, Menu, Bookmark, X, Sun, Moon, Bookmark.
Each accepts size prop (default 16) and color prop
(default “currentColor”).
Stroke width: 1.5px for all icons.

### Dividers

1px solid border. Never rely on margin alone.

### Skeleton Loading

Animate opacity 0.3 → 0.7 → 0.3 on 1.5s loop.
Proportions must match the actual content they
replace. Never use a generic block.
Show the known content (match header) above
the skeletons so the user stays grounded.

### Empty States

A geometric SVG mark (not emoji, not illustration).
Primary message: Body, text1.
Secondary message: Caption, text2.
Never apologetic. Never “coming soon”.
Always honest and purposeful.

-----

## Screen-Specific Standards

### Fixture List

The time zone must dominate the left column.
Team names are the hero of each row.
Status information lives on the right only.
Competition group headers: Label uppercase, text2,
with a 1px border below the header row.
Live rows are the only rows that break the default
colour treatment — yellow time, yellow dot,
accent LIVE text.

### Analysis Result Screen

This is the most important screen in the product.
It must feel like a premium research report.

Structure order:

1. Match header (Display title, competition, time)
1. Data quality indicator (subtle, honest)
1. Recommendation block (confidence, pick, value edge)
1. Reasoning paragraph (plain prose, no label)
1. Three agent panels (equal visual weight)
1. Market implied probability cells
1. Red flags (only if present, danger accent)

Confidence score visual treatment:

- Under 50%: danger colour
- 50–65%: warning colour
- Over 65%: accent colour
  The confidence percentage number should be the
  largest typographic element in the recommendation
  block. It earns that size.

Confidence bar: 4px tall, full width, animated
fill from 0 to value on mount over 600ms ease-out.

Value edge chip: accent background only if positive.
Surface2 background if zero or negative.
Always show the sign (+ or -) explicitly.

Agent panels: three panels at equal visual weight.
Each has its own edge indicator pill.
Key factors render with a 2px left accent bar,
not bullets.
Never make one panel visually dominant over others.

Reasoning paragraph: Body text1. No label above it.
Minimum 3 sentences. It is the synthesis agent’s
voice and should read like one.

### Pick Cards

Match name is the typographic hero.
It should be Title size minimum, weight 700.
Everything else serves it.
Confidence and value edge are the supporting cast.
One-sentence reasoning below the match name,
clamped to 2 lines, text1.
The value edge chip is the only accent element.
Everything else is text2 or text1.

### Today Screen Header

This is a status block, not a hero section.
Compact. Data-dense. One card.
Shows total events, total leagues, last updated time.
No large display text. No marketing language.

-----

## Responsive Layout Standards

### Mobile (< 768px)

Sticky header: Menu + Wordmark + Search/Bell/Avatar.
Fixed bottom tab bar: Today, Picks, Tracking, Accuracy.
Tab labels always visible. No icon-only tabs.
Content scrolls between header and tab bar.
Horizontal padding: 16px.
Cards: full width, stacked.

### Desktop (≥ 768px)

Persistent left sidebar: 220px, always visible.
No hamburger. No toggle. No overlay on desktop.
Header: Wordmark left, Search + Bell + Avatar right.
Content area fills remaining width.
Horizontal padding: 32px on content.

### Wide Desktop (≥ 1100px)

Two-column main content:
Left: 400px fixture list (fixed width).
Right: fluid analysis pane.
Both columns scroll independently.

-----

## Animation and Motion Standards

Use motion purposefully. Every animation must
answer: what does this communicate to the user?

Permitted animations:

- Sidebar slide: translateX 200ms ease
- Overlay fade: opacity 200ms ease
- Confidence bar fill: width 600ms ease-out on mount
- Skeleton pulse: opacity 1.5s infinite
- Theme transition: color/background 200ms ease on root
- Filter tab active: background 150ms ease
- Row hover: background 100ms ease
- Pick card hover: box-shadow 150ms ease

Never animate:

- Layout properties (height, width except confidence bar)
- Content that the user is not directly interacting with
- Anything that would cause layout shift

-----

## Light and Dark Mode Standards

Dark is the primary mode. Light is a full peer,
not an afterthought.

Theme detection order:

1. localStorage key “matchiq_theme” if set
1. window.matchMedia(“prefers-color-scheme: dark”)
1. Default to dark

Theme toggle: Sun/Moon SVG icon button in header.
Applied via data-theme=“dark” or data-theme=“light”
on the root div.

Light mode must feel considered:

- Surfaces use warm-neutral whites and light grays
- Borders are subtle but present
- Text0 is near-black (#111111), not pure black
- Accent (#B8FF57) works on light — test contrast
- The mono font reads cleanly on light surfaces

200ms transition on the root element covering
color, background-color, and border-color when
theme changes. No flash of wrong theme on load.

-----

## What This Product Is Not

Do not make MatchIQ look like:

- A gambling app (no urgency, no “HOT PICKS”)
- A generic sports app (no team logos as heroes)
- A fintech dashboard (no charts for the sake of charts)
- An AI chatbot (no conversation UI patterns)
- A demo (no placeholder content, no mock data)

Do not use:

- Gradient borders
- Glow effects on non-live elements
- Box shadows for depth on dark backgrounds
- Border radius above 14px
- More than one accent element per card
- Emoji anywhere
- Unicode arrows or symbols (use SVG)
- Decorative elements that carry no information

-----

## Quality Bar

Before marking any UI task complete, ask:

1. Does every element on screen serve the user’s
   current task?
1. Is the typographic hierarchy immediately readable?
1. Do the spacing values follow the 8px grid?
1. Are all colours from the DESIGN token system?
1. Does the hover/active/focus state communicate
   clearly?
1. Does the loading state feel considered?
1. Does the empty state feel honest?
1. Does the error state give the user a path forward?
1. Would a product designer at Linear, Vercel, or
   Raycast be proud of this screen?
1. Does it look the same in both light and dark mode?

If any answer is no, fix it before moving on.