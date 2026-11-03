# CF 训练助手 · 算法竞赛工作区工具包

一套 Windows + VS Code 的算法竞赛（Codeforces / AtCoder / 洛谷 / 牛客）训练工具：
拉题自动建目录并抓题面、中英对照 Markdown、AI 提示/复盘、周题单、赛后复盘、整场比赛一键抓取，以及一个活动栏面板把这些操作变成按钮。

> 这是从个人工作区整理出来的**工具包**：只包含脚本、VS Code 插件源码、模板和文档，不包含题目代码、比赛数据和个人配置。
>
> **CPH 已卸载**：本项目不再依赖 Competitive Programming Helper，补丁机制已移除；拉题、题面、样例自测全部由本工具完成。
>
> **交流群**：QQ **188241279**（问题反馈 / 使用交流 / 更新通知）

## 拉题方式（推荐：直接给比赛链接）


不再依赖 Competitive Companion：把**比赛链接**直接交给工具，自动把整场题面/样例扒下来，并给每道题生成 cpp + 样例缓存：

```powershell
node tools\pull-contest.js https://codeforces.com/contest/2278
node tools\pull-contest.js https://atcoder.jp/contests/abc402
node tools\pull-contest.js https://www.luogu.com.cn/contest/251050
node tools\pull-contest.js https://ac.nowcoder.com/acm/contest/85333
```

也可以直接在 VS Code 面板点「📥 抓取整场比赛」或「📥 抓取单个题目」，粘贴链接即可；单个题目拉完会直接打开 cpp + 题面 md 两栏。

抓取过程中进度通知上有 **取消按钮**，可随时中断（已生成的文件保留）；抓取完成后可点「选择题目打开」→ 打开 cpp 并分屏题面 md；打开任何有同名 .md 的 .cpp 也会自动分屏题面预览。打开题目时会强制两栏布局：左侧 cpp、右侧题面 md（设置 `cf-training-tools.forceTwoColumnSplit=false` 可关闭）。

每道题产物：
- `<题号>.md`：中英对照题面（英文自动翻译）
- `<题号>.cpp`：按**初始模板**生成（可配置，见下）
- `<题号>.json`：结构化题面数据（title / url / group / 时限 / 内存 / 样例 tests）
- `.cph`：CPH 样例缓存（`cp.ps1 samples` / CPH 按钮可直接跑样例）
- 整场还有 `contest.json`：平台、比赛名、题目列表、模板、生成时间

CPH（Competitive Companion）仍然可用，只是不再是主流程：需要"浏览器一键拉题"时再用，补丁生成的目录/缓存格式与 `pull-contest.js` 一致。

## 初始模板（可配置）

默认使用仓库根目录的 `new.cpp`。设置优先级从高到低：

1. 命令行：`node tools\pull-contest.js <链接> --template=templates\new.cpp`
2. 插件设置：`Ctrl+,` 搜 `CF 训练` → `cf-training-tools.pull.template`；或面板「🧩 设置拉题初始模板」选文件
3. `training/pull-config.json`（复制 `training/pull-config.example.json`）：`{ "template": "new.cpp" }`
4. 默认 `new.cpp`

## Codeforces Gym / 私有比赛（登录）

Gym 和私有比赛需要登录才能看题面/API。工具支持保存浏览器登录态（Cookie），不用把账号密码交给脚本。

1. 浏览器登录 `codeforces.com`，并**报名**要做的 Gym/私有比赛
2. 面板「设置 / 维护」→ **🍪 设置 CF 登录 Cookie**（或命令面板搜 `CF 训练: 设置 CF 登录 Cookie`）
3. F12 → Network → 随便点一个 `codeforces.com` 请求 → Request Headers → 复制 **Cookie** 整行（要包含 `JSESSIONID`、`cf_clearance` 等全部字段）
4. 粘贴后会自动验证，成功后显示你的 handle；之后抓取整场/单题 Gym 会自动带上登录态
5. Cookie 过期后重新设置；面板「🚪 清除 CF 登录 Cookie」可退出

> Cookie 等同于登录态，**不要分享/提交**。它只保存在本机 `training/cf-cookies.txt`（已在 `.gitignore` 中）。
## 功能

- **样例自测（计分面板）**：活动栏「样例自测」块读取 `.cph`/`<题号>.json` 样例；运行后显示通过数/得分、逐题耗时、PASS/FAIL 与期望/实际输出对比
- **自动建目录与题面**：整场抓取自动建 `codeforces/<比赛>/`，生成中英对照 `<题号>.md` 并自动分屏预览
- **多平台题面抓取**
  - 单题：`tools\cph-statement.js` 支持 Codeforces / AtCoder / 洛谷 / 牛客
  - 整场：`tools\pull-contest.js` 抓一场比赛全部题面 + 建 cpp + 样例缓存
- **AI 助手**（任意 OpenAI 兼容 API：DeepSeek / SiliconFlow / 自建网关）
  - 题面翻译：拉题时优先 AI 翻译，失败自动退回 Bing
  - AI 提示：先读当前编辑器代码（含未保存修改）做「代码体检」，再按级别给提示（方向 → 思路 → 伪代码，不直接给完整代码）
  - 问 AI：带题面 + 当前代码提问
  - AI 复盘：赛后逐题分析卡点、关键观察、总结，生成 `review.ai.md`
- **训练工具**
  - 周题单：按 CF 弱项 tag + 难度，从 Codeforces / AtCoder / 洛谷三平台选题（`training/plan.md`）
  - 重做队列：AC 但错 ≥3 次的题（`training/redo.md`）
  - 赛后复盘：拉 CF API 数据生成 `review.md` 模板（`tools\cf-review.ps1`）
- **本地做题工具**
  - `tools\cp.ps1`：编译（gnu++23 + O2 + 大栈）、跑样例、手写输入、对拍
  - `tools\mkdata.ps1`：造题数据生成与校验
- **VS Code 面板**：活动栏「CF 训练」+ 状态栏菜单，所有操作一键触发；支持 AI 配置、样例自测、题单展示

## 环境要求

- Windows 10/11，PowerShell 5.1（系统自带）
- VS Code（含内置 Markdown 预览）
- Node.js（`node` 在 PATH 中）
- g++ 与 gdb：推荐 [MSYS2 UCRT64](https://www.msys2.org/)（默认路径 `C:\msys64\ucrt64\bin`）
- Windows 自带 `curl.exe`（抓题面用）
- 浏览器插件 [Competitive Companion](https://github.com/jmerle/competitive-companion) + VS Code 扩展 [Competitive Programming Helper](https://marketplace.visualstudio.com/items?itemName=DivyanshuAgrawal.competitive-programming-helper)

## 快速开始

1. 克隆仓库，用 VS Code **打开整个文件夹**（工作区根目录就是本仓库根目录）：

   ```powershell
   git clone <仓库地址> 算竞
   code 算竞
   ```

2. **安装本地 VS Code 插件**（活动栏会出现「CF 训练」）：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File tools\install-vscode-extension.ps1
   ```

   然后在 VS Code 里 `Ctrl+Shift+P` → `Developer: Reload Window`。

3. **样例自测**：打开题目 `.cpp` 后，活动栏「CF 训练」→「样例自测」块会读取样例；点「▶ 运行全部样例」显示通过数、得分和逐题 PASS/FAIL（Gym 需先设置 Cookie）。4. **配置 AI（可选但推荐）**：面板「AI 助手」→ ⚙️ 设置 AI API，或 `Ctrl+,` 搜 `CF 训练`，或编辑 `training/ai-config.json`：

   ```json
   { "baseUrl": "https://api.deepseek.com", "apiKey": "sk-...", "model": "deepseek-flash" }
   ```

   然后点「🔌 测试 AI 连接」。API Key 只保存在本机，**不要提交到仓库**（`.gitignore` 已忽略 `training/ai-config.json`）。

5. 把 `new.cpp` 改成你自己的代码模板（`tools\pull-contest.js` 会用它生成新题文件）。

## 更新（已经部署的用户）

仓库根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\update.ps1
```

它会依次做：`git pull --ff-only` → 重装本地插件，最后按提示 `Developer: Reload Window` 即可。
只更新一部分：`-SkipPull`（不 git pull）/ `-NoExtension`（不重装插件）。
本地有改动导致 pull 失败时，先 `git stash` 或提交，再更新。

维护者发布更新：改代码（插件功能变化时改 `package.json` 的 `version`）→ 记录到 `CHANGELOG.md` → `git commit && git push`。建议同时执行 `tools\package-extension.ps1` 生成 `.vsix` 并上传到 GitCode Release，方便没 clone 仓库的人安装。

维护者提交与推送（带密钥/个人文件拦截）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\ship.ps1 -Message "说明这次改了什么"
```

会先做安全检查（拦截 `training/ai-config.json`、CF handle、plan/redo、`.build/`、`dist/`、`.vsix`、`sk-...` 形式的 key），再 `git add -A` → commit → push。`-DryRun` 只检查不提交，`-NoPush` 只提交不推送。

## 分发 / 上架

| 方式 | 用户要做什么 | 之后怎么更新 |
| --- | --- | --- |
| **GitCode 仓库（推荐）** | clone/下载仓库 → 打开文件夹 → 跑 `tools\install-vscode-extension.ps1` | `git pull` + `tools\update.ps1` |
| **.vsix 安装包** | 从 Release 下载 `.vsix` → VS Code「Install from VSIX」；工具脚本仍需仓库 | 下载安装新 `.vsix` |
| **VS Code Marketplace** | 扩展市场搜索安装；**工具脚本仍需要 clone 仓库**（插件按工作区 `tools/` 找脚本） | 市场自动更新插件；脚本仍需 git pull |

生成 `.vsix`：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\package-extension.ps1
# -> dist\cf-training-tools-<version>.vsix
```

上架 VS Code Marketplace 的前置条件（一次性）：

1. Microsoft 账号 + Azure DevOps 组织，创建 Personal Access Token（scope 勾选 **Marketplace → Manage**）
2. 打开 https://marketplace.visualstudio.com/manage 创建 Publisher，得到 publisher ID
3. 用 publisher ID 打包/发布（脚本临时改 `package.json`，发布完自动还原）：

```powershell
$env:VSCE_PAT = '<Azure DevOps PAT>'
powershell -NoProfile -ExecutionPolicy Bypass -File tools\package-extension.ps1 -Publish -Publisher <publisher-id>
```

也可以加 `-Publisher <publisher-id>` 只打包，然后手动在 Marketplace 网页上传 `.vsix`。上架前建议补一个 `LICENSE` 文件（Marketplace 会显示 license 信息）；Open VSX（VSCodium 等）可以用 `npx --yes ovsx publish`。

> 注意：Marketplace 安装的是全局插件，而本项目的脚本/模板在仓库工作区里。想做到「市场装完就能用」，需要把 `tools/` 打包进插件并在首次运行时复制到工作区（尚未实现）。

## 常用命令

```powershell
# 拉题（浏览器点 Competitive Companion，题自动进 codeforces/<比赛>/，并生成题面 md）

# 编译 / 跑样例 / 手写输入 / 对拍
powershell -NoProfile -ExecutionPolicy Bypass -File tools\cp.ps1 build   -Solution "codeforces\1131 div3\2278A.cpp"
powershell -NoProfile -ExecutionPolicy Bypass -File tools\cp.ps1 samples -Solution "codeforces\1131 div3\2278A.cpp"
powershell -NoProfile -ExecutionPolicy Bypass -File tools\cp.ps1 run     -Solution "codeforces\1131 div3\2278A.cpp" -InFile .build\case1.in
powershell -NoProfile -ExecutionPolicy Bypass -File tools\cp.ps1 stress  -Solution sol.cpp -Brute brute.cpp -Generator gen.cpp -Rounds 300

# 题面：单题 / 整场
node tools\cph-statement.js "https://codeforces.com/contest/2278/problem/A" "codeforces\1131 div3\2278A.md" --force
node tools\pull-contest.js https://codeforces.com/contest/2278
node tools\pull-contest.js https://atcoder.jp/contests/abc402
node tools\pull-contest.js https://www.luogu.com.cn/contest/251050
node tools\pull-contest.js https://ac.nowcoder.com/acm/contest/85333

# 周题单 / 赛后复盘
powershell -NoProfile -ExecutionPolicy Bypass -File tools\cf-plan.ps1 -Count 6
powershell -NoProfile -ExecutionPolicy Bypass -File tools\cf-review.ps1 -ContestId 2278

# AI：连通性 / 整篇翻译 / 复盘分析 / 分级提示 / 问答
node tools\ai-client.js ping
node tools\ai-client.js translate "codeforces\1131 div3\2278A.md" --out .build\2278A.zh.md
node tools\ai-client.js review "codeforces\1131 div3" --out "codeforces\1131 div3\review.ai.md"
node tools\ai-client.js hint --md "codeforces\1131 div3\2278A.md" --cpp "codeforces\1131 div3\2278A.cpp" --level 2
node tools\ai-client.js ask --md "codeforces\1131 div3\2278A.md" --cpp "codeforces\1131 div3\2278A.cpp" --question "我的做法为什么 WA？"
```

## 插件面板（活动栏「CF 训练」）

- **AI 助手**：AI 提示（当前题）、问 AI、AI 复盘、AI 翻译题面、设置 AI API、测试连接、在 VS Code 设置中编辑
- **训练**：抓取整场比赛（洛谷/牛客/AtCoder）、生成/刷新周题单、复盘最近一场、复盘指定比赛
- **题面**：打开当前题面预览、重新抓取当前题面
- **代码**：编译并跑样例、只编译
- **设置/维护**：设置 CF handle、CF 登录 Cookie、打开训练手册

状态栏也有「CF 训练」和 AI 配置状态入口。

## 平台支持

| 平台 | 拉题到本地 | 题面 md | 整场抓取 | 样例缓存 |
| --- | --- | --- | --- | --- |
| Codeforces（正赛） | CPH 拉题 / `pull-contest.js` | ✅ | ✅ | ✅ |
| Codeforces Gym / 私有题 | CPH 可拉，但题面需登录 | ❌ | ❌（API 需登录） | ✅ |
| AtCoder | CPH 拉题 | ✅ | ✅ `pull-contest.js` | ✅ |
| 洛谷 | ❌（CPH 不支持） | ✅ | ✅ `pull-contest.js` | ✅ |
| 牛客 | ❌（CPH 不支持） | ✅ | ✅ `pull-contest.js` | ✅ |

> Codeforces 题面页有 Cloudflare 防护，普通脚本请求可能被 403；`cph-statement.js` 会自动改用洛谷镜像 `luogu.com.cn/problem/CF<contestId><index>` 抓题面，所以 CF 正赛整场抓取和 CPH 拉题生成的 md 都能正常完成；Gym/私有比赛仍需登录，抓不到。

## 目录结构

```
.
├─ AGENTS.md                 # 给 AI coding agent 的工作区操作手册（环境/流程/坑）
├─ new.cpp                   # 代码模板（pull-contest 用它生成新题）
├─ tools/
│  ├─ cp.ps1                 # 编译 / 跑样例 / 手写输入 / 对拍
│  ├─ mkdata.ps1             # 造题数据生成与校验
│  ├─ cph-statement.js       # 单题题面 → md（CF/AtCoder/洛谷/牛客，AI/Bing 翻译）
│  ├─ cph-statements.ps1     # 单题题面重抓（插件内部用）
│  ├─ pull-contest.js        # 整场抓取（AtCoder/洛谷/牛客）
│  ├─ cf-plan.ps1            # 周题单（CF+AtCoder+洛谷弱项选题）
│  ├─ cf-review.ps1          # 赛后复盘数据
│  ├─ ai-client.js / _ai.js  # AI 翻译/复盘/提示/问答（OpenAI 兼容）
│  ├─ install-vscode-extension.ps1
│  └─ vscode-extension/      # 本地 VS Code 插件源码
├─ training/                 # 训练产出（个人数据已被 .gitignore 忽略）+ 使用手册
└─ templates/                # 造题模板（statement/gen/brute/checker）
```

## 配置与隐私

- `training/ai-config.json`（API Key）、`training/cf-handle.txt`、`training/plan.*`、`training/redo.md` 等个人配置与数据都已在 `.gitignore` 中忽略，不会被提交
- API Key 只保存在本机（文件或 VS Code 设置），请勿提交或分享
- 题面/样例来自各平台公开页面，仅用于个人学习

## 已知限制

- 仅支持 Windows（脚本用 PowerShell 5.1 + `curl.exe`；含中文的 `.ps1` 必须 UTF-8 with BOM）
- CPH Gym/私有题页面需要登录，抓不到题面；洛谷比赛未开始/未公开时拿不到题目列表；牛客比赛进行中或私有比赛需要登录
- 样例自测由本工具用 g++ 编译（gnu++23 + O2 + 大栈）

## 开发

- 修改插件源码后：`tools\install-vscode-extension.ps1` → Reload Window
- 修改 `cph-statement.js` 后可用 `--html=page.html` 离线调试解析

## License

个人学习使用；第三方题目内容版权归各平台/出题人所有。
