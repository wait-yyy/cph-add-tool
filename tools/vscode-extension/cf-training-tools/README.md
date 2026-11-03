# CF Training Tools（本地 VS Code 插件）

把本工作区 `tools/` 下的训练脚本包成 VS Code 命令 / 按钮，避免每次手敲 PowerShell。

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
| 题面 | 重新生成全部题面 md | 批量重抓+重翻译 |
| 代码 | 编译并跑样例 / 只编译 | 跑 `cp.ps1 samples/build` |
| 设置 | 设置 CF handle | 写 `training/cf-handle.txt` |
| 维护 | 查看 / 重新打 / 回滚 CPH 补丁 | 跑 `cph-folder-patch.ps1` |
| 帮助 | 打开训练手册 | 打开 `training/README.md` 预览 |

## 题单来源

- **Codeforces**：官方 problemset API，按你的弱项 tag + rating 区间挑
- **AtCoder**：kenkoooo 公开题库 + difficulty 模型，默认难度 `rating±200`
- **洛谷**：题库列表页（difficulty 3/4），脚本自动拿 C3VK cookie
- 默认数量分配：CF 占一半，其余 AtCoder/洛谷均分；某平台失败会自动用 CF 补位

## 抓取整场比赛（AtCoder / 洛谷 / 牛客）

面板「训练」分组 → **📥 抓取整场比赛（洛谷/牛客/AtCoder）**，粘贴比赛链接即可：

- `https://atcoder.jp/contests/abc402`
- `https://www.luogu.com.cn/contest/251050`
- `https://ac.nowcoder.com/acm/contest/85333`

会为每道题生成：`<题号>.md` 题面（英文自动 AI/ Bing 翻译）、`<题号>.cpp`（从 `new.cpp` 复制）、`.cph` 样例缓存（CPH 按钮和 `cp.ps1 samples` 都能直接跑样例）。已存在的 md 默认跳过，需要刷新在终端加 `--force`。

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

- 拉题后题面 md 生成完会自动在右侧打开预览，但**只对当前正在编辑的那道题生效**：整场拉题（一次拉很多题）时不会弹出一堆预览，只有最后一个正在编辑的题目会开
- 30 秒内同一份题面不会重复弹预览
- 想彻底关掉：VS Code 设置里把 `cf-training-tools.autoPreview` 设为 `false`（或用 `Ctrl+,` 搜 `CF 训练`）

## 说明

- 需要打开本工作区根目录（扩展按 `workspaceFolders[0]` 找 `tools/`）
- 拉题自动建目录 / 自动生成中英题面 / 自动开预览仍是 CPH 补丁负责，本插件是手动操作的入口
- 所有输出在 **输出** 面板的「CF 训练工具」频道
- 改完源码后跑一次 `install-vscode-extension.ps1` 再 Reload
