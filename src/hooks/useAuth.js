import { useEffect, useState } from 'react'
import { authConfigured } from '../lib/supabase.js'
import { getSession, onAuthChange } from '../lib/auth.js'

const stripHash = () =>
  window.history.replaceState(null, '', window.location.pathname + window.location.search)

/* Session state for the whole app, with the OAuth-return edge cases handled:
 * 1. errors surfaced in the URL fragment become a calm message, not silence;
 * 2. loading holds until BOTH getSession and any pending OAuth exchange settle,
 *    so the sign-in screen never flashes before a returning session resolves;
 * 3. token fragments are cleared from the URL bar once signed in. */
export function useAuth() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(authConfigured)
  const [authError, setAuthError] = useState(null)

  useEffect(() => {
    if (!authConfigured) return

    const hash = window.location.hash || ''

    if (hash.includes('error=')) {
      const params = new URLSearchParams(hash.slice(1))
      const desc = params.get('error_description') || params.get('error')
      setAuthError(desc ? desc.replace(/\+/g, ' ') : "Sign-in didn't complete. Please try again.")
      stripHash()
    }

    // Returning from OAuth: supabase-js still has to exchange the fragment for a
    // session, so getSession() may resolve empty first — wait for the auth event.
    const returningFromOAuth = hash.includes('access_token=')

    getSession().then(({ data }) => {
      if (data?.session || !returningFromOAuth) {
        setSession(data?.session ?? null)
        setLoading(false)
      }
    }).catch(() => setLoading(false))

    const { data: sub } = onAuthChange((_event, s) => {
      setSession(s ?? null)
      if (s) {
        setAuthError(null)
        if (window.location.hash) stripHash()
      }
      setLoading(false)
    })

    // Never hang on a broken OAuth return: fall through to the sign-in screen.
    const failsafe = setTimeout(() => setLoading(false), 6000)

    return () => {
      sub?.subscription?.unsubscribe()
      clearTimeout(failsafe)
    }
  }, [])

  return { session, user: session?.user ?? null, loading, authError, setAuthError }
}
