import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  Sun, Moon, ChevronLeft, ChevronRight, X as XIcon, Check, Heart,
  Mail, ArrowUpRight, Plus, Minus, Eye, EyeOff, Pencil,
} from 'lucide-react'
import '@fontsource-variable/inter'

import {
  LS_THEME, LS_ANALYSIS, LS_TRACKED, LS_AGENT_PERF, LS_DIAG_OPEN, LS_ODDS_HIST,
  LS_COMP_CACHE, COMP_TTL_MS, cacheFresh,
  delay, readJSON, writeJSON, readRaw, writeRaw,
} from './lib/storage.js'
import { footballFetch, isHalfTime, liveLabel, matchScore, matchPhase } from './lib/football.js'
import { getFixtureNews, getHeadlines, relativeTime } from './lib/news.js'
import { getMatchGoals, formatMinute } from './lib/matchevents.js'
import { SYSTEM_PROMPT, buildPrompt, standingsRowFor } from './lib/prompts.js'
import { GROQ_MODEL, GROQ_ENDPOINT, SYNTHESIS_PARAMS, extractFirstJsonObject } from './lib/groq.js'
import {
  calculateKelly, runMultiMarketAnalysis, updateAgentPerformance, autoResolve, countsTowardRecord,
  edgeToOutcome, AGENT_PERF_EMPTY,
} from './lib/analysis.js'
import {
  lookupOddsForFixture, sportKeysForFixtures, readOddsStore, writeOddsStore, nameScore,
  planOddsFetch, eventsForKeys,
} from './lib/odds.js'
import { useApiHealth } from './hooks/useApiHealth.js'
import { useFixtures } from './hooks/useFixtures.js'
import { authConfigured } from './lib/supabase.js'
import {
  signUpWithEmail, signInWithEmail, signInWithGoogle, signOut, friendlyAuthError,
  resetPasswordForEmail, updatePassword,
} from './lib/auth.js'
import { useAuth } from './hooks/useAuth.js'
import { useUserData } from './hooks/useUserData.js'
import { usePredictionLedger } from './hooks/usePredictionLedger.js'
import { writePredictionToLedger, autoResolveInLedger, manualResolveInLedger } from './lib/ledger.js'
import { USERNAME_RE, getMyUsername, isUsernameAvailable, claimUsername } from './lib/profile.js'

/* ============================================================
 * QUIET SIGNAL — design language
 * Near-monochrome surfaces, one blue accent, Inter with tight
 * confident headlines, generous space, gentle scroll reveals.
 * ============================================================ */

const T = {
  bg:        'var(--iq-bg)',
  card:      'var(--iq-card)',
  card2:     'var(--iq-card2)',
  // Hover/press surfaces for interactive list rows — one step brighter than
  // card2 in dark, one step darker in light, so the shift reads the same way in
  // both themes without a row ever appearing to change elevation.
  cardHover: 'var(--iq-cardHover)',
  cardActive:'var(--iq-cardActive)',
  line:      'var(--iq-line)',
  lineHi:    'var(--iq-lineHi)',
  ink:       'var(--iq-ink)',
  sub:       'var(--iq-sub)',
  faint:     'var(--iq-faint)',
  accent:    'var(--iq-accent)',
  accentInk: 'var(--iq-accentInk)',
  accentBg:  'var(--iq-accentBg)',
  good:      'var(--iq-good)',
  goodBg:    'var(--iq-goodBg)',
  bad:       'var(--iq-bad)',
  badBg:     'var(--iq-badBg)',
  live:      'var(--iq-live)',
  glow:      'var(--iq-glow)',
  shadow:    'var(--iq-shadow)',
  shadowLg:  'var(--iq-shadowLg)',

  sans: "'Inter Variable', -apple-system, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif",
  mono: "ui-monospace, 'SF Mono', 'Cascadia Code', 'Segoe UI Mono', monospace",

  ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
}

const LIGHT = {
  bg:        '#FAFAFA',
  card:      '#FFFFFF',
  card2:     '#F5F5F5',
  cardHover: '#ECECEC',
  cardActive:'#E2E2E2',
  line:      'rgba(0,0,0,0.06)',
  lineHi:    'rgba(0,0,0,0.14)',
  ink:       '#1A1A1A',
  sub:       '#6E6E6E',
  faint:     '#A0A0A0',
  accent:    '#0071E3',
  accentInk: '#FFFFFF',
  accentBg:  'rgba(0,113,227,0.08)',
  good:      '#1D7F3E',
  goodBg:    'rgba(29,127,62,0.08)',
  bad:       '#C93400',
  badBg:     'rgba(201,52,0,0.07)',
  live:      '#E8481C',
  glow:      'none',
  shadow:    '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.04)',
  shadowLg:  '0 12px 48px rgba(0,0,0,0.12)',
}

/* Dark mode is glass: translucent white surfaces over a near-black base, edges
 * from hairlines, depth from luminance — no dark drop shadows. The @supports-not
 * block in GlobalStyles raises surface opacity where backdrop-filter is missing. */
const DARK = {
  bg:        '#0A0A0A',
  card:      'rgba(255,255,255,0.04)',
  card2:     'rgba(255,255,255,0.06)',
  cardHover: 'rgba(255,255,255,0.10)',
  cardActive:'rgba(255,255,255,0.14)',
  line:      'rgba(255,255,255,0.08)',
  lineHi:    'rgba(255,255,255,0.12)',
  ink:       '#F5F5F5',
  sub:       '#A0A0A0',
  faint:     '#6E6E6E',
  accent:    '#2997FF',
  accentInk: '#00080F',
  accentBg:  'rgba(41,151,255,0.13)',
  good:      '#3DD968',
  goodBg:    'rgba(61,217,104,0.11)',
  bad:       '#FF7A66',
  badBg:     'rgba(255,122,102,0.10)',
  live:      '#FF7A66',
  glow:      '0 0 40px 0 rgba(41,151,255,0.15)',
  shadow:    'none',
  shadowLg:  'none',
}

const cssVars = (p) => Object.entries(p).map(([k, v]) => `--iq-${k}:${v};`).join('')

function GlobalStyles() {
  return (
    <style>{`
      [data-theme="light"] { ${cssVars(LIGHT)} color-scheme: light; }
      [data-theme="dark"]  { ${cssVars(DARK)}  color-scheme: dark; }

      html, body, #root { margin: 0; padding: 0; min-height: 100%; }
      body {
        background: ${T.bg};
        color: ${T.ink};
        font-family: ${T.sans};
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
        font-optical-sizing: auto;
        overflow-x: hidden;
      }
      /* The theme vars live on the wrapper div, so the page base must paint
         there too — body sits outside the var scope and can't resolve them. */
      [data-theme] { background: var(--iq-bg); min-height: 100vh; min-height: 100dvh; width: 100%; }
      /* Dark background — one barely-visible neutral wash on a near-black base.
         Calm and chromatically silent; richness comes from the surfaces above. */
      [data-theme="dark"] {
        background:
          radial-gradient(ellipse 100% 40% at 50% 0%,
            rgba(255, 255, 255, 0.03),
            transparent 70%),
          #0A0A0A;
        background-attachment: fixed;
      }

      /* Glass surfaces — dark mode only, where backdrop-filter exists.
         Tuned for a neutral base; the inset top hairline is the light-catching edge. */
      @supports ((backdrop-filter: blur(8px)) or (-webkit-backdrop-filter: blur(8px))) {
        /* Directional specular highlight: a soft glint concentrated in the
           upper-left corner (radial-gradient at 15% 0%) layered over the fill,
           plus a two-axis inset edge — closer to light catching a curved glass
           surface than a flat line across the whole top edge. */
        [data-theme="dark"] .iq-glass,
        [data-theme="dark"] .iq-bar {
          background-color: transparent !important;
          background-image:
            radial-gradient(circle at 15% 0%,
              rgba(255, 255, 255, 0.06), transparent 40%),
            linear-gradient(180deg,
              rgba(255, 255, 255, 0.05),
              rgba(255, 255, 255, 0.03)) !important;
          backdrop-filter: blur(20px) saturate(120%) !important;
          -webkit-backdrop-filter: blur(20px) saturate(120%) !important;
          border-color: rgba(255, 255, 255, 0.09) !important;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.08),
            inset 1px 1px 0 rgba(255, 255, 255, 0.05) !important;
        }
        [data-theme="dark"] .iq-elevated {
          background-color: transparent !important;
          background-image:
            radial-gradient(circle at 15% 0%,
              rgba(255, 255, 255, 0.09), transparent 42%),
            linear-gradient(180deg,
              rgba(255, 255, 255, 0.07),
              rgba(255, 255, 255, 0.04)) !important;
          backdrop-filter: blur(30px) saturate(140%) !important;
          -webkit-backdrop-filter: blur(30px) saturate(140%) !important;
          border-color: rgba(255, 255, 255, 0.12) !important;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.11),
            inset 1px 1px 0 rgba(255, 255, 255, 0.07) !important;
        }
        [data-theme="light"] .iq-glass,
        [data-theme="light"] .iq-bar {
          background-color: transparent !important;
          background-image:
            radial-gradient(circle at 15% 0%,
              rgba(255, 255, 255, 0.9), transparent 40%),
            linear-gradient(180deg,
              rgba(255, 255, 255, 0.7),
              rgba(255, 255, 255, 0.5)) !important;
          backdrop-filter: blur(20px) saturate(150%) !important;
          -webkit-backdrop-filter: blur(20px) saturate(150%) !important;
          border-color: rgba(0, 0, 0, 0.06) !important;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.8),
            inset 1px 1px 0 rgba(255, 255, 255, 0.6) !important;
        }
        [data-theme="light"] .iq-elevated {
          background-color: transparent !important;
          background-image:
            radial-gradient(circle at 15% 0%,
              rgba(255, 255, 255, 0.95), transparent 42%),
            linear-gradient(180deg,
              rgba(255, 255, 255, 0.85),
              rgba(255, 255, 255, 0.65)) !important;
          backdrop-filter: blur(30px) saturate(160%) !important;
          -webkit-backdrop-filter: blur(30px) saturate(160%) !important;
          border-color: rgba(0, 0, 0, 0.08) !important;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.9),
            inset 1px 1px 0 rgba(255, 255, 255, 0.7) !important;
        }

        /* Floating nav — scrolled state: stronger blur + slightly more opaque
           fill so the bar reads as a distinct layer above the moving content. */
        [data-theme="dark"] .iq-bar.iq-bar-scrolled {
          backdrop-filter: blur(28px) saturate(140%) !important;
          -webkit-backdrop-filter: blur(28px) saturate(140%) !important;
          background-image:
            radial-gradient(circle at 15% 0%,
              rgba(255, 255, 255, 0.06), transparent 40%),
            linear-gradient(180deg,
              rgba(255, 255, 255, 0.07),
              rgba(255, 255, 255, 0.05)) !important;
        }
        [data-theme="light"] .iq-bar.iq-bar-scrolled {
          backdrop-filter: blur(28px) saturate(160%) !important;
          -webkit-backdrop-filter: blur(28px) saturate(160%) !important;
          background-image:
            radial-gradient(circle at 15% 0%,
              rgba(255, 255, 255, 0.95), transparent 40%),
            linear-gradient(180deg,
              rgba(255, 255, 255, 0.9),
              rgba(255, 255, 255, 0.75)) !important;
        }
      }
      /* The floating shadow beneath (or above) a scrolled bar — points away
         from the content it hovers over. Kept out of @supports so it applies
         regardless of backdrop-filter availability. */
      .iq-bar { transition: backdrop-filter 180ms ${T.ease}, box-shadow 180ms ${T.ease}; }
      .iq-bar-top.iq-bar-scrolled { box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15); }
      .iq-bar-bottom.iq-bar-scrolled { box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.15); }
      [data-theme="light"] .iq-bar-top.iq-bar-scrolled { box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06); }
      [data-theme="light"] .iq-bar-bottom.iq-bar-scrolled { box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.06); }
      /* No backdrop-filter: raise surface opacity so glass still reads as surface */
      @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
        [data-theme="dark"] {
          --iq-card: rgba(255,255,255,0.14);
          --iq-card2: rgba(255,255,255,0.16);
          --iq-cardHover: rgba(255,255,255,0.20);
          --iq-cardActive: rgba(255,255,255,0.24);
        }
        [data-theme="dark"] .iq-glass,
        [data-theme="dark"] .iq-bar { background: rgba(255, 255, 255, 0.14) !important; }
        [data-theme="dark"] .iq-elevated { background: rgba(255, 255, 255, 0.18) !important; }
        [data-theme="light"] .iq-glass,
        [data-theme="light"] .iq-bar { background: rgba(255, 255, 255, 0.85) !important; }
        [data-theme="light"] .iq-elevated { background: rgba(255, 255, 255, 0.92) !important; }
      }

      /* Accent glow on the verdict headline only (primary button gets it via --iq-glow) */
      .iq-halo { position: relative; }
      [data-theme="dark"] .iq-halo {
        box-shadow: 0 0 40px 0 rgba(41, 151, 255, 0.15);
        border-radius: 28px;
      }
      *, *::before, *::after { box-sizing: border-box; overflow-wrap: break-word; }
      button { font-family: inherit; }
      a { color: inherit; }

      [data-theme] * {
        transition: background-color 300ms ${T.ease}, color 300ms ${T.ease},
          border-color 300ms ${T.ease}, box-shadow 300ms ${T.ease};
      }
      *:focus { outline: none; }
      button:focus-visible, a:focus-visible, [tabindex]:focus-visible, summary:focus-visible {
        outline: 2px solid ${T.accent}; outline-offset: 3px; border-radius: 10px;
      }
      ::selection { background: ${T.accentBg}; }

      @keyframes iq-breathe { 0%,100% { opacity: .5; } 50% { opacity: .95; } }
      .iq-skel { animation: iq-breathe 1.6s ease-in-out infinite; background: ${T.card2}; border-radius: 10px; }

      @keyframes iq-pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.55); opacity: .5; } }
      .iq-pulse { animation: iq-pulse 1.8s ease-in-out infinite; }

      @keyframes iq-livedot { 0%,100% { opacity: .6; } 50% { opacity: 1; } }
      .iq-livedot { animation: iq-livedot 2s ease-in-out infinite; }

      @keyframes iq-think { to { transform: rotate(360deg); } }

      .iq-row { transition: background-color 180ms ${T.ease}; }
      .iq-row:hover { background: ${T.card2}; }
      .iq-lift { transition: transform 260ms ${T.ease}, box-shadow 260ms ${T.ease}; }
      .iq-lift:hover { transform: translateY(-2px); box-shadow: ${T.shadowLg}; }
      .iq-lift:active { transform: translateY(0); }

      /* Interactive list row: a background shift rather than the lift used by
         cards, so a dense stack of rows doesn't jitter on hover. */
      .iq-row {
        transition: background 180ms ${T.ease}, border-color 180ms ${T.ease};
        cursor: pointer;
      }
      .iq-row:hover { background: ${T.cardHover} !important; border-color: ${T.lineHi} !important; }
      .iq-row:active { background: ${T.cardActive} !important; }
      .iq-row:focus-visible {
        outline: 2px solid ${T.accent}; outline-offset: 2px;
      }

      details.iq-fold > summary { list-style: none; cursor: pointer; }
      details.iq-fold > summary::-webkit-details-marker { display: none; }
      details.iq-fold[open] .iq-fold-chev { transform: rotate(90deg); }
      .iq-fold-chev { display: inline-flex; transition: transform 240ms ${T.ease}; }

      [data-theme] *::-webkit-scrollbar { width: 10px; height: 8px; }
      [data-theme] *::-webkit-scrollbar-track { background: transparent; }
      [data-theme] *::-webkit-scrollbar-thumb {
        background: ${T.lineHi}; border-radius: 99px;
        border: 3px solid transparent; background-clip: padding-box;
      }
      .iq-scroll-x { overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: thin; }

      @media (prefers-reduced-motion: reduce) {
        [data-theme] *, [data-theme] *::before, [data-theme] *::after {
          animation-duration: 0.001ms !important; transition-duration: 0.001ms !important;
        }
      }
    `}</style>
  )
}

/* Gentle scroll reveal — a soft fade and a few pixels of drift, nothing more */
function Reveal({ children, delay: d = 0, style, className }) {
  const reduce = useReducedMotion()
  if (reduce) return <div style={style} className={className}>{children}</div>
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.65, delay: d, ease: [0.22, 1, 0.36, 1] }}
    >{children}</motion.div>
  )
}

/* Theme mode is 'light' | 'dark' | 'system'; the resolved theme follows the
 * OS preference (live) when mode is 'system'. Stored values from older builds
 * ('light'/'dark') read back unchanged. */
function useTheme() {
  const [mode, setMode] = useState(() => {
    if (typeof window === 'undefined') return 'system'
    const saved = readRaw(LS_THEME)
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  })
  const [sysDark, setSysDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)').matches : false)
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = (e) => setSysDark(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  useEffect(() => { writeRaw(LS_THEME, mode) }, [mode])
  const theme = mode === 'system' ? (sysDark ? 'dark' : 'light') : mode
  // Keep the <html> element (set pre-paint by the blocking script) and the
  // dynamic theme-color meta in lockstep with the resolved theme, so a manual
  // toggle also recolors the browser chrome and the overscroll/bounce area.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.style.colorScheme = theme
    updateThemeColorMeta(theme)
  }, [theme])
  const toggle = () => setMode(theme === 'dark' ? 'light' : 'dark')
  return [theme, toggle, setMode, mode]
}

const THEME_BG = { dark: '#0A0A0A', light: '#FAFAFA' }

/* The media-query theme-color tags only track the OS preference; this keeps a
 * non-media tag in sync with an in-app override so the address-bar tint follows. */
function updateThemeColorMeta(theme) {
  let meta = document.querySelector('meta[name="theme-color"]:not([media])')
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', THEME_BG[theme] || THEME_BG.dark)
}

function useWindowWidth() {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1200 : window.innerWidth))
  useEffect(() => {
    const on = () => setW(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return w
}

/* True once the page has scrolled past `threshold`px. Drives the floating-nav
 * glass intensification — a clean threshold toggle whose visual transition is
 * smoothed by the elements' own CSS transitions (blur/opacity/shadow). */
function useScrolled(threshold = 10) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > threshold)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [threshold])
  return scrolled
}

/* ============================================================
 * Identity, contact
 * ============================================================ */

const CONTACT_EMAIL = 'agwunobisomtochukwu@gmail.com'
const SOCIAL_LINKS = {
  github:   'https://github.com/somtolabs',
  linkedin: 'https://www.linkedin.com/in/agwunobi-somtochukwu-a61870342',
  x:        'https://x.com/gramzfgs',
  email:    `mailto:${CONTACT_EMAIL}`,
}
const mailto = (subject) => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`

/* Brand marks have no Lucide equivalents, so they stay minimal inline glyphs */
const Github = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" clipRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
  </svg>
)
const Linkedin = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M0 1.146C0 .513.526 0 1.175 0h13.65C15.474 0 16 .513 16 1.146v13.708c0 .633-.526 1.146-1.175 1.146H1.175C.526 16 0 15.487 0 14.854V1.146zm4.943 12.248V6.169H2.542v7.225h2.401zm-1.2-8.212c.837 0 1.358-.554 1.358-1.248-.015-.709-.52-1.248-1.342-1.248-.822 0-1.359.54-1.359 1.248 0 .694.521 1.248 1.327 1.248h.016zm4.908 8.212V9.359c0-.216.016-.432.08-.586.173-.431.568-.878 1.232-.878.869 0 1.216.662 1.216 1.634v3.865h2.401V9.25c0-2.22-1.184-3.252-2.764-3.252-1.274 0-1.845.7-2.165 1.193v.025h-.016a5.54 5.54 0 01.016-.025V6.169h-2.4c.03.678 0 7.225 0 7.225h2.4z"/>
  </svg>
)
const XSocial = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M12.6.75h2.454l-5.36 6.142L16 15.25h-4.937l-3.867-5.07-4.425 5.07H.316l5.733-6.57L0 .75h5.063l3.495 4.633L12.601.75Zm-.86 13.028h1.36L4.323 2.145H2.865l8.875 11.633Z"/>
  </svg>
)

/* ============================================================
 * Team crest with initials fallback — everywhere teams appear
 * ============================================================ */

function initialsOf(name = '') {
  const words = name.replace(/[^A-Za-z0-9 ]/g, '').split(' ').filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

function Crest({ src, name, size = 26 }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])
  if (!src || failed) {
    return (
      <span aria-hidden="true" style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: T.card2, border: `1px solid ${T.line}`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: T.sans, fontWeight: 650, fontSize: Math.max(9, size * 0.34),
        color: T.sub, letterSpacing: '0.01em',
      }}>{initialsOf(name)}</span>
    )
  }
  return (
    <img src={src} alt="" onError={() => setFailed(true)} style={{
      width: size, height: size, borderRadius: '50%', objectFit: 'contain',
      background: '#fff', border: `1px solid ${T.line}`, flexShrink: 0, padding: 1,
    }} />
  )
}

/* ============================================================
 * Type scale + small atoms
 * ============================================================ */

const type = {
  display: { fontFamily: T.sans, fontWeight: 650, letterSpacing: '-0.025em', lineHeight: 1.08 },
  title:   { fontFamily: T.sans, fontWeight: 620, letterSpacing: '-0.015em', lineHeight: 1.2 },
  eyebrow: {
    fontFamily: T.sans, fontSize: 12, fontWeight: 620, letterSpacing: '0.06em',
    textTransform: 'uppercase', color: T.faint,
  },
  body:  { fontFamily: T.sans, fontSize: 16, lineHeight: 1.6, color: T.ink, fontWeight: 420 },
  small: { fontFamily: T.sans, fontSize: 13.5, lineHeight: 1.55, color: T.sub, fontWeight: 440 },
  num:   { fontFamily: T.mono, fontWeight: 500 },
}

function Card({ children, style, className, onClick }) {
  return (
    <div className={`iq-glass${className ? ` ${className}` : ''}`} onClick={onClick} style={{
      background: T.card, border: `1px solid ${T.line}`,
      borderRadius: 20, boxShadow: T.shadow, ...style,
    }}>{children}</div>
  )
}

function Eyebrow({ children, style }) {
  return <div style={{ ...type.eyebrow, ...style }}>{children}</div>
}

/* One opener, provided once at the top of the app, so a headline behaves
 * identically wherever it appears. Without this the homepage strip and the
 * verdict screen would each need their own modal and would drift apart. */
const ArticleViewer = createContext(null)

/* One news row, and one list — shared by the homepage strip and the Recent
 * Headlines section on a verdict, so there is a single implementation of how an
 * article looks. Real source, real relative time from the article's own
 * publishedAt, real description when the API supplied one.
 *
 * A row is a button, not a link: tapping opens the in-app detail step first, and
 * the outbound link lives in there. Never renders a placeholder — callers decide
 * not to render at all. */
function NewsRow({ article, label }) {
  const open = useContext(ArticleViewer)
  return (
    <button
      type="button"
      className="iq-row"
      onClick={() => open?.(article, label)}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        background: T.card2, border: `1px solid transparent`,
        borderRadius: 14, padding: '15px 17px', color: T.ink,
        font: 'inherit',
      }}>
      <div style={{ ...type.small, color: T.ink, fontWeight: 560, lineHeight: 1.45, fontSize: 14.5 }}>
        {article.title}
      </div>
      {/* Two lines at most: enough to tell whether the story is worth opening,
          not so much that the section turns into a wall of text. Articles
          without a description simply skip this. */}
      {article.description && (
        <div style={{
          ...type.small, color: T.sub, marginTop: 7, lineHeight: 1.5,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {article.description}
        </div>
      )}
      <div style={{ ...type.small, color: T.faint, marginTop: 9, fontSize: 12.5 }}>
        {label ? `${label} · ` : ''}{article.source} · {relativeTime(article.publishedAt)}
      </div>
    </button>
  )
}

function NewsList({ items }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
      {items.map((it, i) => (
        <NewsRow key={`${it.article.url || it.article.title}-${i}`} article={it.article} label={it.label} />
      ))}
    </div>
  )
}

/* The in-app detail step. Everything shown here is already on the article object
 * fetched during the previous sprint's cached calls — opening this makes no
 * request of any kind.
 *
 * The description is genuinely nullable and NewsAPI truncates it near 200
 * characters, so it is omitted entirely when absent rather than leaving a gap,
 * and the outbound action is always present either way. */
function NewsDetailModal({ article, label, onClose }) {
  const reduce = useReducedMotion()

  // Escape to dismiss, and the page behind must not scroll under the overlay.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  if (!article) return null

  return (
    <motion.div
      onClick={onClose}
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduce ? undefined : { opacity: 0 }}
      transition={{ duration: 0.18 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={article.title}
        onClick={(e) => e.stopPropagation()}
        initial={reduce ? false : { opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduce ? undefined : { opacity: 0, y: 8, scale: 0.99 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        className="iq-glass"
        style={{
          background: T.card, border: `1px solid ${T.line}`, boxShadow: T.shadowLg,
          borderRadius: 22, padding: 28, width: '100%', maxWidth: 520,
          maxHeight: '82dvh', overflowY: 'auto',
        }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
          <Eyebrow>{label || 'Headline'}</Eyebrow>
          <button type="button" onClick={onClose} aria-label="Close" style={{
            background: 'transparent', border: 'none', color: T.faint,
            cursor: 'pointer', padding: 2, lineHeight: 0, marginTop: -2,
          }}><XIcon size={18} /></button>
        </div>

        <h2 style={{ ...type.title, fontSize: 21, color: T.ink, margin: '14px 0 0', lineHeight: 1.3 }}>
          {article.title}
        </h2>

        <div style={{ ...type.small, color: T.faint, marginTop: 10, fontSize: 13 }}>
          {article.source} · {relativeTime(article.publishedAt)}
        </div>

        {article.description && (
          <p style={{ ...type.body, fontSize: 15.5, color: T.sub, marginTop: 18, lineHeight: 1.6 }}>
            {article.description}
          </p>
        )}

        <div style={{ marginTop: 24 }}>
          {article.url ? (
            <a href={article.url} target="_blank" rel="noopener noreferrer"
              className="iq-lift"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: T.accent, color: T.accentInk, boxShadow: T.glow,
                borderRadius: 999, padding: '11px 22px', textDecoration: 'none',
                fontFamily: T.sans, fontSize: 14.5, fontWeight: 560,
              }}>
              Read full article <ArrowUpRight size={16} />
            </a>
          ) : (
            // Honest rather than a dead button: NewsAPI occasionally omits the URL.
            <div style={{ ...type.small, color: T.faint }}>
              This source didn't provide a link to the full article.
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

function Button({ children, onClick, kind = 'primary', style, disabled }) {
  const kinds = {
    primary: { background: T.accent, color: T.accentInk, border: '1px solid transparent', boxShadow: T.glow },
    ghost:   { background: 'transparent', color: T.ink, border: `1px solid ${T.lineHi}` },
    soft:    { background: T.card2, color: T.ink, border: '1px solid transparent' },
    danger:  { background: 'transparent', color: T.bad, border: `1px solid ${T.bad}` },
  }
  return (
    <button onClick={onClick} disabled={disabled} className="iq-lift" style={{
      ...kinds[kind], borderRadius: 999, padding: '10px 22px',
      fontFamily: T.sans, fontSize: 14.5, fontWeight: 560, cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center',
      ...style,
    }}>{children}</button>
  )
}

function Skel({ w = '100%', h = 14, style }) {
  return <div className="iq-skel" style={{ width: w, height: h, ...style }} />
}

function EmptyNote({ title, hint, action }) {
  return (
    <div style={{ textAlign: 'center', padding: '64px 28px' }}>
      <div style={{ ...type.title, fontSize: 22, color: T.ink }}>{title}</div>
      {hint && <div style={{ ...type.small, maxWidth: 360, margin: '12px auto 0' }}>{hint}</div>}
      {action && <div style={{ marginTop: 22 }}>{action}</div>}
    </div>
  )
}

function LiveDot({ size = 8 }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: size, height: size, flexShrink: 0 }}>
      <span className="iq-pulse" style={{
        position: 'absolute', inset: 0, borderRadius: '50%', background: T.live,
      }} />
      <span style={{ position: 'absolute', inset: 1, borderRadius: '50%', background: T.live }} />
    </span>
  )
}

/* In-play signal: a soft accent dot on a slow 2s pulse — felt, not shouted */
function PulseDot({ size = 7 }) {
  return (
    <span className="iq-livedot" aria-label="In play" style={{
      width: size, height: size, borderRadius: '50%', background: T.accent,
      boxShadow: `0 0 8px 2px color-mix(in oklab, ${T.accent} 30%, transparent)`,
      display: 'inline-block', flexShrink: 0,
    }} />
  )
}

/* Score digit that crossfades vertically when its value changes */
function AnimatedScore({ value, style }) {
  return (
    <span style={{ display: 'inline-grid', overflow: 'hidden', ...style }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={String(value)}
          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          style={{ gridArea: '1 / 1' }}>
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

/* Friendly language helpers — plain words first, numbers second */
function confidencePhrase(conf) {
  const c = conf || 0
  if (c >= 0.78) return 'and we feel strongly about it'
  if (c >= 0.68) return 'and we’re fairly confident'
  if (c >= 0.55) return 'though we hold it loosely'
  return 'but only as a slight lean'
}
function pickHeadline(pick, fx) {
  if (pick === 'home_win') return `${fx.homeTeam} to win`
  if (pick === 'away_win') return `${fx.awayTeam} to win`
  return 'A draw looks likeliest'
}
function pickShort(pick, fx) {
  return ({ home_win: fx.homeTeam, away_win: fx.awayTeam, draw: 'Draw' })[pick] || pick
}

/* ============================================================
 * Header + navigation
 * ============================================================ */

const NAV = [
  { key: 'matches',   label: 'Matches' },
  { key: 'bets',      label: 'Best Bets' },
  { key: 'following', label: 'Following' },
  { key: 'record',    label: 'Track Record' },
  { key: 'about',     label: 'About' },
]

/* Brand mark — three ascending bars: three independent angles rising to one
 * verdict. Monochrome via currentColor so it recolors with the theme. */
function LogoMark({ size = 20, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={style}>
      <rect x="3.5" y="12.5" width="4.4" height="8" rx="2.2" fill="currentColor" opacity="0.4" />
      <rect x="9.8" y="8" width="4.4" height="12.5" rx="2.2" fill="currentColor" opacity="0.68" />
      <rect x="16.1" y="3.5" width="4.4" height="17" rx="2.2" fill="currentColor" />
    </svg>
  )
}

/* Brand signature: the wordmark always sets tighter (-0.045em) than any other
 * text in the product — one consistent typographic detail, nothing else. */
function Wordmark({ size = 22, withMark = true }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.42, color: T.ink }}>
      {withMark && <LogoMark size={size * 0.95} style={{ flexShrink: 0 }} />}
      <span style={{
        fontFamily: T.sans, fontWeight: 680, fontSize: size,
        letterSpacing: '-0.045em', display: 'inline-flex', alignItems: 'baseline',
      }}>
        MatchIQ
      </span>
    </span>
  )
}

function Header({ theme, onToggleTheme, tab, onTab, isMobile, liveCount, user, avatarChoice, onOpenProfile }) {
  const dateStr = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  // Floating-nav behaviour: at the top of scroll the bar sits flush with the
  // standard glass; once scrolling begins it intensifies (stronger blur/opacity)
  // and lifts onto a soft shadow so it reads as floating above the content.
  const scrolled = useScrolled(10)
  return (
    <header className={`iq-bar iq-bar-top${scrolled ? ' iq-bar-scrolled' : ''}`} style={{
      position: 'sticky', top: 0, zIndex: 100,
      background: `color-mix(in oklab, ${T.bg} 82%, transparent)`,
      backdropFilter: 'saturate(1.6) blur(18px)', WebkitBackdropFilter: 'saturate(1.6) blur(18px)',
      borderBottom: `1px solid ${T.line}`,
      // Extend the bar's surface up into the notch/status-bar area so the top
      // edge blends with the phone rather than showing a seam above the header.
      paddingTop: 'env(safe-area-inset-top, 0px)',
    }}>
      <div style={{
        maxWidth: 1024, margin: '0 auto', padding: isMobile ? '13px 20px' : '14px 28px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, minWidth: 0 }}>
          <Wordmark size={isMobile ? 19 : 21} />
          {!isMobile && <span style={{ ...type.small, fontSize: 13, color: T.faint }}>{dateStr}</span>}
          {liveCount > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, ...type.small, fontSize: 13, color: T.live, fontWeight: 600 }}>
              <LiveDot size={7} /> {liveCount} live
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!isMobile && (
            <nav style={{ display: 'flex', gap: 2, marginRight: 8 }}>
              {NAV.map(n => {
                const on = n.key === tab
                return (
                  <button key={n.key} onClick={() => onTab(n.key)} style={{
                    background: 'transparent', border: 'none',
                    borderRadius: 999, padding: '8px 14px', cursor: 'pointer',
                    fontFamily: T.sans, fontSize: 13.5, fontWeight: on ? 620 : 460,
                    color: on ? T.ink : T.sub, position: 'relative',
                  }}>
                    {n.label}
                    {on && (
                      <motion.span layoutId="nav-dot" style={{
                        position: 'absolute', left: '50%', bottom: -1, width: 4, height: 4,
                        marginLeft: -2, borderRadius: '50%', background: T.accent,
                      }} />
                    )}
                  </button>
                )
              })}
            </nav>
          )}
          <button onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{
              background: 'transparent', border: `1px solid ${T.line}`, borderRadius: '50%',
              width: 36, height: 36, cursor: 'pointer', color: T.sub,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
            {theme === 'dark' ? <Sun size={16} strokeWidth={1.8} /> : <Moon size={16} strokeWidth={1.8} />}
          </button>
          {user && (
            <button onClick={onOpenProfile} aria-label="Open your profile" style={{
              background: 'transparent', border: 'none', cursor: 'pointer', padding: 2,
              display: 'inline-flex', borderRadius: '50%',
            }}>
              <ResolvedAvatar user={user} avatarChoice={avatarChoice} size={28} />
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

function MobileNav({ tab, onTab }) {
  // Mirror the header's floating-nav behaviour on the bottom bar.
  const scrolled = useScrolled(10)
  return (
    <nav className={`iq-bar iq-bar-bottom${scrolled ? ' iq-bar-scrolled' : ''}`} style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
      background: `color-mix(in oklab, ${T.card} 88%, transparent)`,
      backdropFilter: 'saturate(1.6) blur(20px)', WebkitBackdropFilter: 'saturate(1.6) blur(20px)',
      borderTop: `1px solid ${T.line}`,
      display: 'flex', height: 58,
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    }}>
      {NAV.map(n => {
        const on = n.key === tab
        return (
          <button key={n.key} onClick={() => onTab(n.key)} style={{
            flex: 1, minWidth: 0, background: 'transparent', border: 'none', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 4, color: on ? T.ink : T.faint, position: 'relative', padding: 0,
          }}>
            {on && (
              <motion.span layoutId="mnav-dot" style={{
                width: 4, height: 4, borderRadius: '50%', background: T.accent,
                position: 'absolute', top: 8,
              }} />
            )}
            <span style={{
              fontFamily: T.sans, fontSize: 11, fontWeight: on ? 620 : 480,
              whiteSpace: 'nowrap', marginTop: 8,
            }}>{n.label === 'Track Record' ? 'Record' : n.label === 'Best Bets' ? 'Bets' : n.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

/* ============================================================
 * MATCHES — browse + league tables
 * ============================================================ */

function MatchRow({ fixture: f, analyzed, tracked, onOpen, onToggleTrack }) {
  const isLive = f.status === 'IN_PLAY' || f.status === 'LIVE'
  const isFT = f.status === 'FINISHED'
  const hasScore = f.goalsHome != null && f.goalsAway != null

  const TeamLine = ({ name, logo, goals }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <Crest src={logo} name={name} size={28} />
      <span style={{
        fontFamily: T.sans, fontSize: 14.5, fontWeight: 520, color: T.ink,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1,
      }}>{name}</span>
      {goals != null && (
        <AnimatedScore value={goals} style={{ ...type.num, fontSize: 15, fontWeight: 600, color: isLive ? T.live : T.ink }} />
      )}
    </div>
  )

  return (
    <div className={isLive ? 'iq-row iq-elevated' : 'iq-row'} role="button" tabIndex={0}
      aria-label={`${f.homeTeam} versus ${f.awayTeam}`}
      onClick={() => onOpen(f)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(f) } }}
      style={{
        display: 'grid', gridTemplateColumns: '64px minmax(0,1fr) auto',
        gap: 14, alignItems: 'center', padding: '22px 22px',
        borderBottom: `1px solid ${T.line}`, cursor: 'pointer',
        background: isLive ? T.card2 : undefined,
      }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {isLive ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, paddingLeft: 2 }}>
            <PulseDot size={8} />
            {/* PAUSED is football-data's half-time; without this it reads as
                an ordinary live match. */}
            {isHalfTime(f) && <span style={{ ...type.small, fontWeight: 600, color: T.live, fontSize: 11 }}>HT</span>}
          </span>
        ) : isFT ? (
          <span style={{ ...type.small, fontWeight: 600, color: T.ink, fontSize: 12 }}>Full time</span>
        ) : f.status === 'POSTPONED' ? (
          <span style={{ ...type.small, fontWeight: 560, color: T.faint, fontSize: 12 }}>Postponed</span>
        ) : f.status === 'CANCELLED' ? (
          <span style={{ ...type.small, fontWeight: 560, color: T.faint, fontSize: 12 }}>Called off</span>
        ) : (
          <span style={{ ...type.num, fontSize: 13, color: T.sub }}>{f.kickoff}</span>
        )}
        {f.matchDate && <span style={{ fontSize: 10.5, color: T.faint, fontFamily: T.sans }}>{f.matchDate}</span>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <TeamLine name={f.homeTeam} logo={f.homeLogo} goals={hasScore ? f.goalsHome : null} />
        <TeamLine name={f.awayTeam} logo={f.awayLogo} goals={hasScore ? f.goalsAway : null} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {analyzed && (
          <span title="Already analysed" style={{
            fontSize: 11.5, fontWeight: 560, color: T.accent, background: T.accentBg,
            borderRadius: 999, padding: '3px 10px', fontFamily: T.sans, whiteSpace: 'nowrap',
          }}>Read</span>
        )}
        <button onClick={(e) => { e.stopPropagation(); onToggleTrack(f.id) }}
          aria-label={tracked ? 'Unfollow this match' : 'Follow this match'}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer', padding: 6,
            color: tracked ? T.accent : T.faint, display: 'inline-flex',
          }}>
          <Heart size={17} strokeWidth={1.8} fill={tracked ? 'currentColor' : 'none'} />
        </button>
        <span style={{ color: T.faint, display: 'inline-flex' }}><ChevronRight size={16} strokeWidth={1.8} /></span>
      </div>
    </div>
  )
}

function MatchesSkeleton() {
  return (
    <div>
      <Skel w={240} h={40} style={{ marginBottom: 12 }} />
      <Skel w={320} h={16} style={{ marginBottom: 32 }} />
      <Card style={{ overflow: 'hidden' }}>
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} style={{ padding: '16px 22px', borderBottom: `1px solid ${T.line}`, display: 'flex', gap: 14, alignItems: 'center' }}>
            <Skel w={44} h={13} />
            <div style={{ flex: 1 }}>
              <Skel w="55%" h={14} style={{ marginBottom: 8 }} />
              <Skel w="45%" h={14} />
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}

function LeagueTables({ fixtures, standingsCache, scorersCache, compDetailsCache }) {
  const compKeys = useMemo(() => {
    const keys = new Set()
    fixtures.forEach(f => { if (f.competitionCode) keys.add(f.competitionCode) })
    return Array.from(keys)
  }, [fixtures])

  const comps = compKeys.map(code => ({
    code,
    name: compDetailsCache[code]?.name || fixtures.find(f => f.competitionCode === code)?.competition || code,
    table: standingsCache[code]?.[0]?.table || [],
    scorers: scorersCache[code] || [],
  })).filter(c => c.table.length > 0 || c.scorers.length > 0)

  if (!comps.length) {
    return (
      <EmptyNote title="Tables are on their way"
        hint="League standings and top scorers load quietly in the background as match data arrives. Check back in a moment." />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {comps.map(c => (
        <Reveal key={c.code}>
          <Card style={{ padding: 28 }}>
            <div style={{ ...type.title, fontSize: 20, color: T.ink }}>{c.name}</div>
            {c.table.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <Eyebrow style={{ marginBottom: 10 }}>Standings — top 6</Eyebrow>
                {c.table.slice(0, 6).map(row => (
                  <div key={row.team?.id} style={{
                    display: 'grid', gridTemplateColumns: '22px 26px minmax(0,1fr) 34px 34px',
                    gap: 8, alignItems: 'center', padding: '8px 0',
                    borderBottom: `1px solid ${T.line}`,
                  }}>
                    <span style={{ ...type.num, fontSize: 12, color: T.faint }}>{row.position}</span>
                    <Crest src={row.team?.crest} name={row.team?.shortName || row.team?.name} size={20} />
                    <span style={{ ...type.small, color: T.ink, fontWeight: 540, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.team?.shortName || row.team?.name}
                    </span>
                    <span style={{ ...type.num, fontSize: 12, color: T.sub, textAlign: 'right' }}>{row.playedGames}</span>
                    <span style={{ ...type.num, fontSize: 13, fontWeight: 600, color: T.ink, textAlign: 'right' }}>{row.points}</span>
                  </div>
                ))}
              </div>
            )}
            {c.scorers.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <Eyebrow style={{ marginBottom: 10 }}>Leading scorers</Eyebrow>
                {c.scorers.slice(0, 3).map((s, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', alignItems: 'baseline' }}>
                    <span style={{ ...type.small, color: T.ink, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.player?.name}
                      <span style={{ color: T.faint }}> · {s.team?.shortName || s.team?.name}</span>
                    </span>
                    <span style={{ ...type.num, fontSize: 14, fontWeight: 600, color: T.ink, flexShrink: 0 }}>
                      {s.goals || 0} goals
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Reveal>
      ))}
    </div>
  )
}

/* Counts down a rate-limit hold so the wait is visible rather than a dead screen.
 * Returns whole seconds remaining, 0 once the hold has passed. */
function useCountdown(until) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!until || until <= Date.now()) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [until])
  if (!until) return 0
  return Math.max(0, Math.ceil((until - now) / 1000))
}

/* General football headlines on the homepage.
 *
 * The 30-minute window is enforced at the CDN by /api/news (s-maxage=1800), not
 * per browser: every visitor inside a window is served the one cached response,
 * so homepage traffic — which will always dwarf the number of analyses run —
 * costs at most 48 NewsAPI requests a day no matter how many people load it.
 *
 * Renders nothing at all when the list is empty or the refresh failed. There is
 * no placeholder and no fallback copy: an absent strip is the honest state. */
function NewsStrip({ articles }) {
  if (!articles?.length) return null
  return (
    <Reveal delay={0.06}>
      <Card style={{ padding: 28, marginTop: 26 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <Eyebrow>Football news</Eyebrow>
            <h2 style={{ ...type.title, fontSize: 21, color: T.ink, margin: '10px 0 0' }}>
              Latest headlines
            </h2>
          </div>
          <span style={{ ...type.small, color: T.faint, fontSize: 12.5 }}>
            {articles.length} {articles.length === 1 ? 'story' : 'stories'}
          </span>
        </div>
        <NewsList items={articles.map(a => ({ article: a }))} />
      </Card>
    </Reveal>
  )
}

function MatchesScreen({
  fixtures, fixturesLoading, fixturesError, onRetry, rateLimitedUntil,
  analysisCache, tracked, onOpen, onToggleTrack,
  standingsCache, scorersCache, compDetailsCache, headlines,
}) {
  const [view, setView] = useState('fixtures') // 'fixtures' | 'tables'
  const [comp, setComp] = useState('all')
  const [when, setWhen] = useState('all') // all | live | soon

  const live = fixtures.filter(f => f.status === 'IN_PLAY' || f.status === 'LIVE')
  const played = fixtures.filter(f => f.status === 'FINISHED')
  const isMobile = useWindowWidth() < 768

  /* The single highest-conviction verdict already written, if any — real data
   * only. Ranked by confidence, then value edge as the tie-breaker. */
  const topPick = useMemo(() => {
    let best = null
    for (const [id, a] of Object.entries(analysisCache)) {
      if (!a?.recommendation?.pick) continue
      // A look-back at a played match is not a live pick and must not headline.
      if (a.retrospective) continue
      const fx = fixtures.find(f => String(f.id) === String(id))
      if (!fx) continue
      if (!best) { best = { fx, a }; continue }
      const c = a.recommendation.confidence || 0
      const bc = best.a.recommendation.confidence || 0
      if (c > bc || (c === bc && (a.recommendation.value_edge || 0) > (best.a.recommendation.value_edge || 0))) {
        best = { fx, a }
      }
    }
    return best
  }, [analysisCache, fixtures])
  const topPickReason = topPick
    ? ((topPick.a.recommendation.reasoning || '').split(/(?<=[.!?])\s+/)[0] || '')
    : ''

  const compOptions = useMemo(() => {
    const m = new Map()
    fixtures.forEach(f => {
      const code = f.competitionCode || f.competition
      if (!m.has(code)) m.set(code, { code, name: f.competition })
    })
    return Array.from(m.values())
  }, [fixtures])

  const filtered = useMemo(() => {
    let list = fixtures
    if (comp !== 'all') list = list.filter(f => (f.competitionCode || f.competition) === comp)
    if (when === 'live') list = list.filter(f => f.status === 'IN_PLAY' || f.status === 'LIVE')
    if (when === 'soon') list = list.filter(f => f.status === 'SCHEDULED' || f.status === 'TIMED')
    if (when === 'done') list = list.filter(f => f.status === 'FINISHED')
    return list
  }, [fixtures, comp, when])

  const groups = useMemo(() => {
    const m = new Map()
    filtered.forEach(f => {
      const arr = m.get(f.competition) || []
      arr.push(f); m.set(f.competition, arr)
    })
    return Array.from(m.entries())
  }, [filtered])

  /* The prominent group leads: the one holding today's top pick, else the largest */
  const orderedGroups = useMemo(() => {
    if (groups.length < 2) return groups
    let lead = null
    if (topPick) {
      const g = groups.find(([, l]) => l.some(f => String(f.id) === String(topPick.fx.id)))
      if (g) lead = g[0]
    }
    if (!lead) lead = [...groups].sort((a, b) => b[1].length - a[1].length)[0][0]
    return [...groups].sort((a, b) => (a[0] === lead ? -1 : b[0] === lead ? 1 : 0))
  }, [groups, topPick])

  const holdSecs = useCountdown(rateLimitedUntil)

  if (fixturesLoading) return <MatchesSkeleton />

  /* A throttled fixture call used to fall through to "a quiet day — nothing on
   * the slate", which reads as a real answer about the football rather than a
   * temporary API state. Only shown when there is genuinely nothing cached to
   * display; the retry is automatic, so there is nothing for the user to do. */
  if (rateLimitedUntil > Date.now() && fixtures.length === 0) {
    return (
      <Card style={{ padding: 32 }}>
        <div style={{ ...type.title, fontSize: 21, color: T.ink }}>
          Temporarily rate limited by football-data.org
        </div>
        <div style={{ ...type.small, margin: '10px 0 20px' }}>
          The fixture provider caps requests per minute on this plan. Retrying automatically
          {holdSecs > 0 ? ` in ${holdSecs}s` : ' now'} — no need to refresh.
        </div>
        <Button onClick={onRetry} kind="soft">Retry now</Button>
      </Card>
    )
  }

  if (fixturesError) {
    return (
      <Card style={{ padding: 32 }}>
        <div style={{ ...type.title, fontSize: 21, color: T.ink }}>We couldn't fetch today's matches</div>
        <div style={{ ...type.small, margin: '10px 0 20px' }}>{fixturesError}</div>
        <Button onClick={onRetry} kind="soft">Try again</Button>
      </Card>
    )
  }

  /* Hero copy — every word computed from real data, never a placeholder */
  const headline = topPick
    ? `${topPick.fx.homeTeam} vs ${topPick.fx.awayTeam} is today's sharpest read.`
    : fixtures.length === 0
      ? 'A quiet day — nothing on the slate.'
      : `${fixtures.length} ${fixtures.length === 1 ? 'match' : 'matches'} today across ${compOptions.length} ${compOptions.length === 1 ? 'competition' : 'competitions'}.`
  const dateLine = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const topConf = topPick ? Math.round((topPick.a.recommendation.confidence || 0) * 100) : 0
  const topEdge = topPick ? (topPick.a.recommendation.value_edge || 0) : 0
  const highConviction = topPick && (topPick.a.recommendation.confidence || 0) >= 0.72

  return (
    <div>
      {/* Hero — arrives once on load with a quiet rise, the Apple move */}
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        style={{
          padding: isMobile ? '56px 0 8px' : '96px 0 16px',
          display: 'flex', flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'stretch' : 'flex-end',
          justifyContent: 'space-between', gap: 32,
        }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ ...type.display, fontSize: isMobile ? 34 : 46, color: T.ink, margin: 0 }}>{headline}</h1>
          <div style={{
            ...type.body, fontSize: 17, color: T.sub, marginTop: 14,
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          }}>
            {dateLine}
            {live.length > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: T.live, fontWeight: 560 }}>
                <PulseDot size={7} /> {live.length} {live.length === 1 ? 'match' : 'matches'} live now
              </span>
            )}
          </div>
        </div>

        {topPick ? (
          <Materialize delay={0.12}
            style={{ flexShrink: 0, width: isMobile ? '100%' : 330 }}>
            <Card onClick={() => onOpen(topPick.fx)}
              className={`iq-elevated iq-lift${highConviction ? ' iq-halo' : ''}`}
              style={{ padding: 32, cursor: 'pointer' }}>
              <Eyebrow style={{ color: T.accent }}>Today's sharpest read</Eyebrow>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 16 }}>
                <Crest src={topPick.fx.homeLogo} name={topPick.fx.homeTeam} size={26} />
                <Crest src={topPick.fx.awayLogo} name={topPick.fx.awayTeam} size={26} />
                <span style={{ ...type.small, fontSize: 13, color: T.faint, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {topPick.fx.homeTeam} v {topPick.fx.awayTeam}
                </span>
              </div>
              <div style={{ ...type.title, fontSize: 21, color: T.ink, marginTop: 14 }}>
                {pickHeadline(topPick.a.recommendation.pick, topPick.fx)}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                <span style={{ ...type.display, fontSize: 36, color: T.ink, fontVariantNumeric: 'tabular-nums' }}>{topConf}%</span>
                <span style={{ ...type.small, fontSize: 13 }}>sure</span>
                {topEdge > 0 && (
                  <span style={{
                    fontSize: 12, fontWeight: 560, fontFamily: T.sans, color: T.good,
                    background: T.goodBg, borderRadius: 999, padding: '4px 11px', whiteSpace: 'nowrap',
                  }}>{topEdge}-pt edge</span>
                )}
              </div>
              {topPickReason && (
                <div style={{
                  ...type.small, fontSize: 13.5, marginTop: 12,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>{topPickReason}</div>
              )}
            </Card>
          </Materialize>
        ) : fixtures.length > 0 && (
          <div className="iq-glass" style={{
            background: T.card, border: `1px solid ${T.line}`, borderRadius: 999,
            padding: '11px 22px', ...type.small, fontSize: 13.5, whiteSpace: 'nowrap',
            alignSelf: isMobile ? 'flex-start' : 'flex-end',
          }}>
            Run your first analysis to see it here
          </div>
        )}
      </motion.div>

      <Reveal delay={0.04}>
        <div style={{ height: 1, background: T.line, margin: isMobile ? '28px 0 4px' : '40px 0 8px' }} />
      </Reveal>

      <NewsStrip articles={headlines} />

      {/* View toggle */}
      <Reveal delay={0.06}>
        <div style={{ display: 'flex', gap: 4, marginTop: 26, background: T.card2, borderRadius: 999, padding: 3, width: 'fit-content' }}>
          {[{ k: 'fixtures', l: 'Fixtures' }, { k: 'tables', l: 'League tables' }].map(o => (
            <button key={o.k} onClick={() => setView(o.k)} style={{
              background: view === o.k ? T.card : 'transparent',
              color: view === o.k ? T.ink : T.sub,
              border: 'none', boxShadow: view === o.k ? T.shadow : 'none',
              borderRadius: 999, padding: '8px 18px', cursor: 'pointer',
              fontFamily: T.sans, fontSize: 13.5, fontWeight: view === o.k ? 600 : 480,
            }}>{o.l}</button>
          ))}
        </div>
      </Reveal>

      {view === 'tables' ? (
        <div style={{ marginTop: 24 }}>
          <LeagueTables fixtures={fixtures} standingsCache={standingsCache}
            scorersCache={scorersCache} compDetailsCache={compDetailsCache} />
        </div>
      ) : (
        <>
          {/* Filters */}
          <Reveal delay={0.1}>
            <div className="iq-scroll-x" style={{ display: 'flex', gap: 6, marginTop: 18, paddingBottom: 4, whiteSpace: 'nowrap' }}>
              {[
                { k: 'all', l: 'Everything' },
                { k: 'live', l: `Live now${live.length ? ` · ${live.length}` : ''}` },
                { k: 'soon', l: 'Upcoming' },
                { k: 'done', l: `Played${played.length ? ` · ${played.length}` : ''}` },
              ].map(o => (
                <button key={o.k} onClick={() => setWhen(o.k)} style={{
                  background: when === o.k ? T.ink : 'transparent',
                  color: when === o.k ? T.bg : T.sub,
                  border: `1px solid ${when === o.k ? T.ink : T.line}`,
                  borderRadius: 999, padding: '6px 15px', cursor: 'pointer',
                  fontFamily: T.sans, fontSize: 12.5, fontWeight: 560, flexShrink: 0,
                }}>{o.l}</button>
              ))}
              <span style={{ width: 1, background: T.line, margin: '4px 4px', flexShrink: 0 }} />
              {[{ code: 'all', name: 'All leagues' }, ...compOptions].map(c => (
                <button key={c.code} onClick={() => setComp(c.code)} style={{
                  background: comp === c.code ? T.card2 : 'transparent',
                  color: comp === c.code ? T.ink : T.sub,
                  border: `1px solid ${comp === c.code ? T.lineHi : T.line}`,
                  borderRadius: 999, padding: '6px 15px', cursor: 'pointer',
                  fontFamily: T.sans, fontSize: 12.5, fontWeight: 500, flexShrink: 0,
                }}>{c.name}</button>
              ))}
            </div>
          </Reveal>

          {filtered.length === 0 ? (
            <Card style={{ marginTop: 24 }}>
              <EmptyNote title="Nothing here right now" hint="Try a different filter, or check back closer to kick-off." />
            </Card>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 44, marginTop: 28 }}>
              {orderedGroups.map(([name, list], idx) => (
                <Reveal key={name}>
                  {idx > 0 && <div style={{ height: 1, background: T.line, opacity: 0.6, marginBottom: 24 }} />}
                  <Card style={{ overflow: 'hidden' }}>
                    <div style={{
                      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                      padding: '18px 22px 12px',
                    }}>
                      <span style={{ ...type.title, fontSize: idx === 0 ? 20 : 17, color: T.ink }}>{name}</span>
                      <span style={{ ...type.small, color: T.faint }}>
                        {idx === 0 ? `${list.length} ${list.length === 1 ? 'match' : 'matches'}` : list.length}
                      </span>
                    </div>
                    {list.map(f => (
                      <MatchRow key={f.id} fixture={f}
                        analyzed={!!analysisCache[f.id]} tracked={tracked.has(f.id)}
                        onOpen={onOpen} onToggleTrack={onToggleTrack} />
                    ))}
                  </Card>
                </Reveal>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ============================================================
 * MATCH DETAIL — preview, thinking state, verdict story
 * ============================================================ */

function DetailHeader({ fixture: f, onBack, tracked, onToggleTrack }) {
  const isLive = f.status === 'IN_PLAY' || f.status === 'LIVE'
  const hasScore = f.goalsHome != null && f.goalsAway != null
  return (
    <Reveal>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0 30px' }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: 'none', cursor: 'pointer', color: T.sub,
          display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0,
          fontFamily: T.sans, fontSize: 14.5, fontWeight: 500,
        }}><ChevronLeft size={17} strokeWidth={1.8} /> Back</button>
        <button onClick={() => onToggleTrack(f.id)}
          aria-label={tracked ? 'Unfollow this match' : 'Follow this match'}
          style={{
            background: tracked ? T.accentBg : 'transparent',
            border: `1px solid ${tracked ? 'transparent' : T.line}`, borderRadius: 999,
            padding: '7px 16px', cursor: 'pointer',
            color: tracked ? T.accent : T.sub,
            display: 'inline-flex', alignItems: 'center', gap: 7,
            fontFamily: T.sans, fontSize: 13, fontWeight: 560,
          }}>
          <Heart size={14} strokeWidth={1.8} fill={tracked ? 'currentColor' : 'none'} /> {tracked ? 'Following' : 'Follow'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 16, alignItems: 'center' }}>
        {[{ n: f.homeTeam, l: f.homeLogo, g: f.goalsHome }, null, { n: f.awayTeam, l: f.awayLogo, g: f.goalsAway }].map((side, i) =>
          side === null ? (
            <div key="mid" style={{ textAlign: 'center' }}>
              {hasScore ? (
                <div style={{ ...type.num, fontSize: 32, fontWeight: 600, color: isLive ? T.live : T.ink }}>
                  {f.goalsHome}–{f.goalsAway}
                </div>
              ) : (
                <div style={{ ...type.small, fontSize: 15, color: T.faint }}>v</div>
              )}
              <div style={{ ...type.small, color: T.faint, marginTop: 6, fontSize: 12.5 }}>
                {isLive ? <span style={{ color: T.live, fontWeight: 620 }}>{liveLabel(f)}</span>
                  : f.status === 'FINISHED' ? 'Full time'
                  : `${f.matchDate ? f.matchDate + ' · ' : ''}${f.kickoff}`}
              </div>
            </div>
          ) : (
            <div key={i} style={{ textAlign: 'center', minWidth: 0 }}>
              <Crest src={side.l} name={side.n} size={56} />
              <div style={{
                ...type.title, fontSize: 17, color: T.ink, marginTop: 12, lineHeight: 1.25,
              }}>{side.n}</div>
            </div>
          )
        )}
      </div>
      <div style={{ textAlign: 'center', ...type.small, color: T.faint, marginTop: 14 }}>{f.competition}</div>
    </Reveal>
  )
}

function FormBeads({ form }) {
  const items = (form && form.length ? form : ['-', '-', '-', '-', '-'])
  return (
    <span style={{ display: 'inline-flex', gap: 5 }}>
      {items.map((r, i) => {
        const color = r === 'W' ? T.good : r === 'L' ? T.bad : r === 'D' ? T.faint : 'transparent'
        return (
          <span key={i} title={r === 'W' ? 'Won' : r === 'L' ? 'Lost' : r === 'D' ? 'Drew' : 'No data'} style={{
            width: 9, height: 9, borderRadius: '50%',
            background: r === '-' ? 'transparent' : color,
            border: r === '-' ? `1.5px dashed ${T.faint}` : 'none',
            display: 'inline-block',
          }} />
        )
      })}
    </span>
  )
}

function MarketBar({ fixture: f }) {
  const o = f.odds || {}
  if (o.home == null) {
    return (
      <div style={{ ...type.small, color: T.faint }}>
        No live betting prices for this one yet — we'll read it from form and history instead.
      </div>
    )
  }
  const imp = (v) => (v ? 1 / parseFloat(v) : 0)
  const total = imp(o.home) + imp(o.draw) + imp(o.away) || 1
  const segs = [
    { l: f.homeTeam.split(' ')[0], p: imp(o.home) / total, c: T.ink, odds: o.home },
    { l: 'Draw', p: imp(o.draw) / total, c: T.faint, odds: o.draw },
    { l: f.awayTeam.split(' ')[0], p: imp(o.away) / total, c: T.sub, odds: o.away },
  ]
  return (
    <div>
      <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', gap: 2 }}>
        {segs.map((s, i) => (
          <div key={i} style={{ width: `${s.p * 100}%`, background: s.c, opacity: 0.75, borderRadius: 999 }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, gap: 8 }}>
        {segs.map((s, i) => (
          <div key={i} style={{ textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center', minWidth: 0 }}>
            <div style={{ ...type.small, fontWeight: 560, color: T.ink, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.l}</div>
            <div style={{ ...type.num, fontSize: 12, color: T.sub }}>
              {Math.round(s.p * 100)}% <span style={{ color: T.faint }}>({parseFloat(s.odds).toFixed(2)})</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* A match that is under way right now. Neither framing is honest for it: a
 * forward prediction is being written after the ball is already rolling, and a
 * retrospective read has no final result to be retrospective about. So the
 * trigger is withheld and the reason is said plainly. */
function LiveLock({ fixture: f }) {
  return (
    <Reveal>
      <Card style={{ padding: 30, marginTop: 36, borderLeft: `3px solid ${T.live}` }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
          <PulseDot size={8} />
          <span style={{ ...type.small, fontWeight: 620, color: T.live, fontSize: 12.5 }}>
            {isHalfTime(f) ? 'Half-time' : 'Live right now'}
          </span>
        </div>
        <div style={{ ...type.title, fontSize: 19, color: T.ink }}>
          This match is being played right now.
        </div>
        <div style={{ ...type.body, marginTop: 10 }}>
          We won't read it while it's in progress. A prediction written after kick-off
          isn't a prediction, and a verdict written before full time isn't a verdict —
          either one would go into your record as something it isn't.
        </div>
        <div style={{ ...type.small, color: T.faint, marginTop: 14 }}>
          Follow it with the heart above and it'll be here to read the moment it finishes.
        </div>
      </Card>
    </Reveal>
  )
}

function MatchPreview({ fixture: f, onAnalyze, busy, phase }) {
  const hasH2h = f.h2h?.matches?.length > 0
  const after = phase === 'finished'
  return (
    <div style={{ marginTop: 36, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Reveal>
        <Card style={{ padding: 28 }}>
          <Eyebrow>Recent form — last five games</Eyebrow>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
            {[{ n: f.homeTeam, fm: f.homeForm }, { n: f.awayTeam, fm: f.awayForm }].map((s, i) => (
              <div key={i}>
                <div style={{ ...type.small, fontWeight: 560, color: T.ink, marginBottom: 8 }}>{s.n}</div>
                <FormBeads form={s.fm} />
              </div>
            ))}
          </div>
        </Card>
      </Reveal>

      <Reveal delay={0.05}>
        <Card style={{ padding: 28 }}>
          <Eyebrow>What the betting market thinks</Eyebrow>
          <div style={{ marginTop: 16 }}><MarketBar fixture={f} /></div>
        </Card>
      </Reveal>

      {hasH2h && (
        <Reveal delay={0.1}>
          <Card style={{ padding: 28 }}>
            <Eyebrow>When they've met before</Eyebrow>
            <div style={{ ...type.body, marginTop: 12 }}>{f.h2h.summary}</div>
            {f.h2h.lastMeeting && f.h2h.lastMeeting !== 'Unavailable' && (
              <div style={{ ...type.small, color: T.faint, marginTop: 8 }}>Most recently: {f.h2h.lastMeeting}</div>
            )}
          </Card>
        </Reveal>
      )}

      <Reveal delay={0.14}>
        <div style={{ textAlign: 'center', padding: '18px 0 4px' }}>
          <Button onClick={onAnalyze} disabled={busy} style={{ padding: '15px 34px', fontSize: 16, borderRadius: 999 }}>
            {after ? 'What would we have said?' : 'Read this match for me'}
          </Button>
          <div style={{ ...type.small, color: T.faint, marginTop: 14, maxWidth: 400, marginLeft: 'auto', marginRight: 'auto' }}>
            {after
              ? 'This match is already played. We’ll read it from the data as it stood beforehand — but it goes down as a look back, not a call, and it will never count towards your record.'
              : 'Three independent AI perspectives — form, history, and the market — settled into one honest verdict.'}
          </div>
        </div>
      </Reveal>
    </div>
  )
}

function ThinkingState({ fixture: f }) {
  const steps = [
    'Weighing recent form and momentum…',
    'Reading the history between these sides…',
    'Comparing our view against the market price…',
    'Writing the verdict…',
  ]
  const [step, setStep] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setStep(s => Math.min(s + 1, steps.length - 1)), 3200)
    return () => clearInterval(id)
  }, [])
  return (
    <Reveal>
      <Card style={{ padding: 48, marginTop: 36, textAlign: 'center' }}>
        <svg width="40" height="40" viewBox="0 0 44 44" fill="none" aria-hidden="true"
          style={{ animation: 'iq-think 1.6s linear infinite', margin: '0 auto', display: 'block' }}>
          <circle cx="22" cy="22" r="18" stroke={`color-mix(in oklab, ${'var(--iq-accent)'} 20%, transparent)`} strokeWidth="3" />
          <path d="M22 4a18 18 0 0114 6.7" stroke="var(--iq-accent)" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <div style={{ ...type.title, fontSize: 21, color: T.ink, marginTop: 24 }}>
          Reading {f.homeTeam} v {f.awayTeam}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={step}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.4 }}
            style={{ ...type.small, marginTop: 10 }} aria-live="polite">
            {steps[step]}
          </motion.div>
        </AnimatePresence>
      </Card>
    </Reveal>
  )
}

/* Agreement between the three angles, derived from the real analysis JSON */
function angleReads(data, fx) {
  const reads = []
  const fe = data.form_analysis?.form_edge
  if (fe) reads.push({
    key: 'form', name: 'Form', outcome: edgeToOutcome(fe),
    neutral: fe === 'neutral',
    note: fe === 'neutral' ? 'saw the two sides as evenly matched'
      : `leaned towards ${fe === 'home' ? fx.homeTeam : fx.awayTeam} on recent performances`,
  })
  const te = data.tactical_analysis?.tactical_edge
  if (te) reads.push({
    key: 'tactical', name: 'History & matchup', outcome: edgeToOutcome(te),
    neutral: te === 'neutral',
    note: te === 'neutral' ? 'found no clear edge in how these teams match up'
      : `favoured ${te === 'home' ? fx.homeTeam : fx.awayTeam} on how these teams match up`,
  })
  const vb = data.market_analysis?.value_bet
  if (vb) reads.push({
    key: 'market', name: 'Market', outcome: vb === 'none' ? null : edgeToOutcome(vb),
    neutral: vb === 'none',
    note: vb === 'none' ? 'found no mispricing worth acting on'
      : `spotted value in ${vb === 'home' ? fx.homeTeam : vb === 'away' ? fx.awayTeam : 'the draw'} at current prices`,
  })
  return reads
}

function VerdictStory({ fixture: fx, data, onReRun, busy }) {
  const r = data.recommendation || {}
  const conf = Math.round((r.confidence || 0) * 100)
  const modelPct = Math.round((r.model_probability || 0) * 100)
  const edge = r.value_edge || 0
  const kelly = data.kelly
  const halfK = kelly?.halfPercent

  const reads = angleReads(data, fx)
  const opinions = reads.filter(a => a.outcome != null)
  const dissenters = opinions.filter(a => a.outcome !== r.pick)
  const disagreed = dissenters.length > 0

  const marketImplied = ({
    home_win: data.market_analysis?.implied_home_prob,
    draw: data.market_analysis?.implied_draw_prob,
    away_win: data.market_analysis?.implied_away_prob,
  })[r.pick]
  const impliedPct = marketImplied != null ? Math.round(marketImplied * 100) : null

  /* If our pick isn't the market's implied favourite, say so — confidently */
  const impliedAll = [
    ['home_win', data.market_analysis?.implied_home_prob],
    ['draw', data.market_analysis?.implied_draw_prob],
    ['away_win', data.market_analysis?.implied_away_prob],
  ].filter(([, v]) => typeof v === 'number' && v > 0)
  const marketFav = impliedAll.length
    ? impliedAll.reduce((a, b) => (b[1] > a[1] ? b : a))
    : null
  const marketDisagrees = !!(marketFav && r.pick && marketFav[0] !== r.pick)
  const marketFavLabel = marketFav
    ? (marketFav[0] === 'draw' ? 'a draw' : pickShort(marketFav[0], fx))
    : ''
  const reasoningFirstSentence = (r.reasoning || '').split(/(?<=[.!?])\s+/)[0] || ''

  const analysedAt = data._ts
    ? new Date(data._ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null

  const pickLabels = {
    over: 'More than 2.5 goals', under: 'Fewer than 2.5 goals',
    yes: 'Both teams to score', no: 'Not both teams to score',
  }

  return (
    <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* THE VERDICT — one clear thing the eye lands on first */}
      <Reveal>
        <div className="iq-halo" style={{ textAlign: 'center', padding: '16px 0 8px' }}>
          <Eyebrow style={{ color: T.accent, marginBottom: 16 }}>
            {data.retrospective ? 'Looking back' : 'Our verdict'}
          </Eyebrow>
          <h1 style={{ ...type.display, fontSize: 40, color: T.ink, margin: 0 }}>
            {data.retrospective ? `We'd have said ${pickShort(r.pick, fx)}` : pickHeadline(r.pick, fx)}.
          </h1>
          {data.retrospective && (
            <div style={{ ...type.small, color: T.faint, marginTop: 12, maxWidth: 380, margin: '12px auto 0' }}>
              Read after the match was already played, from the data as it stood beforehand.
              It doesn't count towards your record.
            </div>
          )}
          <div style={{ ...type.body, fontSize: 19, color: T.sub, marginTop: 12 }}>
            We're <strong style={{ color: T.ink, fontWeight: 560 }}>{conf}% sure</strong>, {confidencePhrase(r.confidence)}.
          </div>
          <div style={{ maxWidth: 320, margin: '26px auto 0' }}>
            <div style={{ height: 6, background: T.card2, borderRadius: 999, overflow: 'hidden' }}>
              <motion.div
                initial={{ width: 0 }} whileInView={{ width: `${conf}%` }}
                viewport={{ once: true }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
                style={{ height: '100%', borderRadius: 999, background: T.accent }} />
            </div>
          </div>
        </div>
      </Reveal>

      {/* THE WHY — calm, readable prose with breathing room */}
      {r.reasoning && (
        <Reveal>
          <Card className="iq-elevated" style={{ padding: '34px 32px' }}>
            <Eyebrow style={{ marginBottom: 14 }}>Why we think so</Eyebrow>
            <p style={{
              ...type.body, fontSize: 17.5, lineHeight: 1.7, color: T.ink,
              margin: 0, fontWeight: 420,
            }}>{r.reasoning}</p>
          </Card>
        </Reveal>
      )}

      {/* THE CASE EACH WAY — the work done before the pick was made.
          Rendered in the order the model was required to produce it. */}
      {(data.case_for?.home?.length || data.case_for?.away?.length || data.case_for?.draw?.length) && (
        <Reveal>
          <Card style={{ padding: 30 }}>
            <Eyebrow>The case each way, before we picked</Eyebrow>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
              {[
                [`For ${fx.homeTeam}`, data.case_for?.home],
                ['For a draw', data.case_for?.draw],
                [`For ${fx.awayTeam}`, data.case_for?.away],
              ].map(([label, items]) => (items?.length > 0) && (
                <div key={label}>
                  <div style={{ ...type.small, fontSize: 13.5, fontWeight: 600, color: T.ink }}>{label}</div>
                  {items.map((it, i) => (
                    <div key={i} style={{
                      ...type.small, fontSize: 14, color: T.sub, marginTop: 8,
                      paddingLeft: 12, borderLeft: `2px solid ${T.line}`,
                    }}>{it}</div>
                  ))}
                </div>
              ))}
            </div>
            {r.uncertainty && (
              <div style={{
                marginTop: 22, padding: '16px 18px', background: T.card2, borderRadius: 14,
                ...type.small, fontSize: 14, color: T.ink,
              }}>
                <strong style={{ fontWeight: 600 }}>How close it was: </strong>{r.uncertainty}
              </div>
            )}
          </Card>
        </Reveal>
      )}

      {/* THE MARKET DISAGREES — only when our pick isn't the implied favourite */}
      {marketDisagrees && (
        <Reveal>
          <div style={{ borderTop: `1px solid ${T.line}`, paddingTop: 24, padding: '24px 4px 4px' }}>
            <div style={{ ...type.small, fontSize: 13, fontWeight: 560, color: T.faint }}>The market disagrees</div>
            <div style={{ ...type.body, marginTop: 10 }}>
              The market favors {marketFavLabel} at {Math.round(marketFav[1] * 100)}%.
              We think {pickShort(r.pick, fx)} is the better call
              {reasoningFirstSentence ? <> — {reasoningFirstSentence}</> : '.'}
            </div>
          </div>
        </Reveal>
      )}

      {/* AGREEMENT / DISAGREEMENT — quietly highlighted only when it matters */}
      {disagreed ? (
        <Reveal>
          <Card style={{ padding: 30, borderLeft: `3px solid ${T.accent}` }}>
            <Eyebrow style={{ color: T.accent }}>Worth knowing — our angles didn't all agree</Eyebrow>
            <div style={{ ...type.body, marginTop: 12 }}>
              The final call went to <strong style={{ fontWeight: 560 }}>{pickShort(r.pick, fx)}</strong>, but not unanimously.
              That tension is part of the picture:
            </div>
            <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {reads.map(a => {
                const agrees = a.outcome === r.pick
                return (
                  <div key={a.key} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <span style={{
                      marginTop: 2, width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                      background: agrees ? T.goodBg : a.outcome == null ? 'transparent' : T.badBg,
                      border: a.outcome == null ? `1.5px dashed ${T.faint}` : 'none',
                      color: agrees ? T.good : T.bad,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {a.outcome != null && (agrees ? <Check size={12} strokeWidth={2.2} /> : <XIcon size={11} strokeWidth={2.2} />)}
                    </span>
                    <span style={{ ...type.small, fontSize: 14, color: T.ink }}>
                      <strong style={{ fontWeight: 560 }}>{a.name}</strong> {a.note}.
                    </span>
                  </div>
                )
              })}
            </div>
          </Card>
        </Reveal>
      ) : (
        <Reveal>
          <div style={{
            ...type.small, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            padding: '4px 18px', color: T.good, textAlign: 'center',
          }}>
            <Check size={15} strokeWidth={2} />
            All three of our angles — form, history, and the market — pointed the same way here.
          </div>
        </Reveal>
      )}

      {/* THE PRACTICAL TAKEAWAY */}
      <Reveal>
        <Card style={{ padding: 30 }}>
          <Eyebrow>If you were going to act on this</Eyebrow>
          {edge > 0 && impliedPct != null ? (
            <div style={{ ...type.body, marginTop: 12 }}>
              The market prices this outcome at about <strong style={{ fontWeight: 560 }}>{impliedPct}%</strong>; our read makes
              it <strong style={{ fontWeight: 560 }}>{modelPct}%</strong>. That gap — about <strong style={{ color: T.good, fontWeight: 560 }}>{edge} points in your favour</strong> —
              is what makes this interesting.
            </div>
          ) : edge > 0 ? (
            <div style={{ ...type.body, marginTop: 12 }}>
              We rate this outcome about <strong style={{ color: T.good, fontWeight: 560 }}>{edge} points more likely</strong> than
              the betting market's price suggests.
            </div>
          ) : (
            <div style={{ ...type.body, marginTop: 12 }}>
              Honestly? The market has this priced about right. There's no bargain here — treat this
              as a read on the game, not a reason to bet.
            </div>
          )}

          {halfK != null && halfK > 0 ? (
            <div style={{
              marginTop: 20, padding: '18px 22px', background: T.card2,
              borderRadius: 16, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap',
            }}>
              <span style={{ ...type.display, fontSize: 26, color: T.ink }}>
                ~{halfK}%
              </span>
              <span style={{ ...type.small, fontSize: 14, color: T.ink }}>
                of your betting pot would be a disciplined stake here.
              </span>
              <details className="iq-fold" style={{ width: '100%' }}>
                <summary style={{ ...type.small, color: T.sub, fontWeight: 560, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span className="iq-fold-chev"><ChevronRight size={13} strokeWidth={2} /></span>
                  How we sized that
                </summary>
                <div style={{ ...type.small, marginTop: 10 }}>
                  This is the <em>Kelly Criterion</em> — a formula for stake sizing from probability edges.
                  Full Kelly says {kelly.fullPercent}%; we suggest half of that ({kelly.halfPercent}%) because
                  it keeps most of the long-term growth with far gentler swings.
                </div>
              </details>
            </div>
          ) : kelly && (
            <div style={{ ...type.small, color: T.faint, marginTop: 16 }}>
              {kelly.label === 'No odds available for Kelly calculation'
                ? 'Without live prices we can’t suggest a stake size for this one.'
                : 'Our math says the sensible stake here is zero.'}
            </div>
          )}
        </Card>
      </Reveal>

      {/* WHAT COULD MAKE THIS WRONG */}
      {r.red_flags?.length > 0 && (
        <Reveal>
          <Card style={{ padding: 30 }}>
            <Eyebrow>What could make us wrong</Eyebrow>
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {r.red_flags.map((flag, i) => (
                <div key={i} style={{ display: 'flex', gap: 12 }}>
                  <Minus size={15} strokeWidth={1.8} style={{ color: T.faint, flexShrink: 0, marginTop: 3 }} />
                  <span style={{ ...type.small, fontSize: 14, color: T.ink }}>{flag}</span>
                </div>
              ))}
            </div>
            <div style={{ ...type.small, color: T.faint, marginTop: 16 }}>
              Football keeps its own counsel. Nothing here is certain.
            </div>
          </Card>
        </Reveal>
      )}

      {/* OTHER MARKETS */}
      {data.multiMarket?.length > 0 && (
        <Reveal>
          <Card style={{ padding: 30 }}>
            <Eyebrow>A goals angle, if you prefer</Eyebrow>
            <div style={{ marginTop: 14, display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              {data.multiMarket.map(m => {
                const res = m.result || {}
                const c = Math.round((res.confidence || 0) * 100)
                return (
                  <div key={m.key} style={{ background: T.card2, borderRadius: 16, padding: 20 }}>
                    <div style={{ ...type.small, fontSize: 14, fontWeight: 560, color: T.ink }}>
                      {pickLabels[res.recommendation] || res.recommendation || '—'}
                    </div>
                    <div style={{ ...type.small, color: T.sub, marginTop: 8 }}>{res.reasoning}</div>
                    <div style={{ ...type.num, fontSize: 12, color: T.faint, marginTop: 10 }}>{c}% confident · {m.label}</div>
                  </div>
                )
              })}
            </div>
          </Card>
        </Reveal>
      )}

      {/* EVERY NUMBER — for the curious, revealed on request */}
      <Reveal>
        <details className="iq-fold">
          <summary style={{
            ...type.small, fontSize: 14, fontWeight: 560, color: T.sub, padding: '10px 4px',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <span className="iq-fold-chev"><ChevronRight size={14} strokeWidth={2} /></span>
            See every number behind this verdict
          </summary>
          <Card style={{ padding: 28, marginTop: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 18 }}>
              {[
                { l: 'Model probability', v: `${modelPct}%` },
                { l: 'Confidence', v: `${conf}% (${r.confidence_label || '—'})` },
                { l: 'Value edge vs market', v: `${edge > 0 ? '+' : ''}${edge}%` },
                { l: 'Implied — home', v: `${Math.round((data.market_analysis?.implied_home_prob || 0) * 100)}%` },
                { l: 'Implied — draw', v: `${Math.round((data.market_analysis?.implied_draw_prob || 0) * 100)}%` },
                { l: 'Implied — away', v: `${Math.round((data.market_analysis?.implied_away_prob || 0) * 100)}%` },
                { l: 'Full Kelly', v: kelly?.fullPercent != null ? `${kelly.fullPercent}%` : '—' },
                { l: 'Half Kelly', v: kelly?.halfPercent != null ? `${kelly.halfPercent}%` : '—' },
                { l: 'Data quality', v: data.data_quality || '—' },
              ].map(x => (
                <div key={x.l}>
                  <div style={{ ...type.eyebrow, fontSize: 10.5 }}>{x.l}</div>
                  <div style={{ ...type.num, fontSize: 16, color: T.ink, marginTop: 5 }}>{x.v}</div>
                </div>
              ))}
            </div>

            <div style={{ height: 1, background: T.line, margin: '24px 0' }} />

            {/* Per-angle detail */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
              {(data.data_read?.home_facts || data.data_read?.away_facts) && (
                <div>
                  <Eyebrow>What the data said, before any comparison</Eyebrow>
                  {data.data_read?.home_facts && (
                    <div style={{ ...type.small, marginTop: 10, color: T.ink }}>
                      <strong style={{ fontWeight: 560 }}>{fx.homeTeam}:</strong> {data.data_read.home_facts}
                    </div>
                  )}
                  {data.data_read?.away_facts && (
                    <div style={{ ...type.small, marginTop: 5, color: T.ink }}>
                      <strong style={{ fontWeight: 560 }}>{fx.awayTeam}:</strong> {data.data_read.away_facts}
                    </div>
                  )}
                </div>
              )}
              <div>
                <Eyebrow>Form angle</Eyebrow>
                <div style={{ ...type.small, marginTop: 10, color: T.ink }}>
                  <strong style={{ fontWeight: 560 }}>{fx.homeTeam}:</strong> {data.form_analysis?.home_verdict}
                </div>
                <div style={{ ...type.small, marginTop: 5, color: T.ink }}>
                  <strong style={{ fontWeight: 560 }}>{fx.awayTeam}:</strong> {data.form_analysis?.away_verdict}
                </div>
                {(data.form_analysis?.key_factors || []).map((k, i) => (
                  <div key={i} style={{ ...type.small, color: T.sub, marginTop: 5, paddingLeft: 12, borderLeft: `2px solid ${T.line}` }}>{k}</div>
                ))}
              </div>
              <div>
                <Eyebrow>History & matchup angle</Eyebrow>
                <div style={{ ...type.small, marginTop: 10, color: T.ink }}>{data.tactical_analysis?.matchup_insight}</div>
                {(data.tactical_analysis?.key_factors || []).map((k, i) => (
                  <div key={i} style={{ ...type.small, color: T.sub, marginTop: 5, paddingLeft: 12, borderLeft: `2px solid ${T.line}` }}>{k}</div>
                ))}
              </div>
              <div>
                <Eyebrow>Market angle</Eyebrow>
                <div style={{ ...type.small, marginTop: 10, color: T.ink }}>{data.market_analysis?.market_signal}</div>
              </div>
            </div>
          </Card>
        </details>
      </Reveal>

      <RecentHeadlines fixture={fx} news={data.news} />

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 12, flexWrap: 'wrap', padding: '4px 4px 12px',
      }}>
        <span style={{ ...type.small, color: T.faint }}>
          {analysedAt ? `Written ${analysedAt}` : 'From an earlier reading'}
        </span>
        {onReRun && <Button kind="ghost" onClick={onReRun} disabled={busy} style={{ padding: '8px 18px', fontSize: 13 }}>Read it again</Button>}
      </div>
    </div>
  )
}

/* The headlines that were actually in front of the model when it wrote this
 * verdict — the same articles carried on the analysis by runAnalysis, not a
 * second fetch. Rendered nowhere if the analysis predates this feature
 * (`news` undefined), and stated plainly when the search genuinely found
 * nothing. Nothing here is ever filled in to look complete. */
function RecentHeadlines({ fixture, news }) {
  if (!news) return null
  const items = [
    ...(news.home || []).map(a => ({ article: a, label: fixture.homeTeam })),
    ...(news.away || []).map(a => ({ article: a, label: fixture.awayTeam })),
  ]
  return (
    <Reveal>
      <Card style={{ padding: 28, marginBottom: 18 }}>
        <Eyebrow>Recent headlines</Eyebrow>
        {items.length === 0 ? (
          <div style={{ ...type.small, marginTop: 12 }}>
            No recent headlines found for either team.
          </div>
        ) : (
          <>
            <div style={{ ...type.small, color: T.faint, marginTop: 10, fontSize: 12.5 }}>
              Unverified coverage, used as loose context only — not team news.
            </div>
            <NewsList items={items} />
          </>
        )}
      </Card>
    </Reveal>
  )
}

/* The Track action on a written verdict. Tracking and the Match Center are one
 * gesture: it marks the fixture (through the same `tracked` set the heart uses,
 * not a parallel store) and opens the centre on the same tap. */
function TrackBar({ tracked, onTrack }) {
  return (
    <Reveal>
      <Card className="iq-lift" onClick={onTrack} style={{
        padding: '18px 22px', marginTop: 26, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...type.small, fontSize: 14.5, fontWeight: 560, color: T.ink }}>
            {tracked ? 'Open the match centre' : 'Track this match'}
          </div>
          <div style={{ ...type.small, fontSize: 12.5, color: T.faint, marginTop: 4 }}>
            {tracked
              ? 'Form, table, head-to-head, market and live score in one place.'
              : 'Follow it and see everything we know — form, table, head-to-head, market, live score.'}
          </div>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0,
          background: tracked ? T.accentBg : T.ink, color: tracked ? T.accent : T.bg,
          borderRadius: 999, padding: '9px 18px',
          fontFamily: T.sans, fontSize: 13.5, fontWeight: 600,
        }}>
          <Heart size={14} strokeWidth={2} fill={tracked ? 'currentColor' : 'none'} />
          {tracked ? 'Match centre' : 'Track'}
        </span>
      </Card>
    </Reveal>
  )
}

function MatchDetail({ fixture, data, loading, error, onBack, onRetry, onAnalyze, tracked, onToggleTrack, onOpenCenter }) {
  /* Three phases, three behaviours — previously two, with no status check at
   * all: a finished match and a live one both got the same forward-looking
   * "Read this match for me". A verdict already written stays visible whatever
   * the phase; it is only the trigger that is withheld while a match is live. */
  const phase = matchPhase(fixture)
  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <DetailHeader fixture={fixture} onBack={onBack} tracked={tracked} onToggleTrack={onToggleTrack} />
      {data && !loading && !error && (
        <TrackBar tracked={tracked} onTrack={() => onOpenCenter(fixture)} />
      )}
      {loading ? (
        <ThinkingState fixture={fixture} />
      ) : error ? (
        <Card style={{ padding: 30, marginTop: 36, borderLeft: `3px solid ${T.bad}` }}>
          <div style={{ ...type.title, fontSize: 19, color: T.ink }}>That reading didn't come through</div>
          <div style={{ ...type.small, margin: '10px 0 18px' }}>{error}</div>
          <Button kind="soft" onClick={onRetry}>Try again</Button>
        </Card>
      ) : data ? (
        <VerdictStory fixture={fixture} data={data}
          onReRun={phase === 'live' ? null : onAnalyze} busy={loading} />
      ) : phase === 'live' ? (
        <LiveLock fixture={fixture} />
      ) : (
        <MatchPreview fixture={fixture} onAnalyze={onAnalyze} busy={loading} phase={phase} />
      )}
    </div>
  )
}

/* ============================================================
 * MATCH CENTER — everything real we actually know about a match
 *
 * Reached from the Track button on a verdict, or by opening a followed match
 * from the Following list. Deliberately built from the app's existing card
 * system rather than the flat auth styling, because it lives inside the app
 * shell next to MatchDetail.
 *
 * Every field here is read from a real API response. The free football-data.org
 * tier returns status, scores (full/half/regular/extra), lastUpdated, matchday,
 * venue and referees — and nothing else. There is no `minute` field, no event
 * feed, no lineups and no match statistics, so no minute counter, timeline or
 * heatmap is rendered. Where that data would go, the Live section says plainly
 * that the plan doesn't include it.
 * ============================================================ */

function CenterSection({ title, children, accent }) {
  return (
    <Reveal>
      <Card style={{ padding: 28 }}>
        <Eyebrow style={accent ? { color: T.live } : undefined}>{title}</Eyebrow>
        <div style={{ marginTop: 16 }}>{children}</div>
      </Card>
    </Reveal>
  )
}

function StatRow({ label, value, strong }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'baseline',
      padding: '9px 0', borderBottom: `1px solid ${T.line}`,
    }}>
      <span style={{ ...type.small, color: T.sub, minWidth: 0 }}>{label}</span>
      <span style={{
        ...type.small, fontSize: 13.5, color: T.ink, textAlign: 'right',
        fontWeight: strong ? 600 : 500, flexShrink: 0,
      }}>{value}</span>
    </div>
  )
}

/* Goal-level form, the same data the prompt reasons from. */
function FormLedger({ team, letters, detail }) {
  const rows = Array.isArray(detail) ? detail : []
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ ...type.small, fontSize: 14, fontWeight: 560, color: T.ink }}>{team}</span>
        <FormBeads form={letters} />
      </div>
      {rows.length === 0 ? (
        <div style={{ ...type.small, color: T.faint, marginTop: 8, fontSize: 12.5 }}>
          Per-match detail hasn't loaded for this side yet.
        </div>
      ) : (
        <>
          <div style={{ marginTop: 10 }}>
            {rows.map((m, i) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '20px 44px minmax(0,1fr) auto',
                gap: 10, alignItems: 'baseline', padding: '6px 0',
                borderBottom: i < rows.length - 1 ? `1px solid ${T.line}` : 'none',
              }}>
                <span style={{
                  ...type.small, fontSize: 11.5, fontWeight: 600,
                  color: m.result === 'W' ? T.good : m.result === 'L' ? T.bad : T.faint,
                }}>{m.result}</span>
                <span style={{ ...type.num, fontSize: 13, color: T.ink }}>{m.gf}–{m.ga}</span>
                <span style={{
                  ...type.small, fontSize: 12.5, color: T.sub, minWidth: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {m.venue === 'H' ? 'home' : 'away'} v {m.opponent || 'unknown'}
                </span>
                <span style={{ ...type.small, fontSize: 11.5, color: T.faint }}>{m.date || ''}</span>
              </div>
            ))}
          </div>
          <div style={{ ...type.small, fontSize: 12.5, color: T.faint, marginTop: 10 }}>
            {rows.reduce((s, m) => s + m.gf, 0)} scored, {rows.reduce((s, m) => s + m.ga, 0)} conceded
            across those {rows.length}.
          </div>
        </>
      )}
    </div>
  )
}

function OddsMovement({ fixture: f, history }) {
  const o = f.odds || {}
  if (o.home == null) {
    return <div style={{ ...type.small, color: T.faint }}>No live prices for this match yet.</div>
  }
  const first = history?.first
  const move = (key) => {
    if (!first || first[key] == null) return null
    const d = parseFloat(o[key]) - parseFloat(first[key])
    if (!isFinite(d) || Math.abs(d) < 0.01) return { d: 0, text: 'unchanged', color: T.faint }
    return {
      d,
      text: `${d > 0 ? '+' : ''}${d.toFixed(2)} since ${new Date(history.firstAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
      // Drifting out means the market grew less confident in that outcome.
      color: d > 0 ? T.bad : T.good,
    }
  }
  return (
    <div>
      <MarketBar fixture={f} />
      <div style={{ marginTop: 20 }}>
        {[['home', f.homeTeam], ['draw', 'Draw'], ['away', f.awayTeam]].map(([k, label]) => {
          const m = move(k)
          return (
            <div key={k} style={{
              display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline',
              padding: '8px 0', borderBottom: `1px solid ${T.line}`,
            }}>
              <span style={{ ...type.small, color: T.ink, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
              <span style={{ display: 'inline-flex', gap: 10, alignItems: 'baseline', flexShrink: 0 }}>
                <span style={{ ...type.num, fontSize: 14, color: T.ink }}>{parseFloat(o[k]).toFixed(2)}</span>
                {m && <span style={{ ...type.small, fontSize: 11.5, color: m.color }}>{m.text}</span>}
              </span>
            </div>
          )
        })}
      </div>
      {!first && (
        <div style={{ ...type.small, fontSize: 12.5, color: T.faint, marginTop: 12 }}>
          This is the first price we've recorded for this match — movement will show from your next visit.
        </div>
      )}
      {f.marketMovement && !/Fetching/i.test(f.marketMovement) && (
        <div style={{ ...type.small, fontSize: 12.5, color: T.faint, marginTop: 10 }}>{f.marketMovement}</div>
      )}
    </div>
  )
}

/* Real goal scorers for a finished match, from API-Football's events endpoint.
 *
 * Fetched here and nowhere else — on opening one specific match, never across a
 * fixture list. The free plan allows 100 requests a day, so preloading even one
 * day's card would spend a fifth of it before anyone asked for anything.
 *
 * Renders nothing at all while loading or when the match isn't finished. When
 * the data genuinely isn't retrievable it says so plainly instead of leaving an
 * empty section — most often because the match has aged out of the free plan's
 * ~48-hour window, which was measured directly against the API. */
function GoalsSection({ fixture }) {
  const [state, setState] = useState({ loading: true, goals: [], unavailable: null })

  useEffect(() => {
    if (fixture.status !== 'FINISHED') { setState({ loading: false, goals: [], unavailable: 'notfinished' }); return }
    let cancelled = false
    setState({ loading: true, goals: [], unavailable: null })
    getMatchGoals(fixture).then(r => {
      if (!cancelled) setState({
        loading: false, goals: r.goals || [], unavailable: r.unavailable || null,
        homeTeamId: r.homeTeamId ?? null, awayTeamId: r.awayTeamId ?? null,
      })
    })
    return () => { cancelled = true }
  }, [fixture.id, fixture.status])

  if (fixture.status !== 'FINISHED') return null
  if (state.loading) return null

  const { goals, unavailable } = state
  // A goalless draw is a real answer; anything else with no goals is not.
  const goalless = !unavailable && goals.length === 0 &&
    fixture.goalsHome === 0 && fixture.goalsAway === 0

  if (unavailable || (goals.length === 0 && !goalless)) {
    return (
      <CenterSection title="Goals">
        <div style={{ ...type.small, color: T.faint }}>
          {unavailable === 'ratelimit'
            /* Temporary and self-clearing, so don't call it unavailable — that
               would read as a fact about the match rather than about us. */
            ? 'Briefly rate limited by our events provider — reopen this match in a moment.'
            : <>
                Goal details unavailable for this match.
                {unavailable === 'window' && ' Our events provider only covers the last couple of days.'}
              </>}
        </div>
      </CenterSection>
    )
  }

  if (goalless) {
    return (
      <CenterSection title="Goals">
        <div style={{ ...type.small, color: T.sub }}>No goals — it finished 0–0.</div>
      </CenterSection>
    )
  }

  /* Grouped by API-Football's own team id, which the goals carry — exact, and it
   * handles the cases where the two providers' names share nothing ("Atletico-MG"
   * against "CA Mineiro"). Name matching is only the fallback. */
  const { homeTeamId, awayTeamId } = state
  const side = (id, teamName) => goals.filter(g =>
    id != null && g.teamId != null ? g.teamId === id : nameScore(g.team, teamName) > 0)
  const homeGoals = side(homeTeamId, fixture.homeTeam)
  const awayGoals = side(awayTeamId, fixture.awayTeam)
  const grouped = [
    { name: fixture.homeTeam, logo: fixture.homeLogo, list: homeGoals },
    { name: fixture.awayTeam, logo: fixture.awayLogo, list: awayGoals },
  ]
  // Anything the name match couldn't place still gets shown, never dropped.
  const placed = new Set([...homeGoals, ...awayGoals])
  const unplaced = goals.filter(g => !placed.has(g))

  const line = (g) => `${formatMinute(g)} ${g.player}${
    g.detail && g.detail !== 'Normal Goal' ? ` (${g.detail.toLowerCase()})` : ''}`

  return (
    <CenterSection title="Goals">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {grouped.filter(t => t.list.length > 0).map(t => (
          <div key={t.name}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
              <Crest src={t.logo} name={t.name} size={20} />
              <span style={{ ...type.small, fontWeight: 600, color: T.ink }}>{t.name}</span>
            </div>
            <div style={{ ...type.small, color: T.sub, lineHeight: 1.7 }}>
              {t.list.map((g, i) => (
                <div key={i}>
                  <span style={{ ...type.num, color: T.ink, fontWeight: 600 }}>{formatMinute(g)}</span>
                  {' '}{g.player}
                  {g.detail && g.detail !== 'Normal Goal' && (
                    <span style={{ color: T.faint }}> ({g.detail.toLowerCase()})</span>
                  )}
                  {g.assist && <span style={{ color: T.faint }}> · assist {g.assist}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
        {unplaced.length > 0 && (
          <div style={{ ...type.small, color: T.sub, lineHeight: 1.7 }}>
            {unplaced.map((g, i) => <div key={i}>{line(g)} — {g.team}</div>)}
          </div>
        )}
      </div>
    </CenterSection>
  )
}

function MatchCenter({
  fixture: f, analysis, standings, oddsHistory,
  onBack, onOpenAnalysis, tracked, onToggleTrack,
}) {
  const isLive = f.status === 'IN_PLAY' || f.status === 'LIVE'
  const isFT = f.status === 'FINISHED'
  const hasScore = f.goalsHome != null && f.goalsAway != null
  const score = matchScore(f)
  const home = standingsRowFor(standings, f.homeTeamId)
  const away = standingsRowFor(standings, f.awayTeamId)
  const h2hMatches = f.h2h?.matches || []

  const statusLine = isLive ? liveLabel(f)
    : isFT ? 'Full time'
    : f.status === 'POSTPONED' ? 'Postponed'
    : f.status === 'CANCELLED' ? 'Called off'
    : `${f.matchDate ? f.matchDate + ' · ' : ''}${f.kickoff}`

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <Reveal>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0 30px' }}>
          <button onClick={onBack} style={{
            background: 'transparent', border: 'none', cursor: 'pointer', color: T.sub,
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0,
            fontFamily: T.sans, fontSize: 14.5, fontWeight: 500,
          }}><ChevronLeft size={17} strokeWidth={1.8} /> Back</button>
          <button onClick={() => onToggleTrack(f.id)}
            aria-label={tracked ? 'Stop tracking this match' : 'Track this match'}
            style={{
              background: tracked ? T.accentBg : 'transparent',
              border: `1px solid ${tracked ? 'transparent' : T.line}`, borderRadius: 999,
              padding: '7px 16px', cursor: 'pointer', color: tracked ? T.accent : T.sub,
              display: 'inline-flex', alignItems: 'center', gap: 7,
              fontFamily: T.sans, fontSize: 13, fontWeight: 560,
            }}>
            <Heart size={14} strokeWidth={1.8} fill={tracked ? 'currentColor' : 'none'} />
            {tracked ? 'Tracking' : 'Track'}
          </button>
        </div>

        <Eyebrow style={{ color: isLive ? T.live : T.accent }}>Match centre</Eyebrow>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 16, alignItems: 'center', marginTop: 16 }}>
          {[{ n: f.homeTeam, l: f.homeLogo }, null, { n: f.awayTeam, l: f.awayLogo }].map((side, i) =>
            side === null ? (
              <div key="mid" style={{ textAlign: 'center' }}>
                {hasScore ? (
                  <div style={{ ...type.num, fontSize: 34, fontWeight: 600, color: isLive ? T.live : T.ink }}>
                    {/* The real scoreline. football-data's `fullTime` sums in the
                        shootout, so a 1–1 that went to penalties arrives as 5–4;
                        matchScore unpicks that from the real stage fields. */}
                    {score.home}–{score.away}
                  </div>
                ) : (
                  <div style={{ ...type.small, fontSize: 15, color: T.faint }}>v</div>
                )}
                <div style={{ ...type.small, color: isLive ? T.live : T.faint, marginTop: 6, fontSize: 12.5, fontWeight: isLive || isFT ? 620 : 500 }}>
                  {isLive && <LiveDot size={6} />} {statusLine}
                </div>
                {score.note && (
                  <div style={{ ...type.small, color: T.sub, marginTop: 6, fontSize: 12 }}>{score.note}</div>
                )}
              </div>
            ) : (
              <div key={i} style={{ textAlign: 'center', minWidth: 0 }}>
                <Crest src={side.l} name={side.n} size={52} />
                <div style={{ ...type.title, fontSize: 16.5, color: T.ink, marginTop: 12, lineHeight: 1.25 }}>{side.n}</div>
              </div>
            )
          )}
        </div>
        <div style={{ textAlign: 'center', ...type.small, color: T.faint, marginTop: 14 }}>
          {f.competition}{f.region ? ` · ${f.region}` : ''}{f.venue && f.venue !== 'TBC' ? ` · ${f.venue}` : ''}
        </div>
      </Reveal>

      <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* ---------- LIVE — only when the match is actually in play ---------- */}
        {isLive && (
          <CenterSection title="Live" accent>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
              <span style={{ ...type.display, fontSize: 44, color: T.live }}>
                {hasScore ? `${f.goalsHome}–${f.goalsAway}` : '—'}
              </span>
              <span style={{ ...type.small, color: T.sub }}>
                {f.homeTeam} v {f.awayTeam}
              </span>
            </div>
            <div style={{ marginTop: 16 }}>
              <StatRow label="Status" value={isHalfTime(f) ? 'Half-time' : 'In play'} strong />
              {f.matchday != null && <StatRow label="Matchday" value={f.matchday} />}
            </div>
            {/* No minute counter: the current football-data.org plan does not
                return a `minute` field, and inventing one would be fabrication. */}
            <div style={{ ...type.small, fontSize: 12.5, color: T.faint, marginTop: 14 }}>
              Our data plan returns the score and status for a live match, but not the clock —
              so we don't show a minute rather than guess one.
            </div>
            {/* Three providers, three different things available. Stated
                separately so none of it reads as a blanket "not available". */}
            <div style={{
              marginTop: 18, padding: '16px 18px', background: T.card2, borderRadius: 14,
            }}>
              <div style={{ ...type.small, fontSize: 13, fontWeight: 560, color: T.ink }}>
                What we can and can't show
              </div>
              <div style={{ ...type.small, fontSize: 12.5, color: T.faint, marginTop: 8, lineHeight: 1.65 }}>
                <div><strong style={{ color: T.sub }}>Live minute, shot maps and in-progress events</strong> — not
                available. The clock is a paid feature on our events provider, so nothing here
                updates minute by minute.</div>
                <div style={{ marginTop: 6 }}><strong style={{ color: T.sub }}>Goal scorers and their minutes</strong> — shown
                once the match finishes, for matches that ended within roughly the last two days.</div>
                <div style={{ marginTop: 6 }}><strong style={{ color: T.sub }}>Half-time, full-time, extra time and
                penalties</strong> — always shown, for any match however old.</div>
              </div>
            </div>
          </CenterSection>
        )}

        {/* ---------- OVERVIEW — always ---------- */}
        {analysis?.recommendation?.pick && (
          <Reveal>
            <Card className="iq-lift" onClick={onOpenAnalysis}
              style={{ padding: 24, cursor: 'pointer', borderLeft: `3px solid ${T.accent}` }}>
              <Eyebrow style={{ color: T.accent }}>Our reading of this match</Eyebrow>
              <div style={{ ...type.title, fontSize: 18, color: T.ink, marginTop: 12 }}>
                {pickHeadline(analysis.recommendation.pick, f)} — {Math.round((analysis.recommendation.confidence || 0) * 100)}% sure
              </div>
              <div style={{ ...type.small, color: T.sub, marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                Read the full verdict <ChevronRight size={14} strokeWidth={2} />
              </div>
            </Card>
          </Reveal>
        )}

        {/* ---------- GOALS — finished matches only, fetched on open ---------- */}
        <GoalsSection fixture={f} />

        <CenterSection title="Recent form — last five">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <FormLedger team={f.homeTeam} letters={f.homeForm} detail={f.homeFormDetail} />
            <div style={{ height: 1, background: T.line }} />
            <FormLedger team={f.awayTeam} letters={f.awayForm} detail={f.awayFormDetail} />
          </div>
        </CenterSection>

        <CenterSection title="Where they stand">
          {!home && !away ? (
            <div style={{ ...type.small, color: T.faint }}>
              We don't have a league table for {f.competition} — it may be a cup or knockout tie.
            </div>
          ) : (
            <div>
              {[[f.homeTeam, home], [f.awayTeam, away]].map(([name, s]) => (
                <div key={name} style={{ marginBottom: 18 }}>
                  <div style={{ ...type.small, fontSize: 14, fontWeight: 560, color: T.ink, marginBottom: 6 }}>{name}</div>
                  {s ? (
                    <>
                      <StatRow label="Position" value={`${s.row.position} of ${s.size}`} strong />
                      <StatRow label="Points" value={`${s.row.points} from ${s.row.playedGames} played`} />
                      <StatRow label="Record" value={`${s.row.won}W ${s.row.draw}D ${s.row.lost}L`} />
                      <StatRow label="Goals" value={`${s.row.goalsFor} scored, ${s.row.goalsAgainst} conceded (${s.row.goalDifference > 0 ? '+' : ''}${s.row.goalDifference})`} />
                    </>
                  ) : (
                    <div style={{ ...type.small, color: T.faint }}>Not in this competition's table.</div>
                  )}
                </div>
              ))}
              {home && away && (
                <div style={{ ...type.body, fontSize: 15, color: T.ink, paddingTop: 6 }}>
                  {home.row.points === away.row.points
                    ? `Level on ${home.row.points} points, separated by goal difference.`
                    : `${home.row.points > away.row.points ? f.homeTeam : f.awayTeam} are ${Math.abs(home.row.points - away.row.points)} points better off, and ${Math.abs(home.row.position - away.row.position)} ${Math.abs(home.row.position - away.row.position) === 1 ? 'place' : 'places'} apart.`}
                </div>
              )}
            </div>
          )}
        </CenterSection>

        <CenterSection title="When they've met before">
          {h2hMatches.length === 0 ? (
            <div style={{ ...type.small, color: T.faint }}>
              {f.h2h?.summary && f.h2h.summary !== 'Head-to-head data unavailable'
                ? f.h2h.summary
                : 'No head-to-head record came back for these two sides.'}
            </div>
          ) : (
            <div>
              <div style={{ ...type.body, fontSize: 15.5, color: T.ink }}>{f.h2h.summary}</div>
              <div style={{ marginTop: 16 }}>
                {h2hMatches.slice(0, 6).map((m, i) => {
                  const hs = m.score?.fullTime?.home
                  const as = m.score?.fullTime?.away
                  return (
                    <div key={m.id || i} style={{
                      display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto 68px',
                      gap: 10, alignItems: 'baseline', padding: '8px 0',
                      borderBottom: i < Math.min(h2hMatches.length, 6) - 1 ? `1px solid ${T.line}` : 'none',
                    }}>
                      <span style={{ ...type.small, fontSize: 12.5, color: T.ink, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.homeTeam?.shortName || m.homeTeam?.name} v {m.awayTeam?.shortName || m.awayTeam?.name}
                      </span>
                      <span style={{ ...type.num, fontSize: 13, color: T.ink }}>
                        {hs != null && as != null ? `${hs}–${as}` : '—'}
                      </span>
                      <span style={{ ...type.small, fontSize: 11.5, color: T.faint, textAlign: 'right' }}>
                        {m.utcDate ? new Date(m.utcDate).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </CenterSection>

        <CenterSection title="What the market says">
          <OddsMovement fixture={f} history={oddsHistory} />
        </CenterSection>

        {(f.matchday != null || (f.venue && f.venue !== 'TBC')) && (
          <CenterSection title="Match details">
            {f.competition && <StatRow label="Competition" value={f.competition} />}
            {f.matchday != null && <StatRow label="Matchday" value={f.matchday} />}
            {f.venue && f.venue !== 'TBC' && <StatRow label="Venue" value={f.venue} />}
            {isFT && hasScore && <StatRow label="Final score" value={`${f.goalsHome}–${f.goalsAway}`} strong />}
          </CenterSection>
        )}

        <div style={{ ...type.small, fontSize: 12, color: T.faint, textAlign: 'center', padding: '4px 0 12px' }}>
          Everything on this page comes from football-data.org and the-odds-api.com.
          Nothing here is estimated or filled in.
        </div>
      </div>
    </div>
  )
}

/* ============================================================
 * BEST BETS + COMBO SLIP
 * ============================================================ */

function BetCard({ entry, onOpen, comboActive, onToggleCombo }) {
  const { fx, a } = entry
  const r = a.recommendation
  const conf = Math.round((r.confidence || 0) * 100)
  const edge = r.value_edge || 0
  const firstSentence = (r.reasoning || '').split(/(?<=[.!?])\s+/)[0] || ''
  return (
    <Card className="iq-lift" onClick={() => onOpen(fx)} style={{ padding: 26, cursor: 'pointer' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Crest src={fx.homeLogo} name={fx.homeTeam} size={20} />
          <Crest src={fx.awayLogo} name={fx.awayTeam} size={20} />
          <span style={{ ...type.small, fontSize: 12.5, color: T.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fx.competition} · {fx.matchDate ? `${fx.matchDate}, ` : ''}{fx.kickoff}
          </span>
        </span>
        {edge > 0 && (
          <span style={{
            fontSize: 12, fontWeight: 560, fontFamily: T.sans, color: T.good,
            background: T.goodBg, borderRadius: 999, padding: '4px 11px', whiteSpace: 'nowrap',
          }}>{edge}-pt edge</span>
        )}
      </div>

      <div style={{ ...type.title, fontSize: 22, color: T.ink, marginTop: 14, letterSpacing: '-0.02em' }}>
        {pickHeadline(r.pick, fx)}
      </div>
      {firstSentence && (
        <div style={{
          ...type.small, fontSize: 14, marginTop: 8,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{firstSentence}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 18 }}>
        <div style={{ flex: 1, height: 5, background: T.card2, borderRadius: 999, overflow: 'hidden' }}>
          <div style={{ width: `${conf}%`, height: '100%', background: T.accent, borderRadius: 999 }} />
        </div>
        <span style={{ ...type.num, fontSize: 13, color: T.sub }}>{conf}% sure</span>
        <button onClick={(e) => { e.stopPropagation(); onToggleCombo(entry.id) }} style={{
          background: comboActive ? T.accent : 'transparent',
          color: comboActive ? T.accentInk : T.sub,
          border: `1px solid ${comboActive ? T.accent : T.lineHi}`,
          borderRadius: 999, padding: '6px 14px', cursor: 'pointer',
          fontFamily: T.sans, fontSize: 12.5, fontWeight: 560, whiteSpace: 'nowrap',
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }}>
          {comboActive ? <Check size={12} strokeWidth={2.4} /> : <Plus size={12} strokeWidth={2.2} />}
          {comboActive ? 'In combo' : 'Combine'}
        </button>
      </div>
    </Card>
  )
}

/* Combo slip — the parlay math and correlation detection preserved exactly */
function ComboSlip({ selections, entries, onRemove, onClear }) {
  if (!selections.length) return null

  const chosen = selections.map(id => entries.find(e => String(e.id) === String(id))).filter(Boolean)
  const allHaveOdds = chosen.every(e => {
    const pick = e.a.recommendation?.pick
    const o = e.fx?.odds
    return pick && o && (pick === 'home_win' ? o.home : pick === 'away_win' ? o.away : o.draw)
  })
  const combinedOdds = allHaveOdds
    ? chosen.reduce((acc, e) => {
        const pick = e.a.recommendation?.pick
        const o = e.fx.odds
        const dec = pick === 'home_win' ? o.home : pick === 'away_win' ? o.away : o.draw
        return acc * parseFloat(dec)
      }, 1)
    : null
  const combinedProb = chosen.reduce((acc, e) => acc * (e.a.recommendation?.model_probability || 0), 1)

  const teamMap = {}
  const matchIds = new Set()
  const warnings = []
  chosen.forEach(e => {
    if (!e.fx) return
    if (matchIds.has(e.fx.id)) warnings.push(`Two of these picks come from the same match (${e.fx.homeTeam} v ${e.fx.awayTeam})`)
    matchIds.add(e.fx.id)
    ;[e.fx.homeTeam, e.fx.awayTeam].forEach(t => {
      if (!t) return
      if (teamMap[t]) warnings.push(`${t} shows up in more than one pick`)
      teamMap[t] = true
    })
  })

  let kellyPct = null
  if (combinedOdds && combinedProb > 0 && warnings.length === 0) {
    const b = combinedOdds - 1
    const p = combinedProb
    const q = 1 - p
    const k = b > 0 ? (b * p - q) / b : 0
    if (k > 0) kellyPct = (k * 50).toFixed(1)
  }

  return (
    <Card className="iq-elevated" style={{
      position: 'sticky', bottom: 84, padding: 28, marginTop: 26,
      boxShadow: T.shadowLg, border: `1px solid ${T.lineHi}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ ...type.title, fontSize: 19, color: T.ink }}>
          Your combo — {selections.length} {selections.length === 1 ? 'pick' : 'picks'}
        </span>
        <button onClick={onClear} style={{
          background: 'transparent', border: 'none', cursor: 'pointer', ...type.small, color: T.faint,
        }}>Clear</button>
      </div>

      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 7 }}>
        {chosen.map(e => {
          if (!e.fx) return null
          const label = pickShort(e.a.recommendation.pick, e.fx)
          return (
            <div key={e.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '9px 14px', background: T.card2, borderRadius: 12,
            }}>
              <span style={{ ...type.small, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.fx.homeTeam} v {e.fx.awayTeam} — <strong style={{ color: T.ink, fontWeight: 560 }}>{label}</strong>
              </span>
              <button onClick={() => onRemove(e.id)} aria-label="Remove pick" style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: T.faint, padding: 4, display: 'inline-flex', flexShrink: 0,
              }}><XIcon size={14} strokeWidth={2} /></button>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 32, marginTop: 18, flexWrap: 'wrap' }}>
        <div>
          <div style={{ ...type.eyebrow, fontSize: 10.5 }}>Combined price</div>
          <div style={{ ...type.num, fontSize: 22, fontWeight: 600, color: T.ink, marginTop: 4 }}>
            {combinedOdds ? combinedOdds.toFixed(2) : '—'}
          </div>
        </div>
        <div>
          <div style={{ ...type.eyebrow, fontSize: 10.5 }}>Chance it all lands</div>
          <div style={{ ...type.num, fontSize: 22, fontWeight: 600, color: T.sub, marginTop: 4 }}>
            {(combinedProb * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      {warnings.length > 0 ? (
        <div style={{ marginTop: 16, padding: '14px 18px', background: T.badBg, borderRadius: 14 }}>
          <div style={{ ...type.small, fontWeight: 560, color: T.bad }}>
            These picks overlap — the combined chance above is too optimistic.
          </div>
          {[...new Set(warnings)].map((w, i) => (
            <div key={i} style={{ ...type.small, marginTop: 5 }}>{w}</div>
          ))}
          <div style={{ ...type.small, color: T.faint, marginTop: 8 }}>
            When picks share a team or a match, their outcomes rise and fall together. The math treats them
            as independent, so it flatters the combo. Tread carefully.
          </div>
        </div>
      ) : kellyPct != null ? (
        <div style={{ marginTop: 16, padding: '14px 18px', background: T.goodBg, borderRadius: 14 }}>
          <span style={{ ...type.title, fontSize: 19, color: T.good }}>~{kellyPct}%</span>
          <span style={{ ...type.small, marginLeft: 8 }}>of your pot would be a disciplined stake on this combo (half-Kelly).</span>
        </div>
      ) : (
        <div style={{ ...type.small, color: T.faint, marginTop: 14 }}>
          Add picks that have live prices and we'll size a stake for the combo.
        </div>
      )}
    </Card>
  )
}

function BestBetsScreen({ fixtures, analysisCache, onOpen, comboSelections, onToggleCombo, onClearCombo }) {
  const entries = useMemo(
    () => Object.entries(analysisCache)
      .map(([id, a]) => {
        const fx = fixtures.find(f => String(f.id) === String(id))
        return { id: fx?.id ?? id, fx, a }
      })
      .filter(e => e.fx)
      .sort((x, y) => (y.a.recommendation?.confidence || 0) - (x.a.recommendation?.confidence || 0)),
    [fixtures, analysisCache]
  )

  const strong = entries.filter(e => (e.a.recommendation?.confidence || 0) >= 0.65)
  const rest = entries.filter(e => (e.a.recommendation?.confidence || 0) < 0.65)

  if (!entries.length) {
    return (
      <div>
        <Reveal>
          <div style={{ padding: '28px 0 8px' }}>
            <div style={{ ...type.display, fontSize: 38, color: T.ink }}>Best bets.</div>
            <div style={{ ...type.body, fontSize: 17, color: T.sub, marginTop: 12, maxWidth: 520 }}>
              Nothing here yet — this page fills up as you have matches read. The strongest verdicts
              rise to the top on their own.
            </div>
          </div>
        </Reveal>
        <Reveal delay={0.08}>
          <Card style={{ padding: 32, marginTop: 26 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
              {[
                ['Pick a match', 'Open any fixture on the Matches page and tap “Read this match for me”.'],
                ['Three angles, one verdict', 'Form, history, and the market each weigh in; a final pass reconciles them — especially when they disagree.'],
                ['Strong reads land here', 'Anything we’re at least 65% sure about surfaces on this page, ready to combine.'],
              ].map(([t, d], i) => (
                <div key={i} style={{ display: 'flex', gap: 16 }}>
                  <span style={{
                    fontFamily: T.sans, fontSize: 14, fontWeight: 620, color: T.accent,
                    width: 28, height: 28, borderRadius: '50%', background: T.accentBg, flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>{i + 1}</span>
                  <div>
                    <div style={{ ...type.small, fontSize: 14.5, fontWeight: 560, color: T.ink }}>{t}</div>
                    <div style={{ ...type.small, marginTop: 3 }}>{d}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </Reveal>
      </div>
    )
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      <Reveal>
        <div style={{ padding: '28px 0 8px' }}>
          <div style={{ ...type.display, fontSize: 38, color: T.ink }}>Best bets.</div>
          <div style={{ ...type.body, fontSize: 17, color: T.sub, marginTop: 12 }}>
            {strong.length > 0
              ? <>Our {strong.length === 1 ? 'strongest current read' : `${strong.length} strongest current reads`}, best first.</>
              : 'Everything we’ve read so far — nothing has cleared our confidence bar yet.'}
          </div>
        </div>
      </Reveal>

      {strong.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 26 }}>
          {strong.map((e, i) => (
            <Reveal key={e.id} delay={Math.min(i * 0.05, 0.2)}>
              <BetCard entry={e} onOpen={onOpen}
                comboActive={comboSelections.includes(e.id)} onToggleCombo={onToggleCombo} />
            </Reveal>
          ))}
        </div>
      )}

      {rest.length > 0 && (
        <div style={{ marginTop: 40 }}>
          <Reveal><Eyebrow style={{ marginBottom: 14 }}>Weaker leans — read, but not convinced</Eyebrow></Reveal>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {rest.map(e => (
              <Reveal key={e.id}>
                <BetCard entry={e} onOpen={onOpen}
                  comboActive={comboSelections.includes(e.id)} onToggleCombo={onToggleCombo} />
              </Reveal>
            ))}
          </div>
        </div>
      )}

      <ComboSlip selections={comboSelections} entries={entries} onRemove={onToggleCombo} onClear={onClearCombo} />
    </div>
  )
}

/* ============================================================
 * FOLLOWING
 * ============================================================ */

function Countdown({ kickoffDate }) {
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force(x => x + 1), 60000)
    return () => clearInterval(id)
  }, [])
  const diff = new Date(kickoffDate).getTime() - Date.now()
  if (diff <= 0) return null
  const totalMin = Math.floor(diff / 60000)
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin - days * 1440) / 60)
  const mins = totalMin - days * 1440 - hours * 60
  const parts = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
  return <span style={{ ...type.small, fontSize: 12.5, color: T.faint }}>kicks off in {parts}</span>
}

function FollowCard({ fixture: f, analysis: a, onOpen, onToggleTrack, onResolve, section }) {
  const isLive = section === 'live'
  const isDone = section === 'done'
  const hasScore = f.goalsHome != null && f.goalsAway != null
  return (
    <Card className="iq-lift" onClick={() => onOpen(f)} style={{ padding: 22, cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
            <Crest src={f.homeLogo} name={f.homeTeam} size={20} />
            <span style={{ ...type.small, fontSize: 14, fontWeight: 560, color: T.ink }}>{f.homeTeam}</span>
            {hasScore
              ? <span style={{ ...type.num, fontSize: 15, fontWeight: 600, color: isLive ? T.live : T.ink }}>{f.goalsHome}–{f.goalsAway}</span>
              : <span style={{ color: T.faint, fontSize: 13 }}>v</span>}
            <Crest src={f.awayLogo} name={f.awayTeam} size={20} />
            <span style={{ ...type.small, fontSize: 14, fontWeight: 560, color: T.ink }}>{f.awayTeam}</span>
          </div>
          <div style={{ marginTop: 6, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ ...type.small, color: T.faint, fontSize: 12 }}>{f.competition}</span>
            {isLive && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: T.live, fontSize: 12, fontWeight: 600 }}><LiveDot size={6} /> {isHalfTime(f) ? 'half-time' : 'live'}</span>}
            {section === 'soon' && <Countdown kickoffDate={f.kickoffDate} />}
            {isDone && <span style={{ ...type.small, fontSize: 12, color: T.faint }}>full time</span>}
          </div>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onToggleTrack(f.id) }}
          aria-label="Unfollow" style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: T.accent, padding: 4, display: 'inline-flex',
          }}><Heart size={17} strokeWidth={1.8} fill="currentColor" /></button>
      </div>

      {a && (
        <div style={{
          marginTop: 14, padding: '11px 16px', background: T.card2, borderRadius: 12,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <span style={{ ...type.small, color: T.ink }}>
            We said <strong style={{ fontWeight: 560 }}>{pickShort(a.recommendation.pick, f)}</strong>
            <span style={{ color: T.faint }}> · {Math.round((a.recommendation.confidence || 0) * 100)}% sure</span>
          </span>
          {a.resolved && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontSize: 12.5, fontWeight: 560, fontFamily: T.sans,
              color: a.correct ? T.good : T.bad,
            }}>
              {a.correct ? <Check size={13} strokeWidth={2.2} /> : <XIcon size={12} strokeWidth={2.2} />}
              {a.correct ? 'We were right' : 'We were wrong'}
            </span>
          )}
        </div>
      )}

      {isDone && a && !a.resolved && onResolve && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ ...type.small, fontSize: 12.5 }}>Did the pick land?</span>
          <Button kind="soft" style={{ padding: '5px 15px', fontSize: 12 }}
            onClick={(e) => { e.stopPropagation(); onResolve(f.id, true) }}>Yes</Button>
          <Button kind="ghost" style={{ padding: '5px 15px', fontSize: 12 }}
            onClick={(e) => { e.stopPropagation(); onResolve(f.id, false) }}>No</Button>
        </div>
      )}
    </Card>
  )
}

function FollowingScreen({ fixtures, tracked, analysisCache, onOpen, onToggleTrack, onGoMatches, onResolve }) {
  const list = useMemo(() => fixtures.filter(f => tracked.has(f.id)), [fixtures, tracked])
  const live = list.filter(f => f.status === 'IN_PLAY' || f.status === 'LIVE')
  const soon = list.filter(f => f.status === 'SCHEDULED' || f.status === 'TIMED')
  const done = list.filter(f => f.status === 'FINISHED')

  return (
    <div>
      <Reveal>
        <div style={{ padding: '28px 0 8px' }}>
          <div style={{ ...type.display, fontSize: 38, color: T.ink }}>Following.</div>
          <div style={{ ...type.body, fontSize: 17, color: T.sub, marginTop: 12 }}>
            Matches you've marked with a heart live here.
          </div>
        </div>
      </Reveal>

      {list.length === 0 ? (
        <Reveal delay={0.08}>
          <Card style={{ marginTop: 26 }}>
            <EmptyNote title="You're not following anything yet"
              hint="Tap the heart on any match to keep it close — live scores and your verdicts collect here."
              action={<Button kind="soft" onClick={onGoMatches}>Browse matches</Button>} />
          </Card>
        </Reveal>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32, marginTop: 26 }}>
          {[['Playing now', live, 'live'], ['Coming up', soon, 'soon'], ['Finished', done, 'done']].map(([title, arr, sec]) =>
            arr.length > 0 && (
              <Reveal key={sec}>
                <Eyebrow style={{ marginBottom: 12, color: sec === 'live' ? T.live : undefined }}>{title}</Eyebrow>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {arr.map(f => (
                    <FollowCard key={f.id} fixture={f} analysis={analysisCache[f.id]}
                      onOpen={onOpen} onToggleTrack={onToggleTrack} onResolve={onResolve} section={sec} />
                  ))}
                </div>
              </Reveal>
            )
          )}
        </div>
      )}
    </div>
  )
}

/* ============================================================
 * TRACK RECORD — honest accuracy
 * ============================================================ */

/* Fewer than five settled predictions is not a record, it's noise — the same
 * threshold the profile page already uses before it will print an accuracy
 * figure. Below it, say so plainly rather than render a precise-looking number. */
const MIN_SETTLED = 5

function RecordScreen({
  fixtures, analysisCache, onResolve, onOpen,
  verifiedRecord, agentAccuracy, calibration,
}) {
  const [openResolve, setOpenResolve] = useState(null)

  const entries = useMemo(() =>
    Object.entries(analysisCache)
      .map(([id, a]) => ({ id, a, fx: fixtures.find(f => String(f.id) === String(id)) }))
      .sort((x, y) => (y.a._ts || 0) - (x.a._ts || 0)),
    [fixtures, analysisCache])

  /* Look-backs are still shown in the list below — the reader keeps seeing what
   * was read — but they are never counted. `countsTowardRecord` checks each
   * entry against its own fixture's kick-off, which catches the entries written
   * before the retrospective stamp existed as well as the stamped ones. */
  const resolved = entries.filter(e => countsTowardRecord(e.a, e.fx))
  const correct = resolved.filter(e => e.a.correct).length
  const winRate = resolved.length >= 3 ? Math.round((correct / resolved.length) * 100) : null

  const last10 = [...resolved]
    .sort((a, b) => (a.a.resolvedAt || 0) - (b.a.resolvedAt || 0))
    .slice(-10)

  const edges = entries.map(e => e.a.recommendation?.value_edge || 0)
  const avgEdge = edges.length ? edges.reduce((s, x) => s + x, 0) / edges.length : 0

  /* Calibration comes from the ledger via getCalibration(), not from
   * analysisCache — the ledger is the permanent, server-side record and survives
   * a cleared browser. Null until the query returns; empty until it has rows. */
  const buckets = calibration || []
  const settled = verifiedRecord?.count ?? 0
  // Null means the query is still in flight — don't flash "0 of 5" at someone
  // who actually has a record.
  const ledgerLoading = verifiedRecord == null || calibration == null
  const enoughSettled = !ledgerLoading && settled >= MIN_SETTLED

  const agents = [
    { key: 'form', label: 'Form', sub: 'recent results and momentum' },
    { key: 'tactical', label: 'History & matchup', sub: 'head-to-head patterns' },
    { key: 'market', label: 'Market', sub: 'price and value signals' },
  ]

  return (
    <div>
      <Reveal>
        <div style={{ padding: '28px 0 8px' }}>
          <div style={{ ...type.display, fontSize: 38, color: T.ink }}>Track record.</div>
          <div style={{ ...type.body, fontSize: 17, color: T.sub, marginTop: 12, maxWidth: 560 }}>
            The honest ledger. Every verdict we've written, whether it landed, and whether our
            confidence has been worth trusting.
          </div>
        </div>
      </Reveal>

      {/* Verified record — pulled directly from the Supabase ledger, shown
          alongside the analysisCache numbers as a redundant correctness check */}
      {verifiedRecord && verifiedRecord.count > 0 && (
        <Reveal delay={0.04}>
          <Card className="iq-elevated" style={{ padding: 24, marginTop: 26 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <Eyebrow style={{ color: T.accent }}>Verified record</Eyebrow>
                <div style={{ ...type.small, fontSize: 13, marginTop: 6 }}>
                  Straight from your permanent ledger — {verifiedRecord.correct} right of {verifiedRecord.count} settled.
                </div>
              </div>
              <div style={{ ...type.display, fontSize: 34, color: T.ink, fontVariantNumeric: 'tabular-nums' }}>
                {verifiedRecord.winRate == null ? '—' : `${verifiedRecord.winRate}%`}
              </div>
            </div>
          </Card>
        </Reveal>
      )}

      {/* Headline */}
      <Reveal delay={0.06}>
        <Card style={{ padding: 34, marginTop: 26 }}>
          <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <Eyebrow>Verdicts that landed</Eyebrow>
              <div style={{ ...type.display, fontSize: 54, lineHeight: 1, marginTop: 10,
                color: winRate == null ? T.faint : winRate >= 55 ? T.good : winRate >= 45 ? T.ink : T.bad }}>
                {winRate == null ? '—' : `${winRate}%`}
              </div>
              <div style={{ ...type.small, marginTop: 8 }}>
                {resolved.length === 0
                  ? 'No settled matches yet.'
                  : winRate == null
                  ? `Only ${resolved.length} settled so far — too few to judge honestly.`
                  : `${correct} right out of ${resolved.length} settled${resolved.length < 10 ? ' — still a small sample, take it lightly' : ''}.`}
              </div>
            </div>
            <div>
              <Eyebrow>Verdicts written</Eyebrow>
              <div style={{ ...type.num, fontSize: 28, fontWeight: 600, color: T.ink, marginTop: 10 }}>{entries.length}</div>
            </div>
            <div>
              <Eyebrow>Average pricing edge</Eyebrow>
              <div style={{ ...type.num, fontSize: 28, fontWeight: 600, marginTop: 10,
                color: avgEdge > 0 ? T.good : avgEdge < 0 ? T.bad : T.ink }}>
                {edges.length ? `${avgEdge >= 0 ? '+' : ''}${avgEdge.toFixed(1)}` : '—'}
              </div>
            </div>
          </div>

          {last10.length > 0 && (
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${T.line}` }}>
              <Eyebrow style={{ marginBottom: 10 }}>The last {last10.length}, oldest first</Eyebrow>
              <div style={{ display: 'flex', gap: 7 }}>
                {last10.map((e, i) => (
                  <span key={i} title={e.a.correct ? 'Right' : 'Wrong'} style={{
                    width: 14, height: 14, borderRadius: '50%',
                    background: e.a.correct ? T.good : T.bad,
                  }} />
                ))}
              </div>
            </div>
          )}
        </Card>
      </Reveal>

      {/* Calibration — plain words */}
      <Reveal>
        <Card style={{ padding: 30, marginTop: 18 }}>
          <Eyebrow>Is our confidence honest?</Eyebrow>
          <div style={{ ...type.small, marginTop: 10 }}>
            When we say we're 70% sure, we should be right about 70% of the time. Here's how that's held up:
          </div>
          {!enoughSettled ? (
            <div style={{ ...type.small, color: T.faint, marginTop: 16 }}>
              {ledgerLoading
                ? 'Reading your ledger…'
                : `Building a record — ${settled} of ${MIN_SETTLED} settled. This chart stays hidden until there's enough for it to mean anything.`}
            </div>
          ) : (
          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {buckets.map(b => (
              <div key={b.key} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 92px', gap: 12, alignItems: 'center' }}>
                <span style={{ ...type.small, fontWeight: 560, color: T.ink }}>
                  "{b.key}% sure"
                </span>
                <div style={{ height: 6, background: T.card2, borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{
                    width: `${b.rate ?? 0}%`, height: '100%',
                    background: b.rate == null ? 'transparent' : T.accent, borderRadius: 999,
                  }} />
                </div>
                <span style={{ ...type.num, fontSize: 13, color: b.rate == null ? T.faint : T.ink, textAlign: 'right' }}>
                  {b.rate == null ? `no data` : `${b.rate}% right`}
                  <span style={{ color: T.faint }}> · {b.n}</span>
                </span>
              </div>
            ))}
          </div>
          )}
        </Card>
      </Reveal>

      {/* Agent scoreboard — from the ledger's prediction_agents rows */}
      <Reveal>
        <Card style={{ padding: 30, marginTop: 18 }}>
          <Eyebrow>Which of our three angles has been sharpest?</Eyebrow>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {agents.map(row => {
              /* getAgentAccuracy() returns { correct, total, rate } per agent,
               * counted server-side over resolved predictions with abstentions
               * excluded. Each agent is held to the same five-settled threshold
               * as the rest of the app before a percentage is shown. */
              const s = agentAccuracy?.[row.key] || { correct: 0, total: 0, rate: null }
              const rate = s.total >= MIN_SETTLED ? s.rate : null
              return (
                <div key={row.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                  <span style={{ ...type.small }}>
                    <strong style={{ color: T.ink, fontWeight: 560 }}>{row.label}</strong>
                    <span style={{ color: T.faint }}> — {row.sub}</span>
                  </span>
                  <span style={{ ...type.num, fontSize: 14, fontWeight: 600, flexShrink: 0,
                    color: rate == null ? T.faint : rate >= 60 ? T.good : rate >= 45 ? T.ink : T.bad }}>
                    {rate == null
                      ? (agentAccuracy == null ? '—' : `Building a record · ${s.total}/${MIN_SETTLED}`)
                      : `${rate}%`}
                    {rate != null && <span style={{ color: T.faint, fontWeight: 400 }}> · {s.correct}/{s.total}</span>}
                  </span>
                </div>
              )
            })}
          </div>
        </Card>
      </Reveal>

      {/* History */}
      <div style={{ marginTop: 36 }}>
        <Reveal><Eyebrow style={{ marginBottom: 14 }}>Every verdict, newest first</Eyebrow></Reveal>
        {entries.length === 0 ? (
          <Card><EmptyNote title="The ledger is empty" hint="Have a match read and it will be recorded here — wins and losses alike." /></Card>
        ) : (
          <Reveal>
            <Card style={{ overflow: 'hidden' }}>
              {entries.map(({ id, a, fx }, idx) => {
                const r = a.recommendation || {}
                const conf = Math.round((r.confidence || 0) * 100)
                const isOpen = openResolve === id
                return (
                  <div key={id} style={{ borderBottom: idx < entries.length - 1 || isOpen ? `1px solid ${T.line}` : 'none' }}>
                    <div className="iq-row"
                      onClick={() => fx && onOpen(fx)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '15px 22px', cursor: fx ? 'pointer' : 'default',
                      }}>
                      <Crest src={fx?.homeLogo} name={fx?.homeTeam || '?'} size={22} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ ...type.small, fontSize: 14, fontWeight: 560, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {fx ? `${fx.homeTeam} v ${fx.awayTeam}` : `Match #${id}`}
                        </div>
                        <div style={{ ...type.small, fontSize: 12, color: T.faint, marginTop: 2 }}>
                          Said {fx ? pickShort(r.pick, fx) : r.pick} · {conf}% sure
                          {a.finalScore ? ` · ended ${a.finalScore}` : ''}
                        </div>
                      </div>
                      {a.resolved ? (
                        <span style={{
                          fontSize: 12, fontWeight: 560, fontFamily: T.sans, flexShrink: 0,
                          color: a.correct ? T.good : T.bad,
                          background: a.correct ? T.goodBg : T.badBg,
                          borderRadius: 999, padding: '4px 12px',
                        }}>{a.correct ? 'Right' : 'Wrong'}</span>
                      ) : (
                        <button onClick={(e) => { e.stopPropagation(); setOpenResolve(isOpen ? null : id) }} style={{
                          background: 'transparent', border: `1px solid ${T.lineHi}`, borderRadius: 999,
                          padding: '4px 13px', cursor: 'pointer', flexShrink: 0,
                          fontFamily: T.sans, fontSize: 12, fontWeight: 560, color: T.sub,
                        }}>Settle</button>
                      )}
                    </div>
                    {isOpen && (
                      <div style={{ padding: '10px 22px 18px', background: T.card2, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ ...type.small }}>Was the pick right?</span>
                        <Button kind="soft" style={{ padding: '5px 16px', fontSize: 12, background: T.card }}
                          onClick={() => { onResolve(id, true); setOpenResolve(null) }}>Yes</Button>
                        <Button kind="ghost" style={{ padding: '5px 16px', fontSize: 12 }}
                          onClick={() => { onResolve(id, false); setOpenResolve(null) }}>No</Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </Card>
          </Reveal>
        )}
      </div>
    </div>
  )
}

/* ============================================================
 * AUTH — sign in / sign up (Supabase, Google OAuth + email)
 * ============================================================ */

/* The one deliberately multi-color mark in the app: users trust the familiar
 * Google G, so it keeps its standard colors. Inline SVG, no raster asset. */
const GoogleG = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
)

function ButtonSpinner({ color = 'currentColor' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 44 44" fill="none" aria-hidden="true"
      style={{ animation: 'iq-think 1s linear infinite', display: 'block' }}>
      <circle cx="22" cy="22" r="18" stroke={color} strokeOpacity="0.25" strokeWidth="5" />
      <path d="M22 4a18 18 0 0114 6.7" stroke={color} strokeWidth="5" strokeLinecap="round" />
    </svg>
  )
}

function AuthInput({ label, type: inputType, value, onChange, autoComplete, disabled }) {
  const isPassword = inputType === 'password'
  const [show, setShow] = useState(false)
  return (
    <label style={{ display: 'block' }}>
      <span style={{ ...type.small, fontSize: 12.5, fontWeight: 560, color: T.sub, display: 'block', marginBottom: 7 }}>{label}</span>
      <span style={{ position: 'relative', display: 'block' }}>
        <input type={isPassword && show ? 'text' : inputType} value={value}
          onChange={e => onChange(e.target.value)}
          autoComplete={autoComplete} disabled={disabled} required
          style={{
            width: '100%', background: T.card2, color: T.ink,
            border: `1px solid ${T.line}`, borderRadius: 12,
            padding: isPassword ? '12px 44px 12px 15px' : '12px 15px',
            fontFamily: T.sans, fontSize: 15, outline: 'none',
          }} />
        {isPassword && (
          <button type="button" onClick={() => setShow(s => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
            style={{
              position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: T.faint, padding: 8, display: 'inline-flex',
            }}>
            {show ? <EyeOff size={16} strokeWidth={1.8} /> : <Eye size={16} strokeWidth={1.8} />}
          </button>
        )}
      </span>
    </label>
  )
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function BackArrow({ onClick }) {
  return (
    <button onClick={onClick} aria-label="Back" style={{
      background: 'transparent', border: 'none', cursor: 'pointer', color: T.faint,
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 0',
      fontFamily: T.sans, fontSize: 14, fontWeight: 500, marginBottom: 18,
    }}><ChevronLeft size={17} strokeWidth={1.8} /> Back</button>
  )
}

/* Real-time password guidance — honest tiers, no theatrics */
function passwordScore(pw) {
  if (!pw) return 0
  let s = 0
  if (pw.length >= 8) s += 1
  if (pw.length >= 12) s += 1
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s += 1
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) s += 1
  if (pw.length < 8) s = Math.min(s, 1)
  return Math.min(4, s)
}

function PasswordStrength({ password }) {
  if (!password) return null
  const score = passwordScore(password)
  const [label, color] = [
    ['Too short', T.faint], ['Weak', T.bad], ['Okay', T.sub], ['Good', T.good], ['Strong', T.good],
  ][score]
  return (
    <div aria-live="polite" style={{ marginTop: -6 }}>
      <div style={{ display: 'flex', gap: 5 }}>
        {[1, 2, 3, 4].map(i => (
          <span key={i} style={{
            flex: 1, height: 4, borderRadius: 999,
            background: i <= score ? color : T.card2,
            transition: `background 250ms ${T.ease}`,
          }} />
        ))}
      </div>
      <div style={{ ...type.small, fontSize: 12, color, marginTop: 6 }}>
        {label}{score < 3 && ' — 8+ characters with a mix of cases and numbers goes a long way'}
      </div>
    </div>
  )
}

/* Single, ceremony-free way in. Google OAuth handles new and returning users
 * identically (Supabase creates the account on first sign-in), so there's one
 * screen and one action — no sign-in/sign-up split, no email/password form.
 * Email auth still lives in lib/auth.js, unused, for a future re-enable.
 *
 * Deliberately flat: pure black/white page, no glass, blur, or shadow. The
 * rest of the app keeps the glass system; this pre-auth screen does not. */
function AuthScreen({ theme, onBack, initialError, onClearInitialError }) {
  const [busy, setBusy] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [error, setError] = useState(null)
  const googleTimer = useRef(null)
  useEffect(() => () => clearTimeout(googleTimer.current), [])

  const shownError = error || initialError
  const dark = theme === 'dark'

  // Flat palette — pure page, mid-gray muted text, a button defined by a solid
  // border (and a hair-lighter fill in dark mode so it reads off pure black).
  const pageBg = dark ? '#000000' : '#FFFFFF'
  const textColor = dark ? '#FFFFFF' : '#000000'
  const muted = '#6E6E6E'
  const btnBg = pressed || hovered
    ? (dark ? '#161616' : '#F2F2F2')
    : (dark ? '#0A0A0A' : '#FFFFFF')
  const btnBorder = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'
  const colorTween = 'background-color 200ms ease, color 200ms ease'

  async function handleGoogle() {
    if (busy) return // double-click guard — state disables the button one render later
    setBusy(true); setError(null); onClearInitialError?.()
    try {
      const { error: err } = await signInWithGoogle()
      if (err) { setError(friendlyAuthError(err.message)); setBusy(false); return }
      // Success normally navigates away. If the user cancels mid-redirect or the
      // navigation never happens, don't spin forever — reset with a clear message.
      googleTimer.current = setTimeout(() => {
        setBusy(b => {
          if (b) { setError('Sign-in was cancelled — please try again.'); return false }
          return b
        })
      }, 10000)
    } catch (e) {
      setError(friendlyAuthError(e.message)); setBusy(false)
    }
  }

  return (
    // Full-bleed flat layer. Its own data-theme + pure inline background paints
    // over the app's themed base; background/text ease on theme change (200ms).
    <div data-theme={theme} style={{
      minHeight: '100dvh', width: '100%', display: 'grid', placeItems: 'center',
      padding: 'calc(48px + env(safe-area-inset-top, 0px)) 20px calc(56px + env(safe-area-inset-bottom, 0px))',
      background: pageBg, color: textColor, transition: colorTween,
    }}>
      <GlobalStyles />
      {/* Entrance: a calm fade + gentle upward drift, no scale or blur. */}
      <motion.div
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.34, ease: 'easeOut' }}
        style={{ width: '100%', maxWidth: 400, margin: '0 auto', textAlign: 'center' }}>
        {onBack && <BackArrow onClick={onBack} />}

        <div style={{ display: 'flex', justifyContent: 'center', color: textColor, marginBottom: 32 }}>
          <LogoMark size={40} />
        </div>
        <h1 style={{
          ...type.display, fontSize: 30, color: textColor, margin: '0 0 12px',
          lineHeight: 1.15, transition: colorTween,
        }}>
          Sign in with Google to continue
        </h1>
        <div style={{
          ...type.small, fontSize: 14.5, color: muted, margin: '0 auto 30px', maxWidth: 320,
        }}>
          The fastest, most secure way in — more sign-in options are coming soon.
        </div>

        <button
          onClick={handleGoogle} disabled={busy}
          onPointerDown={() => setPressed(true)}
          onPointerUp={() => setPressed(false)}
          onPointerLeave={() => { setPressed(false); setHovered(false) }}
          onPointerEnter={() => setHovered(true)}
          style={{
            width: '100%', background: btnBg, color: textColor,
            border: `1px solid ${btnBorder}`, borderRadius: 14, padding: '15px 22px',
            fontFamily: T.sans, fontSize: 15.5, fontWeight: 560,
            cursor: busy ? 'default' : 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 11,
            transform: pressed && !busy ? 'scale(0.97)' : 'scale(1)',
            transition: `transform 130ms ease, background-color 160ms ease, color 200ms ease`,
          }}>
          <AnimatePresence mode="wait" initial={false}>
            {busy ? (
              <motion.span key="spin" style={{ display: 'inline-flex' }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}>
                <ButtonSpinner color={textColor} />
              </motion.span>
            ) : (
              <motion.span key="label" style={{ display: 'inline-flex', alignItems: 'center', gap: 11 }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}>
                <GoogleG size={19} /> Continue with Google
              </motion.span>
            )}
          </AnimatePresence>
        </button>

        <AnimatePresence>
          {shownError && (
            <motion.div role="alert" key="err"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              style={{ ...type.small, fontSize: 13.5, color: '#D46A6A', marginTop: 18 }}>
              {shownError}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

/* ============================================================
 * PASSWORD RESET — request + email-link landing
 * ============================================================ */

function ForgotPasswordScreen({ onBack }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const { error: err } = await resetPasswordForEmail(email.trim())
      if (err) setError(friendlyAuthError(err.message))
      else setSent(true)
    } catch (e2) {
      setError(friendlyAuthError(e2.message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ width: '100%', maxWidth: 400, margin: '0 auto' }}>
      <BackArrow onClick={onBack} />
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
        <Wordmark size={24} />
      </div>
      <h1 style={{ ...type.display, fontSize: 32, color: T.ink, textAlign: 'center', margin: '0 0 8px' }}>
        Reset your password
      </h1>
      <div style={{ ...type.small, fontSize: 14.5, textAlign: 'center', marginBottom: 26 }}>
        Tell us your email and we'll send you a link to set a new one.
      </div>
      <Card className="iq-elevated" style={{ padding: 28 }}>
        {sent ? (
          <div style={{ textAlign: 'center', padding: '18px 4px' }}>
            <div style={{ ...type.title, fontSize: 19, color: T.ink }}>Check your email.</div>
            <div style={{ ...type.small, marginTop: 10 }}>
              If an account exists for <strong style={{ color: T.ink, fontWeight: 560 }}>{email}</strong>,
              a reset link is on its way. Follow it and you'll be asked to choose a new password.
            </div>
            <div style={{ ...type.small, fontSize: 12.5, color: T.faint, marginTop: 12 }}>
              Nothing arriving? Give it a minute or check your spam folder.
            </div>
            <button onClick={onBack} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              ...type.small, color: T.accent, fontWeight: 560, marginTop: 18,
            }}>Back to sign in</button>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <AuthInput label="Email" type="email" value={email} onChange={setEmail}
              autoComplete="email" disabled={busy} />
            <Button kind="primary" disabled={busy}
              style={{ width: '100%', padding: '13px 22px', fontSize: 15, marginTop: 4 }}
              onClick={() => {}}>
              {busy ? <ButtonSpinner /> : 'Send reset link'}
            </Button>
            {error && (
              <div role="alert" style={{
                ...type.small, fontSize: 13.5, color: T.bad, background: T.badBg,
                borderRadius: 12, padding: '11px 15px',
              }}>{error}</div>
            )}
          </form>
        )}
      </Card>
    </div>
  )
}

/* Where the reset email's link lands: the user is in a recovery session and
 * must choose a new password before entering the app. */
function ResetPasswordScreen({ theme, onDone }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (passwordScore(password) < 2) {
      setError('That password is a little thin — 8+ characters with a mix of cases and numbers keeps you safe.')
      return
    }
    setBusy(true); setError(null)
    try {
      const { error: err } = await updatePassword(password)
      if (err) { setError(friendlyAuthError(err.message)); setPassword('') }
      else onDone()
    } catch (e2) {
      setError(friendlyAuthError(e2.message)); setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-theme={theme} style={{
      minHeight: '100dvh', width: '100%', display: 'grid', placeItems: 'center',
      padding: '32px 20px', position: 'relative', zIndex: 1,
    }}>
      <GlobalStyles />
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
          <Wordmark size={24} />
        </div>
        <h1 style={{ ...type.display, fontSize: 32, color: T.ink, textAlign: 'center', margin: '0 0 8px' }}>
          Set a new password
        </h1>
        <div style={{ ...type.small, fontSize: 14.5, textAlign: 'center', marginBottom: 26 }}>
          Choose something strong — you'll use it from now on.
        </div>
        <Card className="iq-elevated" style={{ padding: 28 }}>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <AuthInput label="New password" type="password" value={password} onChange={setPassword}
              autoComplete="new-password" disabled={busy} />
            <PasswordStrength password={password} />
            <Button kind="primary" disabled={busy}
              style={{ width: '100%', padding: '13px 22px', fontSize: 15, marginTop: 4 }}
              onClick={() => {}}>
              {busy ? <ButtonSpinner /> : 'Save and continue'}
            </Button>
            {error && (
              <div role="alert" style={{
                ...type.small, fontSize: 13.5, color: T.bad, background: T.badBg,
                borderRadius: 12, padding: '11px 15px',
              }}>{error}</div>
            )}
          </form>
        </Card>
      </motion.div>
    </div>
  )
}

/* ============================================================
 * ONBOARDING — welcome → how it works → create account
 * ============================================================ */

const LS_ONBOARD = 'matchiq_onboarding_seen'

/* Abstract backdrop for the signed-out screens — large soft neutral-white
 * forms, slowly breathing, arranged differently per step so each screen has
 * its own character. Crossfades with the step change so the whole screen
 * moves as one. Pure gradient light: no photography, no extra colors. */
const BACKDROP_SCENES = {
  welcome: [
    { left: '50%', top: '-12%', size: 640, tint: 16, dur: 11 },
    { left: '82%', top: '78%', size: 400, tint: 8, dur: 14 },
  ],
  how: [
    { left: '10%', top: '16%', size: 480, tint: 12, dur: 12 },
    { left: '90%', top: '70%', size: 520, tint: 10, dur: 15 },
  ],
  auth: [
    { left: '18%', top: '85%', size: 560, tint: 12, dur: 13 },
    { left: '85%', top: '8%', size: 380, tint: 8, dur: 11 },
  ],
  signin: [
    { left: '50%', top: '105%', size: 680, tint: 12, dur: 14 },
  ],
  reset: [
    { left: '8%', top: '30%', size: 460, tint: 10, dur: 13 },
  ],
}

function OnboardingBackdrop({ stage }) {
  const reduce = useReducedMotion()
  const scene = BACKDROP_SCENES[stage] || BACKDROP_SCENES.welcome
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <AnimatePresence>
        <motion.div key={stage}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.9, ease: 'easeInOut' }}
          style={{ position: 'absolute', inset: 0 }}>
          {scene.map((b, i) => (
            <motion.span key={i}
              animate={reduce ? undefined : { y: [0, -18, 0], scale: [1, 1.06, 1] }}
              transition={reduce ? undefined : { duration: b.dur, repeat: Infinity, ease: 'easeInOut' }}
              style={{
                position: 'absolute', left: b.left, top: b.top,
                width: b.size, height: b.size, marginLeft: -b.size / 2, marginTop: -b.size / 2,
                borderRadius: '50%',
                // Neutral ambient glow — white, not accent-tinted, so the
                // signed-out backdrop carries no colour of its own.
                background: `radial-gradient(circle, color-mix(in oklab, #FFFFFF ${b.tint}%, transparent), transparent 70%)`,
              }} />
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/* Liquid-Glass materialization entrance — the surface condenses into place:
 * blur sharpens in alongside a fade and a slight scale, rather than a flat
 * fade. Reserved for genuine entrances of significant glass surfaces (modals,
 * the verdict card, onboarding step cards), never routine state changes.
 * Respects reduced-motion by falling back to a plain fade. */
function Materialize({ children, delay = 0, style, className, onClick }) {
  const reduce = useReducedMotion()
  return (
    <motion.div style={style} className={className} onClick={onClick}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, filter: 'blur(8px)' }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, filter: 'blur(0px)' }}
      transition={{ duration: 0.38, delay, ease: 'easeOut' }}>
      {children}
    </motion.div>
  )
}

/* Staggered arrival for onboarding content — each block rises in turn */
function Arrive({ children, order = 0, style }) {
  return (
    <motion.div style={style}
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: order * 0.09, ease: 'easeOut' }}>
      {children}
    </motion.div>
  )
}

function WelcomeScreen({ onStart, onSignIn, isMobile }) {
  return (
    <div style={{ textAlign: 'center', maxWidth: 460, margin: '0 auto' }}>
      <Arrive order={0}>
        <div style={{ display: 'flex', justifyContent: 'center', color: T.ink, marginBottom: 44 }}>
          <LogoMark size={40} />
        </div>
      </Arrive>
      <Arrive order={1}>
        <h1 style={{ ...type.display, fontSize: isMobile ? 38 : 46, color: T.ink, margin: 0 }}>
          Predictions worth trusting
        </h1>
      </Arrive>
      <Arrive order={2}>
        <div style={{ ...type.body, fontSize: 17.5, color: T.sub, marginTop: 20, maxWidth: 400, marginLeft: 'auto', marginRight: 'auto' }}>
          AI analysis that shows its reasoning, for football matches happening today.
        </div>
      </Arrive>
      <Arrive order={3}>
        <div style={{ marginTop: 48 }}>
          <Button onClick={onStart} style={{
            padding: '15px 30px', fontSize: 16,
            width: isMobile ? '100%' : 260,
          }}>Get started</Button>
        </div>
        <button onClick={onSignIn} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          ...type.small, color: T.sub, marginTop: 24,
        }}>
          Already have an account? <span style={{ color: T.accent, fontWeight: 560 }}>Sign in</span>
        </button>
      </Arrive>
    </div>
  )
}

const HOW_CARDS = [
  ['Three views on every match',
    'Our system reads each match from three angles — form, tactics, and the market — separately, so their disagreements become the most useful part of the analysis.'],
  ['One clear reasoned verdict',
    'A synthesis step weighs those three views and delivers a plain-language recommendation, with the reasoning always visible.'],
  ['Honest about accuracy',
    'Every prediction is tracked against what actually happened. You see the record, not just the confidence.'],
]

function HowItWorksScreen({ onContinue, onBack, isMobile }) {
  return (
    <div style={{ maxWidth: 460, margin: '0 auto' }}>
      <BackArrow onClick={onBack} />
      <Arrive order={0}>
        <Eyebrow style={{ textAlign: 'center', marginBottom: 8 }}>How this works</Eyebrow>
        <h1 style={{ ...type.display, fontSize: isMobile ? 28 : 32, color: T.ink, textAlign: 'center', margin: '0 0 30px' }}>
          Three angles, one verdict.
        </h1>
      </Arrive>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        {HOW_CARDS.map(([heading, body], i) => (
          <Materialize key={heading} delay={0.1 + i * 0.1}>
            <Card style={{ padding: 30 }}>
              <div style={{ ...type.title, fontSize: 18, color: T.ink }}>{heading}</div>
              <div style={{ ...type.small, fontSize: 14.5, marginTop: 10 }}>{body}</div>
            </Card>
          </Materialize>
        ))}
      </div>
      <Arrive order={4}>
        <div style={{ marginTop: 36, textAlign: 'center' }}>
          <Button onClick={onContinue} style={{
            padding: '15px 30px', fontSize: 16,
            width: isMobile ? '100%' : 260,
          }}>Continue</Button>
        </div>
      </Arrive>
    </div>
  )
}

/* Routes the signed-out experience. First-time visitors walk welcome → how →
 * sign up; anyone who has signed in before (LS_ONBOARD set) goes straight to
 * sign in. Screens hand off with a gentle 250ms fade-and-slide. */
function OnboardingFlow({ theme, initialError, onClearInitialError }) {
  const isMobile = useWindowWidth() < 768
  const [stage, setStage] = useState(() =>
    (typeof window !== 'undefined' && window.localStorage.getItem(LS_ONBOARD) === 'true') ? 'auth' : 'welcome')

  // The Google sign-in screen is a flat, glass-free layer of its own — it owns
  // its full-screen pure black/white background, so it renders outside the
  // decorated welcome/how container rather than inside it.
  if (stage === 'auth') {
    return <AuthScreen theme={theme}
      onBack={() => setStage('how')}
      initialError={initialError} onClearInitialError={onClearInitialError} />
  }

  // Where the user is in the two-step introduction; null hides the dots
  const stepIndex = { welcome: 0, how: 1 }[stage] ?? null

  // Onboarding follows the device's light/dark automatically — no manual toggle.
  // The base background fills into the safe areas so the top and bottom edges
  // blend seamlessly with the phone's status bar and home-indicator regions.
  return (
    <div data-theme={theme} style={{
      minHeight: '100dvh', width: '100%', display: 'grid', placeItems: 'center',
      padding: 'calc(48px + env(safe-area-inset-top, 0px)) 20px calc(72px + env(safe-area-inset-bottom, 0px))',
      position: 'relative', zIndex: 1, overflow: 'hidden',
    }}>
      <GlobalStyles />
      <OnboardingBackdrop stage={stage} />
      <AnimatePresence mode="wait">
        <motion.div key={stage}
          initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }}
          transition={{ duration: 0.32, ease: 'easeOut' }}
          style={{ width: '100%', position: 'relative' }}>
          {stage === 'welcome' && (
            <WelcomeScreen isMobile={isMobile}
              onStart={() => setStage('how')} onSignIn={() => setStage('auth')} />
          )}
          {stage === 'how' && (
            <HowItWorksScreen isMobile={isMobile}
              onContinue={() => setStage('auth')} onBack={() => setStage('welcome')} />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Quiet sense of progression through the three-step introduction */}
      {stepIndex != null && (
        <div style={{
          position: 'absolute', bottom: 32, left: 0, right: 0,
          display: 'flex', justifyContent: 'center', gap: 8,
        }}>
          {[0, 1].map(i => (
            <span key={i} style={{
              width: i === stepIndex ? 22 : 6, height: 6, borderRadius: 999,
              background: i === stepIndex ? T.accent : T.lineHi,
              transition: `all 350ms ${T.ease}`,
            }} />
          ))}
        </div>
      )}
    </div>
  )
}

/* ============================================================
 * USERNAME — live-checked handle, used at the gate and in profile
 * ============================================================ */

function UsernameEditor({ user, currentUsername, onSaved, autoFocus }) {
  const [value, setValue] = useState(currentUsername || '')
  const [status, setStatus] = useState('idle') // idle|invalid|checking|available|taken|current
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const timer = useRef(null)

  useEffect(() => {
    setError(null)
    const v = value.trim().toLowerCase()
    if (!v) { setStatus('idle'); return }
    if (currentUsername && v === currentUsername) { setStatus('current'); return }
    if (!USERNAME_RE.test(v)) { setStatus('invalid'); return }
    setStatus('checking')
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      // Exclude the user's own row so re-saving a lightly-edited handle that
      // resolves back to theirs never falsely reads as taken.
      const ok = await isUsernameAvailable(v, user?.id)
      setStatus(cur => (cur === 'checking' ? (ok ? 'available' : 'taken') : cur))
    }, 400)
    return () => clearTimeout(timer.current)
  }, [value, currentUsername, user])

  const canSave = status === 'available'

  async function save() {
    if (!canSave || saving) return
    setSaving(true); setError(null)
    const { error: err } = await claimUsername(user.id, value.trim().toLowerCase())
    setSaving(false)
    if (err === 'taken') { setStatus('taken'); return }
    if (err) { setError('Could not save that handle — please try again.'); return }
    onSaved(value.trim().toLowerCase())
  }

  const statusLine = {
    invalid: { text: '3–20 characters: lowercase letters, numbers, periods and underscores.', color: T.faint },
    checking: { text: 'Checking availability…', color: T.faint },
    available: { text: 'Available', color: T.good },
    taken: { text: 'That handle is already taken.', color: T.bad },
    current: { text: 'This is your current handle.', color: T.faint },
  }[status]

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', background: T.card2,
        border: `1px solid ${status === 'taken' ? T.bad : status === 'available' ? T.accent : T.line}`,
        borderRadius: 12, padding: '0 14px', transition: `border-color 200ms ${T.ease}`,
      }}>
        <span style={{ ...type.body, fontSize: 16, color: T.faint, marginRight: 2 }}>@</span>
        <input
          autoFocus={autoFocus}
          value={value}
          onChange={e => setValue(e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 20))}
          placeholder="yourhandle" autoComplete="off" autoCapitalize="none" spellCheck={false}
          onKeyDown={e => { if (e.key === 'Enter') save() }}
          style={{
            flex: 1, background: 'transparent', color: T.ink, border: 'none', outline: 'none',
            fontFamily: T.mono, fontSize: 15.5, padding: '12px 8px',
          }} />
        {status === 'available' && <Check size={17} strokeWidth={2.4} style={{ color: T.accent }} />}
        {status === 'checking' && <ButtonSpinner color="var(--iq-faint)" />}
      </div>
      {statusLine && (
        <div style={{ ...type.small, fontSize: 12.5, color: statusLine.color, marginTop: 8 }}>{statusLine.text}</div>
      )}
      {error && <div style={{ ...type.small, fontSize: 12.5, color: T.bad, marginTop: 8 }}>{error}</div>}
      <Button kind="primary" disabled={!canSave || saving}
        onClick={save} style={{ width: '100%', padding: '12px 22px', fontSize: 15, marginTop: 16 }}>
        {saving ? <ButtonSpinner /> : (currentUsername ? 'Save handle' : 'Claim handle')}
      </Button>
    </div>
  )
}

/* Post-auth gate: shown to any signed-in user who has no username yet — both
 * brand-new sign-ups and existing users from before the feature existed. */
function UsernameScreen({ theme, user, onSaved }) {
  return (
    <div data-theme={theme} style={{
      minHeight: '100dvh', width: '100%', display: 'grid', placeItems: 'center',
      padding: 'calc(32px + env(safe-area-inset-top,0px)) 20px calc(32px + env(safe-area-inset-bottom,0px))',
      position: 'relative', zIndex: 1,
    }}>
      <GlobalStyles />
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }} style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 26 }}><Wordmark size={24} /></div>
        <h1 style={{ ...type.display, fontSize: 30, color: T.ink, textAlign: 'center', margin: '0 0 8px' }}>
          Pick your handle
        </h1>
        <div style={{ ...type.small, fontSize: 14.5, textAlign: 'center', marginBottom: 26 }}>
          It's how you'll be known on MatchIQ — you can change it later.
        </div>
        <Card className="iq-elevated" style={{ padding: 28 }}>
          <UsernameEditor user={user} currentUsername={null} onSaved={onSaved} autoFocus />
        </Card>
      </motion.div>
    </div>
  )
}

/* ============================================================
 * PROFILE — identity, record, preferences, sign out
 * ============================================================ */

/* Twelve original geometric avatar marks — one cohesive family built from the
 * app's accent blue plus three muted tones (indigo, teal, amber) over dark
 * tinted grounds. Each is a distinct simple composition, legible at 32–96px. */
const AV = { blue: '#2997FF', ind: '#6C6BE8', teal: '#33B7A6', amber: '#F0B24C' }
const AV_BG = { navy: '#101B33', plum: '#241633', deep: '#0E2A2A', dusk: '#1B1A3A' }
export const AVATAR_PRESET_IDS = Array.from({ length: 12 }, (_, i) => `preset_${i + 1}`)

function PresetGlyph({ id }) {
  switch (id) {
    case 'preset_1': return (<g><rect width="64" height="64" fill={AV_BG.navy}/><circle cx="32" cy="32" r="20" fill="none" stroke={AV.blue} strokeWidth="4"/><circle cx="32" cy="32" r="11" fill="none" stroke={AV.teal} strokeWidth="4"/><circle cx="32" cy="32" r="3.5" fill={AV.amber}/></g>)
    case 'preset_2': return (<g><rect width="64" height="64" fill={AV_BG.dusk}/><path d="M0 64 L64 0 L64 64 Z" fill={AV.blue}/><path d="M0 0 L0 64 L64 0 Z" fill={AV.ind} opacity="0.55"/></g>)
    case 'preset_3': return (<g><rect width="64" height="64" fill={AV_BG.deep}/><path d="M14 50 A36 36 0 0 1 50 14 L50 50 Z" fill={AV.teal}/><circle cx="22" cy="42" r="5" fill={AV.amber}/></g>)
    case 'preset_4': return (<g><rect width="64" height="64" fill={AV_BG.plum}/><path d="M32 16 L50 46 L14 46 Z" fill={AV.blue}/><path d="M32 30 L40 46 L24 46 Z" fill={AV.amber}/></g>)
    case 'preset_5': return (<g><rect width="64" height="64" fill={AV_BG.navy}/><circle cx="25" cy="32" r="16" fill={AV.blue} opacity="0.85"/><circle cx="39" cy="32" r="16" fill={AV.amber} opacity="0.7"/></g>)
    case 'preset_6': return (<g><rect width="64" height="64" fill={AV_BG.dusk}/><circle cx="24" cy="24" r="7" fill={AV.blue}/><circle cx="40" cy="24" r="7" fill={AV.teal}/><circle cx="24" cy="40" r="7" fill={AV.teal}/><circle cx="40" cy="40" r="7" fill={AV.blue}/></g>)
    case 'preset_7': return (<g><rect width="64" height="64" fill={AV_BG.navy}/><rect x="16" y="36" width="8" height="14" rx="4" fill={AV.teal}/><rect x="28" y="26" width="8" height="24" rx="4" fill={AV.blue}/><rect x="40" y="16" width="8" height="34" rx="4" fill={AV.amber}/></g>)
    case 'preset_8': return (<g><rect width="64" height="64" fill={AV_BG.deep}/><path d="M16 38 L32 24 L48 38" fill="none" stroke={AV.blue} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/><path d="M16 48 L32 34 L48 48" fill="none" stroke={AV.teal} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/></g>)
    case 'preset_9': return (<g><rect width="64" height="64" fill={AV_BG.plum}/><circle cx="32" cy="32" r="18" fill={AV.blue}/><circle cx="40" cy="28" r="15" fill={AV_BG.plum}/><circle cx="24" cy="26" r="2.5" fill={AV.amber}/></g>)
    case 'preset_10': return (<g><rect width="64" height="64" fill={AV_BG.navy}/><rect x="27" y="14" width="10" height="36" rx="5" fill={AV.amber}/><rect x="14" y="27" width="36" height="10" rx="5" fill={AV.blue} opacity="0.9"/></g>)
    case 'preset_11': return (<g><rect width="64" height="64" fill={AV_BG.dusk}/><rect x="14" y="14" width="36" height="36" rx="9" fill="none" stroke={AV.teal} strokeWidth="4"/><rect x="24" y="24" width="16" height="16" rx="5" fill={AV.blue}/></g>)
    case 'preset_12': return (<g><rect width="64" height="64" fill={AV_BG.deep}/>{[0,45,90,135,180,225,270,315].map(a => { const r=a*Math.PI/180; return <line key={a} x1={32+9*Math.cos(r)} y1={32+9*Math.sin(r)} x2={32+22*Math.cos(r)} y2={32+22*Math.sin(r)} stroke={AV.blue} strokeWidth="4" strokeLinecap="round"/> })}<circle cx="32" cy="32" r="6" fill={AV.amber}/></g>)
    default: return <rect width="64" height="64" fill={AV_BG.navy}/>
  }
}

function PresetAvatar({ id, size = 28 }) {
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', display: 'inline-flex', flexShrink: 0, border: `1px solid ${T.line}` }}>
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true"><PresetGlyph id={id} /></svg>
    </span>
  )
}

/* Resolves what to actually render: an explicit preset wins; otherwise a Google
 * user keeps their photo and everyone else falls back to the initial circle. */
function ResolvedAvatar({ user, avatarChoice, size = 28 }) {
  const effective = avatarChoice || (user?.user_metadata?.avatar_url ? 'google' : null)
  if (effective && effective.startsWith('preset_')) return <PresetAvatar id={effective} size={size} />
  return <Avatar user={user} size={size} />
}

function Avatar({ user, size = 28 }) {
  const [failed, setFailed] = useState(false)
  const url = user?.user_metadata?.avatar_url
  const initial = (user?.user_metadata?.name || user?.user_metadata?.full_name || user?.email || '?')
    .trim().charAt(0).toUpperCase() || '?'
  if (url && !failed) {
    return (
      <img src={url} alt="" onError={() => setFailed(true)} referrerPolicy="no-referrer" style={{
        width: size, height: size, borderRadius: '50%', objectFit: 'cover',
        display: 'block', border: `1px solid ${T.line}`,
      }} />
    )
  }
  return (
    <span className="iq-elevated" style={{
      width: size, height: size, borderRadius: '50%',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: T.card2, border: `1px solid ${T.line}`,
      color: T.accent, fontFamily: T.sans, fontWeight: 650, fontSize: Math.round(size * 0.42),
    }}>{initial}</span>
  )
}

function Toggle({ on, onChange }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} style={{
      width: 46, height: 28, borderRadius: 999, flexShrink: 0,
      border: `1px solid ${on ? 'transparent' : T.lineHi}`,
      background: on ? T.accent : T.card2, cursor: 'pointer', position: 'relative', padding: 0,
    }}>
      <span style={{
        position: 'absolute', top: 2, left: on ? 19 : 2, width: 22, height: 22,
        borderRadius: '50%', background: on ? T.accentInk : T.sub,
        transition: `left 200ms ${T.ease}, background 200ms ${T.ease}`,
      }} />
    </button>
  )
}

function Segmented({ value, options, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 3, background: T.card2, borderRadius: 999, padding: 3 }}>
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          background: value === o.value ? T.card : 'transparent',
          color: value === o.value ? T.ink : T.sub,
          border: 'none', boxShadow: value === o.value ? T.shadow : 'none',
          borderRadius: 999, padding: '6px 14px', cursor: 'pointer',
          fontFamily: T.sans, fontSize: 12.5, fontWeight: value === o.value ? 600 : 480,
        }}>{o.label}</button>
      ))}
    </div>
  )
}

function ProfileScreen({
  user, analysisCache, fixtures, themeMode, onThemeMode,
  emailNotifications, onEmailNotifications, onSignOut, isMobile,
  avatarChoice, onAvatarChoice, username, onUsernameChange,
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [editingUsername, setEditingUsername] = useState(false)

  const displayName = user?.user_metadata?.name || user?.user_metadata?.full_name || user?.email || ''
  const googlePhoto = user?.user_metadata?.avatar_url
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null

  /* Everything below is computed from the real analysis cache — no invented numbers */
  const entries = Object.values(analysisCache)
  const total = entries.length
  const uniqueMatches = new Set(Object.keys(analysisCache)).size
  /* The stored analysis carries `_ts` and `fixtureId` but no kick-off time, so
   * the fixture list is passed in purely to supply the other half of the
   * comparison. Keyed by string id — analysisCache keys are strings, fixture
   * ids are numbers. Anything not found here has no verifiable kick-off and is
   * excluded by countsTowardRecord rather than counted on trust. */
  const fixtureById = useMemo(() => {
    const m = new Map()
    for (const f of fixtures || []) m.set(String(f.id), f)
    return m
  }, [fixtures])
  const resolved = Object.entries(analysisCache)
    .filter(([id, a]) => countsTowardRecord(a, fixtureById.get(String(id))))
    .map(([, a]) => a)
  const correct = resolved.filter(a => a.correct).length
  const accuracy = resolved.length ? Math.round((correct / resolved.length) * 100) : 0
  const confs = entries.map(a => a.recommendation?.confidence).filter(c => typeof c === 'number')
  const avgConf = confs.length ? Math.round((confs.reduce((s, c) => s + c, 0) / confs.length) * 100) : null
  let bestStreak = 0
  {
    let run = 0
    resolved.slice().sort((a, b) => (a.resolvedAt || a._ts || 0) - (b.resolvedAt || b._ts || 0))
      .forEach(a => { if (a.correct) { run += 1; if (run > bestStreak) bestStreak = run } else run = 0 })
  }

  // Form timeline: the last several resolved calls in the order they settled,
  // oldest → newest. Correct calls read in the accent, misses stay muted. This
  // is the page's signature element — built only from resolved analyses.
  const timeline = resolved.slice()
    .sort((a, b) => (a.resolvedAt || a._ts || 0) - (b.resolvedAt || b._ts || 0))
    .slice(-14)
    .map(a => ({
      correct: !!a.correct,
      label: `${a.fixture?.home || a.recommendation?.pick || 'Match'}${a.fixture?.away ? ` vs ${a.fixture.away}` : ''} — ${a.correct ? 'correct' : 'missed'}`,
    }))

  // Signature line: a stat-as-identity. Favor accuracy once there's a real
  // sample, otherwise the join-based line — always from real data.
  const signature = resolved.length >= 5
    ? `${accuracy}% accuracy across ${resolved.length} resolved ${resolved.length === 1 ? 'match' : 'matches'}`
    : memberSince ? `Reading matches since ${memberSince}` : 'Just getting started'

  const deleteHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Delete my account')}&body=${encodeURIComponent(`Please delete my MatchIQ account associated with ${user?.email || ''}`)}`

  function chooseAvatar(id) { onAvatarChoice(id); setPickerOpen(false) }

  const StatCard = ({ label, big, bigColor = T.ink, bigSize = 44, context }) => (
    <Card style={{ padding: 28 }}>
      <Eyebrow style={{ fontSize: 11 }}>{label}</Eyebrow>
      <div style={{
        ...type.display, fontSize: bigSize, color: bigColor,
        fontVariantNumeric: 'tabular-nums', marginTop: 12, lineHeight: 1.05,
      }}>{big}</div>
      <div style={{ ...type.small, fontSize: 13, marginTop: 8 }}>{context}</div>
    </Card>
  )

  const prefRow = { minHeight: isMobile ? 48 : 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }

  return (
    <div style={{ maxWidth: 620, margin: '0 auto' }}>
      {/* Identity — a considered "cover" moment that materializes in, with its
          own faint neutral wash (no colour of its own). */}
      <Materialize>
        <div style={{
          textAlign: 'center', padding: isMobile ? '52px 20px 40px' : '72px 20px 52px',
          marginBottom: 8, borderRadius: 24, position: 'relative', overflow: 'hidden',
          background: `radial-gradient(ellipse 90% 70% at 50% 0%, color-mix(in oklab, ${T.ink} 5%, transparent), transparent 70%)`,
        }}>
          <div style={{ display: 'inline-block', position: 'relative' }}>
            <button onClick={() => setPickerOpen(o => !o)} aria-label="Edit avatar"
              className="iq-halo" style={{
                display: 'inline-flex', borderRadius: '50%', padding: 0, border: 'none',
                background: 'transparent', cursor: 'pointer',
              }}>
              <ResolvedAvatar user={user} avatarChoice={avatarChoice} size={isMobile ? 88 : 104} />
            </button>
            <button onClick={() => setPickerOpen(o => !o)} aria-label="Edit avatar" style={{
              position: 'absolute', right: -2, bottom: -2, width: 32, height: 32, borderRadius: '50%',
              background: T.accent, color: T.accentInk, border: `2px solid ${T.bg}`, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Pencil size={14} strokeWidth={2} />
            </button>
          </div>
          <div style={{ ...type.display, fontSize: isMobile ? 28 : 34, color: T.ink, marginTop: 22 }}>{displayName}</div>
          {username && (
            <div style={{ fontFamily: T.mono, fontSize: 15, fontWeight: 600, color: T.accent, marginTop: 8 }}>
              @{username}
            </div>
          )}
          <div style={{ ...type.small, fontSize: 13, color: T.sub, marginTop: 10 }}>{signature}</div>
        </div>
      </Materialize>

      {/* Avatar picker — 12 presets plus the Google photo when available */}
      <AnimatePresence>
        {pickerOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}>
            <Card className="iq-elevated" style={{ padding: 22, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Eyebrow>Choose an avatar</Eyebrow>
                <button onClick={() => setPickerOpen(false)} aria-label="Close" style={{
                  background: 'transparent', border: 'none', cursor: 'pointer', color: T.faint, display: 'inline-flex', padding: 4,
                }}><XIcon size={16} strokeWidth={2} /></button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))', gap: 12 }}>
                {googlePhoto && (
                  <button onClick={() => chooseAvatar('google')} title="Your Google photo" style={{
                    background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                    display: 'inline-flex', justifyContent: 'center',
                    outline: (avatarChoice || 'google') === 'google' ? `2px solid ${T.accent}` : 'none',
                    outlineOffset: 3, borderRadius: '50%',
                  }}>
                    <Avatar user={user} size={52} />
                  </button>
                )}
                {AVATAR_PRESET_IDS.map(id => (
                  <button key={id} onClick={() => chooseAvatar(id)} style={{
                    background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                    display: 'inline-flex', justifyContent: 'center',
                    outline: avatarChoice === id ? `2px solid ${T.accent}` : 'none',
                    outlineOffset: 3, borderRadius: '50%',
                  }}>
                    <PresetAvatar id={id} size={52} />
                  </button>
                ))}
              </div>
              {googlePhoto && (
                <div style={{ ...type.small, fontSize: 12, color: T.faint, marginTop: 14 }}>
                  The first option is your Google photo.
                </div>
              )}
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Form timeline — the page's distinctive element, drawn from real
          resolved calls. Connected markers settle left (oldest) → right (newest). */}
      <Reveal>
        <div style={{ marginTop: 8, marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
            <Eyebrow>Recent form</Eyebrow>
            {resolved.length > 0 && (
              <span style={{ ...type.small, fontSize: 12, color: T.faint }}>
                last {timeline.length} resolved · oldest to newest
              </span>
            )}
          </div>
          <Card className="iq-elevated" style={{ padding: '30px 26px' }}>
            {timeline.length === 0 ? (
              <div style={{ ...type.small, fontSize: 13.5, color: T.faint, textAlign: 'center', padding: '8px 0' }}>
                Your form line draws itself here as tracked matches resolve.
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                {timeline.map((m, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && (
                      <span style={{ flex: 1, height: 2, background: T.line, minWidth: 6 }} />
                    )}
                    <span title={m.label} style={{
                      width: 15, height: 15, borderRadius: '50%', flexShrink: 0,
                      background: m.correct ? T.accent : 'transparent',
                      border: `2px solid ${m.correct ? T.accent : T.lineHi}`,
                      boxShadow: m.correct ? `0 0 0 4px ${T.accentBg}` : 'none',
                    }} />
                  </React.Fragment>
                ))}
              </div>
            )}
            {timeline.length > 0 && (
              <div style={{ display: 'flex', gap: 18, marginTop: 22, ...type.small, fontSize: 12, color: T.faint }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ width: 11, height: 11, borderRadius: '50%', background: T.accent }} /> Correct
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ width: 11, height: 11, borderRadius: '50%', border: `2px solid ${T.lineHi}` }} /> Missed
                </span>
              </div>
            )}
          </Card>
        </div>
      </Reveal>

      {/* Record */}
      <Reveal>
        <Eyebrow style={{ marginBottom: 14 }}>Your record</Eyebrow>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
          <StatCard label="Analyses run" big={total}
            context={`across ${uniqueMatches} ${uniqueMatches === 1 ? 'match' : 'matches'}`} />
          {resolved.length < 5 ? (
            <StatCard label="Accuracy" big="Building a record" bigSize={22} bigColor={T.ink}
              context={`${resolved.length} of 5 resolved`} />
          ) : (
            <StatCard label="Accuracy" big={`${accuracy}%`} bigColor={accuracy >= 50 ? T.accent : T.sub}
              context={`${correct} correct out of ${resolved.length} resolved.`} />
          )}
          <StatCard label="Average confidence" big={avgConf != null ? `${avgConf}%` : '—'}
            context="across your analyses." />
          <StatCard label="Best streak" big={bestStreak}
            context={bestStreak > 0 ? 'consecutive correct calls.' : 'Track a match to start.'} />
        </div>
      </Reveal>

      {/* Preferences */}
      <Reveal>
        <div style={{ marginTop: 40 }}>
          <Eyebrow style={{ marginBottom: 10 }}>Preferences</Eyebrow>
          <Card className="iq-elevated" style={{ padding: '6px 24px' }}>
            <div style={{ borderBottom: `1px solid ${T.line}`, padding: '4px 0' }}>
              <div style={{ ...prefRow }}>
                <span style={{ ...type.small, fontSize: 14.5, color: T.ink, fontWeight: 540 }}>Handle</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontFamily: T.mono, fontSize: 13.5, color: T.accent }}>
                    {username ? `@${username}` : 'not set'}
                  </span>
                  <button onClick={() => setEditingUsername(e => !e)} style={{
                    background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                    ...type.small, fontSize: 13, color: T.sub, fontWeight: 560,
                  }}>{editingUsername ? 'Cancel' : 'Edit'}</button>
                </div>
              </div>
              <AnimatePresence>
                {editingUsername && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25 }}
                    style={{ overflow: 'hidden' }}>
                    <div style={{ padding: '6px 0 16px' }}>
                      <UsernameEditor user={user} currentUsername={username}
                        onSaved={(u) => { onUsernameChange(u); setEditingUsername(false) }} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div style={{ ...prefRow, borderBottom: `1px solid ${T.line}` }}>
              <span style={{ ...type.small, fontSize: 14.5, color: T.ink, fontWeight: 540 }}>Theme</span>
              <Segmented value={themeMode} onChange={onThemeMode} options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'system', label: 'System' },
              ]} />
            </div>
            <div style={{ padding: '12px 0 16px' }}>
              <div style={{ ...prefRow, minHeight: 'auto' }}>
                <span style={{ ...type.small, fontSize: 14.5, color: T.ink, fontWeight: 540 }}>Email notifications</span>
                <Toggle on={emailNotifications} onChange={onEmailNotifications} />
              </div>
              <div style={{ ...type.small, fontSize: 12.5, color: T.faint, marginTop: 8 }}>
                We'll email you when a tracked match kicks off. Coming soon.
              </div>
            </div>
          </Card>
        </div>
      </Reveal>

      {/* Sign out / delete */}
      <Reveal>
        <div style={{ marginTop: 48, paddingBottom: 24 }}>
          <button onClick={onSignOut} style={{
            background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
            fontFamily: T.sans, fontSize: 15, fontWeight: 560, color: T.sub,
          }}>Sign out</button>
          <div style={{ marginTop: 18 }}>
            {!confirmDelete ? (
              <button onClick={() => setConfirmDelete(true)} style={{
                background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                fontFamily: T.sans, fontSize: 13, color: T.faint, textDecoration: 'underline',
              }}>Delete account</button>
            ) : (
              <Card style={{ padding: 22, marginTop: 6 }}>
                <div style={{ ...type.small, fontSize: 14, color: T.ink, fontWeight: 540 }}>
                  This permanently deletes your data. Are you sure?
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                  <Button kind="soft" onClick={() => setConfirmDelete(false)}
                    style={{ padding: '8px 20px', fontSize: 13.5 }}>Cancel</Button>
                  <a href={deleteHref} style={{ textDecoration: 'none' }}>
                    <Button kind="danger" onClick={() => {}}
                      style={{ padding: '8px 20px', fontSize: 13.5 }}>Delete permanently</Button>
                  </a>
                </div>
                <div style={{ ...type.small, fontSize: 12, color: T.faint, marginTop: 12 }}>
                  This opens your mail app with a deletion request — we handle it within a few days.
                </div>
              </Card>
            )}
          </div>
        </div>
      </Reveal>
    </div>
  )
}

/* ============================================================
 * ABOUT
 * ============================================================ */

function AboutScreen({ apiStatus, user, onSignOut, onOpenProfile }) {
  const statuses = [
    { key: 'football', name: 'Match data' },
    { key: 'odds', name: 'Betting prices' },
    { key: 'analysis', name: 'Analysis engine' },
  ]
  const statusWord = (s) => s === 'operational' ? 'Working' : s === 'degraded' ? 'Having trouble' : 'Not checked yet'
  const statusColor = (s) => s === 'operational' ? T.good : s === 'degraded' ? T.bad : T.faint

  const SocialTile = ({ href, Icon, label }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="iq-lift" style={{
      display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none',
      background: T.card2, borderRadius: 14,
      padding: '13px 18px', color: T.ink, flex: 1, minWidth: 130,
      fontFamily: T.sans, fontSize: 13.5, fontWeight: 560,
    }}>
      <Icon size={16} /> {label}
    </a>
  )

  return (
    <div style={{ maxWidth: 620 }}>
      <Reveal>
        <div style={{ padding: '28px 0 8px' }}>
          <div style={{ ...type.display, fontSize: 38, color: T.ink }}>About MatchIQ.</div>
          <p style={{ ...type.body, fontSize: 17, color: T.sub, marginTop: 14, marginBottom: 0 }}>
            MatchIQ reads football matches the way a careful analyst would — from three independent
            angles at once. One looks at <em>form</em>, one at the <em>history between the teams</em>,
            and one at what the <em>betting market</em> believes. When those angles disagree, that's
            often the most interesting thing we can tell you — so we never hide it.
          </p>
        </div>
      </Reveal>

      {user && (
        <Reveal delay={0.04}>
          <Card style={{ padding: 30, marginTop: 26 }}>
            <Eyebrow>Your account</Eyebrow>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              gap: 14, marginTop: 14, flexWrap: 'wrap',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ ...type.small, fontSize: 14.5, fontWeight: 560, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user.email}
                </div>
                <div style={{ ...type.small, fontSize: 12.5, color: T.faint, marginTop: 3 }}>
                  Your follows, verdicts and theme sync to this account.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button kind="soft" onClick={onOpenProfile} style={{ padding: '8px 20px', fontSize: 13.5 }}>
                  View profile
                </Button>
                <Button kind="ghost" onClick={onSignOut} style={{ padding: '8px 20px', fontSize: 13.5 }}>
                  Sign out
                </Button>
              </div>
            </div>
          </Card>
        </Reveal>
      )}

      <Reveal delay={0.06}>
        <Card style={{ padding: 30, marginTop: 26 }}>
          <Eyebrow>Made by</Eyebrow>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 14 }}>
            <span style={{
              width: 48, height: 48, borderRadius: '50%', background: T.accentBg, color: T.accent,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: T.sans, fontSize: 16, fontWeight: 650,
            }}>BA</span>
            <div>
              <div style={{ ...type.body, fontWeight: 600 }}>Bright Agwunobi</div>
              <div style={{ ...type.small, color: T.faint }}>Final-year Computer Science · AAUA</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
            <SocialTile href={SOCIAL_LINKS.github} Icon={Github} label="GitHub" />
            <SocialTile href={SOCIAL_LINKS.linkedin} Icon={Linkedin} label="LinkedIn" />
            <SocialTile href={SOCIAL_LINKS.x} Icon={XSocial} label="X" />
            <SocialTile href={SOCIAL_LINKS.email} Icon={Mail} label="Email" />
          </div>
        </Card>
      </Reveal>

      <Reveal>
        <Card style={{ padding: 30, marginTop: 18 }}>
          <Eyebrow>Say hello</Eyebrow>
          {[
            ['Send feedback', mailto('MatchIQ Feedback')],
            ['Report a bug', mailto('MatchIQ Bug Report')],
            ['Suggest a feature', mailto('MatchIQ Feature Request')],
          ].map(([t, href]) => (
            <a key={t} href={href} className="iq-row" style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '13px 4px', textDecoration: 'none',
              borderBottom: `1px solid ${T.line}`, color: T.ink,
              fontFamily: T.sans, fontSize: 14.5, fontWeight: 520,
            }}>
              {t} <ArrowUpRight size={15} strokeWidth={1.8} style={{ color: T.faint }} />
            </a>
          ))}
          <div style={{ ...type.small, color: T.faint, marginTop: 14 }}>{CONTACT_EMAIL}</div>
        </Card>
      </Reveal>

      <Reveal>
        <Card style={{ padding: 30, marginTop: 18 }}>
          <Eyebrow>Is everything working?</Eyebrow>
          <div style={{ marginTop: 12 }}>
            {statuses.map(s => (
              <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', alignItems: 'center' }}>
                <span style={{ ...type.small, fontSize: 14, color: T.ink }}>{s.name}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, ...type.small }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor(apiStatus[s.key]) }} />
                  {statusWord(apiStatus[s.key])}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </Reveal>

      <Reveal>
        <div style={{ marginTop: 36, color: T.faint }}>
          <Wordmark size={26} />
        </div>
        <div style={{ ...type.small, color: T.faint, marginTop: 14, lineHeight: 1.8 }}>
          Data: football-data.org and the-odds-api.com · Analysis: Groq ({GROQ_MODEL})<br />
          <a href={mailto('Privacy Policy Request')} style={{ color: T.sub }}>Privacy</a> · {' '}
          <a href={mailto('Terms of Service Request')} style={{ color: T.sub }}>Terms</a><br />
          © 2026 MatchIQ · Bright Agwunobi. This is analysis, not financial advice — bet only what
          you'd be at peace losing.
        </div>
      </Reveal>
    </div>
  )
}

/* ============================================================
 * Dev-only diagnostics — never ships to users
 * ============================================================ */

function DiagnosticPanel({ apiHealth, open, onToggle, onRetryFootball, onRetryOdds }) {
  if (!import.meta.env.DEV) return null
  const fmtAt = (ts) => ts ? new Date(ts).toLocaleTimeString('en-GB', { hour12: false }) : '—'
  if (!open) {
    return (
      <button onClick={onToggle} title="Show API diagnostics" style={{
        position: 'fixed', bottom: 84, right: 12, zIndex: 200,
        background: T.card, color: T.sub, border: `1px solid ${T.lineHi}`,
        borderRadius: 999, padding: '6px 12px', fontFamily: T.mono, fontSize: 10,
        fontWeight: 600, cursor: 'pointer', boxShadow: T.shadow,
      }}>DIAG</button>
    )
  }
  const row = (name, h, retry, extra) => (
    <div key={name} style={{
      display: 'grid', gridTemplateColumns: '80px 40px 1fr auto auto', gap: 10,
      alignItems: 'center', padding: '6px 12px', borderTop: `1px solid ${T.line}`,
      fontFamily: T.mono, fontSize: 11,
    }}>
      <span style={{ color: T.ink, fontWeight: 600 }}>{name}</span>
      <span style={{ color: T.sub }}>{h.code ?? '—'}</span>
      <span style={{ color: T.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={h.msg || ''}>
        {h.msg || 'no request yet'}{extra ? ` · ${extra}` : ''}
      </span>
      <span style={{ color: T.faint }}>{fmtAt(h.at)}</span>
      {retry ? (
        <button onClick={retry} style={{
          background: 'transparent', border: `1px solid ${T.lineHi}`, color: T.sub,
          borderRadius: 6, padding: '2px 8px', fontFamily: T.mono, fontSize: 10, cursor: 'pointer',
        }}>RETRY</button>
      ) : <span />}
    </div>
  )
  return (
    <div style={{
      position: 'fixed', left: 12, right: 12, bottom: 84, zIndex: 200, maxWidth: 640,
      margin: '0 auto', background: T.card, border: `1px solid ${T.lineHi}`,
      borderRadius: 12, boxShadow: T.shadowLg,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px' }}>
        <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700, color: T.accent, letterSpacing: '0.12em' }}>API DIAGNOSTICS</span>
        <button onClick={onToggle} aria-label="Hide diagnostics" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: T.sub, display: 'inline-flex', padding: 4 }}><XIcon size={12} strokeWidth={2} /></button>
      </div>
      {row('FOOTBALL', apiHealth.football, onRetryFootball, apiHealth.football.count != null ? `${apiHealth.football.count} fixtures` : null)}
      {row('ODDS', apiHealth.odds, onRetryOdds, apiHealth.odds.remaining != null ? `${apiHealth.odds.remaining} credits left` : (apiHealth.odds.count != null ? `${apiHealth.odds.count} events` : null))}
      {row('GROQ', apiHealth.analysis, null, null)}
    </div>
  )
}

/* ============================================================
 * Root — auth gate wraps the app; MatchIQ's logic is preserved
 * ============================================================ */

function BrandedLoading({ theme }) {
  return (
    <div data-theme={theme} style={{ minHeight: '100dvh', width: '100%', display: 'grid', placeItems: 'center' }}>
      <GlobalStyles />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
        <Wordmark size={24} />
        <ButtonSpinner color="var(--iq-accent)" />
      </div>
    </div>
  )
}

export default function AuthRoot() {
  const [theme] = useTheme()
  const { user, loading, authError, setAuthError, recovery, clearRecovery } = useAuth()

  // Retroactive username gate: look up the handle once per signed-in user. Fast
  // and invisible for anyone who already has one; routes the rest to set one.
  //
  // The gate keys on WHICH user the handle was resolved for (usernameFor), not a
  // separate loading boolean. Effects run after render, so on an account switch
  // (user A signs out, user B signs in on the same device) a boolean flag lags a
  // frame behind and the app would render once with B's session but A's stale
  // @handle. Comparing usernameFor to the current user.id closes that window: the
  // handle is only treated as resolved when it belongs to the user in hand.
  const [username, setUsername] = useState(null)
  const [usernameFor, setUsernameFor] = useState(null)
  useEffect(() => {
    if (!authConfigured || !user) return
    let cancelled = false
    getMyUsername(user.id).then(u => {
      if (cancelled) return
      setUsername(u)
      setUsernameFor(user.id)
    })
    return () => { cancelled = true }
  }, [user])
  const usernameResolved = !!user && usernameFor === user.id

  // Once signed in (any method), onboarding never replays — sign-outs land on sign in.
  useEffect(() => {
    if (user) window.localStorage.setItem(LS_ONBOARD, 'true')
  }, [user])

  // Without Supabase keys the app runs un-gated, exactly as before.
  if (!authConfigured) return <MatchIQ />

  if (loading) return <BrandedLoading theme={theme} />

  if (!user) {
    return <OnboardingFlow theme={theme} initialError={authError}
      onClearInitialError={() => setAuthError(null)} />
  }

  // Arrived via a password-reset email: set the new password before entering
  if (recovery) return <ResetPasswordScreen theme={theme} onDone={clearRecovery} />

  // Resolving whether THIS user has a handle — hold rather than flash the app
  // (and never flash the previous user's handle after an account switch).
  if (!usernameResolved) return <BrandedLoading theme={theme} />

  // No handle yet (new sign-up or pre-feature user) → claim one before entering.
  if (!username) {
    return <UsernameScreen theme={theme} user={user} onSaved={setUsername} />
  }

  return <MatchIQ user={user} username={username} onUsernameChange={setUsername} />
}

function MatchIQ({ user, username, onUsernameChange }) {
  const width = useWindowWidth()
  const isMobile = width < 768

  const [theme, toggleTheme, setThemeMode, themeMode] = useTheme()
  const [emailNotifications, setEmailNotifications] = useState(false)
  const [avatarChoice, setAvatarChoice] = useState(null)

  const [oddsCache, setOddsCache] = useState([])
  const [oddsUpdatedAt, setOddsUpdatedAt] = useState(null)
  const [oddsQuotaRemaining, setOddsQuotaRemaining] = useState(null)
  /* Raw Odds API responses keyed by sport key, with fetch timestamps. A ref, not
   * state: reading it must never itself schedule a render, and it is restored
   * from localStorage so a reload inside the TTL spends no quota. */
  const oddsStoreRef = useRef(readOddsStore())

  /* General football headlines for the homepage strip. Empty until the first
   * response lands, and left empty on failure so NewsStrip renders nothing at
   * all rather than a placeholder. The 30-minute window that keeps this off the
   * quota is enforced by the CDN in /api/news, not here — this interval simply
   * asks again once the window has rolled, and a long-lived tab is the only case
   * where it matters. */
  const [headlines, setHeadlines] = useState([])
  useEffect(() => {
    let cancelled = false
    const load = () => {
      getHeadlines(10).then(({ articles }) => {
        if (!cancelled) setHeadlines(articles)
      })
    }
    load()
    const id = setInterval(load, 30 * 60 * 1000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const [standingsCache, setStandingsCache] = useState({})
  const [scorersCache, setScorersCache] = useState({})
  const [compDetailsCache, setCompDetailsCache] = useState({})

  const [activeTab, setActiveTab] = useState('matches')
  const { apiStatus, apiHealth, setStatus, setHealth } = useApiHealth()
  const {
    fixtures, fixturesLoading, fixturesError, loadFixtures, refreshFixtures, h2hCache, loadH2H,
    rateLimitedUntil, fixturesFetchedAt,
  } = useFixtures({ setStatus, setHealth })

  const [diagOpen, setDiagOpen] = useState(() => readRaw(LS_DIAG_OPEN) !== '0')
  useEffect(() => { writeRaw(LS_DIAG_OPEN, diagOpen ? '1' : '0') }, [diagOpen])

  const [comboSelections, setComboSelections] = useState([])
  const [agentPerf, setAgentPerf] = useState(() => readJSON(LS_AGENT_PERF, AGENT_PERF_EMPTY))

  function toggleCombo(id) {
    setComboSelections(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  function clearCombo() { setComboSelections([]) }

  const [selected, setSelected] = useState(null)
  const [center, setCenter] = useState(null)   // fixture shown in the Match Center
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  /* First and latest price we've seen per fixture. The odds API hands back a
   * snapshot, so this local record is the only honest basis for saying a line
   * has moved — and it's why the Match Center says so explicitly on a first visit. */
  const [oddsHist, setOddsHist] = useState(() => readJSON(LS_ODDS_HIST, {}))
  useEffect(() => { writeJSON(LS_ODDS_HIST, oddsHist) }, [oddsHist])

  function recordOdds(id, odds) {
    if (!id || !odds || odds.home == null) return
    setOddsHist(prev => {
      const cur = prev[id]
      const now = Date.now()
      if (!cur) return { ...prev, [id]: { first: odds, firstAt: now, latest: odds, latestAt: now } }
      if (cur.latest && cur.latest.home === odds.home && cur.latest.draw === odds.draw && cur.latest.away === odds.away) return prev
      return { ...prev, [id]: { ...cur, latest: odds, latestAt: now } }
    })
  }

  const [analysisCache, setAnalysisCache] = useState(() => readJSON(LS_ANALYSIS, {}))
  const [tracked, setTracked] = useState(() => new Set(readJSON(LS_TRACKED, [])))

  useEffect(() => { writeJSON(LS_ANALYSIS, analysisCache) }, [analysisCache])
  useEffect(() => { writeJSON(LS_AGENT_PERF, agentPerf) }, [agentPerf])

  /* Auto-resolve finished fixtures against cached analyses.
   * Watches analysisCache as well as fixtures: a match analysed *after* it had
   * already finished used to never resolve, because the fixture list wasn't
   * changing and nothing re-ran this pass. The `changed` guard keeps the added
   * dependency from looping — a second pass finds every row already resolved. */
  useEffect(() => {
    if (!fixtures.length) return
    const byId = Object.fromEntries(fixtures.map(f => [f.id, f]))
    let changed = false
    const next = { ...analysisCache }
    let perf = agentPerf
    for (const [id, a] of Object.entries(analysisCache)) {
      if (a.resolved) continue
      const fx = byId[id]
      if (!fx) continue
      const resolved = autoResolve(a, fx)
      if (resolved) {
        next[id] = resolved; changed = true
        /* A retrospective resolves for display — the reader still gets to see
         * whether the look-back would have landed — but it never touches agent
         * performance or the ledger, because it was written after the result
         * was already known and grading it would flatter the record. */
        if (!a.retrospective) {
          perf = updateAgentPerformance(perf, resolved)
          // Mirror the resolution into the permanent ledger (best-effort).
          autoResolveInLedger(user, fx, resolved.actualResult)
        }
      }
    }
    if (changed) { setAnalysisCache(next); setAgentPerf(perf) }
  }, [fixtures, analysisCache])

  function resolveManual(id, correct) {
    setAnalysisCache(prev => {
      const a = prev[id]
      if (!a) return prev
      return {
        ...prev,
        [id]: { ...a, resolved: true, autoResolved: false, correct, resolvedAt: Date.now() },
      }
    })
    // Manual result → ledger, but only for rows auto-resolution hasn't claimed.
    manualResolveInLedger(user, id, correct)
  }

  useEffect(() => { writeJSON(LS_TRACKED, Array.from(tracked)) }, [tracked])

  /* -------- account sync — pull once on sign-in, then debounced push -------- */
  const trackedArr = useMemo(() => Array.from(tracked), [tracked])
  useUserData(user, { tracked: trackedArr, analysisCache, agentPerf, theme, emailNotifications, avatarChoice }, (row) => {
    if (row.theme === 'light' || row.theme === 'dark') setThemeMode(row.theme)
    if (typeof row.email_notifications === 'boolean') setEmailNotifications(row.email_notifications)
    if (typeof row.avatar_choice === 'string') setAvatarChoice(row.avatar_choice)
    if (Array.isArray(row.tracked) && row.tracked.length) {
      setTracked(prev => new Set([...prev, ...row.tracked]))
    }
    if (row.analysis_cache && typeof row.analysis_cache === 'object') {
      // Local entries win per fixture — they're at least as fresh as the remote copy.
      setAnalysisCache(prev => ({ ...row.analysis_cache, ...prev }))
    }
    if (row.agent_perf && typeof row.agent_perf === 'object' && Object.keys(row.agent_perf).length) {
      setAgentPerf(prev => {
        const localTotal = Object.values(prev || {}).reduce((s, v) => s + (v?.total || 0), 0)
        return localTotal > 0 ? prev : row.agent_perf
      })
    }
  })

  /* -------- prediction ledger: verified record read-back -------- */
  const ledger = usePredictionLedger(user)
  const [verifiedRecord, setVerifiedRecord] = useState(null)
  /* Agent accuracy and calibration now come from the same Supabase ledger as the
   * verified record, rather than from the localStorage figures derived off
   * analysisCache. getAgentAccuracy and getCalibration were written when the
   * ledger read layer was built but had no call site until now. */
  const [agentAccuracy, setAgentAccuracy] = useState(null)
  const [calibration, setCalibration] = useState(null)
  useEffect(() => {
    if (activeTab !== 'record') return
    let cancelled = false
    ledger.getResolvedPredictions().then(rows => {
      if (cancelled) return
      const count = rows.length
      const correct = rows.filter(r => r.correct).length
      setVerifiedRecord({ count, correct, winRate: count ? Math.round((correct / count) * 100) : null })
    })
    ledger.getAgentAccuracy().then(acc => { if (!cancelled) setAgentAccuracy(acc) })
    ledger.getCalibration().then(b => { if (!cancelled) setCalibration(b) })
    return () => { cancelled = true }
  }, [activeTab, ledger])

  useEffect(() => {
    const k = import.meta.env.VITE_GROQ_API_KEY || ''
    console.log('VITE_GROQ_API_KEY prefix:', k ? k.slice(0, 8) + '…' : '(missing)')
  }, [])

  /* -------- competition enrichment trigger -------- */
  const compLoadedRef = useRef('')
  useEffect(() => {
    if (!fixtures.length) return
    const key = [...new Set(fixtures.map(f => f.competitionCode).filter(Boolean))].sort().join(',')
    if (!key || key === compLoadedRef.current) return
    compLoadedRef.current = key
    loadCompetitionData(fixtures)
  }, [fixtures])

  /* -------- odds --------
   * Two things keep this off the quota. Only the sport keys that today's real
   * fixtures actually belong to are requested — every key in the table used to
   * be fetched on every mount, so competitions with nothing playing were paid
   * for daily. And each key's response is cached for ODDS_TTL_MS and persisted,
   * so a reload, a tab switch or a second mount inside that window costs zero
   * requests. `force` is the diagnostic panel's retry, which must ignore both. */
  async function loadOdds(fixturesList, { force = false } = {}) {
    const keys = sportKeysForFixtures(fixturesList)
    if (!keys.length) {
      // Honest, not silent: the competitions on today's card have no odds
      // coverage in the mapping table, so there is nothing to request.
      const codes = [...new Set((fixturesList || []).map(f => f.competitionCode).filter(Boolean))]
      setOddsCache([])
      setStatus('odds', 'degraded')
      setHealth('odds', {
        code: null,
        msg: codes.length ? `No odds coverage for ${codes.join(', ')}` : 'No fixtures loaded yet',
        count: 0, at: Date.now(), remaining: oddsQuotaRemaining,
      })
      return
    }

    const store = { ...oddsStoreRef.current }
    const { cached, toFetch } = planOddsFetch(keys, store, { force })
    console.log(`[odds-api] needed: ${keys.join(', ')} · cached: ${cached.length ? cached.join(', ') : 'none'} · fetching: ${toFetch.length ? toFetch.join(', ') : 'none'}`)

    if (!toFetch.length) {
      const flat = eventsForKeys(keys, store)
      setOddsCache(flat)
      setStatus('odds', flat.length > 0 ? 'operational' : 'degraded')
      setHealth('odds', {
        code: 200,
        msg: `Cached · ${flat.length} events · ${keys.length} of ${keys.length} keys from cache`,
        count: flat.length, at: Date.now(), remaining: oddsQuotaRemaining,
      })
      return
    }

    try {
      let lastRemaining = null
      let lastCode = null
      let lastMsg = null
      await Promise.allSettled(
        toFetch.map(async (sport) => {
          // Same trailing-slash trap as the football team-matches call: the
          // vercel.json rewrite doesn't match `/odds/?…`, so this 404'd in
          // production and left the odds cache empty on every load.
          const res = await fetch(
            `/api/odds/v4/sports/${sport}/odds?regions=uk&markets=h2h&oddsFormat=decimal`,
          )
          const rem = res.headers.get('x-requests-remaining')
          if (rem != null) { lastRemaining = rem; console.log(`[odds-api] ${sport} x-requests-remaining:`, rem) }
          lastCode = res.status
          if (!res.ok) {
            try {
              const errBody = await res.json()
              lastMsg = errBody?.message || `HTTP ${res.status}`
            } catch { lastMsg = `HTTP ${res.status}` }
            // Deliberately not cached: a failure must be retried on the next
            // load rather than locked in for the length of the TTL.
            return
          }
          const data = await res.json()
          store[sport] = { at: Date.now(), events: Array.isArray(data) ? data : [] }
        })
      )
      oddsStoreRef.current = store
      writeOddsStore(store)

      const flat = eventsForKeys(keys, store)
      console.log('odds cache size:', flat.length)
      if (lastRemaining != null) setOddsQuotaRemaining(lastRemaining)
      setOddsCache(flat)
      setOddsUpdatedAt(Date.now())
      const healthy = flat.length > 0
      setStatus('odds', healthy ? 'operational' : 'degraded')
      setHealth('odds', {
        code: lastCode,
        msg: healthy
          ? `OK · ${flat.length} events · ${toFetch.length} requested, ${cached.length} cached`
          : (lastMsg || 'No events returned'),
        count: flat.length,
        at: Date.now(),
        remaining: lastRemaining ?? oddsQuotaRemaining,
      })
    } catch (err) {
      console.error('odds fetch failed:', err)
      setStatus('odds', 'degraded')
      setHealth('odds', { code: null, msg: `Network: ${err.message}`, count: null, at: Date.now(), remaining: null })
    }
  }

  /* -------- competition enrichment (standings, scorers, details) --------
   * Three requests per competition, and they were re-fired on every refresh.
   * Standings and scorers only move when a match finishes, so a six-hour cache
   * takes this to zero on a refresh without ever showing a stale table. */
  async function loadCompetitionData(fixturesList) {
    const codes = [...new Set(fixturesList.map(f => f.competitionCode).filter(Boolean))].slice(0, 6)
    const store = readJSON(LS_COMP_CACHE, {}) || {}
    const stale = []
    for (const code of codes) {
      const entry = store[code]
      if (cacheFresh(entry, COMP_TTL_MS)) {
        if (entry.details) setCompDetailsCache(prev => ({ ...prev, [code]: entry.details }))
        if (entry.standings) setStandingsCache(prev => ({ ...prev, [code]: entry.standings }))
        if (entry.scorers) setScorersCache(prev => ({ ...prev, [code]: entry.scorers }))
      } else {
        stale.push(code)
      }
    }
    console.log(`[football-api] competitions: ${codes.length} · ${codes.length - stale.length} cached · ${stale.length} to fetch`)

    for (const code of stale) {
      try {
        const [detRes, stRes, scRes] = await Promise.allSettled([
          footballFetch(`v4/competitions/${code}`),
          footballFetch(`v4/competitions/${code}/standings`),
          footballFetch(`v4/competitions/${code}/scorers?limit=10`),
        ])
        const entry = { at: Date.now() }
        if (detRes.status === 'fulfilled' && detRes.value.ok) {
          const d = await detRes.value.json()
          entry.details = d
          setCompDetailsCache(prev => ({ ...prev, [code]: d }))
        }
        if (stRes.status === 'fulfilled' && stRes.value.ok) {
          const d = await stRes.value.json()
          entry.standings = d.standings || []
          setStandingsCache(prev => ({ ...prev, [code]: entry.standings }))
        }
        if (scRes.status === 'fulfilled' && scRes.value.ok) {
          const d = await scRes.value.json()
          entry.scorers = d.scorers || []
          setScorersCache(prev => ({ ...prev, [code]: entry.scorers }))
        }
        // Only banked if something actually came back, so a throttled attempt
        // retries on the next load instead of caching a hole for six hours.
        if (entry.details || entry.standings || entry.scorers) {
          store[code] = entry
          writeJSON(LS_COMP_CACHE, store)
        }
      } catch (e) {
        console.warn(`[comp ${code}] enrichment failed:`, e.message)
      }
    }
  }

  useEffect(() => {
    loadFixtures()
  }, [])

  /* -------- odds trigger --------
   * Odds can only be requested once we know which competitions are actually
   * playing, so this waits on the fixture list rather than firing on mount.
   * Keyed on the sport keys themselves: form enrichment and the status refresh
   * both replace the `fixtures` array without changing which competitions are
   * on the card, and neither should cost a request. */
  // null, not '': a fixture list with no mapped competition produces an empty
  // key, and that case still needs one pass through loadOdds to report itself.
  const oddsKeysRef = useRef(null)
  useEffect(() => {
    if (!fixtures.length) return
    const key = sportKeysForFixtures(fixtures).sort().join(',')
    if (key === oddsKeysRef.current) return
    oddsKeysRef.current = key
    loadOdds(fixtures)
  }, [fixtures])

  /* -------- keeping status honest over time --------
   * The mount fetch is only a snapshot. Without this the app happily shows a
   * kick-off time for a match that finished an hour ago, and never resolves it.
   *
   * Every fixture the user has a stake in — followed or already analysed — is
   * refreshed by id alongside anything currently live or due to have started.
   * Fetching by id also brings back fixtures that have aged out of the date
   * window, which is why a followed match no longer vanishes before full time.
   *
   * Cadence respects the 10 req/min free tier: 60s while something is live or
   * overdue, 5 minutes otherwise, plus an immediate pass whenever the tab is
   * brought back to the foreground (the common case on a phone). */
  const refreshRef = useRef(refreshFixtures)
  refreshRef.current = refreshFixtures

  const watchIds = useMemo(() => {
    const now = Date.now()
    const ids = new Set()
    for (const id of tracked) ids.add(Number(id))
    for (const id of Object.keys(analysisCache)) ids.add(Number(id))
    for (const f of fixtures) {
      if (f.status === 'IN_PLAY' || f.status === 'LIVE') ids.add(Number(f.id))
      // Past its kick-off but still marked as scheduled — the stale case.
      else if (f.status === 'SCHEDULED' && f.kickoffDate && new Date(f.kickoffDate).getTime() < now) {
        ids.add(Number(f.id))
      }
    }
    return [...ids].filter(Boolean).sort()
  }, [tracked, analysisCache, fixtures])

  const watchKey = watchIds.join(',')
  const urgent = useMemo(() => {
    const now = Date.now()
    return fixtures.some(f =>
      f.status === 'IN_PLAY' || f.status === 'LIVE' ||
      (f.status === 'SCHEDULED' && f.kickoffDate && new Date(f.kickoffDate).getTime() < now))
  }, [fixtures])

  const fetchedAtRef = useRef(fixturesFetchedAt)
  fetchedAtRef.current = fixturesFetchedAt

  useEffect(() => {
    if (!watchKey) return
    const ids = watchKey.split(',').map(Number)
    const tick = ({ initial = false } = {}) => {
      if (document.hidden) return
      /* The list was just fetched from the network — refreshing the same ids
       * immediately is a duplicate call against the minute limit. When the list
       * came from cache this does run, which is what keeps live scores honest. */
      if (initial && Date.now() - fetchedAtRef.current < 30000) return
      refreshRef.current(ids)
    }
    tick({ initial: true })
    const id = setInterval(() => tick(), urgent ? 60000 : 300000)
    const onVisible = () => { if (!document.hidden) refreshRef.current(ids) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [watchKey, urgent])

  /* The open match screen and match centre mirror the refreshed list, so a
   * score that changes underneath doesn't leave one view contradicting another. */
  useEffect(() => {
    const sync = (cur, set) => {
      if (!cur) return
      const fresh = fixtures.find(f => f.id === cur.id)
      if (!fresh) return
      if (fresh.status === cur.status &&
          fresh.goalsHome === cur.goalsHome &&
          fresh.goalsAway === cur.goalsAway &&
          fresh.homeFormDetail === cur.homeFormDetail) return
      set(prev => prev && prev.id === fresh.id ? {
        ...prev,
        status: fresh.status, statusShort: fresh.statusShort,
        goalsHome: fresh.goalsHome, goalsAway: fresh.goalsAway,
        homeForm: fresh.homeForm, awayForm: fresh.awayForm,
        homeFormDetail: fresh.homeFormDetail, awayFormDetail: fresh.awayFormDetail,
      } : prev)
    }
    sync(selected, setSelected)
    sync(center, setCenter)
  }, [fixtures, selected, center])

  /* -------- selection + analysis -------- */
  /* Attaches the live odds and any cached head-to-head to a fixture, and logs
   * the price so movement can be shown later. Shared by both entry points. */
  function hydrate(fixture) {
    let f = fixture
    const found = lookupOddsForFixture(fixture, oddsCache)
    if (found) { f = { ...fixture, ...found }; recordOdds(f.id, found.odds) }
    const cachedH2h = h2hCache[f.id]
    if (cachedH2h) f = { ...f, h2h: cachedH2h }
    return { f, cachedH2h }
  }

  /* The Match Center. Tracking and opening are the same gesture, and it uses
   * the existing `tracked` set rather than a second store. */
  async function openCenter(fixture) {
    const { f, cachedH2h } = hydrate(fixture)
    setTracked(prev => prev.has(f.id) ? prev : new Set(prev).add(f.id))
    setCenter(f)
    window.scrollTo({ top: 0 })
    if (!cachedH2h) {
      const h2h = await loadH2H(f)
      if (h2h) setCenter(prev => (prev && prev.id === f.id ? { ...prev, h2h } : prev))
    }
  }

  async function openFixture(fixture) {
    const { f, cachedH2h } = hydrate(fixture)
    setCenter(null)
    setSelected(f)
    setError(null)
    window.scrollTo({ top: 0 })
    if (analysisCache[f.id]) {
      setAnalysis(analysisCache[f.id])
      if (!cachedH2h) {
        const h2h = await loadH2H(f)
        if (h2h) setSelected(prev => (prev && prev.id === f.id ? { ...prev, h2h } : prev))
      }
      return
    }
    setAnalysis(null)
    if (!cachedH2h) {
      const h2h = await loadH2H(f)
      if (h2h) setSelected(prev => (prev && prev.id === f.id ? { ...prev, h2h } : prev))
    }
    // No auto-fire — the user asks for the reading from the preview.
  }

  /* Which fixture has a Groq read in flight, and which fixtures still have
   * background goals-market calls pending. Refs, not state: the check has to be
   * synchronous to be a real guard. `loading` is set with setState, so it isn't
   * observable until React commits — two clicks dispatched in the same frame both
   * saw loading === false and both fired a full analysis. Against a 200k/day
   * token budget one stray double-tap costs about 5% of the day. */
  const analysisInFlightRef = useRef(null)
  const marketInFlightRef = useRef(new Set())

  async function runAnalysis(fx) {
    /* The live case is refused outright rather than being quietly treated as
     * one of the other two. The UI already withholds the button, so this is the
     * backstop for a match that kicks off between render and click. */
    const phase = matchPhase(fx)
    if (phase === 'live') {
      setError('This match is being played right now — we won\'t read it until full time.')
      return
    }
    if (analysisInFlightRef.current != null) {
      console.warn(`[groq] analysis already in flight for fixture ${analysisInFlightRef.current} — ignoring duplicate trigger`)
      return
    }
    analysisInFlightRef.current = fx.id
    setLoading(true); setError(null); setAnalysis(null)
    try {
      // Standings for this competition go into the prompt as the quality
      // baseline — position, points and the gap between the two sides.
      const standings = standingsCache[fx.competitionCode] || null
      /* Team news is fetched here and only here — at the moment of analysis,
       * never for a whole fixture list. The free plan allows 100 requests/day,
       * so preloading even one day's card would exhaust it. Per-team results are
       * cached for six hours, so a team appearing in several analyses this
       * afternoon costs one request. Failure returns empty and is never fatal. */
      const news = await getFixtureNews(fx)
      const res = await fetch(
        GROQ_ENDPOINT,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: GROQ_MODEL,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: buildPrompt(fx, { standings, news }) },
            ],
            response_format: { type: 'json_object' },
            ...SYNTHESIS_PARAMS,
          }),
        },
      )
      const data = await res.json()
      if (data.error) throw new Error(data.error.message || 'Groq rejected the request')
      // A reasoning model spends most of its budget thinking; if the ceiling is
      // hit the JSON arrives half-written, so name that rather than failing on parse.
      if (data.choices?.[0]?.finish_reason === 'length') {
        throw new Error('The model ran out of room before finishing its answer. Try again.')
      }
      const parsed = extractFirstJsonObject(data.choices?.[0]?.message?.content)
      // Guard the one number the model is most prone to inventing: with no odds
      // there is no market probability to compare against, so there is no edge.
      if (parsed.recommendation && fx.odds?.home == null) {
        parsed.recommendation.value_edge = 0
      }
      parsed._ts = Date.now()
      /* The exact articles that went into the prompt, carried on the analysis so
       * the Recent Headlines section renders from this data rather than fetching
       * it a second time. Persisted with the analysis, so re-opening the verdict
       * shows the same headlines the model actually saw. */
      parsed.news = { home: news.home, away: news.away, fetchedAt: news.fetchedAt }
      parsed.kelly = calculateKelly(parsed, fx)
      parsed.fixtureId = fx.id
      parsed.competitionCode = fx.competitionCode
      /* A read of an already-finished match is a look back, not a prediction.
       * Marked here once, at the point the phase is known, so every consumer —
       * the verdict framing, the record, the profile stats and the ledger — can
       * tell the two apart from the stored analysis alone. */
      parsed.retrospective = phase === 'finished'
      setAnalysis(parsed)
      setAnalysisCache(prev => ({ ...prev, [fx.id]: parsed }))
      // Parallel, permanent record. Best-effort: never blocks the analysis UI.
      // Retrospectives are deliberately not written: the ledger is the verified
      // record of real forward calls, and a post-hoc read is not one.
      if (!parsed.retrospective) writePredictionToLedger(user, fx, parsed)
      setStatus('analysis', 'operational')
      setHealth('analysis', { code: 200, msg: `OK · ${fx.homeTeam} vs ${fx.awayTeam}`, at: Date.now() })

      /* Fire multi-market in background (fire-and-forget). `loading` goes false
       * as soon as the main read lands, so these two calls are still pending for
       * the best part of a minute while the verdict is on screen and "Read it
       * again" is live. Without this guard a re-run in that window stacked a
       * second pair of goals-market calls on top of the first. */
      if (!marketInFlightRef.current.has(fx.id)) {
        marketInFlightRef.current.add(fx.id)
        // Same `standings` object buildPrompt received above — the goals-market
        // agents were previously the only ones without it, which is why they
        // reported "no data" for teams the main read had full season stats for.
        runMultiMarketAnalysis(fx, parsed, { standings }).then(multi => {
          if (multi && multi.length) {
            const enriched = { ...parsed, multiMarket: multi }
            setAnalysis(a => a && a.fixtureId === fx.id ? enriched : a)
            setAnalysisCache(prev => ({ ...prev, [fx.id]: enriched }))
          }
        }).catch(e => console.warn('multi-market failed:', e.message))
          .finally(() => { marketInFlightRef.current.delete(fx.id) })
      } else {
        console.warn(`[groq] goals-market calls already pending for fixture ${fx.id} — not duplicating`)
      }
    } catch (e) {
      console.error('groq call failed:', e)
      setError(e.message || 'Analysis failed.')
      setStatus('analysis', 'degraded')
      setHealth('analysis', { code: null, msg: e.message || 'Groq call failed', at: Date.now() })
    } finally {
      // No automatic retry: a failure surfaces the error card with a manual
      // "Try again", so a bad response can never re-fire on its own.
      analysisInFlightRef.current = null
      setLoading(false)
    }
  }

  function toggleTracked(id) {
    setTracked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function switchTab(t) {
    setActiveTab(t)
    setSelected(null); setCenter(null); setAnalysis(null); setError(null)
    window.scrollTo({ top: 0 })
  }

  const liveCount = fixtures.filter(f => f.status === 'LIVE' || f.status === 'IN_PLAY').length

  function renderTab() {
    if (center) {
      return (
        <MatchCenter
          fixture={center}
          analysis={analysisCache[center.id]}
          standings={standingsCache[center.competitionCode] || null}
          oddsHistory={oddsHist[center.id]}
          onBack={() => setCenter(null)}
          onOpenAnalysis={() => { setCenter(null); openFixture(center) }}
          tracked={tracked.has(center.id)}
          onToggleTrack={toggleTracked}
        />
      )
    }
    if (selected) {
      return (
        <MatchDetail
          fixture={selected} data={analysis} loading={loading} error={error}
          onBack={() => { setSelected(null); setAnalysis(null); setError(null) }}
          onRetry={() => runAnalysis(selected)}
          onAnalyze={() => runAnalysis(selected)}
          tracked={tracked.has(selected.id)}
          onToggleTrack={toggleTracked}
          onOpenCenter={openCenter}
        />
      )
    }
    if (activeTab === 'matches') return (
      <MatchesScreen
        fixtures={fixtures} fixturesLoading={fixturesLoading} fixturesError={fixturesError}
        rateLimitedUntil={rateLimitedUntil}
        onRetry={() => loadFixtures(false, { force: true })}
        analysisCache={analysisCache} tracked={tracked}
        onOpen={openFixture} onToggleTrack={toggleTracked}
        standingsCache={standingsCache} scorersCache={scorersCache} compDetailsCache={compDetailsCache}
        headlines={headlines}
      />
    )
    if (activeTab === 'bets') return (
      <BestBetsScreen
        fixtures={fixtures} analysisCache={analysisCache} onOpen={openFixture}
        comboSelections={comboSelections} onToggleCombo={toggleCombo} onClearCombo={clearCombo}
      />
    )
    if (activeTab === 'following') return (
      <FollowingScreen
        fixtures={fixtures} tracked={tracked} analysisCache={analysisCache}
        onOpen={openCenter} onToggleTrack={toggleTracked}
        onGoMatches={() => switchTab('matches')} onResolve={resolveManual}
      />
    )
    if (activeTab === 'record') return (
      <RecordScreen fixtures={fixtures} analysisCache={analysisCache}
        onResolve={resolveManual} onOpen={openFixture}
        verifiedRecord={verifiedRecord}
        agentAccuracy={agentAccuracy} calibration={calibration} />
    )
    if (activeTab === 'profile') return (
      <ProfileScreen user={user} analysisCache={analysisCache} fixtures={fixtures} isMobile={isMobile}
        themeMode={themeMode} onThemeMode={setThemeMode}
        emailNotifications={emailNotifications} onEmailNotifications={setEmailNotifications}
        avatarChoice={avatarChoice} onAvatarChoice={setAvatarChoice}
        username={username} onUsernameChange={onUsernameChange}
        onSignOut={async () => { try { await signOut() } catch (e) { console.warn('sign out failed:', e.message) } }} />
    )
    if (activeTab === 'about') return (
      <AboutScreen apiStatus={apiStatus} user={user} onOpenProfile={() => switchTab('profile')}
        onSignOut={async () => { try { await signOut() } catch (e) { console.warn('sign out failed:', e.message) } }} />
    )
    return null
  }

  const screenKey = center ? `center-${center.id}` : selected ? `match-${selected.id}` : activeTab

  /* One modal instance for the whole app, opened through context. Both the
   * homepage strip and a verdict's Recent Headlines hand the same article object
   * to the same viewer, so the two placements cannot drift apart — and nothing
   * is fetched when a headline is tapped, because everything shown is already on
   * the object the previous sprint's cached calls produced. */
  const [openArticle, setOpenArticle] = useState(null)
  const showArticle = useMemo(
    () => (article, label) => setOpenArticle({ article, label }),
    [],
  )

  return (
    <ArticleViewer.Provider value={showArticle}>
    <div data-theme={theme} style={{ minHeight: '100dvh', position: 'relative', zIndex: 1 }}>
      <GlobalStyles />
      <Header theme={theme} onToggleTheme={toggleTheme}
        tab={activeTab} onTab={switchTab} isMobile={isMobile} liveCount={liveCount}
        user={user} avatarChoice={avatarChoice} onOpenProfile={() => switchTab('profile')} />
      <main style={{
        maxWidth: 720, margin: '0 auto',
        padding: isMobile ? '18px 20px 100px' : '28px 28px 88px',
      }}>
        <AnimatePresence mode="wait">
          <motion.div key={screenKey}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}>
            {renderTab()}
          </motion.div>
        </AnimatePresence>
      </main>
      {isMobile && <MobileNav tab={activeTab} onTab={switchTab} />}
      <DiagnosticPanel
        apiHealth={apiHealth} open={diagOpen} onToggle={() => setDiagOpen(o => !o)}
        onRetryFootball={() => loadFixtures()} onRetryOdds={() => loadOdds(fixtures, { force: true })}
      />
      <AnimatePresence>
        {openArticle && (
          <NewsDetailModal
            key="news-detail"
            article={openArticle.article}
            label={openArticle.label}
            onClose={() => setOpenArticle(null)}
          />
        )}
      </AnimatePresence>
    </div>
    </ArticleViewer.Provider>
  )
}
