# MatchIQ UI Optimization Sprint

## Before You Write a Single Line of Code

Read these files in this exact order:

1. MATCHIQ_UI_SKILL.md — the design execution
   standard for this project. Every decision you
   make must pass through it.
1. CLAUDE.md — the project context, architecture,
   and constraints.
1. src/App.jsx — the current implementation in full.

Do not begin implementation until you have read
all three. Report what you found in each before
proceeding.

-----

## Your Role

You are a senior product designer and frontend
engineer. You have shipped production software at
companies where design quality is a competitive
advantage. You do not add things to look busy.
You remove things that do not earn their place.
Your instinct is restraint, precision, and craft.

-----

## Objective

Elevate the MatchIQ UI to a significantly higher
quality bar using the standards defined in
MATCHIQ_UI_SKILL.md as your complete design
authority.

You have full creative discretion over execution
quality. You have zero discretion over the token
system, the brand, the navigation structure, the
agent pipeline, or the API calls.

-----

## What Does Not Change

These are absolute. Touch them and the sprint fails.

- DESIGN token object — not one value changes
- SYSTEM_PROMPT — byte-identical
- buildPrompt — byte-identical
- Groq fetch call — URL, headers, body, unchanged
- Vite proxy configuration — untouched
- All import.meta.env references — unchanged
- No new npm packages
- No emoji anywhere
- No mock data

-----

## What Changes — Specific Tasks

Work through these in order. Do not skip ahead.

### Task 1 — Implement Light and Dark Mode

Dark mode is the existing design. Preserve it exactly.

Create a complete light mode token set following
the lSurface, lBorder, and lText values defined
in MATCHIQ_UI_SKILL.md.

Implement a useTheme hook that:

- Reads localStorage key “matchiq_theme” on init
- Falls back to window.matchMedia prefers-color-scheme
- Defaults to dark if neither is set
- Exposes theme (“dark” | “light”) and toggleTheme()
- Writes to localStorage on toggle
- Applies data-theme attribute to the root div

Apply a 200ms transition on the root container
covering color, background-color, and border-color.
This makes the theme switch feel smooth not jarring.

Add a theme toggle button to the header. Sun icon
in dark mode, Moon icon in light mode. Both as
inline SVG components following the icon standard
in MATCHIQ_UI_SKILL.md.

Verify both themes against the contrast rules
in the skill file before marking this done.

### Task 2 — Fixture List Refinement

The fixture row has three zones: time, teams, status.
Each zone must be typographically distinct.

Time zone (left, fixed width 44px):

- LIVE dot: 6px circle, live colour,
  positioned left of the time value
- Time: DataSm mono
- Colour: text2 normally, live colour when LIVE

Team zone (center, flexible):

- Home team: Body, text0, weight 600
- Separator: Caption “vs”, text3,
  horizontal margin 6px each side
- Away team: Body, text0, weight 400
- If IN_PLAY and score available:
  replace “vs” with “0 - 0” in DataSm mono
  accent colour

Status zone (right, fixed width):

- SCHEDULED: ChevronRight SVG, text3, 16px
- IN_PLAY: “LIVE” DataSm mono, accent colour
- FINISHED: “FT” DataSm mono, text3
- Analyzed: 20px filled accent circle,
  ChevronRight SVG in surface0
- Tracked: Bookmark SVG icon, accent if tracked,
  text3 if not. Tap toggles tracked state.

Competition group headers:

- Label uppercase mono, text2, 0.08em tracking
- Count in DataSm mono text3 right-aligned
- 1px border below the header row
- 20px top margin before each group except the first

Row hover: surface2 background, 100ms transition.
Every row: 1px border-bottom.

If a fixture has a matchDate (not today):
Show the date as a DataSm mono text2 label
above the time, within the time zone.

### Task 3 — Analysis Result Screen

This screen is the product. Treat it accordingly.

Structure (in this exact order, no exceptions):

MATCH HEADER

- Back action (mobile only): ChevronLeft +
  competition name, Caption text2, tap returns
  to fixture list
- Match title: Display size, text0, weight 800,
  no wrapping, overflow ellipsis
- Meta row: competition + kickoff in Caption mono text2

DATA QUALITY INDICATOR
Show a single subtle row below the meta:
“Data quality: {high | medium | low}”
DataSm mono. Colour: accent for high,
warning for medium, danger for low.
This comes from the data_quality field in the
Groq JSON response.

RECOMMENDATION BLOCK (surface1 card, full width)

- “RECOMMENDATION” Label uppercase mono text2
- Pick value: Title, text0, weight 700
- Confidence number: the largest element on screen
  32px mono weight 800, colour from the confidence
  colour scale in the skill file
- 4px confidence bar, full width, animated 600ms
  ease-out on mount, colour matches the number
- Two chips side by side:
  “Model {prob}%” — surface2 chip, DataSm mono
  “{+/-}{edge}% vs market” — accent bg if positive,
  surface2 if zero/negative, DataSm mono
- “BET {units}u” chip — surface2, Label mono
- Reasoning paragraph: Body text1, no label above it,
  minimum 3 sentences, margin-top 16px

RED FLAGS (only render if non-empty)

- “RED FLAGS” Label uppercase, danger colour
- Each flag: Caption text1, 3px left border danger

THREE AGENT PANELS (vertical stack mobile,
3-column on wide desktop if space allows)
Each panel: surface1 card, full width, Inner padding

- Panel label: Label uppercase mono text2
  (“FORM ANALYSIS”, “TACTICAL ANALYSIS”,
  “MARKET ANALYSIS”)
- Edge pill: accent bg if one team has edge,
  surface3 if neutral. Right-aligned in header row.
- Verdict: Body text1, margin-bottom 12px
- Key factors: each on its own row with a 2px
  left accent bar (not a bullet, not a dash)
  Caption text1, 8px left padding

MARKET CELLS (three equal columns)

- Home team first word / Draw / Away team first word
- Implied probability: Data mono text0 below label
- Market signal: Caption text1 below cells

### Task 4 — Pick Cards

The match name is the hero. Design for that.

Card structure (surface1, Lg radius, Inner padding):

Top row:

- Competition pill: surface3 bg, borderMd border,
  DataSm mono, text2, radius.sm
- Kickoff time: DataSm mono text2, right-aligned
- If agent consensus data exists: consensus
  squares right of time (8x8px, 4px gap,
  accent filled or surface3 empty)

Match title:

- Title size, text0, weight 700
- margin: 10px 0 6px

Reasoning excerpt:

- One sentence from the reasoning field
- Body text1, 2-line clamp, overflow ellipsis
- margin-bottom: 12px

Divider: 1px border

Recommendation row:

- “RECOMMENDATION” Label text2 above
- Pick value: Body text0 weight 600

Confidence row:

- Confidence % left: Data mono text0 weight 700
- 3px bar: full width, surface3 bg,
  filled width = confidence%, accent fill
- Value edge chip right: accent bg if positive,
  surface2 if not. DataSm mono.

Footer:

- “{n} risks flagged” Caption mono text2
- margin-top: 10px

### Task 5 — Loading and Empty States

Skeletons must match the proportions of the
content they represent.

Fixture list skeleton:

- 3 group headers (Label width skeleton)
- 4 rows per group (matching row height)
- Each row has three zones matching the real layout

Analysis skeleton:

- Match header block (2 lines)
- Recommendation card (5 lines of varied width)
- Three agent panel outlines

All skeletons: opacity 0.3 → 0.7 → 0.3, 1.5s loop.
Inject keyframe via a style tag in the component.

Empty states use a geometric SVG mark specific
to the context:

Fixture empty: two vertical rectangles,
different heights, 2px wide, accent colour,
24px and 16px tall, 4px apart.

Picks empty: a diamond shape outline,
16px, borderMd colour.

Tracking empty: a circle with a plus inside,
16px, text3 colour.

All empty states:

- Primary: Body text1
- Secondary: Caption text2
- No buttons unless there is a meaningful action
- Never apologetic, never “coming soon”

### Task 6 — Today Screen Header

Compact status block. Not a hero. Not marketing.

Single card (surface1, Inner padding):
Left column:

- “Today” Title sans text0
- Date in Caption mono text2 below

Right column (right-aligned):

- Two chips side by side:
  “{n} events” DataSm mono
  “{n} leagues” DataSm mono
  Both: surface2 bg, 1px borderMd, radius.sm
- “Updated {time} UTC” Caption mono text2 below chips

Full width below, 1px border-top, padding-top 10px:

- “{n} analysed today” Caption mono text2 left
- “Market refresh {n}s ago” Caption mono text2 right

### Task 7 — Micro-interactions

Every interactive element needs a considered state.

Focus rings: 2px accent, 2px offset, on all
interactive elements via :focus-visible.
Never outline: none without a replacement.

All icon buttons: aria-label attribute.

Sidebar slide (mobile): translateX(-260px) to
translateX(0) over 200ms ease. Apply on the
sidebar div style directly, toggled by sidebarOpen.
Overlay behind sidebar: opacity 0 to 0.7 over
200ms ease.

Theme transition: apply to the root container:
transition: color 200ms ease,
background-color 200ms ease,
border-color 200ms ease

Bookmark toggle: immediate visual feedback,
no delay. Accent fill on active, text3 on inactive.

-----

## Implementation Order

Do not skip ahead. Do not work on task 3 before
task 1 is complete and verified.

1. Read all three files. Report findings.
1. Implement useTheme hook and light mode.
1. Verify both themes in browser before continuing.
1. Refine fixture list rows.
1. Rebuild analysis result screen.
1. Rebuild pick cards.
1. Fix loading and empty states.
1. Rebuild today header.
1. Add micro-interactions.
1. Run full regression checklist.
1. Write final report.

-----

## Regression Checklist

Every item must pass before the sprint is complete.

DESIGN SYSTEM

- [ ] No colour value outside DESIGN tokens
- [ ] No font size outside type scale
- [ ] No spacing value not on 4px grid
- [ ] No border radius above 14px
- [ ] No emoji anywhere
- [ ] No mock data anywhere

THEME

- [ ] Dark mode renders correctly
- [ ] Light mode renders correctly
- [ ] Theme persists on refresh
- [ ] Defaults to system preference
- [ ] Toggle button in header with correct icon
- [ ] 200ms transition on theme change
- [ ] No flash of wrong theme on load
- [ ] Accent readable in both themes

FIXTURE LIST

- [ ] Three zones clearly distinct
- [ ] Time: DataSm mono, correct colour per status
- [ ] Teams: correct weight hierarchy
- [ ] Status zone: correct treatment per status
- [ ] Live dot appears on IN_PLAY rows
- [ ] Analyzed circle appears for cached fixtures
- [ ] Bookmark toggle works and persists
- [ ] Group headers with border-bottom
- [ ] Row hover state works
- [ ] Border-bottom on every row

ANALYSIS SCREEN

- [ ] Match header renders correctly
- [ ] Data quality indicator present
- [ ] Confidence number is largest element
- [ ] Confidence colour follows the scale
- [ ] Bar animates on mount
- [ ] Value edge chip uses correct background
- [ ] Reasoning is 3+ sentences
- [ ] Red flags only render when non-empty
- [ ] Three agent panels at equal weight
- [ ] Key factors use 2px left bar not bullets
- [ ] Market cells render correctly
- [ ] Back button on mobile only

PICK CARDS

- [ ] Match title is typographic hero
- [ ] Reasoning excerpt clamps to 2 lines
- [ ] Confidence bar present
- [ ] Value edge chip correct colour
- [ ] Footer shows risk count

STATES

- [ ] Skeletons match content proportions
- [ ] Skeleton animation runs
- [ ] Empty states use geometric SVG marks
- [ ] Error states have retry actions
- [ ] No “coming soon” anywhere

CORE FUNCTIONALITY

- [ ] SYSTEM_PROMPT byte-identical
- [ ] buildPrompt byte-identical
- [ ] Groq fetch unchanged
- [ ] Vite proxy unchanged
- [ ] All API keys via import.meta.env
- [ ] No new npm packages
- [ ] Zero compile errors
- [ ] All tabs navigate correctly
- [ ] Analysis runs and renders result
- [ ] analysisCache persists to localStorage
- [ ] Tracked fixtures persist to localStorage

-----

## Final Report

Structure your report as:

Design Decisions Made: for each task, what you
did and why. Not what the spec said — your
reasoning for each execution choice.

Light Mode Approach: how you designed it as a
peer to dark mode, not a derivative.

What Was Preserved: confirm SYSTEM_PROMPT,
buildPrompt, Groq fetch, proxy are byte-identical.

Regression Checklist: every item with pass or fail.

Remaining Issues: honest assessment of what
is not yet perfect and why.

Next Recommended Step: one clear sprint goal.