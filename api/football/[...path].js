export default async function handler(req, res) {
  // Strip the /api/football prefix; keep query string intact
  const path = req.url.replace(/^\/api\/football/, '') || '/'
  const targetUrl = `https://api.football-data.org${path}`

  console.log('[football fn]', req.method, targetUrl)

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'X-Auth-Token': process.env.FOOTBALL_API_KEY || '',
        'Content-Type': 'application/json',
      },
    })

    const contentType = response.headers.get('content-type')
    const text = await response.text()

    res.status(response.status)
    if (contentType?.includes('application/json')) {
      res.setHeader('Content-Type', 'application/json')
    }
    res.send(text)
  } catch (err) {
    console.error('[football fn error]', err.message)
    res.status(500).json({
      error: 'Football API request failed',
      message: err.message,
    })
  }
}
