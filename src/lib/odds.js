/* Odds API — sport keys, request planning, response cache, fixture↔event matching. */

import { LS_ODDS_CACHE, readJSON, writeJSON } from './storage.js'

/* football-data.org competition code → the-odds-api sport key.
 *
 * Keyed by competition rather than held as a flat list so the app can ask "which
 * sport keys do today's fixtures actually need?" — previously every key here was
 * requested on every mount, burning quota on competitions with nothing playing.
 *
 * Note the provider's Ligue 1 key is `ligue_one`, not `ligue_1`; the latter isn't
 * a real sport key and 404'd on every load. */
export const ODDS_SPORTS = {
  WC:  'soccer_fifa_world_cup',
  PL:  'soccer_epl',
  PD:  'soccer_spain_la_liga',
  BL1: 'soccer_germany_bundesliga',
  SA:  'soccer_italy_serie_a',
  FL1: 'soccer_france_ligue_one',
  CL:  'soccer_uefa_champs_league',
  BSA: 'soccer_brazil_campeonato',
}

/* The sport keys a given fixture list genuinely needs, deduped. A competition
 * with no fixtures loaded contributes nothing, so nothing is requested for it. */
export function sportKeysForFixtures(fixtures) {
  const keys = new Set()
  for (const f of fixtures || []) {
    const key = ODDS_SPORTS[f?.competitionCode]
    if (key) keys.add(key)
  }
  return [...keys]
}

/* Pre-match prices don't move fast enough to justify refetching on every mount.
 * Twelve minutes is deliberately conservative — long enough that a reload, a tab
 * switch or a nav back to the list costs nothing, short enough that a line that
 * genuinely moves before kick-off is picked up well within the hour. */
export const ODDS_TTL_MS = 12 * 60 * 1000

/* Cached per sport key, not as one blob, so a day with two competitions can
 * reuse one and refresh the other independently. Persisted because the redundant
 * fetch this is preventing is exactly the one a page reload used to trigger. */
export function readOddsStore() {
  const raw = readJSON(LS_ODDS_CACHE, {})
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
}

export function writeOddsStore(store) {
  writeJSON(LS_ODDS_CACHE, store)
}

export function isFresh(entry, now = Date.now()) {
  return !!entry && typeof entry.at === 'number' && (now - entry.at) < ODDS_TTL_MS
}

/* Splits the keys a load needs into those already covered by a live cache entry
 * and those that have to go to the network. `force` bypasses the cache entirely,
 * which is what the diagnostic panel's retry button is for. */
export function planOddsFetch(keys, store, { force = false, now = Date.now() } = {}) {
  const cached = []
  const toFetch = []
  for (const key of keys) {
    if (!force && isFresh(store[key], now)) cached.push(key)
    else toFetch.push(key)
  }
  return { cached, toFetch }
}

/* Every event across the keys this load cares about — cache hits and fresh
 * fetches alike — flattened into the single array the matcher consumes. */
export function eventsForKeys(keys, store) {
  const flat = []
  for (const key of keys) {
    const entry = store[key]
    if (Array.isArray(entry?.events)) flat.push(...entry.events)
  }
  return flat
}

/* Accents fold away and punctuation becomes a separator, so "São Paulo FC",
 * "Sao Paulo" and "Bragantino-SP" all reduce to comparable words. */
function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/* Words that identify a club type rather than the club: matching on these alone
 * would happily pair Atlético Mineiro with Atlético Madrid. Short tokens (FC,
 * EC, RB, and the Brazilian state suffixes -SP/-RJ/-MG) fall out on length. */
const GENERIC = new Set([
  'club', 'clube', 'futebol', 'futbol', 'football', 'calcio', 'atletico',
  'athletic', 'atletic', 'real', 'sporting', 'sport', 'deportivo', 'racing',
  'united', 'city', 'town', 'rovers', 'wanderers', 'albion', 'olympique',
  'borussia', 'dynamo', 'lokomotiv', 'internacional', 'nacional', 'juniors',
])

function tokens(s) {
  return norm(s).split(' ').filter(t => t.length >= 3)
}

function distinctive(s) {
  return tokens(s).filter(t => !GENERIC.has(t))
}

/* How strongly two team names refer to the same club. 0 means they don't.
 * Graded rather than boolean so the best candidate event wins instead of
 * whichever one happened to come back first. */
export function nameScore(a, b) {
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return 0
  if (na === nb) return 3
  if (na.includes(nb) || nb.includes(na)) return 2
  // "CA Mineiro" vs "Atletico Mineiro", "RB Bragantino" vs "Bragantino-SP":
  // no substring relation, but they share the word that names the club.
  const da = distinctive(a)
  const db = new Set(distinctive(b))
  if (da.some(t => db.has(t))) return 1
  return 0
}

/* football-data.org and the-odds-api name teams differently ("Brighton and Hove
 * Albion" vs "Brighton", "São Paulo FC" vs "Sao Paulo"), so score every event on
 * both sides and take the strongest pairing rather than requiring a substring. */
export function lookupOddsForFixture(fixture, oddsCache) {
  const homeName = fixture.homeTeam
  const awayName = fixture.awayTeam
  let game = null
  let best = 0
  for (const g of oddsCache || []) {
    if (!g.home_team || !g.away_team) continue
    const h = nameScore(g.home_team, homeName)
    if (!h) continue
    const a = nameScore(g.away_team, awayName)
    if (!a) continue
    const total = h + a
    if (total > best) { best = total; game = g }
  }
  if (!game || !game.bookmakers?.length) return null
  const bk = game.bookmakers[0]
  const mkt = bk.markets?.find(m => m.key === 'h2h')
  if (!mkt) return null
  /* The outcome labels come from the same feed as the event, so reuse the same
   * comparator — and pick the best-scoring outcome, not the first non-zero one,
   * so a weak token hit can't steal the price from an exact name. */
  const pickOutcome = (name) => {
    let out = null
    let top = 0
    for (const o of mkt.outcomes || []) {
      const s = nameScore(o.name, name)
      if (s > top) { top = s; out = o }
    }
    return out
  }
  const home = pickOutcome(homeName)
  const away = pickOutcome(awayName)
  const draw = mkt.outcomes?.find(o => norm(o.name) === 'draw')
  if (!home || !away || !draw || home === away) return null
  return {
    odds: { home: home.price, draw: draw.price, away: away.price },
    marketMovement: `Live odds from ${game.bookmakers.length} bookmakers via ${bk.title}`,
  }
}
