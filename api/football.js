// Vercel serverless proxy for football-data.org
// Route:  /api/football/<subpath>?<query>  →  https://api.football-data.org/<subpath>?<query>
// The subpath arrives via req.query.path (populated by vercel.json rewrite).
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    // Extract path from query (`?path=v4/matches`)
    const rawPath = Array.isArray(req.query.path)
      ? req.query.path.join('/')
      : (req.query.path || '')

    // Reconstruct upstream query string, minus our injected `path` param
    const url = new URL(req.url, 'http://x')
    url.searchParams.delete('path')
    const qs = url.searchParams.toString()

    const targetUrl =
      `https://api.football-data.org/${rawPath}${qs ? `?${qs}` : ''}`

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'X-Auth-Token': process.env.FOOTBALL_API_KEY || '',
        'Content-Type': 'application/json',
      },
    })

    const ct = upstream.headers.get('content-type') || ''
    const text = await upstream.text()
    if (ct.includes('application/json')) res.setHeader('Content-Type', 'application/json')
    res.status(upstream.status).send(text)
  } catch (err) {
    console.error('[football fn error]', err)
    res.status(500).json({ error: 'Football API request failed', message: String(err?.message || err) })
  }
}
