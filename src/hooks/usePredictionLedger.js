import { useCallback } from 'react'
import { supabase } from '../lib/supabase.js'

/* Read layer over the prediction ledger. Every query is scoped to the signed-in
 * user (RLS enforces this server-side too); all return safe empties on failure.
 *
 * ---- retrospectives ----
 * A read written after its match kicked off was never a forward-looking call,
 * so it must not reach any accuracy figure. New ones are never inserted at all
 * (see runAnalysis), but rows written before that detection existed are in the
 * table and are marked by `predictions.is_retrospective`.
 *
 * That flag is filtered in JavaScript rather than in the PostgREST query, and
 * deliberately so. Naming a column the database does not yet have is a 42703,
 * which these functions swallow into a safe empty — so a query-level filter
 * shipped before the migration ran would silently blank the record screen and
 * every accuracy stat. Filtering after `select('*')` is inert while the column
 * is absent (the field is simply undefined, and `!== true` keeps the row) and
 * engages by itself the moment the column exists. Order of deploy and migration
 * therefore cannot break anything. */
const isRetrospective = (row) => row?.is_retrospective === true

export function usePredictionLedger(user) {
  const getRecentPredictions = useCallback(async (limit = 20) => {
    if (!supabase || !user) return []
    const { data, error } = await supabase
      .from('predictions')
      .select('*')
      .eq('user_id', user.id)
      .order('analyzed_at', { ascending: false })
      .limit(limit)
    if (error) { console.warn('[ledger] recent failed:', error.message); return [] }
    return data || []
  }, [user])

  const getResolvedPredictions = useCallback(async () => {
    if (!supabase || !user) return []
    const { data, error } = await supabase
      .from('predictions')
      .select('*')
      .eq('user_id', user.id)
      .eq('resolved', true)
      .order('resolved_at', { ascending: false })
    if (error) { console.warn('[ledger] resolved failed:', error.message); return [] }
    // Feeds the Record screen and, via getCalibration, the confidence buckets.
    return (data || []).filter(p => !isRetrospective(p))
  }, [user])

  /* Per-agent accuracy across resolved predictions — the query that will later
   * power the agent-performance section. Abstentions (correct = null) are excluded. */
  const getAgentAccuracy = useCallback(async () => {
    if (!supabase || !user) return {}
    const { data, error } = await supabase
      .from('prediction_agents')
      .select('agent_type, correct, prediction_id, predictions!inner(user_id, resolved)')
      .eq('predictions.user_id', user.id)
      .eq('predictions.resolved', true)
    if (error) { console.warn('[ledger] agent accuracy failed:', error.message); return {} }
    /* The agent rows carry no flag of their own — it lives on the parent
     * prediction — so the parent set is fetched (already resolved-and-genuine)
     * and used as the allow-list. Embedding is_retrospective in the join above
     * instead would reintroduce the 42703 hazard the module comment describes. */
    const genuine = new Set((await getResolvedPredictions()).map(p => p.id))
    const acc = {}
    for (const row of data || []) {
      if (row.correct == null) continue
      if (!genuine.has(row.prediction_id)) continue
      const k = row.agent_type
      acc[k] = acc[k] || { correct: 0, total: 0 }
      acc[k].total++
      if (row.correct) acc[k].correct++
    }
    for (const k of Object.keys(acc)) {
      acc[k].rate = acc[k].total ? Math.round((acc[k].correct / acc[k].total) * 100) : null
    }
    return acc
  }, [user, getResolvedPredictions])

  /* Confidence-bucket calibration over resolved predictions. Inherits the
   * retrospective exclusion from getResolvedPredictions. */
  const getCalibration = useCallback(async () => {
    const resolved = await getResolvedPredictions()
    const buckets = [
      { key: '50–60', min: 0.5, max: 0.6 },
      { key: '60–70', min: 0.6, max: 0.7 },
      { key: '70–80', min: 0.7, max: 0.8 },
      { key: '80+', min: 0.8, max: 1.01 },
    ].map((b) => ({ ...b, n: 0, correct: 0 }))
    for (const p of resolved) {
      const c = p.confidence || 0
      const b = buckets.find((x) => c >= x.min && c < x.max)
      if (b) { b.n++; if (p.correct) b.correct++ }
    }
    return buckets.map((b) => ({
      key: b.key, n: b.n,
      rate: b.n ? Math.round((b.correct / b.n) * 100) : null,
    }))
  }, [getResolvedPredictions])

  return { getRecentPredictions, getResolvedPredictions, getAgentAccuracy, getCalibration }
}
