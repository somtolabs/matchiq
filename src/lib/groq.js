/* Single source of truth for the Groq model and its reasoning parameters.
 *
 * Why this model: openai/gpt-oss-120b is the reasoning-capable model Groq
 * currently serves as the replacement for llama-3.3-70b-versatile. The models
 * endpoint reports `reasoning` and `structured_outputs` in its supported
 * features, where llama-3.3-70b-versatile reports only `tools` and `json_mode`.
 * That matters here: the model thinks through the evidence before it commits to
 * an answer natively, which is exactly the "reason first, pick last" behaviour
 * this app's prompt asks for.
 *
 * reasoning_format: 'hidden' keeps the full internal reasoning server-side and
 * returns only the final JSON, so nothing has to be stripped before parsing.
 *
 * max_tokens must cover reasoning tokens as well as the answer — Groq bills
 * them together under completion_tokens, and a high-effort read on a full
 * fixture brief spends a few thousand tokens thinking before it writes anything.
 *
 * The binding constraint is NOT the model's 65,536-token completion ceiling but
 * the account's rate limit: the on-demand tier allows 8,000 tokens per minute
 * for this model, and Groq counts `prompt + max_tokens` against it up front. A
 * generous max_tokens therefore doesn't merely reserve headroom, it makes the
 * request unsatisfiable — 12,000 was rejected outright with "Request too large
 * … Limit 8000, Requested 15019". These values are sized to sit inside that
 * window with a real fixture brief (~2,600–3,100 prompt tokens) while still
 * leaving several times more room than the finished JSON needs. */

export const GROQ_MODEL = 'openai/gpt-oss-120b'
export const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'

/* Extracts the first complete JSON object from a model response.
 *
 * Slicing from the first `{` to the LAST `}` — what this app did before — breaks
 * whenever the model emits anything after its object. That was observed for real:
 * one run in three returned a second trailing object, and the naive slice handed
 * `{...}{...}` to JSON.parse and threw. Walking the brace depth (while ignoring
 * braces inside strings and escapes) stops at the end of the first object, so a
 * trailing fragment is discarded instead of poisoning a valid answer. */
export function extractFirstJsonObject(raw) {
  const text = String(raw || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```json|```/g, '')
    .trim()
  const start = text.indexOf('{')
  if (start === -1) throw new Error('No JSON object found in model output')
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (esc) { esc = false; continue }
    if (ch === '\\') { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return JSON.parse(text.slice(start, i + 1))
    }
  }
  throw new Error('Model output ended mid-object')
}

/* ---------- Groq's JSON-generation failure ----------
 *
 * With response_format json_object, Groq validates the completion server-side
 * before returning it. When the model's output doesn't validate, the client
 * never sees malformed JSON to parse — it gets a 400 whose body is:
 *
 *   { "error": { "code": "json_validate_failed",
 *                "message": "Failed to generate JSON. Please adjust your prompt.
 *                            See 'failed_generation' for more details.",
 *                "failed_generation": "…" } }
 *
 * The message reads like a prompt bug, which is what makes it misleading: it is
 * a sampling outcome, not a defect in the request. The identical body sent again
 * generally validates, which is exactly why the reported case succeeded on a
 * manual second attempt. So the retry belongs here rather than in front of the
 * reader — asking someone to press a button again is asking them to do the
 * retry by hand.
 *
 * Matched on the code first; the message text is only a fallback for the day
 * Groq changes the code, and both halves of it are required so an unrelated
 * error can't be mistaken for this one. */
export function isJsonValidationFailure(err) {
  if (!err) return false
  if (err.code === 'json_validate_failed') return true
  const msg = String(err.message || '')
  return /failed to generate json/i.test(msg) && /failed_generation/i.test(msg)
}

/* What the reader is told when even the retry didn't validate. Deliberately not
 * the Groq string: "adjust your prompt" is advice for whoever wrote the app, and
 * there is no prompt in front of the reader to adjust. */
export const ANALYSIS_INCOMPLETE_MESSAGE =
  "The analysis didn't complete correctly. Try again."

/* The main read — the one place careful, consistent reasoning matters most.
 *
 * This SHOULD be reasoning_effort: 'high'. It is 'medium' because 'high' cannot
 * physically complete on the current Groq tier, and that was measured, not
 * assumed. With this prompt (2,714 tokens) the arithmetic is:
 *
 *   prompt 2,714 + max_tokens must stay under the 8,000 TPM ceiling
 *   → max_tokens can be at most ~5,200
 *   → 'high' exceeded 5,200 completion tokens on every attempt, returning
 *     json_validate_failed with an empty generation (it spent the whole budget
 *     thinking and never wrote the answer)
 *   → 'medium' lands at ~1,250 reasoning + ~1,000 answer, comfortably inside it
 *
 * So 'high' fails 100% of the time here, and shipping it would mean shipping a
 * permanently broken analysis. If the Groq account moves to a higher tier, raise
 * max_tokens above ~6,500 and set this back to 'high' — nothing else needs to
 * change. The reasoning-first behaviour this sprint is about comes from the
 * model being a reasoning model at all, which 'medium' fully delivers. */
export const SYNTHESIS_PARAMS = {
  reasoning_effort: 'medium',
  reasoning_format: 'hidden',
  max_tokens: 3600,
  temperature: 0.3,
  top_p: 0.9,
}

/* The narrower goals-market reads — simpler question, much shorter brief.
 * Kept at 'low' so these fire-and-forget calls don't consume the per-minute
 * budget the main read needs; they are a bonus panel, not the verdict. */
export const AGENT_PARAMS = {
  reasoning_effort: 'low',
  reasoning_format: 'hidden',
  max_tokens: 1800,
  temperature: 0.3,
}
