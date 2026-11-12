# 更新记录

## v0.3.6 — 2026-11-12

**设置页的面板现在跟随宿主的深浅色。**

面板是 `webServer` 单独托管的一份 HTML 文档，跨在 `http://127.0.0.1:<port>` 上，
宿主的 `--dsw-*` 令牌和 `body[data-ds-dark-theme]` 都进不了它的 iframe ——
所以宿主切到深色时，这一页仍然是白底黑字，放在一起很扎眼。

- `lib/panel.html`：配色全部改成变量，新增一整套深色取值（对齐 DSH 官方 ui-theme：
  `bg-layer-2/1`、`border-l2`、`label-primary/tertiary`、`state-business-primary`、
  `state-error-primary`），并声明 `color-scheme` 让原生控件（滚动条、下拉）一起变。
  浅色取值一个都没改，只是搬进了变量里。**顺带修掉三处硬编码**：
  `.tag.ok/.warn/.bad` 的浅色底、`button:disabled` 的灰、`button` 的白底 ——
  它们在深色下会各自留下一块亮斑。
- `lib/panel.html`：新增主题脚本。优先级是
  ① URL 上的 `?theme=dark|light`（宿主给的首帧）→ ② 宿主 `postMessage`
  （`{ type: 'cookie-guard:theme', theme }`，切换主题时实时生效）→
  ③ `prefers-color-scheme`（单独在浏览器里打开、没人告诉我们时）。
  宿主一旦明确指定过，系统偏好就不再抢方向盘。
- `lib/client.js`：以 `body[data-ds-dark-theme]` 为权威信号算出当前主题（属性比
  `prefers-color-scheme` 准 —— 用户可以在浅色系统里选深色），呈现器还没跑起来时
  才退回媒体查询；通过 `useSyncExternalStore` + `MutationObserver` 响应切换。
  iframe 的 `src` 带上首次渲染时的 `?theme=`，之后的变化走 `postMessage`，
  **不重载面板**（重载会白闪一下并重新拉一次状态）。
- iframe 的加载底色和 `color-scheme` 也跟着主题走，深色宿主下不再先闪一块白。
- 宿主没提供 react hooks 时一切照旧工作（退化成一次性读取，不抛错）。
- 测试：新增 `test/theme.test.mjs`（26 项）—— 变量齐全性、深色两套取值逐项一致、
  浅色取值无回归、深色文字对比度 ≥ 4.5:1、以及用 `node:vm` 跑面板主题脚本验证
  「首帧」「实时切换」「跟随系统」「非法消息忽略」；`test/client.test.mjs`
  从 16 项扩到 27 项（深浅两种宿主、属性压过媒体查询、无 hooks、无 matchMedia）。

## v0.3.5 — 2026-11-11

**修一个体验上的坑：关掉启动器窗口，DSH 也会跟着退出。**

v0.3.4 的启动器用 `start "" "DSH.exe"` 拉起 DSH，而 Windows 会让子进程继承父进程的控制台。
因此那个黑窗口一旦被叉掉，系统会向控制台里所有进程发 `CTRL_CLOSE_EVENT`，DSH 连带被杀。
（面板上「立即清理并重启」没有这个问题，因为 `helper.mjs` 用的是 `spawn(..., { detached: true })`。）

- 新增 `scripts/spawn-dsh.mjs`：用 Node 的 `spawn(exe, [], { detached: true, stdio: 'ignore' })` 启动，
  DSH 不再附着到启动器控制台；启动后等 2.5 秒确认存活即退出，窗口自行关闭。
- `launcher/dsh-launch.cmd`：优先走 `spawn-dsh.mjs`；**找不到 node 时退回原来的 `start ""`**（宁可回到旧行为，也不能不启动）。
- 去掉 `tasklist` 死等 12 秒的循环 —— 等待现在发生在 spawn-dsh 里，且窗口会自己关掉，不需要用户去叉。
- 启动器仍会清掉 `ELECTRON_RUN_AS_NODE`，避免 DSH 以 Node 模式启动后 40ms 退出。
- 测试：`test/launcher.test.mjs` 增至 34 项（新增「必须 detached」「必须保留退路」「不再死等 12 秒」等断言）。

## v0.3.4 — 2026-11-11

**修一个真问题：从 npm / 插件页装进来的人，防护其实是关着的。**

只装插件只有面板和手动按钮 —— 自动体检（`prelaunch.mjs`）只有启动器会调用，
所以新装的人面板永远显示"还没有数据"，平时启动也不会清理。

- **新增一键安装启动器**：面板「操作」区多了「安装启动器」按钮 → `POST /cookie-guard/api/install-launcher`，
  在 `%LOCALAPPDATA%\dsh-cookie431\` 生成 `start-dsh.cmd`，并在桌面建「DSH（带体检启动）」快捷方式。
  可逆：删掉这两样即可；不写注册表、不碰系统目录。
- `/api/status` 新增 `launcher` 段（`installed` / `cmdPath` / `lnkExists`），面板据此决定显示
  「去安装」还是「已就位」。
- 面板空状态文案不再硬编码"用桌面上的快捷方式"，没装启动器时直接引导去装。
- `launcher/dsh-launch.cmd` 不再写死 DSH 路径：优先用 `CG_DSH_EXE`（安装器会填），
  并按 `%USERPROFILE%\.dsh\dsh-runtimes\*\dependencies\node\bin\node.exe` 自动找 DSH 自带的 node ——
  **没装 node 的机器也能体检**（之前 `where node` 找不到就直接跳过体检）。
- npm 包里开始包含 `launcher/`，`package.json` 新增 `install-launcher` 脚本。
- 测试：新增 `test/launcher.test.mjs`（25 项），`panel.test.mjs` 扩到 42 项。

## v0.3.3 — 2026-11-09

- **改名发布到 npm：`dsh-cookie431`**（`dsh-cookie-guard` 已被他人占用）。
  改的是包名，仓库名仍是 `dsh-cookie-guard`。
- 去掉 `bin` 字段（npm 拒绝没有 shebang 的目标脚本，会静默删掉入口）。
- 补 `repository` / `homepage` / `bugs` / `publishConfig`。

## v0.3.2 — 2026-11-08

**新增：设置里有了入口，不用再开浏览器。**

- 客户端半侧（`lib/client.js`）注册到 DSH 的 `settings.section` 槽位，设置里多了「Cookie Guard」一页，
  里面直接嵌 `/cookie-guard/` 页面 —— 面板逻辑仍然只有一份。
- 修正两个字段的语义：`package.json` 的 `dsh.client.inject` 填**客户端包 id**，
  `module.exports.inject` 填 **Cordis 服务名**（`slots`）。填错会静默失败。
- 面板按钮调 `clean.mjs` 时补上 `--threshold 1`，报告里记的阈值不再是不存在的 40。

## v0.3.1 — 2026-11-08

- 撤回上一版加进去的客户端半侧（当时的实现拿不到 `ctx.slots`，界面永远不出现）。

## v0.3.0 — 2026-11-07

- 首次尝试把面板塞进 DSH 界面（`settings.section`），启动时因 `dsh.client.inject`
  填了不存在的包而崩溃，已回退。

## v0.2.0 — 2026-11-06

- **去掉清理前的 cookie 备份**。`dsh-auth-*` 是每次启动新签发的本地握手票（30 天、绑定当时的端口），
  备份既不能恢复任何东西，也不提供诊断信息（该信息已经在报告里）。少一个分支、少一个失败点。

## v0.1.0 — 2026-11-05

- 第一版：`probe.mjs`（只读计数）、`clean.mjs`（清到只剩最新 N 条）、`prelaunch.mjs`（启动前体检）、
  `lib/panel.html` + `lib/routes.mjs`（只读面板）、`scripts/helper.mjs`（清理并重启）。

## 0.3.3 — 2026-11-09

- 发布到 npm，包名 **dsh-cookie431**（原名 `dsh-cookie-guard` 已被他人占用，仓库名保持 `dsh-cookie-guard` 不变）
- `package.json` 的 `name`、`cordis.patch.yml` 的 `id`/`name`、profile 依赖键同步改名，避免 patch 名与安装目录不一致导致插件静默不加载
- 补 `repository` / `homepage` / `bugs` / `publishConfig` 字段，`bin` 命令改为 `dsh-cookie431`
