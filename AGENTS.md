# 算法竞赛工作区 · agent 操作手册

> 本文件由 DSH 作为工作区指令自动加载。读者是 agent，不是人。
> 目标：在这个仓库里高效地 **解题 / 读题 / 造题**，少走弯路、少跑无效命令。
> 如果你发现约定有缺漏，直接改本文件，别把约定留在对话里。

## 1. 环境事实（已实测，不要再猜）

| 项 | 值 |
| --- | --- |
| 系统 / shell | Windows，**只有 Windows PowerShell 5.1**（没有 pwsh 7）。脚本禁用 PS7-only 语法（`??`、`?.`、`Join-String`、`-Parallel` 等） |
| 调脚本 | `powershell -NoProfile -ExecutionPolicy Bypass -File tools\cp.ps1 ...`（ExecutionPolicy 是 RemoteSigned，但加 Bypass 更省心） |
| 编译器 | `C:\msys64\ucrt64\bin\g++.exe`（GCC 16.2.0，UCRT64；`g++` 已在 PATH） |
| 调试器 | `C:\msys64\ucrt64\bin\gdb.exe`（GDB 18.1） |
| Python | `C:\msys64\ucrt64\bin\python.exe`（3.14，算式/暴力/造数据辅助可用） |
| 编译器默认标准 | `gnu++17`；评测机（CF）是 **GNU G++23** → 一律显式 `-std=gnu++23` |
| 优化 | 不显式 `-O2` 时本地会慢一个数量级 → 计时/验复杂度必须 `-O2` |
| 栈 | Windows 默认 1MB，深递归（约 1e5+ 层）会爆栈 → 必须 `-Wl,--stack=268435456` |
| 消毒器 | **没有 ASan/UBSan**（`-fsanitize=address,undefined` 链接失败，缺 `libasan/libubsan`）。替代：`-g -D_GLIBCXX_DEBUG` |
| 其他工具 | 没有 clang / clang-format / valgrind；`Invoke-WebRequest`、`git clone` 和外网 API 大多不通（CF 还有 Cloudflare 反爬） |
| 网络 | agent 工具的 `web_fetch` / `web_search` 可上网；**脚本里只有 `curl.exe` 带浏览器 UA 能过 CF 的 Cloudflare**（PowerShell `Invoke-WebRequest`、Node 原生 https 默认会被 403）→ 题面抓取用 `tools\cph-statement.js` 的 curl 路径；Bing 翻译走 `cn.bing.com`；AI 走 OpenAI 兼容 API（实测 DeepSeek / SiliconFlow 可达，OpenAI 官方被墙），配置在 `training\ai-config.json`；**AtCoder / 洛谷 / 牛客题面也能匿名抓**（洛谷比赛题必须带 `?contestId=<比赛id>`，pull-contest 会自动加）。CF 题面页被 Cloudflare 403 时，`cph-statement.js` 会自动改用洛谷镜像 `luogu.com.cn/problem/CF<contestId><index>`（Gym/私有题无镜像；Gym/私有比赛可在面板「设置 CF 登录 Cookie」保存浏览器 Cookie，脚本会自动带上） |
| 进程控制 | 沙箱下 `Start-Process` 读不到子进程 ExitCode，`taskkill`/`Wait-Process` 会被拒绝；只有自己 `CreateProcess` 的句柄才能 Kill → 跑程序一律走 `tools\_runner.cpp` |

## 2. 目录约定

```
<根>/
  codeforces/<比赛>/<题号>.cpp   拉来的题；CPH 补丁自动建比赛目录（同目录有 .cph/ 样例缓存、<题号>.bin、<题号>.md 中英对照题面）
  new.cpp               用户的模板（CPH 全局设置指向它）→ 不要改
  new1.cpp / 训练.cpp   用户的历史草稿，别动
  729808A.cpp ...       早期历史题可能还平铺在根目录；别动，也不要主动搬（搬了 .cph 缓存会失联）
  .cph/                 根目录 cpp 的 CPH 样例缓存；比赛目录里的题缓存在各自 codeforces/<比赛>/.cph/
  .build/               agent 的编译产物、对拍临时文件；可随时整个删掉（脚本会自动重建）
  tools/                agent 工具：cp.ps1（解题）、mkdata.ps1（造题）、_common.ps1、
                        cph-folder-patch.ps1（CPH 补丁：按比赛建目录 + 拉题自动抓题面 md）、
                        cph-statement.js / cph-statements.ps1（题面抓取脚本；批量补跑/重抓）、
                        _cf_api.ps1 / cf-plan.ps1 / cf-review.ps1（Codeforces 训练：周题单、赛后复盘）、
                        _ai.js / ai-client.js（AI：题面翻译、复盘总结、分级提示、问答；OpenAI 兼容）、
                        pull-contest.js（整场抓取：Codeforces / AtCoder / 洛谷 / 牛客 → 题面 md + cpp + CPH 样例缓存）、
                        _cf_auth.js / cf-login-check.js（Codeforces 登录 Cookie：Gym/私有比赛）、
                        install-vscode-extension.ps1 + vscode-extension/（本地 VS Code 插件源码）、
                        _runner.cpp（原生运行器，首次运行自动编译成 .build\_runner.exe）
  templates/            造题模板：gen.cpp / brute.cpp / checker.cpp / statement.md
  problems/<slug>/      造题工程（按需创建，见 §5）
```

规则：
- 临时文件（输入、输出、编译产物）只放 `.build/`，别在根目录堆垃圾。
- **不要改用户已写的 `.cpp`**，除非用户明确点名要改；要改就整份列出或明确说明改哪几行。
- **不要移动/重命名拉来的题**：CPH 样例缓存按“源文件完整路径的 md5”命名（`.cph/.<文件名>_<md5>.prob`），挪文件后缓存失联、样例和 CPH 判题都不认；解题直接在 CPH 建好的 `codeforces/<比赛>/` 目录里进行。
- 不要创建 `.vscode/`、`.editorconfig`、`.gitignore`，不要执行 git 操作（用户明确表示不需要）。
- 脚本输出是 ASCII（PS 5.1 控制台编码会毁掉 UTF-8 中文）；文件内容用 **UTF-8 无 BOM**。例外：**含中文字符串的 `.ps1` 必须存 UTF-8 with BOM**，否则 PS 5.1 按 GBK 解析直接语法错误（`_cf_api.ps1` / `cf-plan.ps1` / `cf-review.ps1` 就是 BOM 文件）。

## 3. 解题流程（标准动作）

### 3.1 读题
1. 先读 CPH 拉题时自动生成的**中英对照**题面：`codeforces/<比赛>/<题号>.md`（每段英文下一行中文翻译；标题形如 `## Input / 输入`；样例代码块不翻译）。没有 md 时再看样例缓存（缓存与源文件同级；根目录老题才在根 `.cph/`）：
   - 比赛目录题：`Get-ChildItem 'codeforces\1131 div3\.cph' -Filter '.<文件名>_*.prob'`
   - 根目录老题：`Get-ChildItem .cph -Filter '.<文件名>_*.prob'`
   `.prob` 是 JSON，里面有题目名、大赛、URL、TL/ML、全部样例；同一文件可能有多个 hash（文件被移动过），取最新的。
2. 需要完整题面时用 `web_fetch`：
   - CF：`https://codeforces.com/problemset/problem/<contest>/<index>`（偶尔会返回首页，兜底 `https://codeforces.com/contest/<contest>/problem/<index>?locale=en`）
   - 洛谷：`https://www.luogu.com.cn/problem/P1234`
   - AtCoder：`https://atcoder.jp/contests/<contest>/tasks/<task>?lang=en`
   - 要标签/难度：`https://codeforces.com/api/problemset.problems`（JSON，可读）
3. md 缺失时（Gym 需登录抓不到、Luogu 未支持、或网络抖动）才用 `web_fetch` 抓题面，存到源文件同目录 `<题号>.md`（不要另建 `statements/`）；开头写 5~10 行中文摘要：题意、输入输出、限制、样例结论、易错点。下次直接用，不要重复抓。
   - Codeforces / AtCoder / 洛谷 / 牛客的整场比赛可以直接跑 `node tools\pull-contest.js <比赛链接>`：自动抓全部题面 md、按 `new.cpp` 建 cpp、生成 CPH `.cph` 样例缓存（之后 `cp.ps1 samples` / CPH 按钮都能跑样例）；支持 `--only=A,B`、`--out=<dir>`、`--force`、`--no-cpp`。CF 正赛走 API 枚举 + 洛谷镜像兜底；Gym/私有比赛需登录，不支持。

### 3.2 写代码
- 从 `new.cpp` 复制风格：`bits/extc++.h` + `bits/stdc++.h`、`#define int long long`、`#define endl '\n'`、`all(a)`、`gp_hash_table`、`signed main`、`const ll inf/MOD/mod/N`。
- 新题文件名 = 题号（如 `2279A.cpp`）；CPH 拉题时会自动放到 `codeforces/<比赛>/` 下并打开，直接写那个文件，不要移动/另存。
- 多组默认读 `T`；单组把 `cin >> T` 删掉或 `T = 1`（不要留无用变量被 `-Wall` 抱怨）。
- `#define int long long` 下：数组大小/比较器要写成 `int` 也按 64 位算；确需 32 位用 `int32_t`。
- 交题前删掉调试输出、`freopen`、`#ifdef POCKET` 之类。

### 3.3 验证（必须做，别只靠肉眼看代码）
```powershell
# 编译（gnu++23 + O2 + 大栈 + 和 CPH 一致的 -D DEBUG -D CPH）；路径含空格必须加引号
powershell -NoProfile -ExecutionPolicy Bypass -File tools\cp.ps1 build -Solution "codeforces\1131 div3\2278A.cpp"

# 跑同目录 .cph 里的全部样例（自动对比，PASS/FAIL + 耗时）
powershell -NoProfile -ExecutionPolicy Bypass -File tools\cp.ps1 samples -Solution "codeforces\1131 div3\2278A.cpp"

# 用手写输入跑一次（不给 -InFile 时自动用同目录 input.txt，没有就喂空输入）
powershell -NoProfile -ExecutionPolicy Bypass -File tools\cp.ps1 run -Solution "codeforces\1131 div3\2278A.cpp" -InFile .build\case1.in

# 对拍：gen 用 argv[1] 当 seed；失败会存 .build\fail_seed<seed>.in 并打印输入
powershell -NoProfile -ExecutionPolicy Bypass -File tools\cp.ps1 stress -Solution sol.cpp -Brute brute.cpp -Generator gen.cpp -Rounds 300
```
退出码：`0` 成功，`1` 失败（编译错/WA/RE/TLE），`2` 用法错或无数据。
需要调试编译时加 `-DebugBuild`（`-O0 -g3 -D_GLIBCXX_DEBUG`，会随机报 STL 越界，代替 sanitizer）。
编译产物在 `.build/`：名字是源文件名去掉扩展名加 `.exe`；源文件名含非 ASCII（如 `训练.cpp`）时会变成 `___<hash8>.exe`（原因见 §6）。

### 3.4 交付
- 先给结论：算法/关键观察、复杂度、易错点（1~3 行），再给代码，最后给验证结果（samples 几/几、对拍轮数、最坏耗时）。
- 不自动提交到评测机，除非用户要求；提交语言选 GNU G++23。
- 用户中文交流，回答用中文。

## 4. CPH 扩展的行为（会影响你的判断）

- CPH 编译命令等价于：`g++ "<file>" -o "<file>.bin" <用户全局 settings 的 cph.language.cpp.Args> -D DEBUG -D CPH`。
  用户全局 Args 目前是**空的** → 用 CPH 按钮跑出来的程序是 **gnu++17、无 -O2、1MB 栈**。
  所以：**计时/验复杂度/大递归一律用 `cp.ps1`**，别用 CPH 的耗时下结论。
- CPH 产物是 `<名字>.bin`，不是源码，别把它当文件读。
- `-D DEBUG`、`-D CPH` 在 CPH 编译时一定存在；`cp.ps1` 为了对齐也加了这两个宏。
- CPH 的样例缓存与源文件同级：`.cph/.<完整文件名>_<md5(源文件完整路径)>.prob`（JSON，字段见 §2）。**挪动/改名源文件后 hash 变化，缓存失联**。
- 本机 CPH 已打过“按比赛建目录”补丁（`tools\cph-folder-patch.ps1`）：拉题时源文件写到 `codeforces/<比赛>/<题号>.cpp`，`.cph/` 和 `.bin` 跟着进同目录。扩展升级/重装会用新文件覆盖 `dist\extension.js` → 补丁失效，重跑 `-Action apply` 即可（`-Action status` 查看、`-Action revert` 回滚；备份在扩展目录 `dist\extension.js.cph-folder-orig`）。改完需重载 VS Code 窗口才生效。
- 题面 md 是拉题时自动生成的**中英对照**版本：补丁 spawn `node tools\cph-statement.js` 抓原题页面→Markdown，再翻译成中文（**配置了 `training\ai-config.json` 时优先用 AI 翻译，否则/失败时退回 Bing**；每段英文后跟一行中文；样例代码块、公式 `$...$` 保持原样），写盘后扩展自动 `markdown.showPreviewToSide` 打开预览。**自动预览只对当前正在编辑的那道题生效**（整场拉题不会弹一堆；30 秒内同一份 md 不重复开），可用 VS Code 设置 `algorithm-training-tool.autoPreview=false` 关闭。**支持 CF 正赛、AtCoder、洛谷、牛客**；Gym/私有题需登录（可设置 CF 登录 Cookie）。翻译失败会退回纯英文，失败原因看 `.build\cph-statement.log`。单题重抓：`powershell -NoProfile -ExecutionPolicy Bypass -File tools\cph-statements.ps1 -Solution <cpp> -Force`；手动抓单题可加 `--no-translate` 只出英文、`--no-ai` 强制走 Bing。**整场抓取**用 `node tools\pull-contest.js <比赛链接>`（Codeforces/AtCoder/洛谷/牛客；CF 正赛 API 枚举、题面 403 时用洛谷镜像 `CF<id><index>`；洛谷比赛题自动带 `?contestId=`，牛客按 A..Z 自动探测题号），会同时建 cpp 和 `.cph` 样例缓存。Gym/私有比赛需登录（设置 Cookie 后可抓）。

## 5. 造题流程（出题/验题）

目录：
```
problems/<slug>/
  statement.md   题面（从 templates/statement.md 复制，内部备注也要写）
  gen.cpp        生成器：argv[1]=seed，stdout 输出数据
  sol.cpp        标解（用 new.cpp 模板风格写）
  brute.cpp      暴力（可选；有它才能交叉验证 + 对拍）
  checker.cpp    特判（可选；浮点/构造/多解题必需）
  data/          tXX.in / tXX.ans，由 mkdata 生成
```

动作：
```powershell
# 建目录 + 复制模板
New-Item -ItemType Directory -Force problems\slug | Out-Null
Copy-Item templates\statement.md, templates\gen.cpp, templates\brute.cpp problems\slug\

# 生成 30 组数据：gen(seed) -> .in，sol -> .ans，brute+checker 校验，打印每组耗时/大小
powershell -NoProfile -ExecutionPolicy Bypass -File tools\mkdata.ps1 -ProblemDir problems\slug -Count 30

# 标解写完先用暴力对拍，再定数据
powershell -NoProfile -ExecutionPolicy Bypass -File tools\cp.ps1 stress -Solution problems\slug\sol.cpp -Brute problems\slug\brute.cpp -Generator problems\slug\gen.cpp -Rounds 500
```
`mkdata` 里 checker 收到的是**相对仓库根**的路径（`problems\slug\data\tXX.in` 这种），所以 slug 用 ASCII 最稳；它用 brute 的输出校验 `ans`，标解写错时会报 `CHECKER REJECTED`。
出题检查清单（缺一项都算没做完）：
1. `statement.md` 的数据范围和 `gen.cpp` 里的常量**完全一致**；多组数据核对 Σ 限制。
2. `brute.cpp` 能在最大数据上跑完（否则没法验；实在不行给暴力加剪枝/换更小的子任务）。
3. 边界/极端数据不是靠随机撞出来的：显式构造 `n=1`、极值、全相同、单调、退化树/图、答案卡 long long。
4. 随机的树/图要说明结构（避免随机树高 log、随机图不连通这类坑）。
5. 浮点/构造/多解 → 写 `checker.cpp`，并用一个**故意错的**输出验证 checker 会 WA。
6. 时限：取最慢测试点耗时的 2~3 倍；`mkdata` 会报超过 `-TimeLimitMs` 的点。
7. 用错解（或少一个特判的解）跑一遍数据，确认会被卡掉。

## 6. 已知坑（踩过就别再踩）

- `gp_hash_table` 在 `__gnu_pbds` 里，模板已 `using namespace __gnu_pbds;`；单独写文件时别忘。
- 没开 `-O2` 时 `bits/stdc++.h` 编译 1s 左右是正常的；`samples` 里显示的是**运行**时间，不含编译。
- 输出对比是宽松的：忽略行尾空白和末尾空行（`Get-NormalizedText`），但**不做**浮点容差，浮点题必须用 checker。
- 中文路径/文件名可以正常用（工作区路径含"算竞"），但脚本参数要加引号。
- **别手敲 `g++ -o <中文绝对路径或中文文件名>`**：g++ 把 `-o` 传给 ld 时会乱码（报 `ld: cannot open output file`）或生成乱码文件名（`训练.exe` → `ÑµÁ·.exe`）。一律 `cd` 到仓库根、用相对路径 + ASCII 产物名——`cp.ps1` 已经这么处理了。
- 别自己用 `Start-Process`/`taskkill`/`Wait-Process` 跑或杀程序（沙箱拒绝对非自有进程取退出码/终止）。`cp.ps1`/`mkdata.ps1` 内部用 `_runner.exe`：文件句柄喂 stdio、自己计时、自有句柄 TerminateProcess，所以 TLE/RE 都能准确判。
- `.build\_runner.exe` 由 `tools\_runner.cpp` 自动编译（改过源码会自动重建）；`.build/` 删了也没关系。
- 沙箱里 `Invoke-WebRequest`/`git clone` 不通；要联网用 agent 的 `web_fetch`，或脚本里用 `curl.exe` + 浏览器 UA（CF 的 Cloudflare 只认这个，见 §1 和 `tools\cph-statement.js`）。
- 不要用 `-fsanitize=*`；不要指望 `ulimit`；线程栈默认也是 1MB，`-Wl,--stack` 只作用于主线程。
- PS 5.1 里 `$args`、`$input`、`$error` 是自动变量，写脚本别拿它们当普通变量名。
- CPH 扩展自动升级后，`codeforces/<比赛>/` 自动建目录的补丁会失效（`-Action status` 显示 `PATCHED no`）→ 重跑 `tools\cph-folder-patch.ps1`，别以为是 CPH 坏了。
- 题面 md 没生成 / 没翻译成中文 / 没自动开预览：先看 `.build\cph-statement.log`。Gym/需要登录的题抓不到是正常的；其他多半是 Cloudflare 或 Bing 翻译限流，用 `tools\cph-statements.ps1 -Solution <cpp> -Force` 重跑（单题）（必要时把 md 删掉重来）。抓取依赖 `node`、Windows 自带的 `curl.exe` 和 `cn.bing.com` 可访问。

## 7. 汇报与自检

收尾前自检：
- [ ] 解题前先读同目录 `<题号>.md`（没有才抓，别重复抓题面）
- [ ] `cp.ps1 build` 无 warning/错误
- [ ] `cp.ps1 samples` 全 PASS
- [ ] 复杂度能在限制内（给出量级估算，别只看样例）
- [ ] 边界（n=1、极值、全相同、负数、答案溢出）在 `run` 里验过
- [ ] 对拍 ≥200 轮（有暴力时）
- [ ] 没有调试残留输出

汇报格式：`改了什么 / 用的命令 / 结果（几/几 PASS、对拍轮数、最慢耗时）/ 下一步建议`，不要贴大段无关日志。

## 8. 训练模式（用户说「训练模式 / 别给代码 / 提示一下 / 复盘」时生效）

用户是在练算法，不是只要答案。默认**不写完整代码**，按提示阶梯逐级给：

1. 方向：关键观察 / 用哪类算法 / 复杂度
2. 具体步骤：状态定义、转移、要维护什么
3. 伪代码
4. 完整代码——只有用户明确说「给代码 / 看标解」才给

规则：
- 先复述确认题意（别急着讲做法），用户说「换个方向」就换一条思路。
- 用户 AC 后问一句「关键观察是什么」，把 2~3 行 insight 追加到题目同目录的 `<题号>.md` 末尾（`## 关键观察` 段）；**不要改用户的 `.cpp`**。
- 复盘：用户说「复盘 <比赛目录>」时，读该目录所有 `.cpp` + `.cph`/md，生成 `codeforces/<比赛>/review.md`：每题写 ① 状态（过/没过/WA 次数）② 卡点（思路错 vs 边界/实现错）③ 正确关键观察 ④ 下次类似题怎么想 ⑤ 要补的专题。题多时按通过情况分组，重点写没过的。
- 训练产出统一放 `training/`（`plan.md` 周题单、`redo.md` 重做队列、`log.md` 打卡），复盘 md 放比赛目录，不要散在根目录。
- 用户给出 CF handle 后，可用公开 API（`codeforces.com/api/user.status?handle=...`、`problemset.problems`、`contest.status`）拉数据辅助复盘/题单；请求走 `curl.exe` + 浏览器 UA（见 §1）。handle 是公开信息，不要外传或写入可疑位置。
- 训练工具（handle 存在 `training\cf-handle.txt`）：
  - `tools\cf-plan.ps1 [-Count 5] [-Refresh] [-Sources cf,atcoder,luogu]` → 生成 `training\plan.md`（弱项 tag + Codeforces/AtCoder/洛谷三平台题目）、`training\plan.json`（VS Code 面板用）、`training\redo.md`（AC 但错 >=3 次的重做队列）。AtCoder 数据来自 kenkoooo 公开题库，洛谷从题库列表页抓（脚本自动取 C3VK cookie）
  - `tools\cf-review.ps1 [-ContestId N] [-Refresh]` → 生成 `codeforces\<比赛目录>\review.md`，API 数据自动填，`<!-- AGENT -->` 占位符由 agent 在用户说「复盘」时补分析
  - 私有 gym / 隐藏比赛 API 查不到（`contestId not found`），这种只能基于本地 `.cpp` / `.cph` 手动复盘
  - `tools\pull-contest.js <比赛链接>` → 整场抓取（Codeforces / AtCoder / 洛谷 / 牛客）：题面 md + 按**初始模板**建 cpp + 结构化数据 `<题号>.json` + 整场 `contest.json` + CPH `.cph` 样例缓存；`--only=A,B` 只抓部分、`--out=<dir>` 指定目录、`--force` 覆盖已存在 md、`--no-cpp` 只抓题面、`--single` 抓单个题目（输出 `SINGLE base|cpp|md`）。CF 正赛支持（API 枚举 + 洛谷镜像兜底），Gym/私有比赛需先设置 CF 登录 Cookie。初始模板默认 `new.cpp`，可设 `--template=<文件>` / 插件设置 `algorithm-training-tool.pull.template` / `training\pull-config.json`。插件面板「📥 抓取整场比赛」「🧩 设置拉题初始模板」同款。项目 QQ 群：188241279。
- 本机已装本地插件 `local.algorithm-training-tool`（活动栏「算法训练」面板：当前题单/AI 按钮 + 状态栏菜单）：把周题单/复盘/题面/编译样例/CPH 补丁/AI 操作包成 VS Code 按钮。源码在 `tools\vscode-extension\algorithm-training-tool`，改完跑 `tools\install-vscode-extension.ps1` 再重载窗口生效；`-Uninstall` 卸载。
- AI 助手（可选，配置 `training\ai-config.json`，OpenAI 兼容：DeepSeek / SiliconFlow / 任意网关；key 只存本地，不要写进 md 或回答里）：
  - `tools\ai-client.js ping|translate|review|hint|ask`：连通性测试 / 整篇翻译 / 赛后复盘分析 / 分级提示 / 问答
  - 插件里有「AI 提示（当前题）」「问 AI」「AI 复盘（选比赛）」「AI 翻译当前题面」「设置 AI API」「测试 AI 连接」「在 VS Code 设置中编辑」按钮；AI 复盘生成 `codeforces\<比赛>\review.ai.md`
  - 设置 AI 的三种方式等价：面板「设置 AI API」/ VS Code 设置页搜 `算法训练`（`algorithm-training-tool.ai.*`）/ 直接编辑 `training\ai-config.json`；状态栏有「AI 已配置/未配置」指示，点一下可改
  - 提示/问答默认是教练模式：只给思路，不给完整可提交代码（用户明确要代码才给）；**AI 提示会先读当前编辑器 buffer（含未保存修改）做「代码体检」，再按级别给针对性提示**（未保存内容由插件快照到 `.build\ai-active-code.cpp` 传给 ai-client）
  - DeepSeek 当前模型名是 `deepseek-flash` / `deepseek-v4-pro`（不是 deepseek-chat）；模型名填错时 `_ai.js` 会读 400 错误里的可用模型列表自动回退，并提示更新 `training\ai-config.json`
- 模拟赛/出题：按用户目标难度（Div3/Div4 的 A~E 等）选题；用户没做完前不剧透题解。
