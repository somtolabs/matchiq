import { useState, useEffect, useRef } from 'react'
import {
  readJSON, writeJSON, cacheFresh,
  LS_FIXTURES_CACHE, LS_FORM_CACHE, FIXTURES_TTL_MS, FORM_TTL_MS,
} from '../lib/storage.js'
import {
  mapMatch, formDetailForTeam, footballFetch, onFootballRateLimit, footballBlockedMs,
  FOOTBALL_RATE_LIMIT, todayKey, localDayUtcRange,
} from '../lib/football.js'

/* Anything that isn't genuinely an array becomes an empty one. Used on every
 * value that ends up in the `fixtures` state, because that state is iterated
 * with for...of and spread in several components — forms of iteration that
 * throw outright rather than degrading, and a throw during render takes the
 * whole app down with it. */
const asList = (v) => (Array.isArray(v) ? v : [])

/* A throttled fixture-list call used to return [] and render as "nothing on
 * today's slate". Thrown instead so loadFixtures can report it honestly. Module
 * scope, so `instanceof` holds across renders. */
class RateLimited extends Error {
  constructor(waitMs) {
    super('Rate limited by football-data.org')
    this.waitMs = waitMs
  }
}

/* How long to wait before trying a failed fixture list again, backing off per
 * consecutive failure. The free tier allows 10 requests a minute, so retrying
 * a provider that is down at anything like that rate spends the whole budget
 * on failures and leaves none for the reader when it recovers. */
const RETRY_BASE_MS = 20000
const RETRY_MAX_MS = 5 * 60 * 1000
const retryDelayMs = (failures) =>
  Math.min(RETRY_BASE_MS * 2 ** Math.max(0, failures - 1), RETRY_MAX_MS)

/* Fixture loading + team form enrichment + head-to-head on selection.
 *
 * loadTeamForms stays here because it mutates the fixture list directly via
 * setFixtures. The competition-data trigger does NOT live here — App.jsx runs
 * it as an effect watching `fixtures`, so this hook only fetches the matches
 * and their recent form.
 *
 * apiStatus/apiHealth are owned by useApiHealth and injected as setStatus /
 * setHealth so the DiagnosticPanel keeps reading a single shared surface. */
export function useFixtures({ setStatus, setHealth }) {
  const [fixtures, setFixtures] = useState([])
  const [fixturesLoading, setFixturesLoading] = useState(true)
  const [fixturesError, setFixturesError] = useState(null)
  const [h2hCache, setH2hCache] = useState({})
  /* Non-zero while upstream has told us to wait. Distinct from fixturesError:
   * this is temporary and self-healing, and the UI says so. */
  const [rateLimitedUntil, setRateLimitedUntil] = useState(0)
  /* True only when the fixture-list call itself was throttled — that is the one
   * case worth auto-retrying, and the one that produced the empty state. */
  const [listRateLimited, setListRateLimited] = useState(false)
  /* When the list last came off the network (not the cache) — lets App.jsx skip
   * the mount status-refresh that would otherwise duplicate the call. */
  const [fixturesFetchedAt, setFixturesFetchedAt] = useState(0)
  /* True when the last list call reached football-data.org and came back with a
   * status that carried no data. This is the state that used to be invisible:
   * the call returned an empty list, and an empty list renders as "a quiet day
   * — nothing on the slate", which states something about the football rather
   * than about the request. A day with genuinely no matches is a 200 with zero
   * matches and leaves this false, so the two can be told apart.
   *
   * Separate from fixturesError, which is for failures the reader has to act on
   * (a rejected API key); this one resolves itself, and says so. */
  const [fixturesUnavailable, setFixturesUnavailable] = useState(false)
  const [fixturesRetryAt, setFixturesRetryAt] = useState(0)
  const failureCountRef = useRef(0)

  async function fetchRange(fromStr, toStr) {
    let res
    try {
      res = await footballFetch(`v4/matches?dateFrom=${fromStr}&dateTo=${toStr}`)
    } catch (e) {
      setHealth('football', { code: null, msg: `Network: ${e.message}`, count: null, at: Date.now() })
      throw new Error(`Network failure — proxy or dev server unreachable (${e.message})`)
    }
    if (res.status === 401 || res.status === 403) {
      setHealth('football', { code: res.status, msg: 'API key rejected', count: null, at: Date.now() })
      throw new Error('API key rejected — verify FOOTBALL_API_KEY in Vercel env (or .env locally) is active.')
    }
    if (res.status === 429) {
      const waitMs = footballBlockedMs() || 60000
      setHealth('football', {
        code: 429,
        msg: `Rate limited (${FOOTBALL_RATE_LIMIT + 1}/min plan) — retrying in ${Math.ceil(waitMs / 1000)}s`,
        count: null, at: Date.now(),
      })
      throw new RateLimited(waitMs)
    }
    if (!res.ok) {
      setHealth('football', { code: res.status, msg: `HTTP ${res.status}`, count: null, at: Date.now() })
      /* Same shape as the success path, always. This used to return a bare `[]`,
       * which destructured to `{ raw: undefined, matches: undefined }` at every
       * call site — and on the window-fallback path that undefined reached
       * setFixtures before anything threw, so the app committed a non-iterable
       * fixtures state and every consumer of it crashed on the next render.
       *
       * `ok: false` is what makes the empty list legible to the caller. Without
       * it the two reasons a list can be empty — nothing was scheduled, and we
       * never got an answer — arrive indistinguishable. */
      return { ok: false, raw: [], matches: [] }
    }
    const data = await res.json()
    /* The RAW items are what gets cached, never the mapped fixtures: mapMatch
     * computes "Tomorrow" and the kickoff label relative to now, and a Date
     * survives JSON as a string. Re-mapping on read keeps both honest. */
    const raw = data.matches || []
    const matches = raw.map(mapMatch).filter(Boolean)
    setHealth('football', { code: 200, msg: `OK · ${fromStr} → ${toStr}`, count: matches.length, at: Date.now() })
    return { ok: true, raw, matches }
  }

  /* "Today" means the viewer's calendar day, not UTC's. `toISOString()` on the
   * current instant gave the UTC date, which is a different day for anyone far
   * enough east or west — a viewer in Sydney at 07:41 on the 28th was served the
   * card for the 27th. localDayUtcRange converts the local day back into the UTC
   * dates it overlaps, which is what football-data's filter actually keys on. */
  async function fetchToday() {
    const { from, to } = localDayUtcRange(0)
    return fetchRange(from, to)
  }

  async function loadFixturesWindow() {
    const { from, to } = localDayUtcRange(10)
    return fetchRange(from, to)
  }

  /* The two ends of the unavailable state. Kept as a pair so the flag, the
   * retry time and the backoff counter can never disagree with each other. */
  function noteFetchFailure() {
    const n = failureCountRef.current + 1
    failureCountRef.current = n
    setFixturesUnavailable(true)
    setFixturesRetryAt(Date.now() + retryDelayMs(n))
  }

  function clearFetchFailure() {
    failureCountRef.current = 0
    setFixturesUnavailable(false)
    setFixturesRetryAt(0)
  }

  /* Refreshing repeatedly was the reported failure: each refresh re-fired the
   * whole load — list, three competition calls and one per team for form — from
   * scratch, ~18 calls against a 10/min limit, so the second refresh inside a
   * minute got 429s. Serving a recent list from cache makes a refresh free. */
  async function loadFixtures(useWeekWindow = false, { force = false } = {}) {
    setFixturesLoading(true); setFixturesError(null)

    // Keyed on the viewer's day too, so the cache rolls over when their date
    // changes rather than when UTC's does.
    const today = todayKey()
    const cacheKey = useWeekWindow ? `window:${today}` : `day:${today}`

    if (!force) {
      const cached = readJSON(LS_FIXTURES_CACHE, null)
      if (cached?.key === cacheKey && cacheFresh(cached, FIXTURES_TTL_MS) && Array.isArray(cached.raw)) {
        const matches = cached.raw.map(mapMatch).filter(Boolean)
        setFixtures(matches)
        setStatus('football', 'operational')
        setRateLimitedUntil(0)
        setHealth('football', {
          code: 200,
          msg: `Cached · ${matches.length} fixtures · ${Math.round((Date.now() - cached.at) / 1000)}s old`,
          count: matches.length, at: Date.now(),
        })
        setFixturesLoading(false)
        clearFetchFailure()
        loadTeamForms(matches.slice(0, 10))
        return
      }
    }

    try {
      /* Both reads go through asList: a fixture list that isn't a list is not a
       * state this app can render, and the failure mode is silent — nothing
       * throws at the assignment, so it surfaces one render later as a crash
       * with no obvious origin. Coerced here, once, rather than guarded at each
       * of the dozen places that iterate `fixtures`. */
      const day = await fetchToday()
      let raw = asList(day?.raw)
      let matches = asList(day?.matches)
      let ok = day?.ok !== false

      /* The window fallback only earns its request when today genuinely came
       * back empty. If the day call never answered, matches is empty for a
       * different reason, and spending a second request to be told the same
       * thing wastes a tenth of the minute's budget. */
      if (ok && matches.length === 0 && !useWeekWindow) {
        const win = await loadFixturesWindow()
        raw = asList(win?.raw); matches = asList(win?.matches)
        ok = win?.ok !== false
      }

      if (!ok) {
        /* Nothing is written to the cache and nothing on screen is replaced: an
         * empty list from a failed call is not evidence that the day is empty,
         * and caching it would keep asserting that for the next three minutes.
         * Whatever the reader already has stays, and the retry is automatic. */
        noteFetchFailure()
        setStatus('football', 'degraded')
        return
      }

      clearFetchFailure()
      writeJSON(LS_FIXTURES_CACHE, { at: Date.now(), key: cacheKey, raw })
      setFixtures(matches)
      setFixturesFetchedAt(Date.now())
      setStatus('football', 'operational')
      setRateLimitedUntil(0)
      loadTeamForms(matches.slice(0, 10))
    } catch (err) {
      if (err instanceof RateLimited) {
        /* Honest and temporary. Anything already cached stays on screen rather
         * than being replaced by an empty list, and the retry is automatic. */
        setRateLimitedUntil(Date.now() + err.waitMs)
        setListRateLimited(true)
        setStatus('football', 'degraded')
        setFixturesLoading(false)
        return
      }
      const msg = /disabled|forbidden|401|403/i.test(err.message || '')
        ? 'API key rejected — verify FOOTBALL_API_KEY in Vercel env (or .env locally) is active.'
        : err.message || 'Unknown error loading fixtures'
      setFixturesError(msg)
      setStatus('football', 'degraded')
    } finally {
      setFixturesLoading(false)
    }
  }

  /* Automatic recovery: when the hold expires, try again once, unprompted. The
   * user never has to refresh to get out of a rate-limited state. */
  const loadRef = useRef(loadFixtures)
  loadRef.current = loadFixtures
  useEffect(() => {
    // Only the list call retries. A throttled form call must not trigger a whole
    // reload — that is how a retry loop starts.
    if (!listRateLimited || !rateLimitedUntil) return
    const ms = Math.max(0, rateLimitedUntil - Date.now()) + 500
    const t = setTimeout(() => {
      setListRateLimited(false)
      loadRef.current(false, { force: true })
    }, ms)
    return () => clearTimeout(t)
  }, [listRateLimited, rateLimitedUntil])

  /* The same automatic recovery for a provider that answered but had nothing to
   * give. noteFetchFailure moves fixturesRetryAt forward on every consecutive
   * failure, so a retry that fails again re-arms this effect at a longer delay
   * rather than looping — and a success clears the flag, which stops it. */
  useEffect(() => {
    if (!fixturesUnavailable || !fixturesRetryAt) return
    const ms = Math.max(0, fixturesRetryAt - Date.now()) + 250
    const t = setTimeout(() => loadRef.current(false, { force: true }), ms)
    return () => clearTimeout(t)
  }, [fixturesUnavailable, fixturesRetryAt])

  /* A 429 raised by any other call — form, standings, H2H — should surface in the
   * same honest state rather than passing silently. */
  useEffect(() => onFootballRateLimit(({ waitMs }) => {
    setRateLimitedUntil(prev => Math.max(prev, Date.now() + waitMs))
  }), [])

  /* One request per team, which is what football-data offers — the competition
   * -wide alternative returns league matches only, and this feed deliberately
   * includes cup form, which the prompt reads. So the saving comes from caching
   * rather than batching: a team's last five finished matches only change when
   * that team plays again, so six hours is honest and a refresh costs nothing. */
  async function loadTeamForms(fixtures) {
    const teamIds = [...new Set(fixtures.flatMap(f => [f.homeTeamId, f.awayTeamId]))]
      .filter(Boolean)
      .slice(0, 20)

    const store = readJSON(LS_FORM_CACHE, {}) || {}
    const formMap = {}
    const detailMap = {}
    const stale = []
    for (const teamId of teamIds) {
      const entry = store[teamId]
      if (cacheFresh(entry, FORM_TTL_MS) && Array.isArray(entry.detail)) {
        detailMap[teamId] = entry.detail
        formMap[teamId] = entry.detail.map(d => d.result)
      } else {
        stale.push(teamId)
      }
    }
    console.log(`[football-api] form: ${teamIds.length} teams · ${teamIds.length - stale.length} cached · ${stale.length} to fetch`)

    // Apply the cached half immediately so form is on screen without waiting on
    // the network for the rest.
    if (Object.keys(formMap).length) applyForms(formMap, detailMap)

    for (const teamId of stale) {
      try {
        // No trailing slash before the query: vercel.json rewrites
        // `/api/football/:path*`, and `:path*` does not match a trailing
        // slash, so `.../matches/?status=…` 404s in production. That silently
        // emptied homeForm/awayForm for every fixture on the deployed site —
        // the prompt has been reading "Not available" for form all along.
        const res = await footballFetch(`v4/teams/${teamId}/matches?status=FINISHED&limit=5`)
        if (!res.ok) continue
        const data = await res.json()
        const matches = data.matches || []
        // Newest first — the API returns oldest-first for this endpoint.
        const ordered = [...matches].sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
        const detail = ordered
          .slice(0, 5)
          .map(m => formDetailForTeam(m, teamId))
          .filter(Boolean)
        detailMap[teamId] = detail
        formMap[teamId] = detail.map(d => d.result)
        // Banked per team, so a throttle or a closed tab part-way through keeps
        // whatever was already fetched.
        store[teamId] = { at: Date.now(), detail }
        writeJSON(LS_FORM_CACHE, store)
      } catch {}
    }
    applyForms(formMap, detailMap)
  }

  function applyForms(formMap, detailMap) {

    setFixtures(prev => prev.map(f => ({
      ...f,
      homeForm: formMap[f.homeTeamId] || f.homeForm,
      awayForm: formMap[f.awayTeamId] || f.awayForm,
      homeFormDetail: detailMap[f.homeTeamId] || f.homeFormDetail,
      awayFormDetail: detailMap[f.awayTeamId] || f.awayFormDetail,
    })))
  }

  /* -------- status refresh (the time-sensitivity fix) --------
   * The initial load is a snapshot: without this, a match that kicks off or
   * finishes while the app is open keeps rendering its stale status forever,
   * and a fixture that scrolls out of the date window disappears from the
   * Following and Record screens along with its final score.
   *
   * Fetching by id both refreshes what we already hold AND re-adds fixtures
   * that have aged out of the window, so a followed match survives to full time.
   * Merged fields are deliberately narrow — status, scores and kickoff only —
   * so enrichment already attached to a fixture (form, odds, h2h) is preserved. */
  async function refreshFixtures(ids) {
    const list = [...new Set((ids || []).map(Number).filter(Boolean))].slice(0, 100)
    if (!list.length) return 0
    try {
      const res = await footballFetch(`v4/matches?ids=${list.join(',')}`)
      if (!res.ok) {
        if (res.status === 429) setHealth('football', { code: 429, msg: 'Rate limited on status refresh', count: null, at: Date.now() })
        return 0
      }
      const data = await res.json()
      const fresh = (data.matches || []).map(mapMatch).filter(Boolean)
      if (!fresh.length) return 0
      setFixtures(prev => {
        const byId = new Map(fresh.map(m => [m.id, m]))
        const merged = prev.map(f => {
          const m = byId.get(f.id)
          if (!m) return f
          byId.delete(f.id)
          if (m.status === f.status && m.goalsHome === f.goalsHome && m.goalsAway === f.goalsAway) return f
          return {
            ...f,
            status: m.status, statusShort: m.statusShort,
            goalsHome: m.goalsHome, goalsAway: m.goalsAway,
            kickoff: m.kickoff, kickoffDate: m.kickoffDate,
            dayLabel: m.dayLabel, matchDate: m.matchDate,
          }
        })
        // Anything left in byId was tracked or analysed but no longer in the
        // window — keep it in the list so it stays visible with its result.
        return byId.size ? [...merged, ...byId.values()] : merged
      })
      return fresh.length
    } catch (e) {
      console.warn('status refresh failed:', e.message)
      return 0
    }
  }

  async function loadH2H(fixture) {
    if (!fixture?.id) return null
    if (h2hCache[fixture.id]) return h2hCache[fixture.id]
    try {
      const res = await footballFetch(`v4/matches/${fixture.id}/head2head?limit=10`)
      if (!res.ok) return null
      const data = await res.json()
      const matches = data.matches || []
      const agg = data.aggregates || {}
      const homeWins = agg.homeTeam?.wins ?? 0
      const awayWins = agg.awayTeam?.wins ?? 0
      const draws = agg.numberOfDraws ?? 0
      const total = agg.numberOfMatches ?? matches.length
      const last = matches[0]
      const lastMeeting = last
        ? `${new Date(last.utcDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} — ${last.homeTeam?.shortName || last.homeTeam?.name} ${last.score?.fullTime?.home ?? '-'}:${last.score?.fullTime?.away ?? '-'} ${last.awayTeam?.shortName || last.awayTeam?.name}`
        : 'Unavailable'
      const enriched = {
        summary: total > 0
          ? `${total} meetings — ${fixture.homeTeam} ${homeWins}W, ${fixture.awayTeam} ${awayWins}W, ${draws}D`
          : 'No prior meetings on record',
        lastMeeting,
        matches: matches.slice(0, 10),
      }
      setH2hCache(prev => ({ ...prev, [fixture.id]: enriched }))
      return enriched
    } catch (e) {
      console.warn('H2H fetch failed:', e.message)
      return null
    }
  }

  return {
    /* Last line of defence. asList returns the same reference when the value is
     * already an array, so this changes no identity and no dependency array —
     * it only ensures no caller can ever be handed something it cannot iterate. */
    fixtures: asList(fixtures), fixturesLoading, fixturesError, loadFixtures, refreshFixtures, h2hCache, loadH2H,
    rateLimitedUntil, fixturesFetchedAt, fixturesUnavailable, fixturesRetryAt,
  }
}
