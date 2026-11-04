# 训练手册（怎么让 agent 带你练算法）

> 交流群：QQ **188241279**（问题反馈 / 使用交流 / 更新通知）

前提：本工作区的 CPH 已打补丁——拉题自动建 `codeforces/<比赛>/` 目录，生成中英对照题面 `<题号>.md` 并自动开预览。

## 一句话开关

| 你想做什么 | 直接对我说 |
| --- | --- |
| 做题卡住，想自己先想 | 「训练模式：这题只给提示，别给代码」 |
| 赛后复盘 | 「复盘 codeforces/1131 div3」 |
| 要一周题单 | 「按 Div3 中档题给我这周 5 题」 |
| 查代码 / 找 bug | 「review codeforces/1131 div3/2278D.cpp，帮我构造 hack 数据」 |
| 补一个专题 | 「讲一下树状数组，给 3 道递进练习」 |
| 模拟赛 | 「开一场 2 小时 Div3 模拟，按时间放题，别剧透」 |

## 训练模式的提示阶梯

我说「训练模式」后，agent 默认**不写完整代码**，按下面逐级给：

1. 方向：关键观察 / 用哪类算法 / 复杂度应该是多少
2. 具体步骤：状态定义、转移、要维护什么
3. 伪代码
4. 完整代码（只有你明确说「给代码 / 看标解」才给）

卡住时可以说「升一级」，不想看提示就说「换个方向」，想自己写就说「先别说了」。

## 每周循环（目标：Div 尽可能多过）

1. virtual 1~2 场（Div3 / Div4 为主，Div2 教育场也行）
2. 自己写：A/B 限时 10~15 分钟不纠结；中档题卡 20~30 分钟再要提示
3. 赛后立刻 upsolve 没过的题，每题写 2~3 行「关键观察」
4. 我生成 `codeforces/<比赛>/review.md`（卡点、正确思路、要补的专题）+ `training/plan.md` 周题单
5. 一周后从 `training/redo.md` 把「看题解才会」的题重做一遍

「多过题」的瓶颈通常不在 A/B，而在 **C/D 的 WA 次数** 和 **E/F 能不能啃下来**，所以复盘重点记：错在思路，还是错在边界/实现。

## 需要我自动复盘 / 生成题单时

已经配置好：handle 在 `training/cf-handle.txt`（模板见 `training/cf-handle.example.txt`），工具直接跑就行：

```powershell
# 生成周题单 + 重做队列（training/plan.md、training/redo.md）
powershell -NoProfile -ExecutionPolicy Bypass -File tools\cf-plan.ps1

# 生成某场比赛的复盘数据（默认最近一场；数据由 CF API 填，分析由 agent 补）
powershell -NoProfile -ExecutionPolicy Bypass -File tools\cf-review.ps1 -ContestId 2278
```

说明：
- 复盘/题单需要 Codeforces 公开 API（经 `curl.exe`），统计的是最近 1000 次提交
- **私有 gym / 隐藏比赛查不到**（API 返回 `contestId not found`），这种只能基于本地文件手动复盘
- 不想用 API 也行，只是数据要你手动贴

## VS Code 插件（已装好）

- **左侧活动栏 🎓 图标「算法训练」**：面板顶部就是**当前题单**（本周题单里的题，点一下直接在浏览器打开；CF/AtCoder/洛谷都有），下面是分组按钮
- 左下角状态栏「算法训练」：弹出命令菜单
- `Ctrl+Shift+P` 搜 `算法训练`：命令面板

面板里的按钮：生成/刷新周题单（三平台选题）、复盘最近一场、复盘指定比赛、打开/重新抓取当前题面、全部题面重生成、编译并跑样例、只编译、设置 CF handle、CPH 补丁状态/重打/回滚、打开训练手册。

题单来源：**Codeforces**（弱项 tag + rating）、**AtCoder**（kenkoooo 题库 + difficulty）、**洛谷**（题库 difficulty 3/4）；默认数量 CF 占一半，其余两平台均分，某平台失败自动 CF 补位。

插件源码在 `tools/vscode-extension/algorithm-training-tool/`，安装/更新/卸载：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\install-vscode-extension.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools\install-vscode-extension.ps1 -Uninstall
```

## AI 助手（可选，强烈建议配）

配置 `training/ai-config.json`（OpenAI 兼容，默认 DeepSeek）：

```json
{ "baseUrl": "https://api.deepseek.com", "apiKey": "sk-...", "model": "deepseek-flash" }
```

> DeepSeek 当前支持的模型名是 `deepseek-flash` / `deepseek-v4-pro`；填错时客户端会读服务端返回的可用列表自动改用一个能用的模型（仅本次调用），然后提示你更新配置。

- 最方便：VS Code 面板点 **「⚙️ 设置 AI API」**（保存后会自动提示测试连接）；或者 `Ctrl+,` 搜 `算法训练`，在设置页填 `algorithm-training-tool.ai.baseUrl / ai.model / ai.apiKey`
- 左下角状态栏有 **$(sparkle) AI 已配置 / AI 未配置**，点一下直接改
- 两种方式都会同步写入 `training/ai-config.json`（脚本读这个文件），key 只存本地
- 配好后：
  - 拉题抓题面时**优先用 AI 翻译**（失败自动退回 Bing）
  - 面板「AI 提示」= 会先读你当前编辑器里的代码（含未保存修改）做代码体检，再分级提示（方向 → 步骤 → 伪代码，不直接给完整代码）
  - 面板「问 AI」= 带题面 + 你当前代码（含未保存修改）提问
  - 面板「AI 复盘」= 生成 `codeforces/<比赛>/review.ai.md`（卡点/关键观察/总结）
  - 面板「AI 翻译当前题面」= 用 AI 重译当前题
- 命令行：`node tools/ai-client.js ping|translate|review|hint|ask ...`
- 支持的 API：DeepSeek、SiliconFlow、任意 OpenAI 兼容网关（OpenAI 官方从本机不可达）

## 抓取整场比赛（Codeforces / AtCoder / 洛谷 / 牛客）

```powershell
node tools\pull-contest.js https://codeforces.com/contest/2278
node tools\pull-contest.js https://atcoder.jp/contests/abc402
node tools\pull-contest.js https://www.luogu.com.cn/contest/251050
node tools\pull-contest.js https://ac.nowcoder.com/acm/contest/85333

# 单个题目
node tools\pull-contest.js https://codeforces.com/contest/2278/problem/A --single
```

- 每道题生成 `题面.md` + 从**初始模板**复制的 `.cpp` + 结构化题面数据 `.json` + CPH `.cph` 样例缓存（`cp.ps1 samples`、CPH 按钮都能跑样例）；整场还会生成 `contest.json`
- 抓取时进度条可点**取消**；抓取完可「选择题目打开」，自动分屏题面 md（打开有同名 md 的 cpp 也会自动分屏，可用设置 algorithm-training-tool.autoStatementPreview=false 关闭）\n- 默认跳过已有 md；`--force` 覆盖，`--only=A,B` 只抓部分，`--out=<dir>` 指定输出目录，`--no-cpp` 只抓题面
- **初始模板**：默认 `new.cpp`；`--template=<文件>` / 插件设置 `algorithm-training-tool.pull.template` / `training/pull-config.json` 三选一（见项目 README）
- 插件面板「📥 抓取整场比赛」/「📥 抓取单个题目」同款；洛谷比赛题会自动带 `?contestId=`，牛客自动探测 A..Z 题号
- **Codeforces**：正赛用 CF API 枚举；题面页被 Cloudflare 403 时自动改用洛谷镜像 `CF<id><index>` 抓取。**Gym/私有比赛需要登录，不支持整场抓取**。

## Codeforces Gym / 私有比赛

Gym 需要登录：浏览器登录并报名后，面板「设置 / 维护」→「🍪 设置 CF 登录 Cookie」，粘贴 `codeforces.com` 请求的 Cookie 整行（含 JSESSIONID / cf_clearance）。验证成功后会显示 handle，之后整场/单题 Gym 抓取自动带登录态。Cookie 只存本地 `training/cf-cookies.txt`（gitignore），过期重新设置即可。
## 本目录约定

```
training/
  plan.md    周题单（cf-plan.ps1 生成）
  redo.md    重做队列（cf-plan.ps1 生成）
  log.md     打卡/用时记录（可选）
  cf-handle.txt  Codeforces handle
```

比赛目录下的 `review.md` 跟题目放一起：`codeforces/<比赛>/review.md`。
