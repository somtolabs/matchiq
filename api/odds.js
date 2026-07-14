// Vercel serverless proxy for the-odds-api.com
// Route:  /api/odds/<subpath>?<query>  →  https://api.the-odds-api.com/<subpath>?<query>&apiKey=***
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const rawPath = Array.isArray(req.query.path)
      ? req.query.path.join('/')
      : (req.query.path || '')

    const url = new URL(req.url, 'http://x')
    url.searchParams.delete('path')
    // Inject the API key server-side
    url.searchParams.set('apiKey', process.env.ODDS_API_KEY || '')
    const qs = url.searchParams.toString()

    const targetUrl = `https://api.the-odds-api.com/${rawPath}?${qs}`

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
    })

    // Forward useful headers so the DiagnosticPanel keeps working
    const remaining = upstream.headers.get('x-requests-remaining')
    const used = upstream.headers.get('x-requests-used')
    if (remaining) res.setHeader('x-requests-remaining', remaining)
    if (used) res.setHeader('x-requests-used', used)

    const ct = upstream.headers.get('content-type') || ''
    const text = await upstream.text()
    if (ct.includes('application/json')) res.setHeader('Content-Type', 'application/json')
    res.status(upstream.status).send(text)
  } catch (err) {
    console.error('[odds fn error]', err)
    res.status(500).json({ error: 'Odds API request failed', message: String(err?.message || err) })
  }
}
