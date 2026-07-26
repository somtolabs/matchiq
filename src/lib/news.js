/* NewsAPI: query building, per-team caching, and the prompt block.
 *
 * Everything here talks to /api/news, never to newsapi.org directly — the key
 * lives only in the serverless function's process.env.NEWS_API_KEY.
 *
 * Plan reality, confirmed against newsapi.org's live docs and measured against
 * the live key on 2026-07-26:
 *   - Developer (free): 100 requests/day, no overage
 *   - Articles carry a 24-hour delay. A measured fetch returned a newest article
 *     exactly 24.0h old, so nothing here is ever "breaking" news. Ages are always
 *     rendered from the real publishedAt so that delay is visible, never hidden.
 *   - Search reaches back one month, which comfortably covers our 5-day window
 *   - The `everything` endpoint is the right one for both use cases:
 *     top-headlines?category=sports&q=football returned 0 results when tested,
 *     and top-headlines forbids mixing `sources` with `country`/`category`.
 */

import {
  readJSON, writeJSON, cacheFresh, LS_NEWS_CACHE, NEWS_TTL_MS,
} from './storage.js'

/* Accents folded and punctuation dropped, for building a search phrase.
 * Deliberately separate from the odds matcher's normaliser: that one exists to
 * compare two feeds' team names and is frozen, this one shapes a query string. */
function foldAccents(s) {
  return String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

/* Club-type affixes carried by football-data names that no news source uses:
 * "CR Flamengo" is written about as Flamengo, "São Paulo FC" as Sao Paulo. */
const CLUB_AFFIX = new Set([
  'fc', 'cf', 'ec', 'sc', 'cr', 'se', 'ca', 'ac', 'rb', 'fr', 'afc', 'sad',
  'fbpa', 'fbc', 'sk', 'fk', 'bk', 'if', 'cd', 'ud', 'as', 'us', 'ss',
  'club', 'clube', 'de', 'do', 'da', 'the',
])

/* The phrase we actually search for. Returns '' when nothing usable is left,
 * which callers treat as "no news for this team" rather than querying junk. */
export function newsQueryForTeam(teamName) {
  const tokens = foldAccents(teamName)
    .replace(/[^A-Za-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(t => !CLUB_AFFIX.has(t.toLowerCase()))
  if (!tokens.length) return ''
  /* Three or more words left means the name still carries a regional qualifier
   * ("Corinthians Paulista", "Bragantino SP"); a phrase search on the whole
   * thing finds nothing, so use the most distinctive single word instead. */
  if (tokens.length >= 3) {
    return tokens.reduce((a, b) => (b.length > a.length ? b : a))
  }
  return tokens.join(' ')
}

/* Only articles naming the team in their own headline. Measured: an unscoped
 * query for "Flamengo" surfaced an Arsenal/Real Madrid transfer piece that
 * merely mentioned them, while searchIn=title returned four genuine Flamengo
 * stories. Relevance matters more than volume when the budget is 100/day. */
const DAYS_BACK = 5
const PER_TEAM = 4

function teamUrl(query) {
  const from = new Date(Date.now() - DAYS_BACK * 86400000).toISOString().slice(0, 10)
  const p = new URLSearchParams({
    q: `"${query}"`,
    searchIn: 'title',
    language: 'en',
    from,
    sortBy: 'publishedAt',
    pageSize: String(PER_TEAM),
    mode: 'team',
  })
  return `/api/news/v2/everything?${p.toString()}`
}

/* The general football strip. Negations keep American football out — a bare
 * q=football returned USC and Lane Kiffin stories when tested. */
const HEADLINES_QUERY =
  '(soccer OR "Premier League" OR "Champions League" OR LaLiga OR Bundesliga OR "Serie A") NOT NFL NOT "college football"'

export function headlinesUrl(pageSize = 10) {
  const p = new URLSearchParams({
    q: HEADLINES_QUERY,
    language: 'en',
    sortBy: 'publishedAt',
    pageSize: String(pageSize),
    mode: 'headlines',
  })
  return `/api/news/v2/everything?${p.toString()}`
}

/* Only the fields we render or send to the model. Keeps the localStorage cache
 * and the analysis record small, and guarantees we never display a field we
 * haven't deliberately chosen. */
function shapeArticle(a) {
  if (!a?.title || !a?.publishedAt) return null
  // NewsAPI marks pulled articles this way; rendering them would be showing
  // something that no longer exists.
  if (a.title === '[Removed]') return null
  return {
    // Some sources ship a leading space in the headline.
    title: a.title.trim(),
    source: a.source?.name || 'Unknown source',
    url: a.url || null,
    publishedAt: a.publishedAt,
  }
}

async function fetchArticles(url) {
  const res = await fetch(url)
  if (!res.ok) {
    let body = null
    try { body = await res.json() } catch {}
    const err = new Error(body?.message || `News HTTP ${res.status}`)
    err.status = res.status
    err.code = body?.code || null
    throw err
  }
  const data = await res.json()
  if (data.status !== 'ok') throw new Error(data.message || 'NewsAPI returned an error')
  return (data.articles || []).map(shapeArticle).filter(Boolean).slice(0, PER_TEAM)
}

/* Per-team cache, keyed by the search phrase so two clubs that resolve to the
 * same query share one entry. Six hours, persisted: the same team turning up in
 * several analyses in an afternoon costs one request, not one per analysis. */
export async function getTeamNews(teamName) {
  const query = newsQueryForTeam(teamName)
  if (!query) return { articles: [], cached: false, query: null }

  const store = readJSON(LS_NEWS_CACHE, {}) || {}
  const hit = store[query]
  if (cacheFresh(hit, NEWS_TTL_MS) && Array.isArray(hit.articles)) {
    return { articles: hit.articles, cached: true, query }
  }

  try {
    const articles = await fetchArticles(teamUrl(query))
    store[query] = { at: Date.now(), articles }
    writeJSON(LS_NEWS_CACHE, store)
    return { articles, cached: false, query }
  } catch (e) {
    console.warn(`[news] team fetch failed for "${teamName}" (${query}):`, e.message)
    /* An empty result is cached, a failure is not — a quota error or an outage
     * must retry on the next analysis rather than being locked out for 6 hours. */
    return { articles: [], cached: false, query, error: e.message }
  }
}

export async function getHeadlines(pageSize = 10) {
  try {
    return { articles: await fetchArticles(headlinesUrl(pageSize)) }
  } catch (e) {
    console.warn('[news] headlines fetch failed:', e.message)
    return { articles: [], error: e.message }
  }
}

/* Both teams for one analysis. Sequential rather than parallel so a shared
 * cache entry written by the first is visible to the second. */
export async function getFixtureNews(fixture) {
  const home = await getTeamNews(fixture.homeTeam)
  const away = await getTeamNews(fixture.awayTeam)
  return {
    home: home.articles,
    away: away.articles,
    fetchedAt: Date.now(),
    requests: (home.cached ? 0 : 1) + (away.cached ? 0 : 1),
  }
}

/* Whole days are honest here in a way "2h ago" would not be: the free plan's
 * 24-hour delay means nothing is ever fresher than a day. */
export function relativeTime(iso) {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const mins = Math.floor((Date.now() - t) / 60000)
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}

/* The prompt block. Returns '' when neither team has coverage, so buildPrompt
 * omits the section entirely rather than sending an empty heading — the model
 * must never be shown a "news" label with nothing under it.
 *
 * Capped at three headlines per team and truncated: this text is charged against
 * a 200,000 token/day budget, so it earns its place or it doesn't go in. */
const PROMPT_PER_TEAM = 3
const MAX_TITLE = 110

export function newsPromptBlock(news, fixture) {
  if (!news) return ''
  const lines = []
  const add = (team, articles) => {
    for (const a of (articles || []).slice(0, PROMPT_PER_TEAM)) {
      const title = a.title.length > MAX_TITLE ? `${a.title.slice(0, MAX_TITLE - 1)}…` : a.title
      lines.push(`${team}: "${title}" — ${a.source}, ${a.publishedAt.slice(0, 10)}`)
    }
  }
  add(fixture.homeTeam, news.home)
  add(fixture.awayTeam, news.away)
  if (!lines.length) return ''

  return `
═══ RECENT NEWS CONTEXT (use as loose context only, not confirmed fact) ═══
${lines.join('\n')}

The headlines above are recent news mentions, not verified facts. Use them only as loose context for narrative or morale factors if genuinely relevant — do not treat them as confirmed injury reports, confirmed lineup changes, or definitive information. If you reference them in your reasoning, attribute it clearly as "recent coverage suggests..." rather than stating it as established fact.
`
}
