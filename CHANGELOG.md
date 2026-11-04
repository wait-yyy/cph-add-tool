# 更新日志

## 0.19.1

- 文档补充浏览器登录 / 自动提交说明
- selftest 增加浏览器可用性检查，11/11 通过


## 0.19.0

- 新增 **浏览器自动提交（Edge/Chrome）**：用独立 profile（training/browser-profile）复用登录态，CDP 填代码/选语言/点提交
  - 支持 Codeforces（正赛/Gym）、AtCoder；洛谷/牛客仍用「浏览器提交（复制代码）」兜底
  - 需要先在「浏览器登录」里登录对应平台；首次使用会弹出可见浏览器窗口
- 样例面板新增「🖥 自动提交（浏览器）」按钮

## 0.18.0

- 新增「浏览器登录」：用本机 Edge/Chrome 独立 profile 打开 OJ 登录页，登录态保存在 `training/browser-profile/`（gitignore）
- 后续浏览器自动提交/抓取可复用该 profile，避免 Cookie/Cloudflare 问题

## 0.17.1

- 新增 `tools/selftest.js` 基础自检（扩展语法/命令、Companion 写入/缓存、提交识别、样例读取），9/9 通过
- 文档补充 Companion / 浏览器提交 / AI 功能说明


## 0.17.0

- Companion 接收题目时额外写入 `.cph/.<文件名>_<md5>.prob`，`cp.ps1 samples` 和 CPH 兼容工具可直接读取
- 题解社区增加自动索引：`training/community/README.md` 列出所有题解文件与更新时间
- AI 题解保存后自动刷新社区索引

## 0.16.1

- 文档更新：Companion 接收器、浏览器提交、AI 找错/审思路/题解/调题单、同题 AC、五平台 handle
- 明确说明 CF/洛谷的 Cloudflare 限制与 Cookie 不再可靠


## 0.16.0

- 新增 **浏览器提交**：样例面板按钮「🌐 浏览器提交（复制代码）」
  - 自动识别 OJ，复制当前代码，打开对应提交页（CF contest/gym、AtCoder；洛谷/牛客打开题目页）
  - 自动提交被 Cloudflare 拦截时，这是稳定可用的提交方式
- 自动提交接口保留（curl 方案），但需要能通过反爬的 Cookie，实际以浏览器提交为准

## 0.15.0

- **AI 题解社区（本地基础版）**：AI 生成题解后自动保存到 `training/community/<题号>.md`；新增「题解社区」按钮打开资料库
- **等待动画**：所有 `runNode` 长任务（AI/抓取/提交）状态栏显示旋转图标，结束后恢复
- **复盘总结优化**：AI 复盘 Prompt 改为「本场概览 / 逐题复盘 / 三个问题 / 两个专题 / 一个行动」结构
- 同题 AC 查询结果可直接跳转提交页或生成 AI 题解

## 0.14.0

- 新增 **同题 AC**（Codeforces）：公开 API 查询同一题其他人的 AC 提交者/提交记录，可打开提交页或直接生成 AI 题解
- 新增 `tools/cf-ac.js`（不登录、不碰 Cookie；源码仍需浏览器登录查看）
- 查询结果按最早 AC 排序，最多显示 50 人

## 0.13.1

- 修复 AI 调题单命令未注册到处理函数表（命令面板调用会失败）


## 0.13.0

- 新增 **AI 调题单**：输入要求（难度/分类/题量/去掉某 tag），AI 返回修改后的题单 JSON；面板可预览，确认后应用并备份 `training/plan.backup.json`
- 新增 `ai-client.js plan-adjust` 模式（严格 JSON 输出、校验 problems/URL）
- 题单卡片/面板保持原样；应用后自动刷新

## 0.12.0

- 新增 AI 训练功能：
  - **AI 找错**：读取题面/当前代码 + 错误症状，定位最可能 bug、验证方法、最小修改建议（不直接给完整代码）
  - **AI 审思路**：输入简要伪代码/口胡，判断可行性、反例、复杂度、结论（能不能直接写）
  - **AI 题解**：根据题面生成题意/关键观察/算法/正确性/复杂度/易错点/类似题
- 新增**五平台 handle 设置**：Codeforces / 洛谷 / 牛客 / LeetCode / AtCoder，保存在 `training/handles.json`，账号区显示
- 训练面板 AI 区新增对应按钮
- 等待动画沿用 VS Code 进度提示（AI 调用时可取消）

## 0.11.0

- **项目/扩展整体更名为 `algorithm-training-tool` / Algorithm Training Tool / 算法训练工具**
  - 扩展 ID：`waityyy.algorithm-training-tool`
  - 命令前缀：`algorithmTraining.*`
  - 视图容器/视图 ID：`algorithmTrainingSidebar` / `algorithmTraining.main` / `algorithmTraining.samples`
  - 设置命名空间：`algorithm-training-tool.*`
  - 源码目录：`tools/vscode-extension/algorithm-training-tool`
- 新增 Competitive Companion 接收器（端口 27121）：浏览器点 Companion 的「+」即可接收题面样例，不依赖 Cookie/curl；自动生成 `<题号>.cpp/.json/.md`，样例自测面板直接可读

## 0.10.0

- 新增 **Competitive Companion 接收器**（端口 27121）：浏览器里打开题目页，点 Companion 的「+」，题目/样例直接写进工作区
  - 不经过 curl、不需要 Cookie，CF Gym / 洛谷 / AtCoder 等只要 Companion 能解析的页面都能用
  - 自动生成 `<题号>.cpp`（按 new.cpp 模板）、`<题号>.json`（样例，样例自测可直接读）、`<题号>.md`（标题/限制/样例）
  - 自动按平台建目录：CF Gym → `codeforces/gym<id>`，CF 正赛 → `codeforces/<group>`，AtCoder → `atcoder/<contest>`，洛谷 → `luogu/...`，牛客 → `nowcoder/...`
  - 面板「快速开始 → Companion 接收」显示端口/状态
- 新增 `tools/companion-data.js`（接收数据 → 文件，独立可测试）
- 默认端口可在设置 `algorithm-training-tool.companion.port` 修改

## 0.9.8

- 明确区分 Cloudflare 403 和 Cookie 错误：CF 现在对 curl 直接返回 JS 挑战（匿名请求也一样），Cookie 登录检查会提示「Cloudflare 403，不是账号错误」
- 移除错误的 CF API 兜底（官方 API 需要 apiKey/apiSig，Cookie 不能验证 Gym API）

## 0.9.7

- 从 Copy as cURL 中同时提取浏览器 User-Agent 保存到 `training/cf-ua.txt`，CF 登录检查/请求使用与浏览器一致的 UA（cf_clearance 与 UA 绑定，UA 不一致会 403）
- CF 登录检查优先用需要登录的 Gym API 验证 Cookie，避免 settings 页被 Cloudflare 403 时误判
- Cookie 解析修复：只提取 `cookie:` / `-b`，不会再误把 Accept 当 Cookie

## 0.9.6

- **修复 Copy as cURL 解析错误**：之前会把第一个 `-H`（如 Accept）当成 Cookie，导致保存出错误 Cookie、登录 403
- 现在只提取 `-H 'cookie: ...'` 或 `-b '...'`；粘贴内容不含 Cookie 时会明确提示，而不是写入错误值
- 已清除误保存的 CF Cookie，需要重新粘贴一次

## 0.9.5

- 登录 Cookie 支持直接粘贴浏览器「Copy as cURL」整段命令：自动提取其中的 `cookie:` 值，不用手动找请求头
- 登录输入提示同步说明

## 0.9.4

- Cookie 输入容错：粘贴时即使带 `Cookie:` 前缀或换行，也会自动去掉前缀再保存/读取（CF / 洛谷 / 牛客 / AtCoder）
- 说明：Codeforces 登录主要靠 `JSESSIONID`，建议连同 `39ce7`、`70a7c28f3de`、`__cf_bm` 等一起复制完整 Cookie 请求头

## 0.9.3

- 删除训练面板「代码与提交」分组（样例自测/提交仍在独立的「样例自测」视图；编译命令保留在命令面板）
- 账号模块补齐 OJ Cookie 整理接口：
  - 新增「清除平台 Cookie」：可选 Codeforces / 洛谷 / 牛客 / AtCoder / 全部
  - 新增「打开 Cookie 目录」：直接打开 training 目录
  - 保留四平台登录、检查账号状态、设置 CF handle
- 设置模块保持：拉题初始模板 / AI 设置页 / 训练手册

## 0.9.2

- 重新整理训练面板分类：
  - **快速开始**只保留「抓取整场比赛 / 抓取单个题目」，并加入「打开当前题面 / 重新抓取题面」
  - 新增「代码与提交」：样例自测、提交到 OJ、编译并跑样例、只编译
  - 「训练计划」只留赛后复盘（复盘最近一场 / 指定比赛）
  - 「拉题初始模板」移到「设置」
  - 「账号」收纳四平台登录、检查账号状态、设置 CF handle、清除 CF Cookie
  - 「设置」只放拉题模板、AI 设置页、训练手册
- 快速开始四个按钮改为 2×2 排列

## 0.9.1

- **训练面板整体 UI 重排**：
  - 顶部新增品牌区（算法训练工具 + 四平台副标题）
  - 状态胶囊：handle / AI / Gym（Gym 会提示是否需要 CF Cookie）
  - 账号胶囊行：CF / 洛谷 / 牛客 / AtCoder 昵称状态
  - 当前题单改成独立卡片（题数徽章、难度/弱项信息、题目列表、刷新/完整题单/重做队列）
  - 功能按「快速开始 / 题面 / 训练计划 / AI 助手 / 账号 / 设置帮助」分组，可折叠（details）
  - 按钮统一为双列网格 + 图标 + 文字，主要操作高亮；长按钮整行显示
  - 整体间距、圆角、边框、悬停反馈按 VS Code 主题变量统一

## 0.9.0

- 样例自测面板新增 **🚀 提交到 OJ** 按钮 + 侧边栏「提交当前题到 OJ」命令
- 支持 Codeforces（正赛/Gym）、洛谷、AtCoder 自动提交（需要对应平台 Cookie）
- 牛客暂不支持自动提交，会明确提示手动提交
- 提交前自动保存当前 `.cpp`（包括未保存的修改）；运行样例前也会自动保存
- 新增 `tools/submit.js`（识别 OJ、提交、返回提交记录链接；支持 `--dry-run` 检查）

## 0.8.1

- 明确「公开数据 vs 私有数据」：公开比赛/题面不需要登录；**Codeforces Gym / 私有比赛必须设置 CF Cookie**（匿名 API 返回 `You have to be authenticated`）
- 面板账号行显示 Gym 状态：`Gym：可用` / `Gym：需要 CF Cookie`
- 抓 Gym 比赛时若未设置 Cookie，会弹窗提示并可一键去登录
- 登录提示文案区分公开/私有场景

## 0.8.0

- 训练面板新增**账号登录**：Codeforces / 洛谷 / 牛客 / AtCoder 四个平台
- 登录方式：浏览器登录后粘贴 Cookie；保存到本机 training/ 下（已 gitignore），不写入仓库
- 登录成功后自动读取并显示昵称；面板顶部「账号：CF / 洛谷 / 牛客 / AtCoder」状态行
- 新增「检查账号状态」，可批量校验 Cookie
- 新增 `tools/account-login.js`（Cookie 检查 + 昵称解析，失败时支持手动填写昵称）

## 0.7.7

- 样例自测面板布局调整：**样例区在最上方，自定义测试区和自定义用例统一放到所有样例下面**（「添加并运行」表单也移到自定义用例下方）
- 运行/编号/计分逻辑不变

## 0.7.6

- **修复「运行此测试」报错**：`runOne` 里的局部变量 `output` 遮蔽了全局输出通道，调用 `output.appendLine` 时把字符串当通道用，导致 `output.appendLine is not a function`；「运行全部测试」没有这个遮蔽所以正常
- 单个测试运行恢复；无结果/异常会在「算法训练工具」输出面板记录日志

## 0.7.5

- 修复单个测试点运行在某些情况下报错的问题：结果列表长度与当前测试点不一致时重建结果骨架；测试列表为空时先刷新
- 样例面板命令异常会写入「算法训练工具」输出日志（`[samples] ... ERROR` 带堆栈），便于定位
- 无结果时给出明确提示

## 0.7.4

- **修复样例自测按钮点击无反应**：webview 脚本里动态选择器的引号写错导致整段脚本语法错误，按钮事件未绑定（「运行此测试」「添加并运行」等全部无效）
- 点击时无当前 cpp 会给出明确提示（不再静默返回）；输出面板记录 `[samples]` 日志便于排查
- 打开/切换任意 `.cpp` 都会刷新样例面板（用最近一次 cpp 兜底，即使焦点在 webview 也能运行）

## 0.7.3

- 删除「保存」按钮：测试点编辑后，点「▶ 运行此测试」或「▶ 运行全部测试」会**自动保存**再运行，避免改了不生效
- 修复样例自测面板不自动刷新的问题：打开/切换任意 `.cpp` 都会刷新（不再依赖是否有题面 md 或题面预览设置）
- 编译失败时面板直接显示编译器错误首行
- g++ 增加 msys64 路径兜底

## 0.7.2

- 样例自测面板支持**实时编辑测试点**：每个测试点的输入/期望输出可直接修改并保存
- 支持**单个测试点运行**（每个用例独立「▶ 运行此测试」）
- 删除「重新读取样例」按钮/接口（打开 cpp 或切换题目时自动刷新）
- 样例修改保存为 `<题号>.sample-overrides.json`；自定义测试仍为 `<题号>.custom-tests.json`，两者都已 gitignore

## 0.7.1

- 样例自测面板支持**自定义测试**：填写输入 + 期望输出，「添加并运行」保存到同目录 `<题号>.custom-tests.json` 并立即运行
- 自定义测试可逐条删除；得分、通过数、逐题 PASS/FAIL 会把自定义用例一起计算
- 自定义测试文件默认不提交（`.gitignore` 已忽略 `*.custom-tests.json`）

## 0.7.0

- **卸载 CPH 扩展**：移除所有补丁相关代码/命令/脚本（`cph-folder-patch.ps1`），工具完全独立工作
- 新增 **样例自测（计分）** 侧边栏：读取 `.cph` / `<题号>.json` 样例，运行后显示通过数、得分、百分比、逐题 PASS/FAIL、耗时和期望/实际输出
- 新增 `tools/sample-tests.js`（编译 + 逐题运行 + JSON 结果）
- 移除「重新生成全部题面 md」命令（上一版已完成）
- `update.ps1` 不再尝试打 CPH 补丁

## 0.6.7

- 所有命令的进度通知都支持**停止按钮**（`runNode` / `runPowerShell` 默认 cancellable，取消时终止子进程树）
- 移除「重新生成全部题面 md」命令/按钮（批量重抓功能删除；单题重抓仍可用）

## 0.6.6

- Codeforces Gym/私有比赛登录支持：面板「🍪 设置 CF 登录 Cookie」粘贴浏览器 Cookie，自动验证 handle
- 抓取 Gym 单题/整场时 API 与题面请求自动带 Cookie（整场失败会尝试解析 Gym 页面题目列表）
- 新增「🔎 检查 CF 登录状态」「🚪 清除 CF 登录 Cookie」
- Cookie 只存本地 `training/cf-cookies.txt`（已 gitignore），过期重新设置即可

## 0.6.5

- 新增 **抓取单个题目**：面板「📥 抓取单个题目」/ 命令 `algorithmTraining.pullProblem`
  - 支持 Codeforces / AtCoder / 洛谷 / 牛客单题链接
  - 自动生成题面 md、按模板生成 cpp、`.cph` 样例缓存、结构化 json
  - 拉完自动打开 cpp + 题面 md 两栏
- `pull-contest.js` 新增 `--single`（整场链接会明确报错，避免误拉整场）

## 0.6.4

- 打开题目时**强制两栏布局**：左侧 `.cpp`、右侧题面 `.md` 预览（`editorLayoutTwoColumns` + `markdown.showPreviewToSide`，焦点回到 cpp）
- 「打开当前题面预览」和抓取后「选择题目打开」也走同一布局
- 新增设置 `algorithm-training-tool.forceTwoColumnSplit`（默认 true，设为 false 则不调整布局）
## 0.6.3

- 抓取整场比赛时，进度通知增加**取消按钮**：取消会终止 node 进程树（已生成的 md/cpp 保留）
- 抓取完成后可选「选择题目打开」：自动打开该题 `.cpp` 并把题面 `.md` 分屏到侧边
- 打开有同名 `.md` 的 `.cpp` 时自动分屏题面预览；新增设置 `algorithm-training-tool.autoStatementPreview`（默认 true）

## 0.6.2

- 新增 **初始模板接口**：拉题生成 `.cpp` 的模板可配置
  - 命令行 `--template=<文件>`
  - 插件设置 `algorithm-training-tool.pull.template` / 面板「🧩 设置拉题初始模板」
  - `training/pull-config.json`（示例 `training/pull-config.example.json`）
  - 默认 `new.cpp`
- `pull-contest.js` 每道题额外生成 `<题号>.json`（结构化题面数据：title / url / group / 时限 / 内存 / 样例），整场生成 `contest.json`（题目索引 + 模板 + 生成时间）
- 项目介绍加入 QQ 交流群：**188241279**
- 文档改为「直接给比赛链接」为主流程，CPH 变为可选

## 0.6.1

- **整场抓取支持 Codeforces 正赛**：`tools/pull-contest.js` 用 CF API 枚举题目，按 `new.cpp` 建 cpp、生成 `.cph` 样例缓存
- `cph-statement.js`：CF 题面页被 Cloudflare 403 时自动改用洛谷镜像 `luogu.com.cn/problem/CF<contestId><index>` 抓题面（CPH 拉题生成 md 也更稳）
- CF Gym/私有比赛仍不支持（API/题面需要登录）
- 插件面板/命令文案更新为「抓取整场比赛（Codeforces/洛谷/牛客/AtCoder）」

## 0.6.0

- 新增 **整场比赛抓取**：`tools/pull-contest.js` + 插件按钮「📥 抓取整场比赛（洛谷/牛客/AtCoder）」
  - AtCoder / 洛谷 / 牛客整场题面（英文自动 AI/Bing 翻译）→ `<题号>.md`
  - 自动按 `new.cpp` 生成 `.cpp`，并为每道题生成 CPH `.cph` 样例缓存（CPH 按钮 / `cp.ps1 samples` 可直接跑样例）
  - 支持 `--only` / `--out` / `--force` / `--no-cpp` / `--no-translate`
- `cph-statement.js` 支持洛谷、牛客题面解析（含公式、样例、时间/内存限制），并新增 `--samples-out` 导出结构化样例
- 洛谷比赛题自动带 `?contestId=`（否则匿名请求 401）；牛客按 A..Z 自动探测题号
- 修复题面自动预览一次弹一堆的问题（只对当前正在编辑的题生效 + 30 秒去重 + `autoPreview` 开关）
- 插件安装脚本更新 `extensions.json` 注册表，重装后 Reload Window 即可生效
- 新增 `tools/update.ps1`、`tools/package-extension.ps1`、`.vscodeignore`，整理 README / CHANGELOG

## 0.5.2

- 拉题自动预览只对当前正在编辑的那道题生效；新增 VS Code 设置 `algorithm-training-tool.autoPreview`

## 0.5.1

- AI 提示会读取当前编辑器代码（含未保存修改）：先「代码体检」，再按级别给针对性提示
- 「问 AI」也带上当前代码；输出自动写文件并打开预览

## 0.5.0

- AI 设置入口补齐：面板「⚙️ 设置 AI API / 🔌 测试 AI 连接 / 🧰 在 VS Code 设置中编辑」
- 新增 VS Code 原生设置 `algorithm-training-tool.ai.baseUrl / model / apiKey / temperature`（与 `training/ai-config.json` 双向同步）
- 左下角状态栏新增 AI 配置状态（点击可改）

## 0.4.1

- 修正 DeepSeek 模型名（`deepseek-flash` / `deepseek-v4-pro`）；模型名填错时自动回退
- 修复推理模型短 `max_tokens` 下返回空内容的问题

## 0.4.0

- 接入 OpenAI 兼容 API：题面翻译（AI 优先，失败退回 Bing）、AI 复盘（`review.ai.md`）、AI 提示/问答
- 新增 AI 相关命令与面板分组

## 0.3.0

- 活动栏「算法训练」面板：当前题单显示、可点击题目链接、分组按钮
- 多平台周题单（Codeforces + AtCoder + 洛谷）

## 0.2.x

- CPH 补丁：按比赛自动建目录（`codeforces/<比赛>/`）
- 拉题自动抓题面生成中英对照 Markdown，并自动打开预览
- 本地 VS Code 插件雏形（题面/复盘/编译样例/补丁操作按钮）

## 0.1.0

- 初始工具集：`cp.ps1`（编译/样例/对拍）、`mkdata.ps1`（造题）、训练文档
