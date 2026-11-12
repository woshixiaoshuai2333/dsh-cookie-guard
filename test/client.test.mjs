/**
 * Contract tests for lib/client.js — the browser half.
 *
 * The bundle runs inside the DSH shell, where we cannot attach a debugger, so the
 * only reliable way to know it behaves is to replay the shell's loader contract in
 * node:vm with fakes: window.__ModuleLoader__.load, a fake react, a fake ctx.slots.
 *
 * Run: node test/client.test.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(HERE, '..', 'lib', 'client.js'), 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) {
    pass++
    console.log(`  [ok] ${name}`)
  } else {
    fail++
    console.log(`  [FAIL] ${name}${extra === undefined ? '' : ' — ' + extra}`)
  }
}

/** A minimal stand-in for the shell: loader, react, optional slots service. */
function runClient(options = {}) {
  const log = []
  const state = { module: null, threw: null, registered: [], rendered: null, posted: [], effects: [] }
  const react = {
    createElement: (tag, props, ...kids) => {
      const el = { tag, props: props ?? {}, kids }
      if (tag === 'iframe') {
        el.contentWindow = { postMessage: (msg) => state.posted.push(msg) }
        // Mimic React attaching the ref before effects run.
        if (el.props.ref) el.props.ref.current = el
      }
      return el
    }
  }
  if (options.hooks !== false) {
    react.useRef = (initial) => ({ current: initial ?? null })
    react.useEffect = (fn) => { state.effects.push(fn) }
    react.useSyncExternalStore = (subscribe, getSnapshot) => {
      log.push('useSyncExternalStore')
      state.subscribed = subscribe
      return getSnapshot()
    }
  }
  const makeCtx = () => {
    if (options.withoutSlots) return {}
    return {
      slots: {
        inject: (name, fn) => {
          log.push('slot.inject:' + name)
          if (options.injectThrows) throw new Error('inject boom')
          return fn()
        },
        register: (desc, Component) => {
          log.push('slot.register:' + desc.name + '/' + desc.id)
          if (options.registerThrows) throw new Error('register boom')
          state.registered.push(desc)
          if (typeof Component === 'function') state.rendered = Component()
          // Flush effects the way React does after a commit.
          for (const fn of state.effects.splice(0)) fn()
          return () => {}
        }
      }
    }
  }
  const window = {
    __DSH_BOOT__: options.boot ?? { web: { url: 'http://127.0.0.1:9999/' } },
    __ModuleLoader__: options.withoutLoader
      ? undefined
      : {
          load: (spec) => {
            log.push('load:' + spec.id)
            if (options.factoryThrows) throw new Error('factory boom')
            const req = (name) => {
              if (name === 'react') return react
              throw new Error('unexpected require: ' + name)
            }
            state.module = spec.factory(req)
            if (options.apply) {
              state.module.apply(makeCtx())
            }
          }
        }
  }
  const sandbox = {
    window,
    location: { origin: options.origin ?? 'dsh-app://app' },
    console: { warn: () => {}, info: () => {}, error: () => {} },
    document: makeDocument(options),
    Set,
    Object,
    String,
    RegExp,
    Error,
    URL
  }
  if (options.media !== undefined) {
    sandbox.matchMedia = (query) => ({
      matches: options.media === 'dark' && query.includes('dark'),
      addEventListener: () => {},
      removeEventListener: () => {}
    })
  }
  if (options.mutationObserver !== false) {
    sandbox.MutationObserver = class {
      observe() {}
      disconnect() {}
    }
  }
  const context = vm.createContext(sandbox)
  try {
    vm.runInContext(SOURCE, context)
  } catch (err) {
    state.threw = err
  }
  return { log, state, module: state.module }
}

/**
 * The shell's document, reduced to what the theme code reads:
 * `body[data-ds-dark-theme]` plus the presenter's `html { color-scheme }`.
 * `options.dark`/`options.decided` drive readScheme()'s two branches.
 */
function makeDocument(options = {}) {
  const attrs = new Set(options.dark ? ['data-ds-dark-theme'] : [])
  return {
    title: '',
    body: {
      hasAttribute: (name) => attrs.has(name),
      setAttribute: (name) => { attrs.add(name) },
      removeAttribute: (name) => { attrs.delete(name) }
    },
    documentElement: { style: { colorScheme: options.decided === false ? '' : (options.dark ? 'dark' : 'light') } }
  }
}

console.log('client.test.mjs')

/* 1-4: module contract */
{
  const { state } = runClient()
  check('loader.load is called with the package id', !!state.module, 'module not produced')
  check('name is dsh-cookie431', state.module?.name === 'dsh-cookie431', state.module?.name)
  check(
    'inject lists the "slots" SERVICE, not a package id',
    JSON.stringify(state.module?.inject) === '["slots"]',
    JSON.stringify(state.module?.inject)
  )
  check('apply is a function', typeof state.module?.apply === 'function')
}

/* 5-7: registration */
{
  const { state, log } = runClient({ apply: true })
  const desc = state.registered[0] ?? {}
  check('injects into the settings.section slot', log.includes('slot.inject:settings.section'), log.join(','))
  check('registers name=settings.section', desc.name === 'settings.section', desc.name)
  check('registers id=dsh-cookie431', desc.id === 'dsh-cookie431', desc.id)
  check('label() returns Cookie Guard', typeof desc.label === 'function' && desc.label() === 'Cookie Guard')
}

/* 8-10: the rendered section */
{
  const { state } = runClient({ apply: true })
  const tree = state.rendered
  check('component returns an element', !!tree && !!tree.tag, String(tree?.tag))
  const iframe = (tree?.kids ?? []).find((kid) => kid && kid.tag === 'iframe')
  check('section contains an iframe', !!iframe)
  check('iframe points at /cookie-guard/', String(iframe?.props?.src).includes('/cookie-guard/'), iframe?.props?.src)
}

/* 11: boot-URL fallback when the shell origin is not http(s) */
{
  const { state } = runClient({ apply: true, origin: 'dsh-app://app' })
  const tree = state.rendered
  const iframe = (tree?.kids ?? []).find((kid) => kid && kid.tag === 'iframe')
  const src = String(iframe?.props?.src)
  check(
    'falls back to the __DSH_BOOT__ http origin when origin is dsh-app://',
    src.startsWith('http://127.0.0.1:9999/cookie-guard/'),
    iframe?.props?.src
  )
}

/* 12-14: never break the host */
{
  const { state } = runClient({ apply: true, withoutSlots: true })
  check('apply without ctx.slots does not throw', state.threw === null, String(state.threw))
}
{
  const { state } = runClient({ apply: true, registerThrows: true })
  check('a throwing slots.register is swallowed', state.threw === null, String(state.threw))
}
{
  const { state } = runClient({ withoutLoader: true })
  check('missing __ModuleLoader__ does not throw', state.threw === null, String(state.threw))
}
{
  const { state } = runClient({ factoryThrows: true })
  check('a throwing factory does not throw', state.threw === null, String(state.threw))
}

/* 15-21: host colour scheme */
{
  // Light shell: the presenter has run and left the body attribute off.
  const { state } = runClient({ apply: true, dark: false, decided: true })
  const iframe = (state.rendered?.kids ?? []).find((kid) => kid && kid.tag === 'iframe')
  check('light shell → ?theme=light on the iframe src', String(iframe?.props?.src).endsWith('?theme=light'), iframe?.props?.src)
  check(
    'light shell → iframe paints the native light surface (bg-base)',
    iframe?.props?.style?.background === '#fff',
    iframe?.props?.style?.background
  )
}
{
  // Dark shell: body[data-ds-dark-theme] is the authoritative signal.
  const { state } = runClient({ apply: true, dark: true, decided: true })
  const iframe = (state.rendered?.kids ?? []).find((kid) => kid && kid.tag === 'iframe')
  check('dark shell → ?theme=dark on the iframe src', String(iframe?.props?.src).endsWith('?theme=dark'), iframe?.props?.src)
  check(
    'dark shell → iframe paints the native dark surface (bg-base)',
    iframe?.props?.style?.background === '#151517',
    iframe?.props?.style?.background
  )
  check('dark shell → iframe gets color-scheme: dark', iframe?.props?.style?.colorScheme === 'dark', iframe?.props?.style?.colorScheme)
  check(
    'dark shell → the scheme is pushed into the frame over postMessage',
    state.posted.some((msg) => msg && msg.type === 'cookie-guard:theme' && msg.theme === 'dark'),
    JSON.stringify(state.posted)
  )
  check('iframe is mounted with a ref so the bridge can reach it', !!iframe?.props?.ref, 'no ref')
}
{
  // The user picked dark while the OS is light: the attribute must win.
  const { state } = runClient({ apply: true, dark: true, decided: true, media: 'light' })
  const iframe = (state.rendered?.kids ?? []).find((kid) => kid && kid.tag === 'iframe')
  check(
    'body[data-ds-dark-theme] beats a light OS preference',
    String(iframe?.props?.src).endsWith('?theme=dark'),
    iframe?.props?.src
  )
}
{
  // Before the presenter runs there is no html{color-scheme}; the OS query is the best guess.
  const { state } = runClient({ apply: true, dark: false, decided: false, media: 'dark' })
  const iframe = (state.rendered?.kids ?? []).find((kid) => kid && kid.tag === 'iframe')
  check(
    'falls back to prefers-color-scheme before the presenter runs',
    String(iframe?.props?.src).endsWith('?theme=dark'),
    iframe?.props?.src
  )
}
{
  // No react hooks in the host: must still produce a themed iframe, no crash.
  const { state } = runClient({ apply: true, hooks: false, dark: true, decided: true })
  const iframe = (state.rendered?.kids ?? []).find((kid) => kid && kid.tag === 'iframe')
  check('works without react hooks', state.threw === null && String(iframe?.props?.src).endsWith('?theme=dark'), String(state.threw))
}
{
  // No matchMedia / MutationObserver at all: degrade to light, never throw.
  const { state } = runClient({ apply: true, dark: false, decided: false, mutationObserver: false })
  check('no matchMedia or MutationObserver does not throw', state.threw === null, String(state.threw))
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
