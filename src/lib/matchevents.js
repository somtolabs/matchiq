/* Post-match goal scorers from API-Football, via /api/matchevents.
 *
 * Everything below was verified directly against the live API on 2026-07-27
 * with a real Free-plan key, not taken from documentation:
 *
 *   /status                       → plan "Free", 100 req/day, 10 req/min
 *   /leagues?country=Brazil       → 108 competitions, Série A = league 71
 *   /fixtures?league=71&season=2026 → 200 OK but
 *                                   errors.plan "Free plans do not have access
 *                                   to this season, try from 2022 to 2024."
 *   /fixtures?date=2026-07-26     → 200 OK, errors [], 465 fixtures incl. all
 *                                   seven real Série A matches
 *   /fixtures/events?fixture=…    → 200 OK, errors [], real scorers and minutes
 *
 * Two consequences drive the design here.
 *
 * 1. Passing `season` triggers a plan block, and passing `league` requires
 *    `season`. Only a bare `date=` query works — and that is itself limited to
 *    roughly today ± 1 day. So goals are retrievable for matches finished in
 *    the last ~48 hours and no further back. Older matches are honestly
 *    reported as unavailable rather than guessed at.
 *
 * 2. API-Football and football-data.org use different fixture IDs with nothing
 *    in common, and we cannot narrow by league. So a lookup means fetching the
 *    date's whole fixture list and matching on team names — reusing the same
 *    accent-and-variant scorer the odds matcher already uses, rather than
 *    inventing a second one.
 */

import { readJSON, writeJSON, cacheFresh, LS_GOALS_CACHE, LS_AFDATE_CACHE, AFDATE_TTL_MS } from './storage.js'
import { nameScore } from './odds.js'

/* No `/v3` here: the upstream host is v3.football.api-sports.io, so the version
 * already lives in the hostname. Appending it produced
 * https://v3.football.api-sports.io/v3/fixtures — a 404 HTML page from their
 * site, caught only by calling the deployed proxy for real. */
const BASE = '/api/matchevents'

/* API-Football returns HTTP 200 with the real failure inside `errors`, so this
 * is the only safe way to read a response. Verified against a live plan block. */
function readEnvelope(data) {
  const errs = data?.errors
  const hasErrors = Array.isArray(errs)
    ? errs.length > 0
    : (errs && typeof errs === 'object' ? Object.keys(errs).length > 0 : false)
  return {
    ok: !hasErrors,
    errors: hasErrors ? errs : null,
    /* A plan refusal is permanent for this input and worth caching. A rate-limit
     * refusal is the opposite — it clears within the minute — so it must never
     * be cached, and it deserves its own message rather than being reported as
     * "unavailable". Observed live: {"rateLimit":"Too many requests. Your rate
     * limit is 10 requests per minute."} arriving, again, inside a 200. */
    planBlocked: hasErrors && !!(errs.plan || errs.token),
    rateLimited: hasErrors && !!(errs.rateLimit || errs.requests),
    items: Array.isArray(data?.response) ? data.response : [],
  }
}

async function call(path) {
  const res = await fetch(`${BASE}/${path}`)
  let data = null
  try { data = await res.json() } catch {
    throw new Error(`Match events: unreadable response (HTTP ${res.status})`)
  }
  return readEnvelope(data)
}

/* The date's whole fixture list, cached because every match on that date shares
 * it — the second match a user opens on the same day costs no extra request. */
async function fixturesForDate(dateStr) {
  const store = readJSON(LS_AFDATE_CACHE, {}) || {}
  const hit = store[dateStr]
  if (cacheFresh(hit, AFDATE_TTL_MS) && Array.isArray(hit.fixtures)) {
    return { fixtures: hit.fixtures, cached: true, blocked: false }
  }

  // No `league` and no `season`: both trigger the free-plan block.
  const env = await call(`fixtures?date=${dateStr}`)
  if (!env.ok) {
    return {
      fixtures: [], cached: false,
      blocked: env.planBlocked, rateLimited: env.rateLimited, errors: env.errors,
    }
  }

  /* Only what matching and rendering need. The raw payload for a single date is
   * ~450 KB across 465 fixtures; storing that would be reckless. */
  const slim = env.items.map(f => ({
    id: f.fixture?.id,
    status: f.fixture?.status?.short,
    home: f.teams?.home?.name,
    away: f.teams?.away?.name,
    /* API-Football's own team ids. Goals carry the same ids, so grouping by side
     * is exact — no second round of name matching in the UI, which is what left
     * "Atletico-MG" goals unplaceable against football-data's "CA Mineiro". */
    homeId: f.teams?.home?.id ?? null,
    awayId: f.teams?.away?.id ?? null,
    // Kept so the scoreline can disambiguate when a team name can't — see below.
    gh: f.goals?.home ?? null,
    ga: f.goals?.away ?? null,
  })).filter(x => x.id && x.home && x.away)

  store[dateStr] = { at: Date.now(), fixtures: slim }
  writeJSON(LS_AFDATE_CACHE, store)
  return { fixtures: slim, cached: false, blocked: false }
}

/* Same graded comparison the odds matcher uses, applied to both sides, best
 * pairing wins. Requires a real signal on each side so an unrelated fixture
 * can never be mistaken for this one. */
function findFixture(list, fixture) {
  let best = 0
  let hit = null
  for (const c of list) {
    const h = nameScore(c.home, fixture.homeTeam)
    if (!h) continue
    const a = nameScore(c.away, fixture.awayTeam)
    if (!a) continue
    if (h + a > best) { best = h + a; hit = c }
  }
  if (hit) return hit

  /* Fallback for the case where one side's name simply has nothing in common
   * across the two providers. Measured: API-Football writes "Atletico-MG" where
   * football-data writes "CA Mineiro" — the state abbreviation against the city,
   * sharing no token, so the strict two-sided match returns nothing.
   *
   * Rather than guess with a hand-maintained alias list, disambiguate on facts we
   * already hold: same date, one side matching by name, and football-data's own
   * scoreline matching exactly. Accepted only if precisely one candidate fits, so
   * this can never quietly pick the wrong match. */
  const gh = fixture.goalsHome
  const ga = fixture.goalsAway
  if (gh == null || ga == null) return null
  const candidates = list.filter(c =>
    c.gh === gh && c.ga === ga &&
    (nameScore(c.home, fixture.homeTeam) > 0 || nameScore(c.away, fixture.awayTeam) > 0))
  return candidates.length === 1 ? candidates[0] : null
}

function goalsFromEvents(items) {
  return items
    .filter(e => e.type === 'Goal')
    .map(e => ({
      minute: e.time?.elapsed ?? null,
      extra: e.time?.extra ?? null,
      team: e.team?.name || null,
      teamId: e.team?.id ?? null,
      player: e.player?.name || null,
      assist: e.assist?.name || null,
      detail: e.detail || null,   // Normal Goal | Own Goal | Penalty
    }))
    .filter(g => g.player && g.minute != null)
    .sort((a, b) => (a.minute - b.minute) || ((a.extra || 0) - (b.extra || 0)))
}

/* The date football-data gives us, as YYYY-MM-DD in UTC — the same basis
 * API-Football's `date` filter uses. */
function utcDate(fixture) {
  const d = fixture?.kickoffDate ? new Date(fixture.kickoffDate) : null
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null
}

/* Goals for one finished match. Called only when a specific match is opened —
 * never across a list. Returns { goals, unavailable } where `unavailable` is a
 * reason string when there is honestly nothing to show. */
export async function getMatchGoals(fixture) {
  if (!fixture?.id) return { goals: [], unavailable: 'nofixture' }
  if (fixture.status !== 'FINISHED') return { goals: [], unavailable: 'notfinished' }

  const cacheKey = String(fixture.id)
  const store = readJSON(LS_GOALS_CACHE, {}) || {}
  const hit = store[cacheKey]
  /* No TTL: a finished match's goals never change, and neither does the fact
   * that an out-of-window match will never become retrievable. */
  if (hit) {
    return {
      goals: hit.goals || [], unavailable: hit.unavailable || null, cached: true,
      homeTeamId: hit.homeTeamId ?? null, awayTeamId: hit.awayTeamId ?? null,
    }
  }

  const date = utcDate(fixture)
  if (!date) return { goals: [], unavailable: 'nodate' }

  try {
    const day = await fixturesForDate(date)
    if (day.blocked) {
      // Outside the free plan's ~48h date window. Permanent for this match.
      const entry = { at: Date.now(), goals: [], unavailable: 'window' }
      store[cacheKey] = entry; writeJSON(LS_GOALS_CACHE, store)
      return { goals: [], unavailable: 'window', cached: false }
    }
    // Transient: never cached, so reopening a moment later succeeds.
    if (day.rateLimited) return { goals: [], unavailable: 'ratelimit' }
    if (!day.fixtures.length) return { goals: [], unavailable: 'error' }

    const af = findFixture(day.fixtures, fixture)
    if (!af) {
      const entry = { at: Date.now(), goals: [], unavailable: 'nomatch' }
      store[cacheKey] = entry; writeJSON(LS_GOALS_CACHE, store)
      return { goals: [], unavailable: 'nomatch', cached: false }
    }

    const env = await call(`fixtures/events?fixture=${af.id}`)
    if (!env.ok) {
      if (env.planBlocked) {
        const entry = { at: Date.now(), goals: [], unavailable: 'window' }
        store[cacheKey] = entry; writeJSON(LS_GOALS_CACHE, store)
        return { goals: [], unavailable: 'window', cached: false }
      }
      // Transient — not cached, so it retries next time.
      return { goals: [], unavailable: env.rateLimited ? 'ratelimit' : 'error' }
    }

    const goals = goalsFromEvents(env.items)
    const sides = { homeTeamId: af.homeId, awayTeamId: af.awayId }
    // A genuine 0-0 caches as an empty list, which is a real answer, not a gap.
    store[cacheKey] = { at: Date.now(), goals, unavailable: null, ...sides }
    writeJSON(LS_GOALS_CACHE, store)
    return { goals, unavailable: null, cached: false, ...sides }
  } catch (e) {
    console.warn(`[matchevents] goals lookup failed for fixture ${fixture.id}:`, e.message)
    return { goals: [], unavailable: 'error' }
  }
}

/* "45+2'" reads the way a football fan expects; "45'" when there's no stoppage. */
export function formatMinute(g) {
  return g.extra ? `${g.minute}+${g.extra}'` : `${g.minute}'`
}
