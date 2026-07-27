/* localStorage keys + safe access helpers.
 * Every read/write in the app went through a bare try/catch; this centralises
 * that so a disabled-storage browser degrades identically everywhere. */

export const LS_THEME      = 'matchiq_theme'
export const LS_ANALYSIS   = 'matchiq_analysis_cache'
export const LS_TRACKED    = 'matchiq_tracked'
export const LS_AGENT_PERF = 'matchiq_agent_performance'
export const LS_SWIPE_HINT = 'matchiq_swipe_hint_shown'
export const LS_DIAG_OPEN  = 'matchiq_diag_open'
/* First and latest odds seen per fixture — the only honest basis we have for
 * showing market movement, since the odds API gives a snapshot, not a history. */
export const LS_ODDS_HIST  = 'matchiq_odds_history'
/* Odds API responses per sport key, with the time they were fetched. Persisted
 * so a page reload inside the TTL costs no quota — reloads were the single
 * biggest source of redundant requests. */
export const LS_ODDS_CACHE = 'matchiq_odds_cache'
/* football-data responses, so a refresh inside the window costs no requests
 * against the 10/min limit. Fixtures carry live scores so they expire quickly;
 * form and standings only change when a match finishes, so they last hours. */
export const LS_FIXTURES_CACHE = 'matchiq_fixtures_cache'
export const LS_FORM_CACHE     = 'matchiq_form_cache'
export const LS_COMP_CACHE     = 'matchiq_comp_cache'

/* Per-team NewsAPI results, keyed by search phrase. Six hours, because the free
 * plan allows only 100 requests/day and its articles already carry a 24-hour
 * delay — refetching sooner would spend quota to receive the same articles. */
export const LS_NEWS_CACHE = 'matchiq_news_cache'
export const NEWS_TTL_MS = 6 * 60 * 60 * 1000

/* Post-match goal scorers from API-Football, keyed by football-data fixture id.
 * Deliberately no TTL: a finished match's goals never change, and a match that
 * has aged out of the free plan's ~48h window will never come back into it. */
export const LS_GOALS_CACHE = 'matchiq_goals_cache'
/* The date→fixture-list lookup that maps a football-data fixture onto its
 * API-Football id. Shared by every match on that date. */
export const LS_AFDATE_CACHE = 'matchiq_afdate_cache'
export const AFDATE_TTL_MS = 15 * 60 * 1000

export const FIXTURES_TTL_MS = 3 * 60 * 1000
export const FORM_TTL_MS     = 6 * 60 * 60 * 1000
export const COMP_TTL_MS     = 6 * 60 * 60 * 1000

export function cacheFresh(entry, ttl, now = Date.now()) {
  return !!entry && typeof entry.at === 'number' && (now - entry.at) < ttl
}

export const delay = (ms) => new Promise(r => setTimeout(r, ms))

export function readRaw(key) {
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem(key) } catch { return null }
}

export function writeRaw(key, value) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(key, value) } catch {}
}

export function readJSON(key, fallback) {
  const raw = readRaw(key)
  if (raw == null) return fallback
  try { return JSON.parse(raw) } catch { return fallback }
}

export function writeJSON(key, value) {
  try { writeRaw(key, JSON.stringify(value)) } catch {}
}
