import { supabase } from './supabase.js'
import { LS_ANALYSIS, LS_TRACKED, LS_AGENT_PERF } from './storage.js'

/* Dev-only visibility into Supabase's email-sending calls. Production-grade
 * delivery for confirmation/reset requires a real SMTP provider wired in the
 * Supabase dashboard — the default testing relay rate-limits hard. This surfaces
 * a rate-limit or delivery failure in the console so it's obvious when an email
 * didn't actually send, rather than the UI silently pretending it did. It never
 * reaches end users; the returned error still drives the visible UI state. */
function logEmailDelivery(kind, error) {
  if (!import.meta.env.DEV || !error) return error
  const m = String(error.message || '').toLowerCase()
  if (/rate limit|too many|over_email_send_rate|429/.test(m)) {
    console.warn(`[email:${kind}] rate-limited by Supabase — the default relay caps sends. Wire a real SMTP provider in Authentication → Emails.`, error.message)
  } else if (/smtp|send|deliver|email/.test(m)) {
    console.warn(`[email:${kind}] delivery error — check the SMTP provider in the Supabase dashboard.`, error.message)
  }
  return error
}

export async function signUpWithEmail(email, password, name) {
  const res = await supabase.auth.signUp({
    email, password,
    options: {
      // Confirmation emails must land back on this app, not the project's
      // default Site URL (which points at localhost until configured).
      emailRedirectTo: window.location.origin,
      ...(name ? { data: { name } } : {}),
    },
  })
  logEmailDelivery('signup', res.error)
  return res
}

export async function signInWithEmail(email, password) {
  return supabase.auth.signInWithPassword({ email, password })
}

export async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  })
}

export async function resetPasswordForEmail(email) {
  const res = await supabase.auth.resetPasswordForEmail(email, {
    // Lands on a dedicated route; Vercel's SPA rewrite serves index.html there
    // and useAuth reads the recovery token from the URL fragment.
    redirectTo: `${window.location.origin}/reset-password`,
  })
  logEmailDelivery('reset', res.error)
  return res
}

export async function updatePassword(password) {
  return supabase.auth.updateUser({ password })
}

export async function signOut() {
  const res = await supabase.auth.signOut()
  // On a shared device the next account must not inherit this one's data.
  // Theme and the onboarding flag are device prefs and deliberately survive.
  try {
    ;[LS_ANALYSIS, LS_TRACKED, LS_AGENT_PERF].forEach(k => window.localStorage.removeItem(k))
  } catch { /* storage unavailable — nothing cached to clear */ }
  return res
}

export async function resendConfirmation(email) {
  const res = await supabase.auth.resend({ type: 'signup', email })
  logEmailDelivery('resend', res.error)
  return res
}

export async function getSession() {
  return supabase.auth.getSession()
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange(callback)
}

/* Plain-language error copy — raw Supabase strings never reach the UI */
export function friendlyAuthError(message = '') {
  const m = String(message).toLowerCase()
  if (m.includes('invalid login credentials')) return "That email and password don't match. Check them and try again."
  if (m.includes('already registered') || m.includes('already been registered')) return 'That email already has an account — try signing in instead.'
  if (m.includes('password should be at least') || m.includes('at least 6') || m.includes('weak password')) return 'Passwords need at least 8 characters and one number.'
  if (m.includes('valid email') || m.includes('invalid format')) return "That doesn't look like a valid email address."
  if (m.includes('email not confirmed')) return 'Your email hasn’t been confirmed yet — check your inbox for the confirmation link.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts in a row — give it a minute and try again.'
  // A failed SMTP/confirmation send comes back as a 500 "error sending
  // confirmation email" (or a bare unexpected_failure). Name it plainly so it
  // reads as a delivery problem, not a credentials problem.
  if (m.includes('sending confirmation') || m.includes('sending email') || m.includes('sending recovery') || m.includes('unexpected_failure')) {
    return 'We couldn’t send the email right now — the mail service is having trouble. Please try again in a few minutes.'
  }
  if (m.includes('email logins are disabled') || m.includes('signups not allowed') || m.includes('signup is disabled')) {
    return 'Email sign-in isn’t available right now. Try continuing with Google instead.'
  }
  if (m.includes('network') || m.includes('fetch')) return 'We couldn’t reach the sign-in service. Check your connection and try again.'
  return 'Something went wrong signing you in. Please try again.'
}
