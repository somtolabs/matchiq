// Vercel serverless proxy for API-Football (api-sports.io) — match events.
// Route:  /api/matchevents/<subpath>?<query>  →  https://v3.football.api-sports.io/<subpath>?<query>
//
// Named for the capability, not the provider, and deliberately NOT "football":
// /api/football/ is already football-data.org. Two different providers both
// described as "football data" is exactly the confusion worth designing out.
//
// The key is read from process.env.API_FOOTBALL_KEY and sent in the
// x-apisports-key header. It never reaches the browser.
//
// IMPORTANT for anything consuming this: API-Football returns HTTP 200 with the
// real failure inside the body's `errors` object. Verified directly against the
// live API — a plan restriction comes back as
//   200 {"errors":{"plan":"Free plans do not have access to this season, …"}}
// so callers MUST inspect `errors`, not just the status code.
const CACHE_SECONDS = {
  // A day's fixture list is shared by every match on that date and only changes
  // while matches are in play.
  fixtures: 900,     // 15 min
  // A finished match's events never change again.
  events: 86400,     // 24 h at the CDN; the client caches indefinitely
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const key = process.env.API_FOOTBALL_KEY || ''
  if (!key) {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(503).json({
      errors: { key: 'API_FOOTBALL_KEY is not set in the server environment' },
      results: 0,
      response: [],
    })
  }

  try {
    const rawPath = Array.isArray(req.query.path)
      ? req.query.path.join('/')
      : (req.query.path || '')

    const url = new URL(req.url, 'http://x')
    url.searchParams.delete('path')
    const mode = url.searchParams.get('mode')
    url.searchParams.delete('mode')
    // Never let a client smuggle in its own credential.
    url.searchParams.delete('apiKey')
    url.searchParams.delete('key')
    const qs = url.searchParams.toString()

    const targetUrl = `https://v3.football.api-sports.io/${rawPath}${qs ? `?${qs}` : ''}`

    const upstream = await fetch(targetUrl, {
      method: 'GET',
      headers: { 'x-apisports-key': key },
    })

    const text = await upstream.text()

    // Surface the real quota position so it can be watched in the diagnostics.
    for (const h of ['x-ratelimit-requests-limit', 'x-ratelimit-requests-remaining',
                     'x-ratelimit-limit', 'x-ratelimit-remaining']) {
      const v = upstream.headers.get(h)
      if (v) res.setHeader(h, v)
    }
    res.setHeader('Access-Control-Expose-Headers',
      'x-ratelimit-requests-limit, x-ratelimit-requests-remaining, x-ratelimit-limit, x-ratelimit-remaining')

    /* Only cache a genuinely clean response. A 200 carrying a populated `errors`
     * object is a failure wearing a success code, and caching it would freeze a
     * plan or quota error in place for hours. */
    let cacheable = false
    if (upstream.ok && CACHE_SECONDS[mode]) {
      try {
        const body = JSON.parse(text)
        const errs = body?.errors
        const hasErrors = Array.isArray(errs) ? errs.length > 0
          : (errs && typeof errs === 'object' ? Object.keys(errs).length > 0 : false)
        cacheable = !hasErrors
        if (hasErrors) console.warn(`[matchevents] upstream errors on ${rawPath}:`, JSON.stringify(errs))
      } catch { cacheable = false }
    }

    if (cacheable) {
      const ttl = CACHE_SECONDS[mode]
      res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${ttl}`)
      res.setHeader('CDN-Cache-Control', `public, s-maxage=${ttl}`)
    } else {
      res.setHeader('Cache-Control', 'no-store')
    }

    const ct = upstream.headers.get('content-type') || ''
    if (ct.includes('application/json')) res.setHeader('Content-Type', 'application/json')
    res.status(upstream.status).send(text)
  } catch (err) {
    console.error('[matchevents fn error]', err)
    res.setHeader('Cache-Control', 'no-store')
    res.status(500).json({
      errors: { proxy: String(err?.message || err) },
      results: 0,
      response: [],
    })
  }
}
