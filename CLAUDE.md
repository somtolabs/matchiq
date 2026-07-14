# MatchIQ — Claude Code Brief

## What This Is

MatchIQ is a multi-agent football match analysis system built in React (Vite).
Users select a Premier League fixture, hit Analyze, and AI agents process the
match from three independent angles — form, tactical, and market — before a
synthesis agent produces a structured recommendation with confidence score,
value edge, and bet unit suggestion.

This is a solo project by Bright Agwunobi. Every decision must be explained,
every file read before touched, every working feature preserved.

-----

## Current State — Prototype v1

The prototype is fully working with these constraints:

- Fixture data is **mocked** (four hardcoded Premier League matches)
- A **single agent** currently handles what will eventually be three separate agents
- All Anthropic API calls happen **directly from React** (no backend yet)
- Styling is **100% inline styles** — no Tailwind, no CSS files, no external UI libraries
- The app is **single-file** — all components live in `src/App.jsx`

Do not add a backend, do not introduce Tailwind, do not split into multiple
files unless explicitly instructed. Extend the existing architecture.

-----

## Tech Stack

|Layer      |Technology                                      |
|-----------|------------------------------------------------|
|Frontend   |React 18 + Vite                                 |
|AI Agents  |Anthropic API (claude-sonnet-4-6)               |
|Styling    |Inline styles only (design tokens in `C` object)|
|Data (now) |Hardcoded mock fixture array                    |
|Data (next)|football-data.org API + The Odds API            |
|Backend    |None yet (prototype stage)                      |

-----

## File Structure

```
matchiq/
├── CLAUDE.md              ← you are reading this
├── index.html             ← Vite entry point
├── vite.config.js         ← Vite config (default, do not modify)
├── package.json
└── src/
    ├── main.jsx           ← React root mount (do not modify)
    └── App.jsx            ← ENTIRE application lives here
```

Everything is in `src/App.jsx`. Read it fully before changing anything.

-----

## Architecture

### Agent Pipeline (current — single agent)

```
user selects fixture
        ↓
runAnalysis() fires
        ↓
single Anthropic API call receives all match data
        ↓
agent returns structured JSON
        ↓
AnalysisCard renders the result
```

### Agent Pipeline (next — three parallel agents)

```
user selects fixture
        ↓
Promise.all([
  runFormAgent(fixture),       ← only looks at form + season stats
  runTacticalAgent(fixture),   ← only looks at H2H + tactical matchup
  runMarketAgent(fixture)      ← only looks at odds + market movement
])
        ↓
all three resolve
        ↓
runSynthesisAgent(form, tactical, market, fixture)
        ↓
AnalysisCard renders the result
```

The synthesis agent must REASON about disagreements between agents,
not average their outputs. This distinction is the core product value.

-----

## Component Map (src/App.jsx)

Read these in order before modifying anything:

|Component / Function  |What It Does                                                         |
|----------------------|---------------------------------------------------------------------|
|`FIXTURES`            |Mock array of 4 EPL fixtures with form, stats, odds, market movement |
|`SYSTEM_PROMPT`       |The AI agent’s instruction set — returns structured JSON only        |
|`buildPrompt(fixture)`|Formats fixture data into the user message sent to the API           |
|`C`                   |Design token object — all colors live here, never hardcode hex values|
|`FormDot`             |Renders a single W/D/L badge with correct color                      |
|`EdgePill`            |Renders a home/away/neutral edge badge                               |
|`OddChip`             |Renders a single odds value (H/D/A)                                  |
|`Divider`             |Horizontal rule between sections                                     |
|`SectionCard`         |Wrapper card for analysis sections                                   |
|`Label`               |Uppercase section label                                              |
|`FixtureCard`         |Clickable fixture card showing teams, form, odds                     |
|`AnalysisCard`        |Full analysis output (recommendation + 3 sections)                   |
|`Spinner`             |Loading state while agents run                                       |
|`MatchIQ` (default)   |Main app — manages state, renders fixtures + results                 |

-----

## Design Tokens (the `C` object)

Never hardcode colors. Always use these tokens:

```js
C.bg          // #040A17  — page background
C.card        // #0B1628  — card backgrounds
C.cardLight   // #0F1F3D  — lighter card variant
C.border      // rgba(255,255,255,0.07)
C.borderHi    // rgba(255,255,255,0.14)
C.amber       // #F59E0B  — primary accent (recommendation, CTA)
C.green       // #10B981  — positive signals, value edge
C.red         // #EF4444  — red flags, negative edge
C.blue        // #60A5FA  — tactical analysis accent
C.textPrimary   // #F1F5F9
C.textSecondary // #64748B
C.textMuted     // #334155
```

-----

## Anthropic API Rules

- Model: `claude-sonnet-4-6` for all agents in prototype
- Max tokens: `1000` per call
- System prompt instructs the model to return **pure JSON only** — no markdown, no fences
- Always strip code fences before parsing: `raw.replace(/```json|```/g, "").trim()`
- Always wrap parse in try/catch and set error state on failure
- Never put an API key in the code — the artifact handles auth automatically

When splitting into three agents:

- Each agent gets its own `SYSTEM_PROMPT` constant — do not share one prompt
- Each agent only receives the data relevant to its domain
- Use `Promise.all` — agents run in parallel, not sequentially
- Synthesis agent only fires after all three resolve

-----

## JSON Schema (current single agent)

The agent must return this exact shape:

```json
{
  "form_analysis": {
    "home_verdict": "string",
    "away_verdict": "string",
    "form_edge": "home | away | neutral",
    "key_factors": ["string", "string", "string"]
  },
  "tactical_analysis": {
    "matchup_insight": "string",
    "tactical_edge": "home | away | neutral",
    "key_factors": ["string", "string"]
  },
  "market_analysis": {
    "implied_home_prob": 0.00,
    "implied_draw_prob": 0.00,
    "implied_away_prob": 0.00,
    "market_signal": "string",
    "value_bet": "home | draw | away | none"
  },
  "recommendation": {
    "pick": "home_win | draw | away_win",
    "confidence": 0.00,
    "confidence_label": "low | medium | medium-high | high",
    "model_probability": 0.00,
    "value_edge": 0,
    "reasoning": "string",
    "red_flags": ["string"],
    "bet_units": 0.5
  }
}
```

-----

## What to Build Next (priority order)

### Sprint 2 — Three Parallel Agents

Split `runAnalysis()` into four functions:

1. `runFormAgent(fixture)` — form + season stats only
1. `runTacticalAgent(fixture)` — H2H + tactical matchup only
1. `runMarketAgent(fixture)` — odds + market movement only
1. `runSynthesisAgent(formResult, tacticalResult, marketResult, fixture)`

Fire 1-3 with `Promise.all`. Pass results to 4. Update loading state to show
which agents are still running. Update `AnalysisCard` to show which agent
flagged each insight.

### Sprint 3 — Real Fixture Data

Replace the `FIXTURES` mock array with a real fetch from football-data.org.
API key goes in a `.env` file as `VITE_FOOTBALL_API_KEY`. Fetch on app mount
with `useEffect`. Show a skeleton loader while fixtures load. Handle API errors
gracefully with a retry button.

### Sprint 4 — Live Odds

Fetch live odds from The Odds API on fixture selection (not on app mount).
API key goes in `.env` as `VITE_ODDS_API_KEY`. Refresh odds if fixture was
selected more than 2 hours ago. Show a “stale odds” warning badge if refresh
fails.

### Sprint 5 — Backtesting Store

After each match resolves, store the prediction and actual result in
localStorage. Build a simple accuracy dashboard showing hit rate per
confidence level and average value edge realized.

-----

## Rules — Read Before Every Task

1. **Read before writing.** Read every file mentioned in the task before
   changing anything. State what you found.
1. **Extend, never rewrite.** If something works, keep it. Add to it.
   Do not refactor working code unless the task explicitly says to.
1. **One component, one job.** If a component already exists for a UI
   pattern, use it. Never create a duplicate.
1. **Design tokens only.** All colors come from the `C` object.
   No hardcoded hex values anywhere.
1. **JSON only from agents.** Agents must never return prose. If an agent
   response fails to parse as JSON, set the error state and stop — do not
   try to extract meaning from malformed output.
1. **No silent failures.** Every API call, every parse, every fetch must
   have explicit error handling that updates UI state.
1. **Inline styles only.** Do not introduce CSS files, CSS modules, or
   Tailwind classes. Match the existing styling pattern exactly.
1. **No new dependencies without asking.** Check `package.json` before
   suggesting an install. Prefer native browser APIs over libraries.

-----

## Regression Checklist

Run this after every task:

- [ ] All four fixture cards still render
- [ ] Selecting a fixture highlights it correctly
- [ ] Analyze button fires and shows loading state
- [ ] Agent returns valid JSON and analysis card renders
- [ ] Recommendation section shows pick, confidence bar, value edge, bet units
- [ ] Form / Tactical / Market sections all render with correct edge pills
- [ ] Red flags section appears when agent returns them
- [ ] Error state appears and is dismissible on API failure
- [ ] No hardcoded hex values added to the code
- [ ] No new npm packages added without explicit instruction

-----

## Final Report Format

After every task, produce a report with these sections:

**Task Completed:** one sentence  
**Files Modified:** list every file touched  
**What Changed:** bullet points of specific changes  
**What Was Preserved:** confirm working features still work  
**Regression Check:** confirm all checklist items pass  
**Next Recommended Step:** one clear suggestion