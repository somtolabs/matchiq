// Vercel serverless proxy for the Cerebras chat-completions API.
// Route:  POST /api/cerebras  →  https://api.cerebras.ai/v1/chat/completions
//
// The key is read from process.env.CEREBRAS_API_KEY and sent in the
// Authorization header here, server-side — so it never reaches the browser.
// This closes the standing security gap the Groq integration carried: Groq's
// key was VITE_-prefixed and called straight from React, exposed in the bundle.
// Cerebras' key follows the same server-only pattern as football-data, the Odds
// API, NewsAPI and API-Football.
//
// Unlike those four this is a POST passthrough for a single endpoint, so there
// is no subpath rewrite — the request body (model, messages, reasoning params)
// is forwarded verbatim and the upstream JSON is returned unchanged, status and
// all, so the client's existing error handling still sees exactly what the model
// service returned.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(405).json({ error: { code: 'methodNotAllowed', message: 'Use POST' } })
  }

  const key = process.env.CEREBRAS_API_KEY || ''
  if (!key) {
    // Honest and specific: an absent key is a deployment problem, and this must
    // never be cached — otherwise adding the key to the dashboard would appear
    // to do nothing until the CDN entry expired.
    res.setHeader('Cache-Control', 'no-store')
    return res.status(503).json({
      error: { code: 'apiKeyMissing', message: 'CEREBRAS_API_KEY is not set in the server environment' },
    })
  }
  // A model response is never cacheable — each analysis is unique.
  res.setHeader('Cache-Control', 'no-store')

  try {
    // Vercel's Node runtime parses an application/json body into req.body; fall
    // back to reading the raw stream if it didn't (e.g. an unusual content-type).
    const payload = typeof req.body === 'string'
      ? req.body
      : req.body != null
        ? JSON.stringify(req.body)
        : await readRaw(req)

    const upstream = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: payload,
    })

    const text = await upstream.text()
    const ct = upstream.headers.get('content-type') || ''
    if (ct.includes('application/json')) res.setHeader('Content-Type', 'application/json')
    return res.status(upstream.status).send(text)
  } catch (err) {
    console.error('[cerebras fn error]', err)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(500).json({ error: { code: 'proxyFailed', message: String(err?.message || err) } })
  }
}

async function readRaw(req) {
  const chunks = []
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c)
  return Buffer.concat(chunks).toString('utf8')
}
