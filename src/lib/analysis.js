/* Analysis maths and secondary-market agent calls.
 * The Groq endpoint and auth header pattern are unchanged. */

import { GROQ_MODEL, GROQ_ENDPOINT, AGENT_PARAMS, extractFirstJsonObject } from './groq.js'
import { settlementScore, matchScore } from './football.js'
import {
  MARKET_SYSTEM_PROMPT,
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
  const markets = [
    { key: 'over_under', label: 'Over/Under 2.5 Goals', prompt: buildOverUnderPrompt(fixture, mainAnalysis, context) },
    { key: 'btts', label: 'Both Teams to Score', prompt: buildBTTSPrompt(fixture, mainAnalysis, context) },
  ]
  /* Staggered rather than parallel. The main read has just spent most of the
   * account's 8,000 tokens-per-minute allowance, so firing both of these
   * immediately guarantees a rate-limit rejection and an empty goals panel.
   * They're background enrichment — waiting is free, failing isn't.
   *
   * The first call waits too, which it previously did not, and this is now
   * measured rather than assumed. Before the news context existed the main read
   * was counted at ~5,840 tokens up front (prompt + max_tokens) and this call
   * added ~2,083, landing at ~7,923 — inside the 8,000/min window by under 1%.
   * The RECENT NEWS CONTEXT block adds ~211 prompt tokens, which takes the same
   * pair to ~8,219: over the ceiling. Firing immediately would now reliably 429,
   * and that failure is swallowed and shows up as a silently missing goals panel.
   * Timing only — model, params and prompts are untouched.
   *
   * Re-measured against the live API after the standings/H2H/odds data was wired
   * into these prompts (Internacional v Flamengo, real payloads): main read
   * prompt 2,811 + max_tokens 3,600 = 6,411; each market call 674 + 1,800 =
   * 2,474, up ~160 prompt tokens from before. Both market calls were accepted on
   * this same 25s/50s stagger with no 429, so the timing is left alone. Worth
   * knowing that the reserve arithmetic above is conservative: 6,411 + 2,474
   * inside one minute exceeds 8,000 on paper and was still accepted, so Groq is
   * evidently not reserving the full max_tokens the way this comment assumed.
   * The stagger stays because it is cheap insurance, not because that sum is
   * exact. */
  const results = await Promise.allSettled(markets.map(async (market, i) => {
    await new Promise(r => setTimeout(r, (i + 1) * 25000))
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: MARKET_SYSTEM_PROMPT },
          { role: 'user', content: market.prompt },
        ],
        response_format: { type: 'json_object' },
        ...AGENT_PARAMS,
      }),
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error.message || 'groq rejected the market call')
    const parsed = extractFirstJsonObject(data.choices?.[0]?.message?.content)
    return { key: market.key, label: market.label, result: parsed }
  }))
  return results.filter(r => r.status === 'fulfilled').map(r => r.value)
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
