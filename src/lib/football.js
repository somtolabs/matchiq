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
  const today = new Date()
  const isToday = kickoffDate.toDateString() === today.toDateString()
  const tomorrow = new Date(Date.now() + 86400000)
  const isTomorrow = kickoffDate.toDateString() === tomorrow.toDateString()

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
    kickoff: kickoffDate.toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
    }),
    kickoffDate,
    dayLabel: isToday ? null : isTomorrow ? 'Tomorrow'
      : kickoffDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' }),
    matchDate: isToday ? null
      : kickoffDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
    homeForm: [],
    awayForm: [],
    homeSeason: { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0 },
    awaySeason: { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0 },
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
