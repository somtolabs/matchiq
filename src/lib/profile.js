import { supabase } from './supabase.js'

/* Username: a unique handle, enforced by its own table (auth metadata can't
 * guarantee uniqueness). Format mirrors the DB check constraint exactly. */
export const USERNAME_RE = /^[a-z0-9._]{3,20}$/

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
 * for an exact match; it leaks nothing beyond "is this string taken". When
 * editing, pass excludeUserId so the user's own current row doesn't read as
 * taken (keeping your existing handle must stay "available" to re-save). */
export async function isUsernameAvailable(username, excludeUserId) {
  if (!supabase) return false
  const { data, error } = await supabase
    .from('usernames')
    .select('user_id')
    .eq('username', username)
    .maybeSingle()
  if (error) { console.warn('[username] check failed:', error.message); return false }
  if (!data) return true
  return excludeUserId ? data.user_id === excludeUserId : false
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
