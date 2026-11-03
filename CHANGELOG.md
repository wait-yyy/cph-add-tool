# 更新日志

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
