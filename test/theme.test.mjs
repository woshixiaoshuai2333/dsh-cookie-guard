/**
 * 「跟随宿主深色」的实现自检。
 *
 * 分两层：
 *  1. 静态：lib/panel.html 的配色必须全部走变量，深色两套（属性选择器 + @media
 *     兜底）必须逐项一致 —— 少一个变量，深色下就会出现一块刺眼的白。
 *  2. 动态：把 panel.html 里那段主题脚本单独抽出来，在 node:vm 里用假 DOM 跑，
 *     验证「宿主用 ?theme= 指定 → 首帧就是对的」「宿主 postMessage 改口 → 跟着改」
 *     「没人告诉我们 → 跟随系统」「收到不认识的消息 → 不理」。
 *
 * 全程不联网、不碰 ~/.dsh、不写任何文件。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const HTML = readFileSync(join(HERE, '..', 'lib', 'panel.html'), 'utf8')

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

console.log('theme.test.mjs')

/* ── 静态：变量齐全 ─────────────────────────────────────────────── */

/** 把一段 CSS 块里的 `--name: value;` 抽成对象。 */
function declarations(block) {
  const out = {}
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim()
  return out
}

/** 取某个选择器后紧跟的第一个 `{ … }` 块（不含嵌套，本文件里没嵌套）。 */
function block(selector) {
  const at = HTML.indexOf(selector)
  if (at === -1) return ''
  const open = HTML.indexOf('{', at)
  const close = HTML.indexOf('}', open)
  return HTML.slice(open + 1, close)
}

const light = declarations(block(':root {'))
const dark = declarations(block(':root[data-theme="dark"] {'))
const media = declarations(block(':root:not([data-theme]) {'))

const REQUIRED = [
  '--bg', '--card', '--line', '--text', '--muted',
  '--ok', '--warn', '--bad', '--accent',
  '--btn-bg', '--chip-bg', '--chip-fg',
  '--tag-info-bg', '--tag-ok-bg', '--tag-warn-bg', '--tag-bad-bg'
]

check('浅色块定义了全部配色变量', REQUIRED.every((k) => light[k]), REQUIRED.filter((k) => !light[k]).join(','))
check('深色块定义了同一批变量', REQUIRED.every((k) => dark[k]), REQUIRED.filter((k) => !dark[k]).join(','))
check(
  '深色兜底块（@media）与 [data-theme="dark"] 完全一致',
  REQUIRED.every((k) => media[k] === dark[k]),
  REQUIRED.filter((k) => media[k] !== dark[k]).join(',')
)
check('深色块声明了 color-scheme: dark', /color-scheme\s*:\s*dark/.test(block(':root[data-theme="dark"] {') + '}'), '')
check('浅色块声明了 color-scheme: light', /color-scheme\s*:\s*light/.test(block(':root {') + '}'), '')

/* 深色下不能残留浅色硬编码：除了变量定义区，样式里不该再出现 #fff / #ffffff 之类的字面色。 */
const styleChunk = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'))
const bodyRules = styleChunk.replace(/--[a-z0-9-]+\s*:\s*[^;]+;/gi, '')
const literalColors = [...bodyRules.matchAll(/#(?:fff|ffffff|eef0f3|9aa1ab|eef2ff|ecfdf5|fffbeb|fef2f2|f6f7f9)\b/gi)]
  .map((m) => m[0])
check(
  '样式里没有残留的浅色字面值（除 button.primary 的白字）',
  literalColors.every((c) => c.toLowerCase() === '#fff') && literalColors.length <= 1,
  literalColors.join(',')
)

/* ── 静态：深色配色的可读性 ─────────────────────────────────────── */

/** WCAG 相对亮度 + 对比度，够用来卡住「深色下字看不清」。 */
function luminance(hex) {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

for (const [label, palette] of [['浅色', light], ['深色', dark]]) {
  const surfaces = [['--card', palette['--card']], ['--bg', palette['--bg']]]
  // 深色是这次新增的配色，整套都按 WCAG AA 正文标准卡住。
  // 浅色只卡正文/次要文字：--ok/--warn 是沿用 v0.3.5 的点缀色（12px 标签），
  // 为了「跟随深色」去改它们属于视觉回归，超出这个改动的范围。
  const fgKeys = label === '深色'
    ? ['--text', '--muted', '--accent', '--ok', '--warn', '--bad']
    : ['--text', '--muted']
  for (const fgKey of fgKeys) {
    const worst = Math.min(...surfaces.map(([, bg]) => contrast(palette[fgKey], bg)))
    check(
      `${label}：${fgKey} 在卡片/背景上对比度 ≥ 4.5`,
      worst >= 4.5,
      `worst=${worst.toFixed(2)}`
    )
  }
}

// 浅色是既有外观：这次只许「搬到变量里」，取值一个都不许变。
const LIGHT_BASELINE = {
  '--bg': '#f6f7f9',
  '--card': '#ffffff',
  '--line': '#e6e8ec',
  '--text': '#1f2328',
  '--muted': '#6b7280',
  '--ok': '#16a34a',
  '--warn': '#d97706',
  '--bad': '#dc2626',
  '--accent': '#2563eb'
}
check(
  '浅色取值与改动前完全一致（无视觉回归）',
  Object.entries(LIGHT_BASELINE).every(([k, v]) => light[k] === v),
  Object.entries(LIGHT_BASELINE).filter(([k, v]) => light[k] !== v).map(([k, v]) => `${k}: ${light[k]} != ${v}`).join('; ')
)

check(
  '深色：--muted 不靠得太近 --text（两档分明）',
  contrast(dark['--muted'], dark['--card']) < contrast(dark['--text'], dark['--card']),
  ''
)

/* ── 动态：把主题脚本抽出来跑 ─────────────────────────────────── */

const scriptMatch = HTML.match(/<script>\s*\/\* ── 跟随宿主深浅色[\s\S]*?<\/script>/)
check('面板里有一段专门处理主题的脚本', !!scriptMatch)
const THEME_SCRIPT = (scriptMatch?.[0] ?? '').replace(/^<script>/, '').replace(/<\/script>$/, '')

/** 最小假环境：documentElement 的 data-theme + matchMedia + message 事件。 */
function runTheme(search = '', { system = 'light' } = {}) {
  const attrs = new Map()
  const listeners = []
  const mediaListeners = []
  const root = {
    setAttribute: (name, value) => attrs.set(name, value),
    removeAttribute: (name) => attrs.delete(name),
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null)
  }
  const window = {
    matchMedia: (query) => ({
      // 真实浏览器的 matches 是活属性；这里必须用 getter，否则「系统翻转」测不出来。
      get matches() { return query.includes('dark') ? system === 'dark' : system !== 'dark' },
      addEventListener: (_type, fn) => mediaListeners.push(fn),
      removeEventListener: () => {}
    }),
    addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn) }
  }
  const sandbox = {
    window,
    document: { documentElement: root },
    location: { search },
    URLSearchParams,
    console
  }
  vm.runInContext(THEME_SCRIPT, vm.createContext(sandbox))
  return {
    theme: () => root.getAttribute('data-theme'),
    send: (data) => {
      for (const fn of listeners) fn({ data })
    },
    flipSystem: (next) => {
      system = next
      for (const fn of mediaListeners) fn()
    }
  }
}

{
  const page = runTheme('?theme=dark')
  check('?theme=dark → 首帧就是深色', page.theme() === 'dark', String(page.theme()))
}
{
  const page = runTheme('?theme=light', { system: 'dark' })
  check('?theme=light 压过深色系统（用户选了浅色）', page.theme() === 'light', String(page.theme()))
}
{
  const page = runTheme('', { system: 'dark' })
  check('没有参数又没有宿主消息 → 不写 data-theme，交给 @media 兜底', page.theme() === null, String(page.theme()))
}
{
  const page = runTheme('?theme=light', { system: 'light' })
  page.send({ type: 'cookie-guard:theme', theme: 'dark' })
  check('宿主 postMessage 改口 → 立刻跟着变深', page.theme() === 'dark', String(page.theme()))
  page.send({ type: 'cookie-guard:theme', theme: 'light' })
  check('宿主再改回浅色 → 跟着变浅', page.theme() === 'light', String(page.theme()))
}
{
  const page = runTheme('', { system: 'light' })
  page.flipSystem('dark')
  check('没人指定时跟随系统深浅切换', page.theme() === 'dark', String(page.theme()))
}
{
  const page = runTheme('?theme=light', { system: 'light' })
  page.send({ type: 'cookie-guard:theme', theme: 'dark' })
  page.flipSystem('light')
  check('宿主已指定后，系统变化不再抢方向盘', page.theme() === 'dark', String(page.theme()))
}
{
  const page = runTheme('?theme=dark')
  page.send({ type: 'something-else', theme: 'light' })
  page.send({ type: 'cookie-guard:theme', theme: 'chartreuse' })
  page.send(null)
  page.send({})
  check('不认识的消息 / 非法的主题值一律忽略', page.theme() === 'dark', String(page.theme()))
}
{
  const page = runTheme('', { system: 'light' })
  check('默认（浅色系统）保持浅色', page.theme() === null, String(page.theme()))
}

console.log('')
if (fail === 0) {
  console.log(`ALL PASS (${pass}/${pass})`)
  process.exit(0)
} else {
  console.log(`FAILED: ${fail} 项未通过，${pass} 项通过`)
  process.exit(1)
}
