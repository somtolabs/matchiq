/* football-data.org response shaping, plus the request gate that keeps the app
 * inside the plan's rate limit. */

import { delay } from './storage.js'

/* The free tier allows 10 requests per minute. Verified against the live API:
 * the 11th request inside a window returns
 *   HTTP 429 {"message":"You reached your request limit. Wait 48 seconds.","errorCode":429}
 *
 * A cold load legitimately needs ~18 calls (the match list, three competition
 * endpoints, and one per team for form), so without a gate the back half of every
 * load was throttled — and because fetchRange treated 429 as "no matches", a
 * throttled list call rendered as "a quiet day, nothing on the slate".
 *
 * Nine, not ten: the limit is enforced upstream on a window we can't see the
 * start of, so one slot is left as headroom. */
export const FOOTBALL_RATE_LIMIT = 9
export const FOOTBALL_WINDOW_MS = 60000

let dispatched = []          // timestamps of requests actually sent
let gate = Promise.resolve()  // serialises slot reservation
let blockedUntil = 0          // set when upstream tells us to wait

const rateLimitListeners = new Set()

/* Lets the UI show an honest "rate limited, retrying" state instead of an empty
 * one. Returns an unsubscribe function. */
export function onFootballRateLimit(fn) {
  rateLimitListeners.add(fn)
  return () => rateLimitListeners.delete(fn)
}

export function footballBlockedMs() {
  return Math.max(0, blockedUntil - Date.now())
}

/* football-data puts the wait in the message body rather than a Retry-After
 * header, so read it from there and fall back to a full window. */
export function parseWaitMs(body) {
  const m = /wait\s+(\d+)\s*second/i.exec(String(body?.message || body || ''))
  const secs = m ? Number(m[1]) : NaN
  return Number.isFinite(secs) && secs > 0 ? (secs + 1) * 1000 : FOOTBALL_WINDOW_MS
}

/* Claims one slot in the rolling window, waiting if the window is full or if a
 * 429 has told us to stand down. Reservations are serialised so two concurrent
 * callers can't both take the last slot. */
async function reserveSlot() {
  const run = gate.then(async () => {
    const blocked = footballBlockedMs()
    if (blocked > 0) await delay(blocked)
    dispatched = dispatched.filter(t => Date.now() - t < FOOTBALL_WINDOW_MS)
    if (dispatched.length >= FOOTBALL_RATE_LIMIT) {
      const wait = FOOTBALL_WINDOW_MS - (Date.now() - dispatched[0]) + 250
      if (wait > 0) await delay(wait)
      dispatched = dispatched.filter(t => Date.now() - t < FOOTBALL_WINDOW_MS)
    }
    dispatched.push(Date.now())
  })
  gate = run.catch(() => {})
  return run
}

/* Every football-data call in the app goes through here. `path` is the part after
 * /api/football/ — no leading slash, and no trailing slash before the query, which
 * the vercel.json rewrite does not match. */
export async function footballFetch(path) {
  await reserveSlot()
  const res = await fetch(`/api/football/${path}`)
  if (res.status === 429) {
    let body = null
    try { body = await res.clone().json() } catch {}
    const waitMs = parseWaitMs(body)
    blockedUntil = Date.now() + waitMs
    console.warn(`[football-api] 429 on ${path} — ${body?.message || 'rate limited'} · holding requests for ${Math.round(waitMs / 1000)}s`)
    for (const fn of rateLimitListeners) {
      try { fn({ waitMs, path, message: body?.message || 'Rate limited' }) } catch {}
    }
  }
  return res
}

/* Test seam: the gate is module state, and a fresh page load starts empty. */
export function resetFootballGate() {
  dispatched = []
  blockedUntil = 0
  gate = Promise.resolve()
}

/* ---------- calendar days, in the viewer's timezone ----------
 *
 * football-data timestamps are UTC instants; `new Date(utcDate)` parses them to
 * the right instant regardless of where the browser is, and every instant
 * comparison in the app is epoch arithmetic, which is correct by construction.
 * What was NOT correct was the calendar-day question — "is this today?" — which
 * has no answer without a timezone, and was being answered in three different
 * ones at once.
 *
 * 'en-CA' formats as YYYY-MM-DD, so a day key sorts and compares as a string
 * while still being derived from a real Date in a real zone. Passing a tz makes
 * it explicit; omitting it means the viewer's own zone. */
export function dayKey(d, timeZone) {
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return null
  return dt.toLocaleDateString('en-CA', timeZone ? { timeZone } : undefined)
}

export function todayKey(timeZone) {
  return dayKey(new Date(), timeZone)
}

/* Calendar arithmetic on the date itself, so it can't be knocked sideways by a
 * DST transition the way adding 86,400,000ms to an instant can. */
export function nextDayKey(key, days = 1) {
  const [y, m, d] = String(key).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/* The UTC dates spanned by one local calendar day. football-data filters
 * dateFrom/dateTo on UTC, so asking for the viewer's local day means asking for
 * the UTC day(s) it overlaps — otherwise a viewer far enough east or west is
 * served a card for a day that isn't theirs. */
export function localDayUtcRange(days = 0) {
  const key = todayKey()
  const start = new Date(`${key}T00:00:00`)          // parsed as local midnight
  const end = new Date(start.getTime() + (days + 1) * 86400000 - 1)
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }
}

/* One head-to-head meeting, reduced to what can honestly be shown.
 *
 * regularTime is preferred over fullTime for the same reason settlementScore
 * prefers it: football-data folds a shootout into `fullTime`, so a cup tie that
 * finished 1-1 and went to penalties arrives as 6-4. Rendering that as the
 * scoreline would put a goal fest on screen that never happened — and these
 * head-to-head feeds are full of cup ties.
 *
 * `shootout` is carried through so a tie decided on penalties can be labelled
 * as one rather than looking like an ordinary draw. */
export function h2hRows(fixture, limit = 6) {
  const rows = []
  for (const m of fixture?.h2h?.matches || []) {
    if (rows.length >= limit) break
    const reg = m.score?.regularTime
    rows.push({
      key: m.id ?? `${m.utcDate}-${rows.length}`,
      homeName: m.homeTeam?.shortName || m.homeTeam?.name || 'Home',
      awayName: m.awayTeam?.shortName || m.awayTeam?.name || 'Away',
      home: reg?.home ?? m.score?.fullTime?.home ?? m.homeScore ?? null,
      away: reg?.away ?? m.score?.fullTime?.away ?? m.awayScore ?? null,
      shootout: m.score?.penalties?.home != null,
      date: m.utcDate ? new Date(m.utcDate) : null,
      competition: m.competition?.name || null,
    })
  }
  return rows
}

/* ---------- which of the three phases a fixture is in ----------
 *
 * The single place the app decides whether a match is still ahead, underway, or
 * done. Upstream status is authoritative when it is decisive; the kick-off
 * instant is the tie-breaker for the one case it isn't — a fixture still marked
 * SCHEDULED whose kick-off has passed because the status refresh hasn't caught
 * up yet. That fixture is not something we can honestly write a forward
 * prediction for, so it counts as under way. */
export function matchPhase(f) {
  if (!f) return 'upcoming'
  if (f.status === 'IN_PLAY' || f.status === 'LIVE') return 'live'
  if (f.status === 'FINISHED') return 'finished'
  if (f.status === 'POSTPONED' || f.status === 'CANCELLED') return 'off'
  const t = f.kickoffDate ? new Date(f.kickoffDate).getTime() : NaN
  if (!Number.isNaN(t) && t <= Date.now()) return 'live'
  return 'upcoming'
}

/* Maps a raw /v4/matches item to the internal fixture shape the UI consumes.
 * Returns null for malformed items so callers can .filter(Boolean). */
export function mapMatch(item) {
  if (!item || !item.homeTeam || !item.awayTeam) return null

  const statusMap = {
    SCHEDULED: 'SCHEDULED', TIMED: 'SCHEDULED', POSTPONED: 'POSTPONED',
    IN_PLAY: 'IN_PLAY', PAUSED: 'IN_PLAY', LIVE: 'IN_PLAY',
    FINISHED: 'FINISHED', AWARDED: 'FINISHED',
    SUSPENDED: 'CANCELLED', CANCELLED: 'CANCELLED',
  }

  const kickoffDate = new Date(item.utcDate)
  const today = todayKey()
  const isToday = dayKey(kickoffDate) === today
  const isTomorrow = dayKey(kickoffDate) === nextDayKey(today)

  const compCode = item.competition?.code || ''
  const compName = item.competition?.name || 'Unknown'
  const region = item.area?.name || ''

  const goalsHome = item.score?.fullTime?.home ?? item.score?.halfTime?.home ?? null
  const goalsAway = item.score?.fullTime?.away ?? item.score?.halfTime?.away ?? null

  return {
    id: item.id,
    homeTeamId: item.homeTeam.id,
    awayTeamId: item.awayTeam.id,
    homeTeam: item.homeTeam.name || item.homeTeam.shortName || 'TBC',
    awayTeam: item.awayTeam.name || item.awayTeam.shortName || 'TBC',
    homeLogo: item.homeTeam.crest,
    awayLogo: item.awayTeam.crest,
    /* Rendered in the viewer's own timezone. These two lines used to pin
     * `timeZone: 'Europe/London'` while isToday/isTomorrow and matchDate below
     * were computed in the browser's zone, so the same fixture could carry a
     * London clock time next to a local calendar date — a Sydney user saw
     * "Thu 30 Jul · 23:30" for a match that kicks off 08:30 their Thursday. */
    kickoff: kickoffDate.toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit',
    }),
    kickoffDate,
    dayLabel: isToday ? null : isTomorrow ? 'Tomorrow'
      : kickoffDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
    matchDate: isToday ? null
      : kickoffDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
    homeForm: [],
    awayForm: [],
    /* No homeSeason/awaySeason here. Zero-filled placeholders used to sit on this
     * object and nothing ever populated them; the goals-market prompt read them,
     * saw played === 0 and reported "goal data unavailable" for teams whose real
     * season record was sitting in the standings all along. Season stats now come
     * from the standings payload, which is the only place they actually exist. */
    h2h: { summary: 'Head-to-head data unavailable', lastMeeting: 'Unavailable' },
    odds: { home: null, draw: null, away: null },
    marketMovement: 'Fetching live odds on selection',
    venue: item.venue || 'TBC',
    status: statusMap[item.status] || 'SCHEDULED',
    statusShort: item.status,
    goalsHome,
    goalsAway,
    /* The real stage fields football-data returns alongside the score. Verified
     * present on live responses: duration is REGULAR | EXTRA_TIME |
     * PENALTY_SHOOTOUT, with regularTime/extraTime/penalties filled in as the
     * match actually progressed. Kept so a shootout can be shown as what it was
     * rather than as football-data's summed `fullTime`. */
    duration: item.score?.duration || null,
    regularTime: item.score?.regularTime || null,
    extraTime: item.score?.extraTime || null,
    penalties: item.score?.penalties || null,
    halfTimeScore: item.score?.halfTime || null,
    matchday: item.matchday ?? null,
    competition: compName,
    competitionId: compCode,
    competitionCode: compCode,
    region,
  }
}

/* football-data reports PAUSED for half-time and maps to IN_PLAY internally, so
 * the raw code is the only place the distinction survives. */
export function isHalfTime(f) {
  return f?.statusShort === 'PAUSED'
}

/* The label for a match that is currently in play. */
export function liveLabel(f) {
  return isHalfTime(f) ? 'Half-time' : 'Live now'
}

/* The score as it should actually be read, plus a note when the match went past
 * ninety minutes.
 *
 * This matters because football-data's `fullTime` is not the scoreline for a
 * shootout — it is regularTime + extraTime + penalties summed together. Real
 * examples from the live API:
 *
 *   PSG v Arsenal        regularTime 1–1, extraTime 0–0, penalties 4–3, fullTime 5–4
 *   Portugal v Slovenia  regularTime 0–0, extraTime 0–0, penalties 3–0, fullTime 3–0
 *   Germany v Paraguay   regularTime 1–1, extraTime 0–0, penalties 3–4, fullTime 4–5
 *
 * Rendering `fullTime` there prints "5–4" for a match that finished 1–1 — a
 * scoreline that never happened. For EXTRA_TIME, by contrast, fullTime is
 * correct (regularTime + extraTime), so it is used as-is:
 *
 *   Juventus v Galatasaray  regularTime 3–0, extraTime 0–2, fullTime 3–2
 *
 * Returns the numbers to show plus an optional note. Never invents: if the stage
 * fields are absent it falls straight back to the plain score. */
export function matchScore(f) {
  const plain = { home: f?.goalsHome ?? null, away: f?.goalsAway ?? null, note: null }
  if (!f || f.status !== 'FINISHED' || !f.duration || f.duration === 'REGULAR') return plain

  const reg = f.regularTime
  const ext = f.extraTime
  const pen = f.penalties

  if (f.duration === 'PENALTY_SHOOTOUT') {
    if (!reg || reg.home == null || !pen || pen.home == null) return plain
    // A present extraTime object means extra time was actually played.
    const playedET = !!ext && ext.home != null
    const home = reg.home + (playedET ? ext.home : 0)
    const away = reg.away + (playedET ? ext.away : 0)
    // Name the winner: "won 4–3 on penalties" alone doesn't say by whom.
    const winner = pen.home > pen.away ? f.homeTeam : f.awayTeam
    const hi = Math.max(pen.home, pen.away)
    const lo = Math.min(pen.home, pen.away)
    return {
      home, away,
      note: `${playedET ? 'After extra time' : 'At full-time'} · ${winner} won ${hi}–${lo} on penalties`,
    }
  }

  if (f.duration === 'EXTRA_TIME') {
    if (!reg || reg.home == null) return { ...plain, note: 'After extra time' }
    // fullTime already includes extra time here, so only the note is added.
    return {
      home: plain.home, away: plain.away,
      note: `After extra time · ${reg.home}–${reg.away} at ninety minutes`,
    }
  }

  return plain
}

/* The score a 1X2 prediction should be settled on: ninety minutes plus stoppage,
 * excluding extra time and penalties.
 *
 * Deliberately NOT matchScore(). That one exists to *display* what happened, so
 * for a match decided in extra time it reports 2–1 — correct on the pitch, wrong
 * for settlement. Our picks are home_win/draw/away_win measured against h2h odds
 * from the Odds API, and those are ninety-minute markets, so the edge was priced
 * against regular time and must be graded against regular time.
 *
 * England v Slovakia is the clean illustration: 1–1 at ninety, England won 2–1 in
 * extra time. A 1X2 bet on England loses. Grading it a home win would mark a
 * losing pick correct.
 *
 * football-data only populates `regularTime` when a match went beyond ninety
 * minutes; for an ordinary match `fullTime` already IS the ninety-minute score.
 * So the fallback is exact, not a guess. */
export function settlementScore(f) {
  const reg = f?.regularTime
  if (reg && reg.home != null && reg.away != null) {
    return { home: reg.home, away: reg.away, basis: 'regularTime' }
  }
  return { home: f?.goalsHome ?? null, away: f?.goalsAway ?? null, basis: 'fullTime' }
}

/* One finished match from a team's point of view: result, goals for/against,
 * whether it was home or away, and who the opponent was. Null if incomplete.
 * This is what lets the prompt reason from goals rather than W/D/L letters. */
export function formDetailForTeam(match, teamId) {
  const home = match.score?.fullTime?.home
  const away = match.score?.fullTime?.away
  if (home == null || away == null) return null
  const isHome = match.homeTeam?.id === teamId
  const gf = isHome ? home : away
  const ga = isHome ? away : home
  const oppRaw = isHome ? match.awayTeam : match.homeTeam
  return {
    result: gf > ga ? 'W' : gf < ga ? 'L' : 'D',
    gf, ga,
    venue: isHome ? 'H' : 'A',
    opponent: oppRaw?.shortName || oppRaw?.name || null,
    opponentId: oppRaw?.id || null,
    date: match.utcDate ? match.utcDate.slice(0, 10) : null,
    competition: match.competition?.name || null,
  }
}

/* W/D/L for a given team in a finished match. Null if the score is incomplete. */
export function resultForTeam(match, teamId) {
  const home = match.score?.fullTime?.home
  const away = match.score?.fullTime?.away
  if (home == null || away == null) return null
  const isHome = match.homeTeam?.id === teamId
  if (home === away) return 'D'
  const homeWon = home > away
  return isHome === homeWon ? 'W' : 'L'
}
