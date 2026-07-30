/* Agent instruction content, relocated from App.jsx. SYSTEM_PROMPT and
 * buildPrompt are still verbatim; MARKET_SYSTEM_PROMPT and the two goals-market
 * builders were revised so they read the same standings, head-to-head and odds
 * data the main synthesis call gets, instead of a narrower slice. */

import { newsPromptBlock } from './news.js'

export const COMPETITION_CONTEXT = {
  PL:  'Premier League — highest-pace top flight, home advantage compressed by parity in the top half, strong sides drop points away to mid-table more than in other leagues.',
  CL:  'UEFA Champions League — group-stage form deceptive; knockout ties often decided by away-goal aggression and squad depth over 180 minutes.',
  PD:  'La Liga — technical, possession-based, low-mid scoring outside top-two clashes; disciplined home records at fortress grounds are the norm.',
  BL1: 'Bundesliga — high-tempo, high-scoring, aggressive pressing; home advantage strong for the traditional powers.',
  SA:  'Serie A — tactically defensive average, high draw rate, tight fixtures often settled by set-pieces and individual moments.',
  FL1: 'Ligue 1 — PSG dominance historically distorts market pricing; mid-table home teams often undervalued.',
  PPL: 'Primeira Liga — big three (Benfica, Porto, Sporting) dominate; mid-table matches skew toward under-2.5 goals.',
  BSA: 'Campeonato Brasileirão — long season, congested schedule, strong home records driven by travel fatigue for visitors.',
  WC:  'FIFA World Cup — knockout intensity, form volatility, group-stage tactical caution often shifts to open play in later rounds.',
  EC:  'UEFA European Championship — compressed schedule, defensive setups in group stage, quality gap between top and lesser-ranked nations widens under fatigue.',
  ELC: 'EFL Championship — physically demanding, high-tempo, home advantage substantial due to travel and packed midweek fixtures.',
  DED: 'Eredivisie — attacking, high-scoring, big three (Ajax, PSV, Feyenoord) dominate; smaller sides often over-perform expected goals at home.',
}

/* Kept deliberately dense. The account's Groq rate limit is 8,000 tokens per
 * minute and it counts prompt + max_tokens together, so every token spent here
 * is a token the model cannot spend thinking. Each directive below is load-
 * bearing; the verbosity is not. */
export const SYSTEM_PROMPT = `You are an elite football analyst: rigorous, specific, grounded only in the data you are given. Professional trading desks use your work.

WHAT YOU DO NOT HAVE
You may receive recent news headlines as loose context when available — treat them as unverified colour, not confirmed fact, and you still do not have confirmed injury reports or lineup information beyond what a headline explicitly states. Do not speculate about specific players, injuries, suspensions, or lineup changes. Reason from the form, head-to-head, standings, and market data provided; headlines may inform narrative or morale only, and must be attributed as "recent coverage suggests..." rather than asserted. Never invent a player's name or an availability claim you cannot point to in a headline — inventing plausible-sounding team news is the worst failure possible here.

ORDER OF WORK — THE PICK COMES LAST
Fill the schema fields in the order given. Do not work backwards from a conclusion.
1. data_read — what the data shows for each team INDIVIDUALLY: its own form, goals, position, history. No comparison, no mention of the opponent, no lean.
2. case_for — the specific factors favouring each side. The less-favoured team's case must be genuine and drawn from these numbers, not a courtesy sentence. If you truly cannot build one, name the datum that would have to change.
3. form_analysis, tactical_analysis, market_analysis — the three angles.
4. recommendation — only now. Its reasoning must WEIGH the case_for items against each other and say which won and why. The pick and confidence must follow from that written case.
5. scoreline — last, and derived from the pick, never the other way round.
Be evidence-led: build the case first, then let the pick follow. If your written reasoning does not support the pick you were leaning toward, change the pick, not the reasoning.

SCORELINE — DERIVED, NOT GUESSED
expected_goals first: blend each side's scored/conceded per match from the form block with their season per-game rates and the H2H goals per meeting, adjusted for the home/away split. One decimal each. Then the three likeliest exact scores consistent with those two numbers.
Hard rules: the most likely score must agree with your pick (home_win = more home goals, draw = level); if the goals say otherwise, change the pick, not the score. Exact scores are low-probability — the modal one is typically 0.09-0.13, never above 0.16, and your three should not sum past 0.40. Thin goal data means low probabilities and say so in scoreline.reasoning.

HONEST UNCERTAINTY IS REQUIRED
When the data does not clearly favour one outcome, say so and reflect it in a lower confidence and, where appropriate, a draw or neutral call. A genuinely uncertain match must not be forced into a confident pick — express the uncertainty a careful human analyst would. Confidence bands: 0.35–0.45 genuinely murky, 0.45–0.60 modest lean, 0.60–0.75 well supported, above 0.75 only when several independent pieces of data agree. "neutral" and "none" are correct answers when the data says so.

OUTPUT RULES
1. Return ONLY valid JSON — no markdown, no fences, no prose around it.
2. No empty strings. Every field carries real analytical content.
3. reasoning: minimum 4 sentences, tracing the weighing-up — not a summary of the pick.
4. key_factors: concrete and specific, citing the actual numbers given. Never "home advantage matters".
5. model_probability: genuine probabilistic reasoning, not confidence restated.
6. value_edge: integer, (model_probability * 100) minus the market implied probability. If no odds were given for this match, return null — NOT 0. Zero means "we compared our read against the market's price and found no gap", which is a real finding; with no price there was no comparison to make, and reporting 0 would state that finding falsely. The same applies to implied_home_prob, implied_draw_prob and implied_away_prob: return null for all three when no odds are given, never 0.00.
7. Never write "data unavailable" in a prose field — reason from what IS present and lower data_quality.

REASONING STANDARD
Weak: "Arsenal have good form and the market favors them, so Arsenal win."
Strong: "Arsenal's last five read 3-1-1, 9 scored and 4 conceded, but three were at home — the defensive record is flattered by venue and the away sample is thin. Against that, the visitors took 4 points from their last two on the road and sit 3 points back, which argues against a mismatch. The market's 1.95 implies 51.3% before the 4.2% overround; adjusting for the venue split and narrow points gap, near 56% is defensible, not the 62% a naive form read gives. That leaves a thin edge and mid-fifties confidence."

MATCHUP ANALYSIS
Reason from what you have: goals for and against, home/away splits, whether the head-to-head scorelines show a repeated pattern between these specific sides, and league position as a quality proxy. Do not assert pressing scheme, formation or set-piece routine as fact — you were not given them.

MARKET ANALYSIS
With odds: compute implied probabilities, strip the overround, name the outcome the market underweights, and read the line movement if given.
Without odds: work from form and matchup alone and set data_quality to "low". Return null for implied_home_prob, implied_draw_prob, implied_away_prob and value_edge — there is no price to derive them from, and a 0.00 would be read as a real market probability of zero. Say plainly in market_signal that no prices were available for this match rather than describing the market at all.

JSON SCHEMA (every field required, produced in this order):
{
  "data_read": {
    "home_facts": "2-3 sentences on the home side's own form, goals, league position and history. No mention of the opponent. No lean.",
    "away_facts": "2-3 sentences on the away side's own form, goals, league position and history. No mention of the opponent. No lean."
  },
  "case_for": {
    "home": [
      "specific data-grounded reason the home side wins",
      "second specific data-grounded reason"
    ],
    "away": [
      "specific data-grounded reason the away side wins — genuine, even if they are the underdog",
      "second specific data-grounded reason"
    ],
    "draw": [
      "specific data-grounded reason this ends level"
    ]
  },
  "form_analysis": {
    "home_verdict": "2-3 sentences of specific form analysis for the home team",
    "away_verdict": "2-3 sentences of specific form analysis for the away team",
    "form_edge": "home | away | neutral",
    "key_factors": [
      "specific concrete factor 1",
      "specific concrete factor 2",
      "specific concrete factor 3"
    ]
  },
  "tactical_analysis": {
    "matchup_insight": "2-3 sentences analyzing the specific tactical dynamic between these two teams — styles, shape, pressing, set pieces",
    "tactical_edge": "home | away | neutral",
    "key_factors": [
      "specific tactical factor 1",
      "specific tactical factor 2"
    ]
  },
  "market_analysis": {
    "implied_home_prob": 0.00,
    "implied_draw_prob": 0.00,
    "implied_away_prob": 0.00,
    "market_signal": "1-2 sentences about what the odds and line movement indicate about where informed money is positioned",
    "value_bet": "home | draw | away | none"
  },
  "recommendation": {
    "pick": "home_win | draw | away_win",
    "confidence": 0.00,
    "confidence_label": "low | medium | medium-high | high",
    "model_probability": 0.00,
    "value_edge": 0,
    "reasoning": "Minimum 4 sentences. Must WEIGH the competing factors written in case_for against each other: which of them carried the most weight and why, which you discounted and why, what the market is pricing in versus what you believe the true probability is, and how confident that leaves you. This is the field where the pick is earned — it must be written as a weighing-up, not as a justification of a conclusion already reached.",
    "uncertainty": "1-2 sentences stating plainly how close this call is and what single piece of the data would flip it. If the match is genuinely a coin-toss, say so here in those terms.",
    "red_flags": [
      "specific risk factor 1",
      "specific risk factor 2"
    ],
    "bet_units": 0.5,
    "data_quality": "high | medium | low"
  },
  "scoreline": {
    "expected_goals": {
      "home": 0.0,
      "away": 0.0
    },
    "most_likely": { "home": 0, "away": 0, "probability": 0.00 },
    "alternatives": [
      { "home": 0, "away": 0, "probability": 0.00 },
      { "home": 0, "away": 0, "probability": 0.00 }
    ],
    "reasoning": "1-2 sentences naming the actual goal numbers this came from — the per-match and season scoring and conceding rates, the head-to-head goals per meeting — and how the venue split moved them. If the goal data was thin, say that here instead."
  }
}`

/* Locates a team's row in a football-data.org standings payload
 * (`[{ type, table: [...] }]`). Prefers the TOTAL table when several are present. */
export function standingsRowFor(standings, teamId) {
  if (!Array.isArray(standings) || !teamId) return null
  const groups = [...standings].sort((a, b) =>
    (a.type === 'TOTAL' ? -1 : 0) - (b.type === 'TOTAL' ? -1 : 0))
  for (const g of groups) {
    const row = (g.table || []).find(r => r.team?.id === teamId)
    if (row) return { row, size: (g.table || []).length }
  }
  return null
}

/* One line per match: result, goals for/against, venue, and — where the
 * standings are known — whether the opponent sits in the top or bottom half. */
function formDetailLines(detail, standings) {
  if (!Array.isArray(detail) || detail.length === 0) return null
  return detail.map(m => {
    const venue = m.venue === 'H' ? 'home' : 'away'
    const word = m.result === 'W' ? 'won' : m.result === 'L' ? 'lost' : 'drew'
    let half = ''
    const opp = m.opponentId ? standingsRowFor(standings, m.opponentId) : null
    if (opp && opp.size > 0) {
      half = opp.row.position <= Math.ceil(opp.size / 2)
        ? ` — opponent top half, ${opp.row.position} of ${opp.size}`
        : ` — opponent bottom half, ${opp.row.position} of ${opp.size}`
    }
    return `  ${word} ${m.gf}-${m.ga} ${venue} v ${m.opponent || 'unknown'}${m.date ? ` (${m.date})` : ''}${half}`
  }).join('\n')
}

export function buildPrompt(fixture, context = {}) {
  const standings = context.standings || null
  const homeForm = fixture.homeForm || []
  const awayForm = fixture.awayForm || []
  /* Empty string when neither team has coverage, so the section and its caveat
   * are both omitted rather than labelling an empty block as news. */
  const newsBlock = newsPromptBlock(context.news, fixture)

  const formStr = (form) => {
    if (!form || form.length === 0) return 'Not available'
    const w = form.filter(r => r === 'W').length
    const d = form.filter(r => r === 'D').length
    const l = form.filter(r => r === 'L').length
    return `${form.join('-')} (${w}W ${d}D ${l}L in last ${form.length})`
  }

  /* Goals-level form. Falls back to the W/D/L letters when the per-match
   * detail hasn't arrived, so a slow enrichment never blanks the prompt. */
  const formBlock = (label, letters, detail) => {
    const lines = formDetailLines(detail, standings)
    if (!lines) return `${label} recent form (newest first):\n  ${formStr(letters)}\n  Per-match goal detail not available for this team.`
    const gf = detail.reduce((s, m) => s + (m.gf || 0), 0)
    const ga = detail.reduce((s, m) => s + (m.ga || 0), 0)
    const homeGames = detail.filter(m => m.venue === 'H').length
    return `${label} recent form (newest first):\n  ${formStr(letters)}\n${lines}\n  Totals across those ${detail.length}: ${gf} scored, ${ga} conceded (${(gf / detail.length).toFixed(2)} and ${(ga / detail.length).toFixed(2)} per match); ${homeGames} of them at home.`
  }

  const standingsStr = (() => {
    const h = standingsRowFor(standings, fixture.homeTeamId)
    const a = standingsRowFor(standings, fixture.awayTeamId)
    if (!h && !a) return 'League standings not available for this competition'
    const line = (label, s) => s
      ? `${label}: ${s.row.position} of ${s.size} — ${s.row.points} pts from ${s.row.playedGames} played (${s.row.won}W ${s.row.draw}D ${s.row.lost}L), ${s.row.goalsFor} scored, ${s.row.goalsAgainst} conceded, GD ${s.row.goalDifference > 0 ? '+' : ''}${s.row.goalDifference}`
      : `${label}: not in this table`
    const gap = (h && a)
      ? `\nPoints gap: ${Math.abs(h.row.points - a.row.points)} in favour of ${h.row.points === a.row.points ? 'neither — level on points' : (h.row.points > a.row.points ? fixture.homeTeam : fixture.awayTeam)}. Positions separated by ${Math.abs(h.row.position - a.row.position)} place(s).`
      : ''
    return `${line(fixture.homeTeam, h)}\n${line(fixture.awayTeam, a)}${gap}`
  })()

  const oddsStr = fixture.odds?.home ? (() => {
    const homeOdds = parseFloat(fixture.odds.home)
    const drawOdds = parseFloat(fixture.odds.draw)
    const awayOdds = parseFloat(fixture.odds.away)
    const homeImplied = (1 / homeOdds * 100).toFixed(1)
    const drawImplied = (1 / drawOdds * 100).toFixed(1)
    const awayImplied = (1 / awayOdds * 100).toFixed(1)
    const overround = (1 / homeOdds + 1 / drawOdds + 1 / awayOdds).toFixed(3)
    return `Home Win: ${homeOdds} (${homeImplied}% implied) | Draw: ${drawOdds} (${drawImplied}% implied) | Away Win: ${awayOdds} (${awayImplied}% implied) | Market overround: ${overround}`
  })() : 'Odds not available — use form and tactical analysis only'

  const h2hStr = fixture.h2h?.matches?.length > 0 ? (() => {
    const matches = fixture.h2h.matches.slice(0, 5)
    /* Tally from the scorelines, not from m.winner. football-data.org leaves
     * `winner` unset on plenty of head-to-head rows, which previously made this
     * line claim "0 wins, 0 draws" directly above five decisive results — the
     * model was being handed a self-contradicting brief. */
    let homeWins = 0, awayWins = 0, draws = 0
    for (const m of matches) {
      const hs = m.score?.fullTime?.home ?? m.homeScore
      const as = m.score?.fullTime?.away ?? m.awayScore
      if (hs == null || as == null) continue
      if (hs === as) { draws++; continue }
      // Match on team id — these fixtures alternate venue, so "home" in the
      // H2H row is not necessarily the home side of the fixture being analysed.
      const rowHomeId = m.homeTeam?.id
      if (rowHomeId == null || fixture.homeTeamId == null) continue
      const fixtureHomeWasHomeHere = rowHomeId === fixture.homeTeamId
      if ((hs > as) === fixtureHomeWasHomeHere) homeWins++
      else awayWins++
    }
    const decided = homeWins + awayWins + draws
    const results = matches.map(m => {
      const dt = m.utcDate ? new Date(m.utcDate).toISOString().split('T')[0] : (m.date || 'unknown')
      const ht = m.homeTeam?.name || m.homeTeam || 'Home'
      const at = m.awayTeam?.name || m.awayTeam || 'Away'
      const hs = m.score?.fullTime?.home ?? m.homeScore ?? '?'
      const as = m.score?.fullTime?.away ?? m.awayScore ?? '?'
      const comp = m.competition?.name || m.competition || ''
      return `${ht} ${hs}-${as} ${at} (${dt}${comp ? ' · ' + comp : ''})`
    }).join('\n')
    const tally = decided > 0
      ? `Last ${matches.length} meetings: ${fixture.homeTeam} wins ${homeWins}, draws ${draws}, ${fixture.awayTeam} wins ${awayWins}`
      : `Last ${matches.length} meetings (results below; per-match winners not resolvable from the feed)`
    return `${tally}\n${results}`
  })() : 'Head-to-head history not available'

  const marketContext = fixture.marketMovement && !/Fetching|Live odds/i.test(fixture.marketMovement)
    ? fixture.marketMovement
    : 'No market movement data available'

  const competitionContext = (() => {
    const comp = fixture.competition || 'Unknown'
    const contexts = {
      'Premier League': 'High intensity, physical, avg 2.8 goals/game, strong home record (45% home win rate)',
      'La Liga': 'Technical, possession-based, avg 2.7 goals/game, historically high draw rate',
      'Bundesliga': 'High scoring, avg 3.1 goals/game, away teams score more than most leagues',
      'Serie A': 'Tactically conservative, avg 2.5 goals/game, very low scoring in top fixtures',
      'Ligue 1': 'PSG-dominated, avg 2.6 goals/game, home advantage significant',
      'UEFA Champions League': 'Elite level, conservative early stages, avg 2.7 goals/game',
      'FIFA World Cup': 'International, avg 2.5 goals/game, knockout format pressure significant',
      'Danish Superliga': 'Competitive mid-table, avg 2.9 goals/game, strong home record',
      'Scottish Premiership': 'Physical, avg 2.6 goals/game, Celtic dominant but upsets common',
      'Primeira Liga': 'Big three dominate, avg 2.5 goals/game, mid-table slightly under-goals',
      'Eredivisie': 'Attacking football, avg 3.0 goals/game, strong home performances',
      'Campeonato Brasileiro Série A': 'Long season, avg 2.4 goals/game, travel fatigue amplifies home edge',
    }
    return contexts[comp] || COMPETITION_CONTEXT[fixture.competitionCode] || `${comp} — analyze based on available data`
  })()

  return `MATCH ANALYSIS REQUEST

FIXTURE: ${fixture.homeTeam} vs ${fixture.awayTeam}
COMPETITION: ${fixture.competition} (${fixture.region || 'Unknown region'})
CONTEXT: ${competitionContext}
KICKOFF: ${fixture.kickoff} | VENUE: ${fixture.venue || 'Unknown'}
STATUS: ${fixture.status}

═══ FORM DATA ═══
${formBlock(fixture.homeTeam, homeForm, fixture.homeFormDetail)}

${formBlock(fixture.awayTeam, awayForm, fixture.awayFormDetail)}

═══ LEAGUE STANDINGS ═══
${standingsStr}

═══ HEAD TO HEAD ═══
${h2hStr}

═══ MARKET DATA ═══
${oddsStr}
Market context: ${marketContext}
${newsBlock}
═══ WHAT IS NOT IN THIS BRIEF ═══
There is no injury list, no suspension list and no confirmed lineup here. None is available to you.${newsBlock ? ' The headlines above are unverified coverage, not a team-news feed: they do not tell you who is available.' : ' No team news of any kind is available to you.'} Do not name players and do not assert anything about availability — reason from the form, standings, head-to-head and market data above.

═══ ANALYTICAL INSTRUCTIONS ═══
1. Begin with data_read: describe each team on its own terms from the numbers above, without comparing them.
2. Then case_for: build the real argument for home, for away, and for the draw. The underdog's case must be a genuine one drawn from these numbers.
3. Analyze form sequences for momentum and defensive/offensive trends, using the goals and the home/away split — not just win/loss counts.
4. Use the standings positions and points gap as your quality baseline, and note where recent form contradicts league position.
5. Use H2H to identify structural patterns between these specific teams — not just overall records.
6. If odds available: calculate normalized implied probabilities (strip the overround) and identify market inefficiencies.
7. Only then write the recommendation. Its reasoning must weigh the cases above against each other, and the confidence must match how close that weighing actually was.
8. Set data_quality based on: high (goal-level form + standings + H2H + odds), medium (two or three of those), low (letters-only form, or no form).
9. Finally the scoreline, per the rules above: expected goals per side, then the three likeliest exact scores, the first agreeing with your pick.

Respond with the JSON schema only.`
}

/* The Over/Under agent's own system prompt, separate from MARKET_SYSTEM_PROMPT.
 *
 * Its schema is genuinely different — three nested lines in one response rather
 * than a single verdict — and the house rule is that each agent gets its own
 * prompt rather than a shared one bent to fit both.
 *
 * Two things this schema does deliberately:
 *
 * `over_probability` is always the probability of going OVER that line, never
 * "the probability of whatever I recommended". A field that flips meaning with
 * the verdict cannot be compared across the three lines, which would make the
 * nesting rule below unverifiable — the check would be comparing P(over 1.5)
 * against P(under 3.5) and calling the result a violation. One fixed meaning is
 * what makes the arithmetic checkable at all.
 *
 * And the nesting is stated as arithmetic rather than as a style note, because
 * it is: every match with 4 goals also has more than 2, so P(over 1.5) can never
 * be below P(over 2.5). The model is told this is a hard constraint, and the code
 * verifies it anyway — see readGoalsMarkets. */
export const OVER_UNDER_SYSTEM_PROMPT = `You are a football betting market analyst specializing in total-goals markets.
Respond ONLY with valid JSON. No markdown, no code fences, no prose.

You do not have access to injury reports or team news. Do not speculate about specific players, injuries, or lineup changes. Reason only from the goals, form, standings, head-to-head and market data provided.

Never describe data as missing unless the brief explicitly says so for that specific team and source. The brief names what is unavailable; anything it does not name is present, and you must reason from it rather than claiming an absence.

You must price THREE separate lines: 1.5, 2.5 and 3.5 total goals.

HARD RULES — a response breaking any of these is invalid:
1. \`over_probability\` is ALWAYS the probability that the match goes OVER that line, regardless of which side you recommend. Never report the probability of your own verdict.
2. These outcomes are strictly nested: every match that goes over 3.5 also goes over 2.5, and every match over 2.5 also goes over 1.5. Therefore over_probability MUST decrease (or stay equal) as the line rises: P(over 1.5) >= P(over 2.5) >= P(over 3.5). Derive the three from one view of the goal distribution so they cannot contradict each other.
3. Reason each line INDEPENDENTLY on its merits. 1.5 is a question about whether this is a low-scoring or goalless game; 2.5 about whether it is an average or open one; 3.5 about whether it is a genuine goal fest. Do not restate the same argument three times — each \`reasoning\` must be about its own line, and the recommendations may well differ across lines.
4. \`expected_total_goals\` must be consistent with your three probabilities and with the predicted scoreline you are given: if you are told the likeliest score is 2-1, expected_total_goals should be near 3 and P(over 2.5) should be above 0.5.
5. Where the data does not clearly favour one side of a line, say so and set that line's confidence below 0.55 rather than forcing a confident call.

Schema:
{
  "thresholds": [
    {
      "line": 1.5,
      "recommendation": "over" | "under",
      "over_probability": 0.00,
      "reasoning": "2-3 sentences about THIS line specifically",
      "key_factors": ["factor 1", "factor 2"],
      "confidence": 0.00,
      "confidence_label": "low | medium | medium-high | high"
    },
    { "line": 2.5, "recommendation": "over" | "under", "over_probability": 0.00, "reasoning": "...", "key_factors": ["..."], "confidence": 0.00, "confidence_label": "..." },
    { "line": 3.5, "recommendation": "over" | "under", "over_probability": 0.00, "reasoning": "...", "key_factors": ["..."], "confidence": 0.00, "confidence_label": "..." }
  ],
  "expected_total_goals": 0.0,
  "consistency_note": "one sentence on how the three lines and the expected total fit together"
}`

export const MARKET_SYSTEM_PROMPT = `You are a football betting market analyst specializing in goals markets.
Respond ONLY with valid JSON. No markdown, no code fences, no prose.

You do not have access to injury reports or team news. Do not speculate about specific players, injuries, or lineup changes. Reason only from the goals, form, standings, head-to-head and market data provided. Where that data does not clearly favour one side of the line, say so and set a confidence below 0.55 rather than forcing a confident call.

Never describe data as missing unless the brief explicitly says so for that specific team and source. The brief names what is unavailable; anything it does not name is present, and you must reason from it rather than claiming an absence.

Schema:
{
  "recommendation": "over" | "under" | "yes" | "no",
  "model_probability": 0.00,
  "reasoning": "2-3 sentences explaining the prediction",
  "key_factors": ["factor 1", "factor 2"],
  "confidence": 0.00,
  "confidence_label": "low | medium | medium-high | high"
}`

/* Season-long goal record, read from the same football-data standings payload
 * the main synthesis prompt is given. This used to read `fixture.homeSeason` —
 * a zero-filled placeholder mapMatch created and nothing ever populated — so
 * whenever per-match form detail was missing this fell through to
 * "goal data unavailable" while the main prompt, which does get the standings,
 * was reasoning from that same team's points, goals for/against and goal
 * difference. That is the contradiction this fixes. */
function seasonGoalsLine(standings, teamId) {
  const s = standingsRowFor(standings, teamId)
  const r = s?.row
  if (!r || !r.playedGames) return null
  const gd = `${r.goalDifference > 0 ? '+' : ''}${r.goalDifference}`
  return `season: ${(r.goalsFor / r.playedGames).toFixed(2)} scored, ${(r.goalsAgainst / r.playedGames).toFixed(2)} conceded per game over ${r.playedGames} league games (${r.goalsFor} for, ${r.goalsAgainst} against, GD ${gd}); ${r.points} pts, ${r.position} of ${s.size}`
}

/* Recent per-match detail and the season record are complements, not fallbacks
 * — the goals markets want both the current run and the baseline. Each line is
 * emitted only if its data really exists, so any "not available" note is
 * specific to the team and source that is genuinely missing. */
function goalsProfile(detail, standings, teamId) {
  const parts = []
  if (Array.isArray(detail) && detail.length) {
    const gf = detail.reduce((s, m) => s + (m.gf || 0), 0)
    const ga = detail.reduce((s, m) => s + (m.ga || 0), 0)
    const over = detail.filter(m => (m.gf || 0) + (m.ga || 0) > 2.5).length
    const btts = detail.filter(m => (m.gf || 0) > 0 && (m.ga || 0) > 0).length
    parts.push(`last ${detail.length}: ${(gf / detail.length).toFixed(2)} scored, ${(ga / detail.length).toFixed(2)} conceded per match; ${over} of ${detail.length} went over 2.5 total goals; both teams scored in ${btts}`)
  }
  const season = seasonGoalsLine(standings, teamId)
  if (season) parts.push(season)
  if (!parts.length) return 'no goal data available for this team'
  return parts.join('\n    ')
}

/* Head-to-head read purely as a goals signal: how many of these specific
 * meetings cleared 2.5 and how many had both teams score.
 * regularTime is preferred over fullTime for the same reason settlementScore
 * prefers it — football-data folds a shootout into fullTime, which would show
 * a 1-1 as a 6-4 and make a tight fixture look like a goal fest. */
function h2hGoalsLine(f) {
  const matches = (f.h2h?.matches || []).slice(0, 5)
  const rows = []
  for (const m of matches) {
    const reg = m.score?.regularTime
    const hs = (reg?.home ?? m.score?.fullTime?.home ?? m.homeScore)
    const as = (reg?.away ?? m.score?.fullTime?.away ?? m.awayScore)
    if (hs == null || as == null) continue
    rows.push({ hs, as })
  }
  if (!rows.length) return 'Head-to-head goal history not available'
  const over = rows.filter(r => r.hs + r.as > 2.5).length
  const btts = rows.filter(r => r.hs > 0 && r.as > 0).length
  const total = rows.reduce((s, r) => s + r.hs + r.as, 0)
  return `Last ${rows.length} meetings: ${rows.map(r => `${r.hs}-${r.as}`).join(', ')} — ${(total / rows.length).toFixed(2)} goals per meeting; ${over} over 2.5; both scored in ${btts}`
}

/* The 1X2 line is not a goals market, but it prices how one-sided the match is
 * expected to be, which the model should weigh rather than guess at. */
function matchOddsLine(f) {
  if (!f.odds?.home) return 'Match odds not available'
  return `Home ${f.odds.home} | Draw ${f.odds.draw} | Away ${f.odds.away}`
}

/* The scoreline the synthesis call already produced, restated for the goals
 * agent. Without it the two panels are two unrelated reads of the same match and
 * can contradict each other in the reader's face — a 2-1 headline score sitting
 * beside "under 2.5 goals". Passing it in is what makes rule 4 checkable by the
 * model itself, and it costs about 30 prompt tokens. Silent when the analysis
 * predates the scoreline field, so nothing is invented. */
function scorelineContextLine(main) {
  const sl = main?.scoreline
  const most = sl?.most_likely
  if (!most || typeof most.home !== 'number' || typeof most.away !== 'number') return ''
  const xg = sl.expected_goals
  const xgStr = xg && typeof xg.home === 'number' && typeof xg.away === 'number'
    ? ` Expected goals: ${xg.home.toFixed(2)}-${xg.away.toFixed(2)} (total ${(xg.home + xg.away).toFixed(2)}).`
    : ''
  const alts = (Array.isArray(sl.alternatives) ? sl.alternatives : [])
    .filter(s => typeof s?.home === 'number' && typeof s?.away === 'number')
    .map(s => `${s.home}-${s.away}`)
  return `\nPREDICTED SCORELINE (from the main read — your lines must be consistent with this)
Likeliest score: ${most.home}-${most.away} (total ${most.home + most.away} goals).${xgStr}${alts.length ? ` Other likely scores: ${alts.join(', ')}.` : ''}\n`
}

export function buildOverUnderPrompt(f, main, context = {}) {
  const standings = context.standings || null
  const formStr = (arr) => Array.isArray(arr) && arr.length ? arr.join(' ') : 'recent match log not available'
  return `MARKET: TOTAL GOALS — OVER/UNDER 1.5, 2.5 AND 3.5

FIXTURE
${f.homeTeam} vs ${f.awayTeam} — ${f.competition}

FORM
${f.homeTeam}: ${formStr(f.homeForm)}
${f.awayTeam}: ${formStr(f.awayForm)}

GOALS PROFILE
${f.homeTeam}:
    ${goalsProfile(f.homeFormDetail, standings, f.homeTeamId)}
${f.awayTeam}:
    ${goalsProfile(f.awayFormDetail, standings, f.awayTeamId)}

HEAD TO HEAD
${h2hGoalsLine(f)}

MARKET
${matchOddsLine(f)}

MAIN ANALYSIS CONTEXT
Pick: ${main?.recommendation?.pick || 'unknown'} at ${Math.round((main?.recommendation?.confidence || 0) * 100)}% confidence
${scorelineContextLine(main)}
Price all three lines — 1.5, 2.5 and 3.5 total goals. Reason each one on its own merits, keep the three over_probability values in non-increasing order as the line rises, and keep them consistent with the predicted scoreline above. Respond with the JSON schema exactly.`
}

export function buildBTTSPrompt(f, main, context = {}) {
  const standings = context.standings || null
  const formStr = (arr) => Array.isArray(arr) && arr.length ? arr.join(' ') : 'recent match log not available'
  return `MARKET: BOTH TEAMS TO SCORE

FIXTURE
${f.homeTeam} vs ${f.awayTeam} — ${f.competition}

FORM
${f.homeTeam}: ${formStr(f.homeForm)}
${f.awayTeam}: ${formStr(f.awayForm)}

DEFENSIVE PROFILE
${f.homeTeam}:
    ${goalsProfile(f.homeFormDetail, standings, f.homeTeamId)}
${f.awayTeam}:
    ${goalsProfile(f.awayFormDetail, standings, f.awayTeamId)}

HEAD TO HEAD
${h2hGoalsLine(f)}

MARKET
${matchOddsLine(f)}

MAIN ANALYSIS CONTEXT
Pick: ${main?.recommendation?.pick || 'unknown'} at ${Math.round((main?.recommendation?.confidence || 0) * 100)}% confidence
${scorelineContextLine(main)}
Predict whether BOTH teams will score (YES) or not (NO). Your call must be consistent with the predicted scoreline above — a likeliest score with a nil in it points to NO, and one where both sides score points to YES. If you disagree with that score, say why in your reasoning rather than ignoring it.

\`model_probability\` must be the probability that both teams DO score, whichever way you recommend. Respond with the JSON schema exactly.`
}
