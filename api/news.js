// Vercel serverless proxy for newsapi.org
// Route:  /api/news/<subpath>?<query>  →  https://newsapi.org/<subpath>?<query>
// The subpath arrives via req.query.path (populated by the vercel.json rewrite),
// matching the /api/football and /api/odds proxies exactly.
//
// The key is read from process.env.NEWS_API_KEY and sent in the X-Api-Key header,
// never as a query parameter — so it cannot leak into an access log or a referrer,
// and it never reaches the browser at all.
//
// `mode` is ours, not NewsAPI's: it is stripped before forwarding and only selects
// how long the CDN may serve one response to every visitor. Server-side so a
// client cannot ask for a shorter cache and burn the 100/day quota.
const CACHE_SECONDS = {
  headlines: 1800,   // 30 min — the shared homepage strip
  team: 21600,       // 6 h    — per-team news attached to an analysis
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const key = process.env.NEWS_API_KEY || ''
  if (!key) {
    // Honest and specific: an absent key is a deployment problem, not "no news".
    return res.status(503).json({
      status: 'error',
      code: 'apiKeyMissing',
      message: 'NEWS_API_KEY is not set in the server environment',
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
    // Belt and braces: never forward a client-supplied key, and never let one
    // sit in the upstream query string.
    url.searchParams.delete('apiKey')
    const qs = url.searchParams.toString()

    const targetUrl = `https://newsapi.org/${rawPath}${qs ? `?${qs}` : ''}`

    const upstream = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'X-Api-Key': key,
        // NewsAPI rejects some default agents outright.
        'User-Agent': 'matchiq/1.0 (+https://matchiq-jade.vercel.app)',
      },
    })

    const text = await upstream.text()

    const ttl = CACHE_SECONDS[mode]
    if (upstream.ok && ttl) {
      /* This is what makes the homepage strip one NewsAPI request per window
       * rather than one per visitor: the CDN holds the response and serves it to
       * everyone. Nothing is served stale — once the window closes the next
       * request revalidates, and article ages are always rendered from the real
       * publishedAt, never from when we fetched. */
      res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${ttl}`)
      res.setHeader('CDN-Cache-Control', `public, s-maxage=${ttl}`)
    } else {
      // Never cache a failure — that would freeze an outage in place.
      res.setHeader('Cache-Control', 'no-store')
    }

    if (upstream.status === 429) {
      console.warn('[news fn] 429 from NewsAPI — daily quota likely exhausted')
    }

    const ct = upstream.headers.get('content-type') || ''
    if (ct.includes('application/json')) res.setHeader('Content-Type', 'application/json')
    res.status(upstream.status).send(text)
  } catch (err) {
    console.error('[news fn error]', err)
    res.setHeader('Cache-Control', 'no-store')
    res.status(500).json({
      status: 'error',
      code: 'proxyFailed',
      message: String(err?.message || err),
    })
  }
}
