/**
 * dsh-cookie-guard — browser half.
 *
 * Loaded by the DSH shell (dsh-app://) as the package's "./client" export.
 * No bundler: the module contract is small enough to hand-write.
 *
 * Contract (verified against dsh-better-sidebar@0.30.1 and dsh-context@0.78.2):
 *   window.__ModuleLoader__.load({ id, factory })
 *   factory(require) -> { name, inject, apply }
 *
 * IMPORTANT: `inject` here is a list of Cordis *service names* in the client app
 * ("slots", "locale", "sessions", ...), NOT package ids. Declaring a package id
 * makes web boot hang with `pending (waiting for service: <id>)`.
 *
 * English-only on purpose: the bundle is served without an explicit charset, and
 * non-ASCII comments have bitten us before.
 */
;(() => {
  const ID = 'dsh-cookie431'

  function makeFactory() {
    return (require) => {
      const module = { exports: {} }

      let react = null
      try {
        react = require('react')
      } catch (err) {
        console.error('[cookie-guard] cannot require react; client UI skipped', err)
        module.exports = { name: ID, inject: [], apply: () => {} }
        return module.exports
      }
      const h = react.createElement

      /** Panel lives on the same origin as the shell; fall back to the boot URL. */
      function panelUrl() {
        try {
          const fromLocation = `${location.origin}/cookie-guard/`
          if (String(location.origin).indexOf('http') === 0) return fromLocation
        } catch { /* ignore */ }
        return findHttpUrl() ? `${findHttpUrl()}/cookie-guard/` : '/cookie-guard/'
      }

      /** Depth-first scan of window.__DSH_BOOT__ for an http origin. */
      function findHttpUrl() {
        const seen = new Set()
        const walk = (value, depth) => {
          if (depth > 6 || value === null || typeof value !== 'object') {
            if (typeof value === 'string' && /^https?:\/\/127\.0\.0\.1:\d+/.test(value)) return value
            return null
          }
          if (seen.has(value)) return null
          seen.add(value)
          for (const key of Object.keys(value)) {
            const hit = walk(value[key], depth + 1)
            if (hit) return hit
          }
          return null
        }
        try {
          const hit = walk(window.__DSH_BOOT__, 0)
          if (!hit) return null
          return hit.replace(/\/+$/, '')
        } catch { /* ignore */ }
        return null
      }

      /* ------------------------------------------------------------------ *
       * Host colour scheme.
       *
       * The panel is a separate document (served over http from the web
       * server), so it inherits NOTHING from the shell: not the --dsw-* CSS
       * tokens, not the body palette attribute. Without an explicit signal it
       * stays light while the shell is dark — the bug this section fixes.
       *
       * The authoritative signal is `body[data-ds-dark-theme]`, toggled by
       * the shell's theme presenter together with `html { color-scheme }`.
       * `prefers-color-scheme` alone is wrong: the user can pick dark while
       * the OS is light. We only use the media query before the presenter has
       * run (no `color-scheme` set yet, no body attribute) — same rule as
       * dsh-better-sidebar's theme.ts.
       * ------------------------------------------------------------------ */
      const THEME_MESSAGE = 'cookie-guard:theme'

      function darkAttribute() {
        try {
          return document !== undefined && document.body != null && document.body.hasAttribute('data-ds-dark-theme')
        } catch { /* ignore */ }
        return false
      }

      function prefersDark() {
        try {
          return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
        } catch { /* ignore */ }
        return false
      }

      /** @returns {'dark' | 'light'} */
      function readScheme() {
        try {
          const decided = document.documentElement.style.colorScheme !== ''
          if (decided) return darkAttribute() ? 'dark' : 'light'
          if (darkAttribute()) return 'dark'
        } catch { /* ignore */ }
        return prefersDark() ? 'dark' : 'light'
      }

      /** Fire on every flip: the body attribute, the html color-scheme, or the OS query. */
      function subscribeScheme(callback) {
        const disposers = []
        try {
          if (typeof MutationObserver === 'function' && document.body != null) {
            const observer = new MutationObserver(() => callback())
            observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
            try {
              observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] })
            } catch { /* ignore */ }
            disposers.push(() => observer.disconnect())
          }
        } catch { /* ignore */ }
        try {
          if (typeof matchMedia === 'function') {
            const query = matchMedia('(prefers-color-scheme: dark)')
            if (query && typeof query.addEventListener === 'function') {
              const onChange = () => callback()
              query.addEventListener('change', onChange)
              disposers.push(() => query.removeEventListener('change', onChange))
            }
          }
        } catch { /* ignore */ }
        return () => {
          for (const dispose of disposers) {
            try { dispose() } catch { /* ignore */ }
          }
        }
      }

      const hasHooks = typeof react.useState === 'function'
        && typeof react.useEffect === 'function'
        && typeof react.useRef === 'function'

      /** Reactive scheme: useSyncExternalStore when available, plain read otherwise. */
      function useScheme() {
        if (typeof react.useSyncExternalStore === 'function') {
          return react.useSyncExternalStore(subscribeScheme, readScheme, () => 'light')
        }
        if (hasHooks) {
          const [scheme, setScheme] = react.useState(readScheme)
          react.useEffect(() => subscribeScheme(() => setScheme(readScheme())), [])
          return scheme
        }
        return readScheme()
      }

      /** Append the scheme so the very first paint is already the right colour. */
      function withScheme(url, scheme) {
        try {
          const u = new URL(url)
          u.searchParams.set('theme', scheme)
          return u.toString()
        } catch { /* ignore */ }
        return `${url}${url.indexOf('?') === -1 ? '?' : '&'}theme=${scheme}`
      }

      /**
       * Keep the mounted iframe in sync without a reload.
       *
       * The shell is `dsh-app://` and the panel is `http://127.0.0.1:<port>` —
       * different origins — so postMessage is the only channel across them,
       * and the panel listens for exactly one message type.
       */
      function useThemeBridge(scheme) {
        const ref = react.useRef ? react.useRef(null) : { current: null }
        if (react.useEffect) {
          react.useEffect(() => {
            const node = ref.current
            const target = node && node.contentWindow
            if (!target) return
            try {
              target.postMessage({ type: THEME_MESSAGE, theme: scheme }, '*')
            } catch { /* ignore */ }
          }, [scheme])
        }
        return ref
      }

      function Section() {
        const scheme = useScheme()
        // The iframe src only carries the scheme that was current when this
        // section mounted: changing src on a flip would reload the panel (white
        // flash + status refetch). Later flips travel over postMessage, and a
        // remount recomputes the URL from the then-current scheme.
        const mountScheme = react.useRef ? react.useRef(null) : { current: null }
        if (react.useRef && mountScheme.current === null) mountScheme.current = scheme
        const url = withScheme(panelUrl(), react.useRef ? mountScheme.current : scheme)
        const frameRef = useThemeBridge(scheme)
        const frameProps = {
          src: url,
          title: 'Cookie Guard',
          style: {
            flex: 1,
            minHeight: 480,
            width: '100%',
            border: '1px solid rgba(127,127,127,.25)',
            borderRadius: 8,
            // Paint the shell's own surface while the document loads, otherwise
            // a dark shell flashes a white rectangle. Both values are DSH's own
            // alias tokens (bg-base: #fff / #151517) — not a skin's palette.
            background: scheme === 'dark' ? '#151517' : '#fff',
            colorScheme: scheme
          }
        }
        if (react.useRef) frameProps.ref = frameRef
        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 8, height: '100%' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'baseline', gap: 12 } },
            h('div', { style: { fontSize: 15, fontWeight: 600 } }, 'Cookie Guard'),
            h(
              'div',
              { style: { fontSize: 12, opacity: 0.6, flex: 1 } },
              'dsh-auth cookie growth guard — read-only view of the launch-time check'
            ),
            h('a', { href: url, target: '_blank', rel: 'noreferrer', style: { fontSize: 12 } }, 'Open ↗')
          ),
          h('iframe', frameProps)
        )
      }

      function apply(ctx) {
        try {
          if (!ctx || !ctx.slots) {
            console.warn('[cookie-guard] ctx.slots unavailable; client UI skipped')
            return
          }
          const dispose = ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              { name: 'settings.section', id: ID, order: 150, label: () => 'Cookie Guard' },
              Section
            )
          )
          console.info('[cookie-guard] settings section registered', typeof dispose)
        } catch (err) {
          console.error('[cookie-guard] failed to register settings section', err)
        }
      }

      module.exports = { name: ID, inject: ['slots'], apply }
      return module.exports
    }
  }

  try {
    if (window.__ModuleLoader__ && typeof window.__ModuleLoader__.load === 'function') {
      window.__ModuleLoader__.load({ id: ID, factory: makeFactory() })
    } else {
      console.warn('[cookie-guard] __ModuleLoader__ missing; client half cannot load')
    }
  } catch (err) {
    console.error('[cookie-guard] client bundle failed', err)
  }
})()
