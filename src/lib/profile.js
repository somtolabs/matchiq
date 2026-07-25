import { supabase } from './supabase.js'

/* Username: a unique handle, enforced by its own table (auth metadata can't
 * guarantee uniqueness). Format mirrors the DB check constraint exactly. */
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/

export async function getMyUsername(userId) {
  if (!supabase || !userId) return null
  const { data, error } = await supabase
    .from('usernames')
    .select('username')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) { console.warn('[username] load failed:', error.message); return null }
  return data?.username || null
}

/* Availability check — the open SELECT policy lets us query across all users
 * for an exact match; it leaks nothing beyond "is this string taken". */
export async function isUsernameAvailable(username) {
  if (!supabase) return false
  const { data, error } = await supabase
    .from('usernames')
    .select('id')
    .eq('username', username)
    .maybeSingle()
  if (error) { console.warn('[username] check failed:', error.message); return false }
  return !data
}

/* Claim or change: upsert on user_id. A unique-violation on username means
 * someone else holds it — surfaced as a friendly "taken" to the caller. */
export async function claimUsername(userId, username) {
  if (!supabase || !userId) return { error: 'not-configured' }
  const { error } = await supabase
    .from('usernames')
    .upsert({ user_id: userId, username }, { onConflict: 'user_id' })
  if (error) {
    const taken = /duplicate|unique|already exists/i.test(error.message)
    return { error: taken ? 'taken' : error.message }
  }
  return {}
}
