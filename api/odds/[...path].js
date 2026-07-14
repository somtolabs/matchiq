export default async function handler(req, res) {
  // Strip the /api/odds prefix
  const rawPath = req.url.replace(/^\/api\/odds/, '') || '/'

  // Inject the odds API key server-side so it never ships in the client bundle.
  // If the client already appended apiKey= (legacy), we still overwrite/append.
  const separator = rawPath.includes('?') ? '&' : '?'
  const key = process.env.ODDS_API_KEY || ''
  const targetUrl = `https://api.the-odds-api.com${rawPath}${separator}apiKey=${key}`

  console.log('[odds fn]', req.method, targetUrl.replace(key, '***'))

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
    })

    const contentType = response.headers.get('content-type')
    const text = await response.text()

    // Forward useful odds headers so the client's diagnostic panel keeps working
    const remaining = response.headers.get('x-requests-remaining')
    const used = response.headers.get('x-requests-used')
    if (remaining) res.setHeader('x-requests-remaining', remaining)
    if (used) res.setHeader('x-requests-used', used)

    res.status(response.status)
    if (contentType?.includes('application/json')) {
      res.setHeader('Content-Type', 'application/json')
    }
    res.send(text)
  } catch (err) {
    console.error('[odds fn error]', err.message)
    res.status(500).json({
      error: 'Odds API request failed',
      message: err.message,
    })
  }
}
