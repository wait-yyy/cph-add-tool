# tools/cf-review.ps1
# Generate a post-contest review skeleton from the public Codeforces API:
#   codeforces\<contest folder>\review.md      (or training\review-<id>.md if no local folder)
#
# It fills in the objective data (problems, tags, rating, AC/WA counts, times, local files)
# and leaves "<!-- AGENT: ... -->" placeholders for the agent to fill in the analysis
# when the user asks to review the contest.
#
# Usage (Windows PowerShell 5.1):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\cf-review.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\cf-review.ps1 -ContestId 2278
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\cf-review.ps1 -ContestId 2278 -Refresh
#
# Needs: training\cf-handle.txt (or -Handle), curl.exe, network to codeforces.com API.
# Exit codes: 0 = OK, 1 = failure.

[CmdletBinding()]
param(
    [int]$ContestId = 0,
    [string]$Handle,
    [switch]$Refresh
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_cf_api.ps1')

$h = Get-CfHandle $Handle
$hKey = ($h -replace '[^A-Za-z0-9]', '_')
$enc = [uri]::EscapeDataString($h)
$ttl = 600
if ($Refresh) { $ttl = 0 }

$ratingData = Invoke-CfApi ("user.rating?handle=" + $enc) ("userrating-" + $hKey) 3600
$rated = @($ratingData.result)

if ($ContestId -le 0) {
    if ($rated.Count -eq 0) { throw 'no rated contests found for this handle' }
    $last = $rated[$rated.Count - 1]
    $ContestId = [int]$last.contestId
    Write-Host ('INFO   latest rated contest: ' + $ContestId + ' (' + [string]$last.contestName + ')')
}

$contestStatus = $null
try {
    $contestStatus = Invoke-CfApi ("contest.status?contestId=" + $ContestId + "&handle=" + $enc + "&from=1&count=1000") ("contest-" + $ContestId + "-status-" + $hKey) $ttl
} catch {
    Write-Host ('WARN   contest.status failed: ' + $_.Exception.Message)
}

$standings = $null
$isGym = $false
if ($ContestId -gt 10000) { $isGym = $true }
if ($isGym) {
    # Non-gym standings can only be fetched anonymously without extra parameters,
    # so only gyms use the handles-filtered variant here.
    try {
        $standings = Invoke-CfApi ("contest.standings?contestId=" + $ContestId + "&handles=" + $enc + "&showUnofficial=true") ("contest-" + $ContestId + "-standings-" + $hKey) $ttl
    } catch {
        Write-Host ('WARN   gym contest.standings failed: ' + $_.Exception.Message)
    }
}

$subs = @()
if ($null -ne $contestStatus) {
    $subs = @($contestStatus.result)
} else {
    $allStatus = Invoke-CfApi ("user.status?handle=" + $enc + "&from=1&count=1000") ("userstatus-" + $hKey) $ttl
    $subs = @($allStatus.result | Where-Object { $_.contestId -eq $ContestId })
}

# --- contest meta ---
$contestName = 'Contest ' + $ContestId
if ($null -ne $standings -and $null -ne $standings.result.contest) {
    $contestName = [string]$standings.result.contest.name
}
$contestUrl = 'https://codeforces.com/contest/' + $ContestId
if ($isGym) { $contestUrl = 'https://codeforces.com/gym/' + $ContestId }

$deltaText = '（无 rating 变化信息）'
$myRated = @($rated | Where-Object { [int]$_.contestId -eq $ContestId })
if ($myRated.Count -gt 0) {
    $r = $myRated[0]
    if ($contestName -eq ('Contest ' + $ContestId)) { $contestName = [string]$r.contestName }
    $d = [int]$r.newRating - [int]$r.oldRating
    $sign = ''
    if ($d -ge 0) { $sign = '+' }
    $deltaText = ('rank **{0}**，rating {1} → {2}（{3}{4}）' -f $r.rank, $r.oldRating, $r.newRating, $sign, $d)
}

# --- problems metadata ---
$problems = @()
if ($null -ne $standings -and $null -ne $standings.result.problems) {
    $problems = @($standings.result.problems)
}
if ($problems.Count -eq 0) {
    $problemset = Invoke-CfApi 'problemset.problems' 'problemset' 86400
    $problems = @($problemset.result.problems | Where-Object { [int]$_.contestId -eq $ContestId } | Sort-Object index)
}
if ($problems.Count -eq 0) {
    $seen = @{}
    foreach ($s in $subs) {
        if ($null -eq $s.problem) { continue }
        $idx = [string]$s.problem.index
        if (-not $seen.ContainsKey($idx)) {
            $seen[$idx] = 1
            $problems += $s.problem
        }
    }
    $problems = @($problems | Sort-Object index)
}

# --- user row (for WA counts / best times) ---
$row = $null
if ($null -ne $standings -and $null -ne $standings.result.rows) {
    foreach ($rr in @($standings.result.rows)) {
        foreach ($m in @($rr.party.members)) {
            if ([string]$m.handle -ieq $h) { $row = $rr; break }
        }
        if ($null -ne $row) { break }
    }
}
$rowResults = @{}
if ($null -ne $row) {
    for ($i = 0; $i -lt $problems.Count; $i++) {
        if ($i -lt $row.problemResults.Count) {
            $rowResults[[string]$problems[$i].index] = $row.problemResults[$i]
        }
    }
}

# --- per-problem submission stats ---
$stat = @{}
foreach ($s in $subs) {
    if ($null -eq $s.problem) { continue }
    $idx = [string]$s.problem.index
    if (-not $stat.ContainsKey($idx)) {
        $stat[$idx] = @{ subs = 0; ok = 0; wa = 0; tle = 0; other = 0; firstOk = $null }
    }
    $e = $stat[$idx]
    if ($s.verdict -eq 'COMPILATION_ERROR') { continue }
    $e.subs = $e.subs + 1
    if ($s.verdict -eq 'OK') {
        $e.ok = $e.ok + 1
        $t = [int]$s.relativeTimeSeconds
        if ($null -eq $e.firstOk -or $t -lt $e.firstOk) { $e.firstOk = $t }
    } elseif ($s.verdict -eq 'WRONG_ANSWER') { $e.wa = $e.wa + 1 }
    elseif ($s.verdict -eq 'TIME_LIMIT_EXCEEDED') { $e.tle = $e.tle + 1 }
    else { $e.other = $e.other + 1 }
}

# --- locate local contest folder (file naming first, CPH .cph cache urls as fallback) ---
$folder = $null
$codeforcesDir = Join-Path $script:CfRoot 'codeforces'
$nameRe = '^' + $ContestId + '[A-Za-z]\d*\.cpp$'
if (Test-Path -LiteralPath $codeforcesDir) {
    foreach ($d in @(Get-ChildItem -LiteralPath $codeforcesDir -Directory -ErrorAction SilentlyContinue)) {
        $hit = @(Get-ChildItem -LiteralPath $d.FullName -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match $nameRe })
        if ($hit.Count -gt 0) { $folder = $d.FullName; break }
    }
}
if ($null -eq $folder) {
    $rootHit = @(Get-ChildItem -LiteralPath $script:CfRoot -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match $nameRe })
    if ($rootHit.Count -gt 0) { $folder = $script:CfRoot }
}
if ($null -eq $folder -and (Test-Path -LiteralPath $codeforcesDir)) {
    foreach ($d in @(Get-ChildItem -LiteralPath $codeforcesDir -Directory -ErrorAction SilentlyContinue)) {
        $cph = Join-Path $d.FullName '.cph'
        if (-not (Test-Path -LiteralPath $cph)) { continue }
        foreach ($pf in @(Get-ChildItem -LiteralPath $cph -File -Filter '*.prob' -ErrorAction SilentlyContinue)) {
            try { $j = [System.IO.File]::ReadAllText($pf.FullName) | ConvertFrom-Json } catch { continue }
            if ([string]$j.url -match ('/(?:contest|gym)/' + $ContestId + '/')) {
                $folder = $d.FullName
                break
            }
        }
        if ($null -ne $folder) { break }
    }
}

$trainDir = Join-Path $script:CfRoot 'training'
if (-not (Test-Path -LiteralPath $trainDir)) { New-Item -ItemType Directory -Force -Path $trainDir | Out-Null }
if ($null -ne $folder) { $reviewPath = Join-Path $folder 'review.md' }
else { $reviewPath = Join-Path $trainDir ('review-' + $ContestId + '.md') }

function Format-Sec([int]$sec) {
    if ($sec -lt 0) { return '' }
    $m = [int][Math]::Floor($sec / 60)
    $s = $sec % 60
    return ('{0}:{1:00}' -f $m, $s)
}

# --- build review.md ---
$L = New-Object System.Collections.Generic.List[string]
$L.Add(('# ' + $contestName + ' — 赛后复盘'))
$L.Add('')
$L.Add(('- 链接：<{0}>' -f $contestUrl))
$L.Add(('- handle：`{0}`' -f $h))
$L.Add(('- 成绩：{0}' -f $deltaText))
$L.Add('')
$L.Add('## 题目数据')
$L.Add('')
$L.Add('| # | 题目 | 难度 | tags | 结果 | 罚时/WA | 本地文件 |')
$L.Add('| --- | --- | --- | --- | --- | --- | --- |')

$acCount = 0
$total = $problems.Count
$unsolved = @()
$waHeavy = @()
foreach ($p in $problems) {
    $idx = [string]$p.index
    $s = $null
    if ($stat.ContainsKey($idx)) { $s = $stat[$idx] }
    $rr = $null
    if ($rowResults.ContainsKey($idx)) { $rr = $rowResults[$idx] }

    $resultText = '未提交'
    $ac = $false
    if ($null -ne $s -and $s.ok -gt 0) { $resultText = 'AC'; $ac = $true }
    elseif ($null -ne $rr -and [double]$rr.points -gt 0) { $resultText = 'AC'; $ac = $true }
    elseif ($null -ne $rr -and [int]$rr.rejectedAttemptCount -gt 0) { $resultText = ('未过（WA×{0}）' -f [int]$rr.rejectedAttemptCount) }
    elseif ($null -ne $s -and $s.subs -gt 0) { $resultText = ('未过（错 {0} 次）' -f $s.subs) }
    if ($ac) { $acCount = $acCount + 1 }

    $waText = ''
    if ($null -ne $rr) { $waText = [string]([int]$rr.rejectedAttemptCount) }
    elseif ($null -ne $s) { $waText = [string]($s.wa + $s.tle + $s.other) }

    $timeText = ''
    if ($null -ne $rr -and $null -ne $rr.bestSubmissionTimeSeconds -and [int]$rr.bestSubmissionTimeSeconds -gt 0) {
        $timeText = Format-Sec ([int]$rr.bestSubmissionTimeSeconds)
    } elseif ($null -ne $s -and $null -ne $s.firstOk) {
        $timeText = Format-Sec ([int]$s.firstOk)
    }

    $localText = ''
    if ($null -ne $folder) {
        $base = Join-Path $folder (([string]$ContestId) + $idx)
        $cpp = $base + '.cpp'
        $md = $base + '.md'
        if (Test-Path -LiteralPath $cpp) { $localText = ('[{0}]({1})' -f (([string]$ContestId) + $idx + '.cpp'), (Format-CfRelativePath $cpp)) }
        if (Test-Path -LiteralPath $md) {
            if ($localText -ne '') { $localText = $localText + ' / ' }
            $localText = $localText + ('[题面]({0})' -f (Format-CfRelativePath $md))
        }
        if ($localText -eq '') { $localText = '—' }
    } else { $localText = '—' }

    $tagsText = (@($p.tags) | Select-Object -First 4) -join ', '
    $ratingText = '—'
    if ($null -ne $p.rating) { $ratingText = [string]$p.rating }

    $L.Add(('| {0} | {1} | {2} | {3} | {4} | {5} | {6} |' -f $p.index, $p.name, $ratingText, $tagsText, $resultText, $(if ($timeText -ne '') { $timeText + ' / ' + $waText } else { $waText }), $localText))
    if (-not $ac) { $unsolved += $p }
    elseif ($null -ne $s -and ($s.wa + $s.tle + $s.other) -ge 2) { $waHeavy += $p }
}
$L.Add('')
$L.Add(('- 通过：**{0} / {1}**' -f $acCount, $total))
$L.Add('')

$L.Add('## 没过的题（upsolve）')
$L.Add('')
if ($unsolved.Count -eq 0) {
    $L.Add('- 全部通过 🎉')
} else {
    foreach ($p in $unsolved) {
        $idx = [string]$p.index
        $s = $null
        if ($stat.ContainsKey($idx)) { $s = $stat[$idx] }
        $L.Add(('### {0}. {1}（{2}，{3}）' -f $p.index, $p.name, $(if ($null -ne $p.rating) { [string]$p.rating } else { '?' }), ((@($p.tags)) -join ', ')))
        $L.Add('')
        $L.Add(('- 链接：<{0}>' -f (Format-CfProblemLink ([int]$ContestId) $idx)))
        if ($null -ne $folder) {
            $base = Join-Path $folder (([string]$ContestId) + $idx)
            $cpp = $base + '.cpp'
            $md = $base + '.md'
            if (Test-Path -LiteralPath $cpp) { $L.Add(('- 本地代码：[{0}]({1})' -f (([string]$ContestId) + $idx + '.cpp'), (Format-CfRelativePath $cpp))) }
            if (Test-Path -LiteralPath $md) { $L.Add(('- 本地题面：[{0}]({1})' -f (([string]$ContestId) + $idx + '.md'), (Format-CfRelativePath $md))) }
        }
        if ($null -ne $s -and $s.subs -gt 0) {
            $L.Add(('- 提交：{0} 次（WA {1} / TLE {2} / 其他 {3}）' -f $s.subs, $s.wa, $s.tle, $s.other))
        } else {
            $L.Add('- 提交：无（没来得及做）')
        }
        $L.Add('- 卡点：<!-- AGENT: 是没思路、思路错、还是实现/边界错？ -->')
        $L.Add('- 关键观察：<!-- AGENT: 正确解法的关键观察 1~3 条 -->')
        $L.Add('- 下次类似题：<!-- AGENT: 应该先想什么、避免什么 -->')
        $L.Add('')
    }
}

if ($waHeavy.Count -gt 0) {
    $L.Add('## 过了但错误提交多的题（重做候选）')
    $L.Add('')
    foreach ($p in $waHeavy) {
        $idx = [string]$p.index
        $s = $stat[$idx]
        $L.Add(('- **{0}. {1}**（{2}）：错 {3} 次（WA {4} / TLE {5} / 其他 {6}）' -f $p.index, $p.name, $(if ($null -ne $p.rating) { [string]$p.rating } else { '?' }), ($s.wa + $s.tle + $s.other), $s.wa, $s.tle, $s.other))
        $L.Add('  - 错误类型：<!-- AGENT: 边界？类型溢出？题意理解？复杂度？ -->')
    }
    $L.Add('')
}

$L.Add('## 本场总结')
$L.Add('')
$L.Add('<!-- AGENT: 3~5 行。最该补的 1~2 个专题 + 1 个习惯问题（如读题/边界/对拍）+ 下次比赛的 1 个具体行动 -->')
$L.Add('')

[System.IO.File]::WriteAllText($reviewPath, ($L -join "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
Write-Host ('OK     ' + (Format-CfRelativePath $reviewPath))
Write-Host ('INFO   contest={0}  problems={1}  solved={2}  unsolved={3}  waHeavy={4}' -f $ContestId, $total, $acCount, $unsolved.Count, $waHeavy.Count)
exit 0
