# CF Training Tools（本地 VS Code 插件）

把本工作区 `tools/` 下的训练脚本包成 VS Code 命令 / 按钮，避免每次手敲 PowerShell。

> 本插件是「工作区工具启动器」：需要配合 [cph-add-tool](https://gitcode.com/2403_86825600/cph-add-tool) 仓库里的 `tools/` 脚本使用（clone 仓库并用 VS Code 打开该文件夹）。只有插件、没有仓库时，按钮会提示脚本不存在。
>
> 交流群：QQ **188241279**（问题反馈 / 使用交流 / 更新通知）

## 安装 / 更新 / 卸载

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\install-vscode-extension.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools\install-vscode-extension.ps1 -Uninstall
```

装完 `Ctrl+Shift+P` → **Developer: Reload Window** 生效。

## 三种入口

1. **活动栏图标**（左侧竖条，🎓 图标 →「CF 训练」）：点开就是按钮面板，点按钮直接运行
2. **状态栏**左下角「🎓 CF 训练」：弹出命令菜单
3. **命令面板**：`Ctrl+Shift+P` 搜 `CF 训练`

## 面板里有什么

1. **当前题单**（顶部）：显示 `training/plan.json` 里的本周题目，每道题一行（平台徽章 + 题目 + 难度），**点一下直接在浏览器打开**；下面是「刷新 / 完整题单」和重做队列入口
2. **按钮分组**：

| 分组 | 按钮 | 作用 |
| --- | --- | --- |
| 训练 | 生成 / 刷新周题单 | 从 Codeforces + AtCoder + 洛谷三个平台选题，生成 `training/plan.md` / `plan.json`，面板自动刷新 |
| 训练 | 复盘最近一场 / 复盘指定比赛… | 跑 `cf-review.ps1`，打开 `review.md` |
| 题面 | 打开当前题面预览 | 打开当前 cpp 同目录 `<题号>.md` |
| 题面 | 重新抓取当前题面 | 跑 `cph-statements.ps1 -Solution <当前 cpp> -Force` |
| 代码 | 编译并跑样例 / 只编译 | 跑 `cp.ps1 samples/build` |
| 设置 | 设置 CF handle | 写 `training/cf-handle.txt` |
| 帮助 | 打开训练手册 | 打开 `training/README.md` 预览 |

## 题单来源

- **Codeforces**：官方 problemset API，按你的弱项 tag + rating 区间挑
- **AtCoder**：kenkoooo 公开题库 + difficulty 模型，默认难度 `rating±200`
- **洛谷**：题库列表页（difficulty 3/4），脚本自动拿 C3VK cookie
- 默认数量分配：CF 占一半，其余 AtCoder/洛谷均分；某平台失败会自动用 CF 补位

## 抓取整场比赛（Codeforces / AtCoder / 洛谷 / 牛客）

面板「训练」分组 → **📥 抓取整场比赛（CF/洛谷/牛客/AtCoder）**，粘贴比赛链接即可：

- `https://codeforces.com/contest/2278`（正赛；Gym/私有比赛需要登录，不支持）
- `https://atcoder.jp/contests/abc402`
- `https://www.luogu.com.cn/contest/251050`
- `https://ac.nowcoder.com/acm/contest/85333`

抓取过程中进度通知上有**取消按钮**（可随时中断）；抓取完成后可点「选择题目打开」→ 选一道题，会打开 cpp 并把题面 md **分屏**到侧边。

单个题目用面板「📥 抓取单个题目」或命令行 `--single`，会生成 md/cpp/.cph 并直接打开两栏。

会为每道题生成：`<题号>.md` 题面（英文自动 AI/ Bing 翻译）、`<题号>.cpp`（按**初始模板**生成）、`<题号>.json` 结构化题面数据、`.cph` 样例缓存（样例自测面板 / `cp.ps1 samples` 都能直接跑样例）；整场还会生成 `contest.json`。已存在的 md 默认跳过，需要刷新在终端加 `--force`。

初始模板默认是仓库根目录的 `new.cpp`，可以这样改：
- 面板「🧩 设置拉题初始模板」→ 选一个 `.cpp` 文件
- VS Code 设置 `cf-training-tools.pull.template`（相对路径或绝对路径）
- 命令行 `--template=<文件>`，或 `training/pull-config.json` 里的 `"template"`

> Codeforces 题面页有 Cloudflare 防护，`cph-statement.js` 会在 403 时自动改用洛谷镜像 `luogu.com.cn/problem/CF<contestId><index>` 抓题面；Gym/私有比赛仍需要登录。

## Codeforces Gym / 私有比赛（登录）

Gym/私有比赛需要登录：浏览器登录并报名后，面板「设置 / 维护」→「🍪 设置 CF 登录 Cookie」，粘贴浏览器里 `codeforces.com` 请求的 **Cookie** 整行即可（会自动验证并显示 handle）。Cookie 只存本机 `training/cf-cookies.txt`，已 gitignore；过期后重新设置，或用「🚪 清除 CF 登录 Cookie」退出。
## 样例自测（计分）

活动栏「CF 训练」→「样例自测」块：读取当前题目的 `.cph` 缓存或 `<题号>.json`，点「▶ 运行全部测试」编译并逐题运行，显示**样例/自定义通过数、总得分、百分比**；每个测试点可直接编辑输入/期望输出、单测运行并保存。每个测试点都可以**实时编辑**输入/期望输出：点「▶ 运行此测试」只跑这一条，点「▶ 运行全部测试」会先自动保存所有编辑再跑（样例修改存 `<题号>.sample-overrides.json`，自定义存 `<题号>.custom-tests.json`）。打开/切换 `.cpp` 时面板自动刷新，不需要手动「重新读取」。

## AI 助手（OpenAI 兼容 API）

**三个地方都能设置，任选一个：**

1. 面板「AI 助手」分组 → **⚙️ 设置 AI API**（弹输入框：baseUrl → 选模型 → API Key → 自动提示测试连接）
2. 面板「🧰 在 VS Code 设置中编辑」或 `Ctrl+,` 搜 `CF 训练`（配置项 `cf-training-tools.ai.baseUrl / ai.model / ai.apiKey / ai.temperature`）
3. 直接编辑 `training/ai-config.json`

左下角状态栏会显示 **$(sparkle) AI 已配置 / AI 未配置**，点一下就能改。DeepSeek 当前模型名是 `deepseek-flash` / `deepseek-v4-pro`。

| 按钮 | 作用 |
| --- | --- |
| 💡 AI 提示（当前题） | 先读你**当前编辑器里的代码（包括未保存的修改）**做「代码体检」（思路对不对/哪里可能是 bug/哪一步没写完），再按级别给针对性提示；教练模式，不直接给完整代码 |
| ❓ 问 AI（当前题） | 带题面 + 当前代码提问，默认只给思路 |
| 🧠 AI 复盘（选比赛） | 先刷新 `review.md` 数据，再生成 `review.ai.md`（卡点/关键观察/总结） |
| 🌐 AI 翻译当前题面 | 重抓题面并用 AI 翻译（失败自动退回 Bing） |
| ⚙️ 设置 AI API / 🔌 测试 AI 连接 / 🧰 VS Code 设置 | 配置与连通性测试 |

配置好后，拉题自动生成的中英题面也会优先用 AI 翻译。生成的 AI 结果在 `.build/ai-hint.md` / `.build/ai-answer.md` 或比赛目录 `review.ai.md`，并自动打开预览。

## 题面自动预览

- 打开任何有同名 .md 的 .cpp 时，会自动在侧边分屏题面预览；VS Code 设置 cf-training-tools.autoStatementPreview=false 可关闭

- 拉题后题面 md 生成完会自动在右侧打开预览，但**只对当前正在编辑的那道题生效**：整场拉题（一次拉很多题）时不会弹出一堆预览，只有最后一个正在编辑的题目会开
- 30 秒内同一份题面不会重复弹预览
- 想彻底关掉：VS Code 设置里把 `cf-training-tools.autoPreview` 设为 `false`（或用 `Ctrl+,` 搜 `CF 训练`）

## 说明

- 需要打开本工作区根目录（扩展按 `workspaceFolders[0]` 找 `tools/`）
- 所有输出在 **输出** 面板的「CF 训练工具」频道
- 改完源码后跑一次 `install-vscode-extension.ps1` 再 Reload
