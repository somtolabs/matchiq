import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL || ''
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

/* If the env vars are missing (e.g. a local checkout without keys), the app
 * must still run — auth simply stays un-gated rather than crashing at import. */
export const authConfigured = Boolean(url && anonKey)

export const supabase = authConfigured ? createClient(url, anonKey) : null
