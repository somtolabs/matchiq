/* Analysis maths and secondary-market agent calls.
 * The Groq endpoint and auth header pattern are unchanged. */

import { GROQ_MODEL, GROQ_ENDPOINT, AGENT_PARAMS, extractFirstJsonObject } from './groq.js'
import { settlementScore, matchScore } from './football.js'
import {
  MARKET_SYSTEM_PROMPT,
  OVER_UNDER_SYSTEM_PROMPT,
  buildOverUnderPrompt,
  buildBTTSPrompt,
} from './prompts.js'

export function calculateKelly(analysis, fixture) {
  const pick = analysis?.recommendation?.pick
  const modelProb = analysis?.recommendation?.model_probability
  const odds = pick === 'home_win' ? fixture?.odds?.home
    : pick === 'away_win' ? fixture?.odds?.away
    : pick === 'draw' ? fixture?.odds?.draw
    : null
  if (!odds || !modelProb) {
    return { full: null, half: null, fullPercent: null, halfPercent: null,
      label: 'No odds available for Kelly calculation' }
  }
  const b = parseFloat(odds) - 1
  const p = modelProb
  const q = 1 - p
  const kelly = b > 0 ? (b * p - q) / b : 0
  const fullKelly = Math.max(0, kelly)
  const halfKelly = fullKelly / 2
  return {
    full: parseFloat(fullKelly.toFixed(4)),
    half: parseFloat(halfKelly.toFixed(4)),
    fullPercent: parseFloat((fullKelly * 100).toFixed(1)),
    halfPercent: parseFloat((halfKelly * 100).toFixed(1)),
    label: fullKelly <= 0 ? 'No edge detected — do not bet'
      : halfKelly < 0.01 ? 'Marginal edge — minimal stake'
      : 'Positive edge detected',
  }
}

/* `context` carries the same standings payload the main synthesis call is given.
 * It is passed in rather than fetched: the caller already holds it, and these
 * agents must reason from exactly the data the main read used, not a subset. */
export async function runMultiMarketAnalysis(fixture, mainAnalysis, context = {}) {
  /* Still exactly two calls, so a full analysis remains three in total.
   *
   * The three Over/Under lines share ONE call rather than getting one each. That
   * is not only about the token budget (though adding two more calls would not
   * fit — see the reservation arithmetic below): 1.5, 2.5 and 3.5 are strictly
   * nested outcomes, so they have to come out of a single view of the goal
   * distribution or they contradict each other. Three independent calls would
   * each reason from scratch and routinely return P(over 1.5) below P(over 2.5),
   * which is arithmetically impossible and would leave the validator rejecting
   * most responses. Reasoned together, the constraint is one the model can
   * actually hold.
   *
   * BTTS keeps its own call because it is a different question — how the goals
   * are split between the two sides, not how many there are. A 3-0 and a 2-1
   * are the same total-goals answer and opposite BTTS answers, so folding it in
   * would have one brief pulling in two directions. */
  const markets = [
    {
      key: 'over_under',
      label: 'Total goals — 1.5, 2.5, 3.5',
      system: OVER_UNDER_SYSTEM_PROMPT,
      prompt: buildOverUnderPrompt(fixture, mainAnalysis, context),
      /* Back on the shared 1,800. The earlier bump to 2,600 for the three-line
       * schema was sized by guesswork and turned out to be unnecessary. Measured
       * against the live API with a full, worst-case brief (complete form, both
       * teams' season standings, five h2h meetings, live odds): prompt 1,290, and
       * the three-threshold answer finished in 442 and 525 completion tokens over
       * two clean finish:"stop" runs at reasoning_effort 'low'. 1,800 clears the
       * observed max by ~3.4x — no truncation risk — and drops this call's
       * reservation from 3,890 to 3,090 against the 8,000/min ceiling. */
      params: AGENT_PARAMS,
    },
    {
      key: 'btts',
      label: 'Both Teams to Score',
      system: MARKET_SYSTEM_PROMPT,
      prompt: buildBTTSPrompt(fixture, mainAnalysis, context),
      params: AGENT_PARAMS,
    },
  ]
  /* Staggered at 70s and 100s, and both market calls fire in the minute AFTER
   * the synthesis call rather than alongside it.
   *
   * The binding constraint is the account's 8,000 tokens-per-minute ceiling, and
   * Groq counts prompt + max_tokens against it up front. That reservation model
   * is measured, not assumed: firing these calls live, one was rejected at a
   * cumulative 8,033 ("429 … Limit 8000, Used 4143, Requested 3890") and another
   * at 10,578 — so the full max_tokens really is reserved, correcting an earlier
   * note here that guessed Groq under-reserves.
   *
   * Worst-case reservations (prompt + max_tokens), all measured live:
   *   synthesis    ~3,400 + 4,200 = 7,600   → leaves only ~400 in its own minute
   *   over_under    1,290 + 1,800 = 3,090
   *   btts            807 + 1,800 = 2,607
   *
   * Synthesis alone nearly fills its minute, so neither market call can share it.
   * The first waits until 70s — clear of synthesis's rolling-60s window with a
   * 10s cushion that also survives the single synthesis retry (fired a few
   * seconds in, its window closes by ~63s). In the second window the two market
   * calls total 3,090 + 2,607 = 5,697, well under 8,000, so 70s/100s carries both
   * with ~2,300 to spare. They are background enrichment behind an already-
   * rendered verdict, so the wait costs the reader nothing while a 429 would cost
   * them the panel — the stagger is correctly sized and stays. */
  const results = await Promise.allSettled(markets.map(async (market, i) => {
    await new Promise(r => setTimeout(r, 70000 + i * 30000))
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: market.system },
          { role: 'user', content: market.prompt },
        ],
        response_format: { type: 'json_object' },
        ...market.params,
      }),
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error.message || 'groq rejected the market call')
    /* Logged because the reservation arithmetic above is only as good as its
     * inputs, and those were estimates until a real call reported them. Makes
     * the next person's budget decision measurable rather than inherited. */
    const u = data.usage || {}
    console.log(`[groq] ${market.key}: prompt ${u.prompt_tokens ?? '?'} + completion ${u.completion_tokens ?? '?'} = ${u.total_tokens ?? '?'} tokens · reserved ${(u.prompt_tokens ?? 0) + (market.params.max_tokens || 0)} against the 8,000/min ceiling · finish: ${data.choices?.[0]?.finish_reason ?? '?'}`)
    const parsed = extractFirstJsonObject(data.choices?.[0]?.message?.content)
    return { key: market.key, label: market.label, result: parsed }
  }))
  return results.filter(r => r.status === 'fulfilled').map(r => r.value)
}

/* ---------- the predicted scoreline ----------
 *
 * Read out of the model's `scoreline` block rather than recomputed, because the
 * derivation belongs where the data is: the synthesis prompt already carries
 * per-match goals for and against with the home/away split, season per-game
 * rates from the standings, and goals per meeting from the head-to-head. A
 * second calculation here would be a different, worse model of the same
 * numbers, and it could disagree with the verdict written beside it.
 *
 * What this function does instead is refuse to render anything that isn't a
 * real, coherent prediction:
 *   - goals must be non-negative whole numbers, probabilities real fractions;
 *   - the whole block is dropped if the modal score is missing, because the
 *     alternatives alone are not a prediction;
 *   - `agreesWithPick` is computed, not assumed. The prompt requires the modal
 *     score to match the pick, but a prompt rule is not a guarantee, and a
 *     scoreline quietly contradicting the verdict above it is exactly the class
 *     of contradiction this app has had to fix twice already. Surfaced, not
 *     suppressed.
 *
 * Returns null when there is nothing honest to show — every analysis cached
 * before this field existed lands here, which is the common case at first. */
const isCount = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 20 && Number.isInteger(n)
const asProb = (p) => (typeof p === 'number' && Number.isFinite(p) && p > 0 && p <= 1 ? p : null)

function cleanScore(s) {
  if (!s || typeof s !== 'object') return null
  if (!isCount(s.home) || !isCount(s.away)) return null
  return { home: s.home, away: s.away, probability: asProb(s.probability) }
}

export function readScoreline(analysis) {
  const sl = analysis?.scoreline
  if (!sl || typeof sl !== 'object') return null
  const most = cleanScore(sl.most_likely)
  if (!most) return null

  const alternatives = (Array.isArray(sl.alternatives) ? sl.alternatives : [])
    .map(cleanScore)
    .filter(Boolean)
    // A repeat of the headline score is not an alternative.
    .filter(s => !(s.home === most.home && s.away === most.away))
    .slice(0, 2)

  const xg = sl.expected_goals
  const expected = (xg && typeof xg.home === 'number' && typeof xg.away === 'number'
    && Number.isFinite(xg.home) && Number.isFinite(xg.away)
    && xg.home >= 0 && xg.away >= 0 && xg.home <= 10 && xg.away <= 10)
    ? { home: xg.home, away: xg.away }
    : null

  const pick = analysis?.recommendation?.pick
  const impliedByScore = most.home > most.away ? 'home_win'
    : most.away > most.home ? 'away_win' : 'draw'
  // Only meaningful when there is a pick to compare against.
  const agreesWithPick = pick ? impliedByScore === pick : true

  return {
    most,
    alternatives,
    expected,
    agreesWithPick,
    impliedByScore,
    reasoning: typeof sl.reasoning === 'string' && sl.reasoning.trim() ? sl.reasoning.trim() : null,
    // Carried through so the UI can caveat a thin-data prediction without
    // reaching back into the recommendation for it.
    dataQuality: analysis?.recommendation?.data_quality || null,
  }
}

/* ---------- the goals markets: three nested lines plus BTTS ----------
 *
 * Same posture as readScoreline: refuse to render anything that isn't a real,
 * coherent prediction, and compute the agreements rather than trusting the
 * prompt's word that they hold.
 *
 * The nesting rule is the substance here. P(over 1.5) >= P(over 2.5) >=
 * P(over 3.5) is not a preference, it is arithmetic — the over-3.5 matches are a
 * subset of the over-2.5 matches, which are a subset of the over-1.5 ones. A
 * response violating it has not given three prices, it has given three numbers
 * that cannot all describe the same match.
 *
 * It is FLAGGED, not silently repaired. Repairing would mean inventing
 * probabilities the model didn't produce and presenting them as its read, and
 * there is no honest way to choose which of the three numbers was the wrong one.
 * The same call this codebase already makes for a scoreline that contradicts its
 * own pick: surface the disagreement, let the reader weigh it. `coherent` is
 * what the UI keys the warning on, and the numbers shown are always the ones the
 * model actually returned.
 *
 * `over_probability` is read as the probability of going OVER that line, which
 * is what the system prompt fixes it to mean — that single fixed direction is
 * what makes the comparison legitimate. */
const LINES = [1.5, 2.5, 3.5]

function cleanThreshold(t) {
  if (!t || typeof t !== 'object') return null
  const line = typeof t.line === 'number' ? t.line : parseFloat(t.line)
  if (!LINES.includes(line)) return null
  const p = asProb(t.over_probability)
  if (p == null) return null
  const rec = t.recommendation === 'over' || t.recommendation === 'under' ? t.recommendation : null
  if (!rec) return null
  return {
    line,
    recommendation: rec,
    overProbability: p,
    reasoning: typeof t.reasoning === 'string' && t.reasoning.trim() ? t.reasoning.trim() : null,
    keyFactors: Array.isArray(t.key_factors) ? t.key_factors.filter(x => typeof x === 'string' && x.trim()) : [],
    confidence: asProb(t.confidence),
    confidenceLabel: typeof t.confidence_label === 'string' ? t.confidence_label : null,
    /* The model may recommend either side of a line; whether that recommendation
     * agrees with its own probability is checkable, and a mismatch (recommending
     * "over" at a 38% chance of going over) is a real contradiction worth
     * showing rather than quietly rendering. */
    recommendationMatchesProb: rec === 'over' ? p >= 0.5 : p < 0.5,
  }
}

export function readGoalsMarkets(analysis) {
  const entries = Array.isArray(analysis?.multiMarket) ? analysis.multiMarket : []
  const ou = entries.find(m => m?.key === 'over_under')?.result
  const bttsRaw = entries.find(m => m?.key === 'btts')?.result

  const thresholds = (Array.isArray(ou?.thresholds) ? ou.thresholds : [])
    .map(cleanThreshold)
    .filter(Boolean)
    // One entry per line, lowest first — a duplicated line would break nesting.
    .filter((t, i, arr) => arr.findIndex(x => x.line === t.line) === i)
    .sort((a, b) => a.line - b.line)

  /* ---- the nesting check (Part 4) ---- */
  const violations = []
  for (let i = 1; i < thresholds.length; i++) {
    const lo = thresholds[i - 1]
    const hi = thresholds[i]
    if (hi.overProbability > lo.overProbability) {
      violations.push(
        `over ${hi.line} is priced at ${Math.round(hi.overProbability * 100)}%, above over ${lo.line} at ${Math.round(lo.overProbability * 100)}% — impossible, since every match over ${hi.line} is also over ${lo.line}`
      )
    }
  }
  const coherent = violations.length === 0
  // All three lines are what the feature promises; fewer means a partial answer.
  const complete = thresholds.length === LINES.length

  const expectedTotal = (typeof ou?.expected_total_goals === 'number'
    && Number.isFinite(ou.expected_total_goals)
    && ou.expected_total_goals >= 0 && ou.expected_total_goals <= 12)
    ? ou.expected_total_goals
    : null

  /* ---- consistency with the shipped scoreline ---- */
  const sl = readScoreline(analysis)
  const scorelineTotal = sl ? sl.most.home + sl.most.away : null
  const line25 = thresholds.find(t => t.line === 2.5)
  // The modal score's total and the 2.5 line must point the same way: a 2-1
  // (total 3) alongside "under 2.5" is the contradiction worth catching.
  const agreesWithScoreline = (scorelineTotal == null || !line25)
    ? true
    : scorelineTotal > 2.5 ? line25.overProbability >= 0.5 : line25.overProbability < 0.5

  /* Every analysis cached before the three-line schema shipped holds the old
   * single-verdict shape: one over/under call on 2.5 with `model_probability`
   * meaning "probability of what I recommended", not a fixed over-direction.
   *
   * Those cannot be folded into `thresholds` — the direction is not fixed, so
   * comparing them against a real over_probability would be comparing two
   * different quantities, which is the exact mistake the fixed direction exists
   * to prevent. They are carried separately and labelled as the older read, so a
   * cached analysis keeps the goals angle it was written with instead of the
   * panel silently losing it. */
  const legacyRec = (!thresholds.length && (ou?.recommendation === 'over' || ou?.recommendation === 'under'))
    ? ou.recommendation : null
  const legacy = legacyRec ? {
    recommendation: legacyRec,
    // Probability OF THE RECOMMENDATION, which is what the old schema meant.
    probability: asProb(ou.model_probability),
    reasoning: typeof ou.reasoning === 'string' && ou.reasoning.trim() ? ou.reasoning.trim() : null,
    keyFactors: Array.isArray(ou.key_factors) ? ou.key_factors.filter(x => typeof x === 'string' && x.trim()) : [],
    confidence: asProb(ou.confidence),
    confidenceLabel: typeof ou.confidence_label === 'string' ? ou.confidence_label : null,
  } : null

  const bttsProb = asProb(bttsRaw?.model_probability)
  const bttsRec = bttsRaw?.recommendation === 'yes' || bttsRaw?.recommendation === 'no'
    ? bttsRaw.recommendation : null
  const btts = bttsRec ? {
    recommendation: bttsRec,
    probability: bttsProb,
    reasoning: typeof bttsRaw.reasoning === 'string' && bttsRaw.reasoning.trim() ? bttsRaw.reasoning.trim() : null,
    keyFactors: Array.isArray(bttsRaw.key_factors) ? bttsRaw.key_factors.filter(x => typeof x === 'string' && x.trim()) : [],
    confidence: asProb(bttsRaw.confidence),
    confidenceLabel: typeof bttsRaw.confidence_label === 'string' ? bttsRaw.confidence_label : null,
    // Both teams scoring is impossible in a scoreline containing a nil, so the
    // modal score settles this one outright.
    agreesWithScoreline: sl == null ? true
      : (sl.most.home > 0 && sl.most.away > 0) === (bttsRec === 'yes'),
  } : null

  // Nothing honest to show — no goals call of either generation came back.
  if (!thresholds.length && !btts && !legacy) return null

  return {
    thresholds,
    legacy,
    btts,
    expectedTotal,
    coherent,
    violations,
    complete,
    agreesWithScoreline,
    scorelineTotal,
    consistencyNote: typeof ou?.consistency_note === 'string' && ou.consistency_note.trim()
      ? ou.consistency_note.trim() : null,
    // Same caveat source the scoreline panel uses, so both say "thin data" on
    // exactly the same evidence rather than each deciding for itself.
    dataQuality: analysis?.recommendation?.data_quality || analysis?.data_quality || null,
  }
}

/* ---------- is this stored analysis renderable? ----------
 *
 * `recommendation` is the verdict, and it is what the screens actually reach
 * for. Best Bets, the combo slip and the Following rows all read
 * `recommendation.pick` and `recommendation.confidence` directly, with no
 * optional chaining — so an entry that reached the cache without one is not a
 * degraded analysis, it is a render crash waiting for its fixture to appear on
 * the card again. That is exactly what happened: `Cannot read properties of
 * undefined (reading 'confidence')` at BetCard, on one account only, because
 * only that account's cache held such an entry.
 *
 * `pick` is the field tested rather than the mere presence of the object,
 * because `pickHeadline(r.pick)` and `pickShort(r.pick)` are what those screens
 * call, and a recommendation with no pick renders as nothing useful anyway. */
export function hasVerdict(a) {
  return !!a && !!a.recommendation && typeof a.recommendation === 'object'
    && typeof a.recommendation.pick === 'string' && a.recommendation.pick.length > 0
}

/* Drops cache entries that can't be rendered, wherever the cache is ingested.
 *
 * This is the half of the fix that reaches data already in the wild. A bad
 * entry lives in localStorage AND in the account's Supabase `user_data` row, so
 * repairing the writer alone would leave every affected account still crashing.
 * Filtering on ingest means the bad row is gone from state on the next load,
 * and useUserData's debounced push then writes the cleaned cache back — the
 * account repairs itself without anyone clearing storage by hand.
 *
 * Deliberately silent about the football and loud in the console: dropping an
 * entry is a real loss of a stored read, and it should be visible to whoever
 * looks, not papered over. */
export function sanitizeAnalysisCache(cache) {
  if (!cache || typeof cache !== 'object') return {}
  const clean = {}
  const dropped = []
  for (const [id, a] of Object.entries(cache)) {
    if (hasVerdict(a)) clean[id] = a
    else dropped.push(id)
  }
  if (dropped.length) {
    console.warn(`[analysis-cache] dropped ${dropped.length} entr${dropped.length === 1 ? 'y' : 'ies'} with no usable recommendation: ${dropped.join(', ')}`)
  }
  return clean
}

export function edgeToOutcome(edge) {
  if (edge === 'home') return 'home_win'
  if (edge === 'away') return 'away_win'
  return 'draw'
}

export function updateAgentPerformance(prev, analysis) {
  const actual = analysis.actualResult
  if (!actual) return prev
  const next = { ...(prev || {}),
    form: { ...(prev?.form || { correct: 0, total: 0 }) },
    tactical: { ...(prev?.tactical || { correct: 0, total: 0 }) },
    market: { ...(prev?.market || { correct: 0, total: 0 }) },
  }
  const formPred = edgeToOutcome(analysis.form_analysis?.form_edge)
  const tacPred  = edgeToOutcome(analysis.tactical_analysis?.tactical_edge)
  const mktRaw = analysis.market_analysis?.value_bet
  const mktPred = mktRaw === 'none' ? 'draw' : edgeToOutcome(mktRaw)
  next.form.total++; if (formPred === actual) next.form.correct++
  next.tactical.total++; if (tacPred === actual) next.tactical.correct++
  next.market.total++; if (mktPred === actual) next.market.correct++
  return next
}

/* Graded on the ninety-minute score, not football-data's `fullTime`.
 *
 * `fullTime` sums a shootout into the scoreline — Portugal 0–0 Slovenia arrives
 * as 3–0, England 1–1 Switzerland as 6–4 — so reading it directly graded picks
 * against a scoreline that never happened, and in some cases named the wrong
 * winner outright (CD Tolima 0–1 Táchira arrived as 3–1). Extra time is excluded
 * for the same reason the odds are: h2h markets settle at ninety minutes.
 *
 * The score shown to the user still comes from matchScore(), which reports what
 * actually happened on the pitch. This is only the settlement basis. */
export function autoResolve(analysis, fixture) {
  if (!analysis || analysis.resolved) return null
  if (fixture?.status !== 'FINISHED') return null
  const settle = settlementScore(fixture)
  const home = settle.home
  const away = settle.away
  if (home == null || away == null) return null
  const actualResult = home > away ? 'home_win' : away > home ? 'away_win' : 'draw'
  const correct = analysis.recommendation?.pick === actualResult
  const shown = matchScore(fixture)
  return {
    ...analysis,
    resolved: true,
    autoResolved: true,
    actualResult,
    correct,
    // What happened, for display; `actualResult` above is what it settled on.
    finalScore: `${shown.home} – ${shown.away}`,
    settledOn: `${home} – ${away}`,
    settlementBasis: settle.basis,
    resolvedAt: Date.now(),
  }
}

/* May this cached analysis be counted in an accuracy figure?
 *
 * One predicate, used by every on-device accuracy number, so the two screens
 * cannot drift apart. It mirrors what the ledger's is_retrospective column
 * marks server-side, but derives the same fact locally, because the cache is
 * where these screens actually read from.
 *
 * Three ways an entry fails:
 *   - it isn't resolved yet, so there is nothing to be right or wrong about;
 *   - it is stamped `retrospective` (written since e3d7aec, when the phase was
 *     known at the moment of analysis);
 *   - its timestamp is at or after its fixture's kick-off — the same detection
 *     the ledger backfill used (analyzed_at > kickoff_at), applied to entries
 *     written before that stamp existed.
 *
 * And one way it is refused rather than judged: if either timestamp is missing
 * — no `_ts`, or the fixture is no longer in the list and its kick-off cannot
 * be looked up — the entry is excluded. An unverifiable entry is not evidence,
 * and counting it would be the same mistake in a quieter form. */
export function countsTowardRecord(a, fx) {
  if (!a || !a.resolved) return false
  if (a.retrospective === true) return false
  const ts = a._ts
  const kickoff = fx?.kickoffDate ? new Date(fx.kickoffDate).getTime() : NaN
  if (!ts || Number.isNaN(kickoff)) return false
  return ts <= kickoff
}

export const AGENT_PERF_EMPTY = {
  form:     { correct: 0, total: 0 },
  tactical: { correct: 0, total: 0 },
  market:   { correct: 0, total: 0 },
}
