# tools/cf-plan.ps1
# Analyze recent Codeforces submissions and generate a weekly training plan.
#
# Sources (all three by default):
#   - Codeforces : official problemset API, filtered by weak tags + rating window
#   - AtCoder    : kenkoooo.com public problem list + difficulty model
#   - Luogu      : problem list page (difficulty filter), embedded JSON
#
# Outputs:
#   training\plan.md   - human readable plan (weak tags + picked problems)
#   training\plan.json - machine readable plan (used by the VS Code panel)
#   training\redo.md   - problems solved with >= 3 wrong submissions (redo queue)
#
# Usage (Windows PowerShell 5.1):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\cf-plan.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\cf-plan.ps1 -Count 6 -Refresh
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\cf-plan.ps1 -Sources cf,atcoder
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\cf-plan.ps1 -MinRating 1700 -MaxRating 1900 -Tags dp,trees
#
# Needs: training\cf-handle.txt (or -Handle), curl.exe, network.
# Exit codes: 0 = OK, 1 = failure.

[CmdletBinding()]
param(
    [string]$Handle,
    [int]$Count = 5,
    [string[]]$Tags = @(),
    [int]$MinRating = 0,
    [int]$MaxRating = 0,
    [int]$AtCoderMinDifficulty = 0,
    [int]$AtCoderMaxDifficulty = 0,
    [int[]]$LuoguDifficulty = @(3, 4),
    [string[]]$Sources = @('cf', 'atcoder', 'luogu'),
    [switch]$Refresh
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_cf_api.ps1')

$h = Get-CfHandle $Handle
$hKey = ($h -replace '[^A-Za-z0-9]', '_')
$enc = [uri]::EscapeDataString($h)
$ttl = 600
if ($Refresh) { $ttl = 0 }

$info = Invoke-CfApi ("user.info?handles=" + $enc) ("userinfo-" + $hKey) $ttl
$u = $info.result[0]
$rating = 0
if ($null -ne $u.rating) { $rating = [int]$u.rating }
$maxRating = 0
if ($null -ne $u.maxRating) { $maxRating = [int]$u.maxRating }

$status = Invoke-CfApi ("user.status?handle=" + $enc + "&from=1&count=1000") ("userstatus-" + $hKey) $ttl
$subs = @($status.result)

$problemset = Invoke-CfApi 'problemset.problems' 'problemset' 86400
$allProblems = @($problemset.result.problems)

if ($MinRating -le 0) { $MinRating = $rating + 100 }
if ($MaxRating -le 0) { $MaxRating = $rating + 300 }
if ($MaxRating -lt $MinRating) { $MaxRating = $MinRating + 200 }

# --- tag statistics from recent submissions ---
$tagStats = @{}
foreach ($s in $subs) {
    if ($s.verdict -eq 'COMPILATION_ERROR') { continue }
    $p = $s.problem
    if ($null -eq $p -or $null -eq $p.tags) { continue }
    foreach ($t in $p.tags) {
        if (-not $tagStats.ContainsKey($t)) {
            $tagStats[$t] = @{ subs = 0; ok = 0; wa = 0; tle = 0; other = 0 }
        }
        $e = $tagStats[$t]
        $e.subs = $e.subs + 1
        if ($s.verdict -eq 'OK') { $e.ok = $e.ok + 1 }
        elseif ($s.verdict -eq 'WRONG_ANSWER') { $e.wa = $e.wa + 1 }
        elseif ($s.verdict -eq 'TIME_LIMIT_EXCEEDED') { $e.tle = $e.tle + 1 }
        else { $e.other = $e.other + 1 }
    }
}

$solvedKeys = @{}
$tagSolved = @{}
$tagAtt = @{}
foreach ($s in $subs) {
    $p = $s.problem
    if ($null -eq $p -or $null -eq $p.tags) { continue }
    $key = ([string]$p.contestId) + '|' + $p.index
    if ($s.verdict -eq 'OK') { $solvedKeys[$key] = 1 }
    foreach ($t in $p.tags) {
        if (-not $tagAtt.ContainsKey($t)) { $tagAtt[$t] = @{}; $tagSolved[$t] = @{} }
        $tagAtt[$t][$key] = 1
        if ($s.verdict -eq 'OK') { $tagSolved[$t][$key] = 1 }
    }
}

$tagRows = @()
foreach ($k in $tagStats.Keys) {
    $e = $tagStats[$k]
    $errRate = 0
    if ($e.subs -gt 0) { $errRate = [math]::Round(100.0 * ($e.subs - $e.ok) / $e.subs, 0) }
    $a = 0; $o = 0
    if ($tagAtt.ContainsKey($k)) { $a = $tagAtt[$k].Count }
    if ($tagSolved.ContainsKey($k)) { $o = $tagSolved[$k].Count }
    $tagRows += [pscustomobject]@{
        Tag = $k; Subs = $e.subs; OK = $e.ok; WA = $e.wa; TLE = $e.tle; Err = $errRate
        Attempted = $a; Solved = $o
    }
}

$weakTags = @()
if ($Tags.Count -gt 0) {
    $weakTags = @($Tags)
} else {
    $weakTags = @($tagRows | Where-Object { $_.Subs -ge 15 -and $_.Tag -ne 'interactive' -and $_.Tag -ne '*special' } | Sort-Object Err -Descending | Select-Object -First 3 | ForEach-Object { $_.Tag })
}

# --- how many problems per source ---
$wantCf = [int][Math]::Ceiling($Count / 2.0)
$wantAt = 0
$wantLu = 0
$rest = $Count - $wantCf
if ($rest -gt 0 -and ($Sources -contains 'atcoder')) { $wantAt = [int][Math]::Ceiling($rest / 2.0) }
$rest = $Count - $wantCf - $wantAt
if ($rest -gt 0 -and ($Sources -contains 'luogu')) { $wantLu = $rest }

$usedUrls = @{}

function Pick-FromPool([object[]]$Pool, [int]$N, [hashtable]$Used) {
    $out = @()
    if ($N -le 0 -or $null -eq $Pool -or $Pool.Count -eq 0) { return $out }
    $avail = @($Pool | Where-Object { -not $Used.ContainsKey($_.Url) } | Sort-Object Diff)
    if ($avail.Count -eq 0) { return $out }
    $take = [Math]::Min($N, $avail.Count)
    $step = [Math]::Max(1, [int][Math]::Floor($avail.Count / [Math]::Max(1, $take)))
    $idx = 0
    while ($out.Count -lt $take -and $idx -lt $avail.Count) {
        $out += $avail[$idx]
        $Used[$avail[$idx].Url] = 1
        $idx = $idx + $step
    }
    return $out
}

# --- Codeforces candidates ---
$cfPool = @()
for ($round = 0; $round -lt 3; $round++) {
    $cfPool = @()
    foreach ($p in $allProblems) {
        if ($null -eq $p.rating) { continue }
        if ($p.contestId -le 0) { continue }
        $key = ([string]$p.contestId) + '|' + $p.index
        if ($solvedKeys.ContainsKey($key)) { continue }
        if ([int]$p.rating -lt $MinRating -or [int]$p.rating -gt $MaxRating) { continue }
        $hit = $false
        if ($weakTags.Count -eq 0) { $hit = $true }
        else {
            foreach ($t in $p.tags) { if ($weakTags -contains $t) { $hit = $true; break } }
        }
        if (-not $hit) { continue }
        $cfPool += [pscustomobject]@{
            Platform = 'Codeforces'
            Diff = [int]$p.rating
            Title = (([string]$p.contestId) + $p.index + ' — ' + $p.name)
            Url = (Format-CfProblemLink ([int]$p.contestId) $p.index)
            Tags = ((@($p.tags) | Select-Object -First 3) -join ', ')
        }
    }
    if ($cfPool.Count -ge $wantCf) { break }
    $MinRating = [Math]::Max(800, $MinRating - 150)
    $MaxRating = $MaxRating + 150
}
$cfPicked = @(Pick-FromPool -Pool $cfPool -N $wantCf -Used $usedUrls)

# --- AtCoder candidates (kenkoooo public data) ---
$atPicked = @()
$atMinDiff = $AtCoderMinDifficulty
$atMaxDiff = $AtCoderMaxDifficulty
if ($atMinDiff -le 0) { $atMinDiff = [Math]::Max(400, $rating - 200) }
if ($atMaxDiff -le 0) { $atMaxDiff = $rating + 200 }
if ($wantAt -gt 0) {
    try {
        $atProblems = Get-CachedJson 'https://kenkoooo.com/atcoder/resources/problems.json' 'atcoder-problems' 86400
        $atModels = Get-CachedJson 'https://kenkoooo.com/atcoder/resources/problem-models.json' 'atcoder-models' 86400
        $modelMap = @{}
        foreach ($prop in $atModels.PSObject.Properties) { $modelMap[$prop.Name] = $prop.Value }
        $atCand = @()
        foreach ($p in $atProblems) {
            $id = [string]$p.id
            # keep only standard ABC/ARC/AGC/AHC task ids; practice-contest wrappers
            # (adt_*, etc.) reuse ids but are not the canonical task URL.
            if ($id -notmatch '^(abc|arc|agc|ahc)\d+_[a-z]\d*$') { continue }
            if (-not $modelMap.ContainsKey($id)) { continue }
            $d = $modelMap[$id].difficulty
            if ($null -eq $d) { continue }
            $d = [int]$d
            if ($d -lt $atMinDiff -or $d -gt $atMaxDiff) { continue }
            $contestId = $id.Substring(0, $id.IndexOf('_'))
            $atCand += [pscustomobject]@{
                Platform = 'AtCoder'
                Diff = $d
                Title = (([string]$p.title) + ' (' + $id + ')')
                Url = ('https://atcoder.jp/contests/' + $contestId + '/tasks/' + $id)
                Tags = ''
            }
        }
        if ($atCand.Count -gt 0) {
            $seed = [int]((Get-Date).ToString('yyyyMMdd')) + 11
            $takeAt = [Math]::Min($wantAt, $atCand.Count)
            $pickedAt = @($atCand | Get-Random -SetSeed $seed -Count $takeAt)
            foreach ($p in $pickedAt) { $atPicked += $p; $usedUrls[$p.Url] = 1 }
        }
    } catch {
        Write-Host ('WARN   AtCoder source failed: ' + $_.Exception.Message)
    }
}

# --- Luogu candidates (problem list page with embedded JSON) ---
function Get-LuoguListJson([int]$Difficulty, [int]$Page) {
    $cache = Get-CfCachePath ('luogu-diff' + $Difficulty + '-p' + $Page)
    if ((Test-Path -LiteralPath $cache) -and (((Get-Date) - (Get-Item -LiteralPath $cache).LastWriteTime).TotalSeconds -lt 86400)) {
        return ([System.IO.File]::ReadAllText($cache) | ConvertFrom-Json)
    }
    $jar = Join-Path $script:CfCacheDir 'luogu-cookies.txt'
    if (-not (Test-Path -LiteralPath $jar)) {
        & curl.exe -sS --max-time 30 -A $script:CfUa -c $jar -o (Join-Path $script:CfCacheDir 'luogu-home.html') 'https://www.luogu.com.cn/' | Out-Null
    }
    Start-Sleep -Milliseconds 800
    $html = ((& curl.exe -sSL --max-time 60 -A $script:CfUa -b $jar -c $jar ('https://www.luogu.com.cn/problem/list?difficulty=' + $Difficulty + '&page=' + $Page)) | Out-String)
    $m = [regex]::Match($html, '<script[^>]*id="lentille-context"[^>]*type="application/json"[^>]*>([\s\S]*?)</script>')
    if (-not $m.Success) { throw 'luogu: lentille-context JSON not found (anti-bot page?)' }
    $raw = $m.Groups[1].Value
    [System.IO.File]::WriteAllText($cache, $raw, (New-Object System.Text.UTF8Encoding($false)))
    return ($raw | ConvertFrom-Json)
}

$luPicked = @()
if ($wantLu -gt 0) {
    try {
        $luCand = @()
        foreach ($d in $LuoguDifficulty) {
            for ($page = 1; $page -le 2; $page++) {
                $lj = Get-LuoguListJson -Difficulty $d -Page $page
                foreach ($p in $lj.data.problems.result) {
                    $luCand += [pscustomobject]@{
                        Platform = 'Luogu'
                        Diff = [int]$p.difficulty
                        Title = ([string]$p.pid + ' — ' + [string]$p.name)
                        Url = ('https://www.luogu.com.cn/problem/' + [string]$p.pid)
                        Tags = ''
                    }
                }
            }
        }
        if ($luCand.Count -gt 0) {
            $seed = [int]((Get-Date).ToString('yyyyMMdd')) + 23
            $takeLu = [Math]::Min($wantLu, $luCand.Count)
            $pickedLu = @($luCand | Get-Random -SetSeed $seed -Count $takeLu)
            foreach ($p in $pickedLu) { $luPicked += $p; $usedUrls[$p.Url] = 1 }
        }
    } catch {
        Write-Host ('WARN   Luogu source failed: ' + $_.Exception.Message)
    }
}

# --- fill any remaining slots with more Codeforces picks ---
$need = $Count - ($cfPicked.Count + $atPicked.Count + $luPicked.Count)
if ($need -gt 0) {
    $extra = @(Pick-FromPool -Pool $cfPool -N $need -Used $usedUrls)
    $cfPicked += $extra
}

# --- redo queue: solved but many wrong submissions ---
$redo = @()
$groups = @{}
foreach ($s in $subs) {
    $p = $s.problem
    if ($null -eq $p) { continue }
    $key = ([string]$p.contestId) + '|' + $p.index
    if (-not $groups.ContainsKey($key)) { $groups[$key] = @{ p = $p; bad = 0; ok = 0 } }
    $g = $groups[$key]
    if ($s.verdict -eq 'OK') { $g.ok = $g.ok + 1 }
    elseif ($s.verdict -ne 'COMPILATION_ERROR') { $g.bad = $g.bad + 1 }
}
foreach ($k in $groups.Keys) {
    $g = $groups[$k]
    if ($g.ok -ge 1 -and $g.bad -ge 3) {
        $redo += [pscustomobject]@{ Key = $k; Bad = $g.bad; Problem = $g.p }
    }
}
$redo = @($redo | Sort-Object Bad -Descending | Select-Object -First 15)

# --- write plan.md / plan.json / redo.md ---
$trainDir = Join-Path $script:CfRoot 'training'
if (-not (Test-Path -LiteralPath $trainDir)) { New-Item -ItemType Directory -Force -Path $trainDir | Out-Null }
$planPath = Join-Path $trainDir 'plan.md'
$planJsonPath = Join-Path $trainDir 'plan.json'
$redoPath = Join-Path $trainDir 'redo.md'
$now = (Get-Date).ToString('yyyy-MM-dd HH:mm')

$planLines = New-Object System.Collections.Generic.List[string]
$planLines.Add('# 周训练计划')
$planLines.Add('')
$planLines.Add(('- 生成时间：{0}' -f $now))
$planLines.Add(('- handle: `{0}`　当前 rating: **{1}**（历史最高 {2}）' -f $h, $rating, $maxRating))
$planLines.Add(('- Codeforces 目标分数段：**{0} ~ {1}**' -f $MinRating, $MaxRating))
$planLines.Add(('- 来源：**{0}**（Codeforces / AtCoder / 洛谷）' -f (($Sources) -join ' / ')))
$planLines.Add('')
$planLines.Add('## 近 1000 次提交的弱项')
$planLines.Add('')
$planLines.Add('| tag | 提交 | AC | WA | TLE | 错误率 | 做过题数 | 通过题数 |')
$planLines.Add('| --- | --- | --- | --- | --- | --- | --- | --- |')
$topTags = @($tagRows | Where-Object { $_.Subs -ge 15 } | Sort-Object Err -Descending | Select-Object -First 10)
foreach ($r in $topTags) {
    $planLines.Add(('| {0} | {1} | {2} | {3} | {4} | {5}% | {6} | {7} |' -f $r.Tag, $r.Subs, $r.OK, $r.WA, $r.TLE, $r.Err, $r.Attempted, $r.Solved))
}
$planLines.Add('')
$planLines.Add(('- 本周优先补：**{0}**' -f ($weakTags -join ' / ')))
$planLines.Add('')
$planLines.Add('## 本周题目')
$planLines.Add('')

$counter = 0
if ($cfPicked.Count -gt 0) {
    $planLines.Add('### Codeforces（弱项 tag 优先）')
    $planLines.Add('')
    foreach ($p in $cfPicked) {
        $counter = $counter + 1
        $planLines.Add(('{0}. [{1} {2}] [{3}]({4})　`{5}`' -f $counter, $p.Platform, $p.Diff, $p.Title, $p.Url, $p.Tags))
    }
    $planLines.Add('')
}
if ($atPicked.Count -gt 0) {
    $planLines.Add(('### AtCoder（难度 {0} ~ {1}）' -f $atMinDiff, $atMaxDiff))
    $planLines.Add('')
    foreach ($p in $atPicked) {
        $counter = $counter + 1
        $planLines.Add(('{0}. [{1} {2}] [{3}]({4})' -f $counter, $p.Platform, $p.Diff, $p.Title, $p.Url))
    }
    $planLines.Add('')
}
if ($luPicked.Count -gt 0) {
    $planLines.Add(('### 洛谷（难度 {0}）' -f (($LuoguDifficulty) -join '/')))
    $planLines.Add('')
    foreach ($p in $luPicked) {
        $counter = $counter + 1
        $planLines.Add(('{0}. [{1} 难度{2}] [{3}]({4})' -f $counter, $p.Platform, $p.Diff, $p.Title, $p.Url))
    }
    $planLines.Add('')
}
$planLines.Add('## 用法')
$planLines.Add('')
$planLines.Add('- 做题时先说「训练模式」，卡 20~30 分钟再要提示；A/B 题限时 10~15 分钟。')
$planLines.Add('- 每场赛后：`powershell -NoProfile -ExecutionPolicy Bypass -File tools\cf-review.ps1` 生成复盘。')
$planLines.Add('- 一周后从 `training\redo.md` 抽题重做；重做前不看题解。')
$planLines.Add('')
[System.IO.File]::WriteAllText($planPath, ($planLines -join "`r`n"), (New-Object System.Text.UTF8Encoding($false)))

$redoLines = New-Object System.Collections.Generic.List[string]
$redoLines.Add('# 重做队列（AC 但错误提交 >= 3 的题）')
$redoLines.Add('')
$redoLines.Add(('- 生成时间：{0}　handle: `{1}`' -f $now, $h))
$redoLines.Add('')
$redoLines.Add('规则：一周后重做；重做前不看题解，限时 30 分钟；做完在下面打勾并写一行关键观察。')
$redoLines.Add('')
foreach ($r in $redo) {
    $p = $r.Problem
    $redoLines.Add(('- [ ] [{0}{1} — {2}]({3})　`{4}`　错误提交 {5} 次' -f $p.contestId, $p.index, $p.name, (Format-CfProblemLink ([int]$p.contestId) $p.index), $p.rating, $r.Bad))
}
if ($redo.Count -eq 0) { $redoLines.Add('- （暂无）') }
$redoLines.Add('')
[System.IO.File]::WriteAllText($redoPath, ($redoLines -join "`r`n"), (New-Object System.Text.UTF8Encoding($false)))

# machine-readable plan for the VS Code panel
$allPicked = @()
foreach ($p in $cfPicked) { $allPicked += $p }
foreach ($p in $atPicked) { $allPicked += $p }
foreach ($p in $luPicked) { $allPicked += $p }

$problemList = @()
foreach ($p in $allPicked) {
    $problemList += [pscustomobject]@{
        platform = $p.Platform
        rating = [string]$p.Diff
        title = $p.Title
        url = $p.Url
        tags = $p.Tags
    }
}
$redoList = @()
foreach ($r in $redo) {
    $p = $r.Problem
    $redoList += [pscustomobject]@{
        title = (([string]$p.contestId) + $p.index + ' — ' + [string]$p.name)
        url = (Format-CfProblemLink ([int]$p.contestId) $p.index)
        bad = $r.Bad
    }
}
$planObj = [pscustomobject]@{
    generated = $now
    handle = $h
    rating = $rating
    maxRating = $maxRating
    weakTags = @($weakTags)
    sources = @($Sources)
    problems = @($problemList)
    redoCount = $redo.Count
    redo = @($redoList)
}
[System.IO.File]::WriteAllText($planJsonPath, ($planObj | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))

Write-Host ('OK     ' + (Format-CfRelativePath $planPath))
Write-Host ('OK     ' + (Format-CfRelativePath $planJsonPath))
Write-Host ('OK     ' + (Format-CfRelativePath $redoPath))
Write-Host ('INFO   rating={0}  weakTags={1}  cf={2} atcoder={3} luogu={4}  redo={5}' -f $rating, ($weakTags -join ','), $cfPicked.Count, $atPicked.Count, $luPicked.Count, $redo.Count)
exit 0
