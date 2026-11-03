# 更新日志

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

- 新增 **抓取单个题目**：面板「📥 抓取单个题目」/ 命令 `cfTraining.pullProblem`
  - 支持 Codeforces / AtCoder / 洛谷 / 牛客单题链接
  - 自动生成题面 md、按模板生成 cpp、`.cph` 样例缓存、结构化 json
  - 拉完自动打开 cpp + 题面 md 两栏
- `pull-contest.js` 新增 `--single`（整场链接会明确报错，避免误拉整场）

## 0.6.4

- 打开题目时**强制两栏布局**：左侧 `.cpp`、右侧题面 `.md` 预览（`editorLayoutTwoColumns` + `markdown.showPreviewToSide`，焦点回到 cpp）
- 「打开当前题面预览」和抓取后「选择题目打开」也走同一布局
- 新增设置 `cf-training-tools.forceTwoColumnSplit`（默认 true，设为 false 则不调整布局）
## 0.6.3

- 抓取整场比赛时，进度通知增加**取消按钮**：取消会终止 node 进程树（已生成的 md/cpp 保留）
- 抓取完成后可选「选择题目打开」：自动打开该题 `.cpp` 并把题面 `.md` 分屏到侧边
- 打开有同名 `.md` 的 `.cpp` 时自动分屏题面预览；新增设置 `cf-training-tools.autoStatementPreview`（默认 true）

## 0.6.2

- 新增 **初始模板接口**：拉题生成 `.cpp` 的模板可配置
  - 命令行 `--template=<文件>`
  - 插件设置 `cf-training-tools.pull.template` / 面板「🧩 设置拉题初始模板」
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

- 拉题自动预览只对当前正在编辑的那道题生效；新增 VS Code 设置 `cf-training-tools.autoPreview`

## 0.5.1

- AI 提示会读取当前编辑器代码（含未保存修改）：先「代码体检」，再按级别给针对性提示
- 「问 AI」也带上当前代码；输出自动写文件并打开预览

## 0.5.0

- AI 设置入口补齐：面板「⚙️ 设置 AI API / 🔌 测试 AI 连接 / 🧰 在 VS Code 设置中编辑」
- 新增 VS Code 原生设置 `cf-training-tools.ai.baseUrl / model / apiKey / temperature`（与 `training/ai-config.json` 双向同步）
- 左下角状态栏新增 AI 配置状态（点击可改）

## 0.4.1

- 修正 DeepSeek 模型名（`deepseek-flash` / `deepseek-v4-pro`）；模型名填错时自动回退
- 修复推理模型短 `max_tokens` 下返回空内容的问题

## 0.4.0

- 接入 OpenAI 兼容 API：题面翻译（AI 优先，失败退回 Bing）、AI 复盘（`review.ai.md`）、AI 提示/问答
- 新增 AI 相关命令与面板分组

## 0.3.0

- 活动栏「CF 训练」面板：当前题单显示、可点击题目链接、分组按钮
- 多平台周题单（Codeforces + AtCoder + 洛谷）

## 0.2.x

- CPH 补丁：按比赛自动建目录（`codeforces/<比赛>/`）
- 拉题自动抓题面生成中英对照 Markdown，并自动打开预览
- 本地 VS Code 插件雏形（题面/复盘/编译样例/补丁操作按钮）

## 0.1.0

- 初始工具集：`cp.ps1`（编译/样例/对拍）、`mkdata.ps1`（造题）、训练文档
