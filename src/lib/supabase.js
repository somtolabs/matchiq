import { createClient } from '@supabase/supabase-js'

// Accept both names — the .env in the wild uses VITE_SUPABASE_PROJECT_URL.
const url = import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_PROJECT_URL || ''
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

/* If the env vars are missing (e.g. a local checkout without keys), the app
 * must still run — auth simply stays un-gated rather than crashing at import. */
export const authConfigured = Boolean(url && anonKey)

export const supabase = authConfigured ? createClient(url, anonKey) : null
