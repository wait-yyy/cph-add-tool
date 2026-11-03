# tools/cp.ps1 -- agent CLI for solving: build / run / samples / stress
#
# Usage (Windows PowerShell 5.1):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\cp.ps1 build   -Solution 2278A.cpp [-DebugBuild]
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\cp.ps1 run     -Solution 2278A.cpp [-InFile in.txt] [-TimeLimitMs 4000]
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\cp.ps1 samples -Solution 2278A.cpp [-TimeLimitMs 4000]
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\cp.ps1 stress  -Solution sol.cpp -Brute brute.cpp -Generator gen.cpp [-Rounds 200] [-StartSeed 1]
#
# Exit codes: 0 = OK, 1 = failure (build error / WA / RE / TLE), 2 = bad usage / no data.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('build', 'run', 'samples', 'stress')]
    [string]$Action,

    [Parameter(Position = 1)]
    [string]$Solution,

    [string]$Brute,
    [string]$Generator,
    [string]$InFile,
    [int]$Rounds = 200,
    [int]$StartSeed = 1,
    [int]$TimeLimitMs = 4000,
    [switch]$DebugBuild,
    [switch]$Quiet
)

. (Join-Path $PSScriptRoot '_common.ps1')

function Show-Usage {
    Write-Host 'usage:' -ForegroundColor Yellow
    Write-Host '  cp.ps1 build   -Solution <file.cpp> [-DebugBuild]'
    Write-Host '  cp.ps1 run     -Solution <file.cpp> [-InFile <in.txt>] [-TimeLimitMs 4000]'
    Write-Host '  cp.ps1 samples -Solution <file.cpp> [-TimeLimitMs 4000]'
    Write-Host '  cp.ps1 stress  -Solution <sol.cpp> -Brute <brute.cpp> -Generator <gen.cpp> [-Rounds 200] [-StartSeed 1] [-TimeLimitMs 3000]'
}

function Invoke-Build {
    if (-not $Solution) { Show-Usage; return 2 }
    $exe = Build-CppFile -Source $Solution -DebugBuild:$DebugBuild
    if (-not $exe) { return 1 }
    return 0
}

function Invoke-Run {
    if (-not $Solution) { Show-Usage; return 2 }
    $src = Resolve-Source $Solution
    $exe = Build-CppFile -Source $src -DebugBuild:$DebugBuild
    if (-not $exe) { return 1 }

    $inPath = $null
    if ($InFile) {
        $inPath = Resolve-Source $InFile
    } else {
        $candidate = Join-Path (Split-Path -Parent $src) 'input.txt'
        if (Test-Path -LiteralPath $candidate) {
            $inPath = $candidate
            Write-Host ("INPUT  auto: {0}" -f $candidate) -ForegroundColor DarkGray
        } else {
            $inPath = New-EmptyInput
        }
    }

    $limit = [Math]::Max(1000, $TimeLimitMs)
    $r = Invoke-Program -Exe $exe -InPath $inPath -LimitMs $limit
    if ($r.Timeout) {
        Write-Host ("RUN TLE  > {0} ms" -f $limit) -ForegroundColor Red
        return 1
    }
    $color = 'Green'
    if ($r.ExitCode -ne 0) { $color = 'Red' }
    Write-Host ("RUN  exit={0}  {1} ms" -f $r.ExitCode, $r.Ms) -ForegroundColor $color
    if ($r.StdErr -and $r.StdErr.Trim() -ne '') {
        Write-Host '--- stderr ---' -ForegroundColor DarkYellow
        Write-Host $r.StdErr.TrimEnd("`r`n")
    }
    if ($r.StdOut -and $r.StdOut -ne '') {
        Write-Host '--- stdout ---'
        Write-Host $r.StdOut.TrimEnd("`r`n")
    }
    if ($r.ExitCode -ne 0) { return 1 }
    return 0
}

function Invoke-Samples {
    if (-not $Solution) { Show-Usage; return 2 }
    $src = Resolve-Source $Solution
    $dir = Split-Path -Parent $src
    $base = Split-Path -Leaf $src

    $probFiles = @()
    $cphDir = Join-Path $dir '.cph'
    if (Test-Path -LiteralPath $cphDir) {
        $probFiles = @(Get-ChildItem -LiteralPath $cphDir -File -Filter ('.' + $base + '_*.prob') |
            Sort-Object LastWriteTime -Descending)
    }
    if ($probFiles.Count -eq 0) {
        Write-Host ("NO SAMPLES  no .cph cache for {0}" -f $base) -ForegroundColor Yellow
        Write-Host '  open the problem once in the CPH extension (it writes .cph/.<file>_<hash>.prob)'
        Write-Host '  or test a hand-written input: cp.ps1 run -Solution X.cpp -InFile in.txt'
        return 2
    }

    $prob = [System.IO.File]::ReadAllText($probFiles[0].FullName) | ConvertFrom-Json
    Write-Host ("PROBLEM  {0}" -f $prob.name) -ForegroundColor Cyan
    if ($prob.group) { Write-Host ("  group:  {0}" -f $prob.group) -ForegroundColor DarkGray }
    if ($prob.url) { Write-Host ("  url:    {0}" -f $prob.url) -ForegroundColor DarkGray }
    $tl = 0
    $ml = 0
    if ($null -ne $prob.timeLimit) { $tl = [int]$prob.timeLimit }
    if ($null -ne $prob.memoryLimit) { $ml = [int]$prob.memoryLimit }
    if ($tl -gt 0 -or $ml -gt 0) {
        Write-Host ("  limits: TL {0} ms / ML {1} MB" -f $tl, $ml) -ForegroundColor DarkGray
    }

    $exe = Build-CppFile -Source $src -Quiet:$Quiet
    if (-not $exe) { return 1 }

    $tests = @($prob.tests)
    $total = $tests.Count
    if ($total -eq 0) {
        Write-Host 'NO TESTS  this .cph file has no sample tests' -ForegroundColor Yellow
        return 2
    }

    $limit = [Math]::Max(2000, $TimeLimitMs)
    $pass = 0
    $fail = 0
    $maxMs = 0
    for ($i = 0; $i -lt $total; $i++) {
        $t = $tests[$i]
        $idx = $i + 1
        $inPath = Join-Path $script:WorkDir ('_sample_{0}.in' -f $idx)
        Write-Utf8NoBom $inPath ([string]$t.input)
        $r = Invoke-Program -Exe $exe -InPath $inPath -LimitMs $limit
        $label = "[{0}/{1}]" -f $idx, $total
        if ($r.Timeout) {
            Write-Host ("{0} TLE  > {1} ms" -f $label, $limit) -ForegroundColor Red
            $fail++
            continue
        }
        if ($r.ExitCode -ne 0) {
            Write-Host ("{0} RE  exit={1}  {2} ms" -f $label, $r.ExitCode, $r.Ms) -ForegroundColor Red
            if ($r.StdErr -and $r.StdErr.Trim() -ne '') { Write-Host ('  ' + $r.StdErr.TrimEnd("`r`n")) -ForegroundColor DarkYellow }
            $fail++
            continue
        }
        if ($r.Ms -gt $maxMs) { $maxMs = $r.Ms }
        if (Test-SameOutput ([string]$t.output) $r.StdOut) {
            Write-Host ("{0} PASS  {1} ms" -f $label, $r.Ms) -ForegroundColor Green
            $pass++
        } else {
            Write-Host ("{0} FAIL  {1} ms" -f $label, $r.Ms) -ForegroundColor Red
            Show-OutputDiff -Expected ([string]$t.output) -Actual $r.StdOut -ActualLabel 'GOT'
            $fail++
        }
    }

    $color = 'Green'
    if ($fail -gt 0) { $color = 'Red' }
    Write-Host ("SAMPLES  {0}/{1} passed  max {2} ms" -f $pass, $total, $maxMs) -ForegroundColor $color
    if ($fail -gt 0) { return 1 }
    return 0
}

function Save-StressFailure {
    param(
        [string]$InputText,
        [string]$SolOut,
        [string]$BruteOut,
        [int]$Seed,
        [string]$Reason
    )
    $inPath = Join-Path $script:WorkDir ('fail_seed{0}.in' -f $Seed)
    Write-Utf8NoBom $inPath $InputText
    if ($null -ne $SolOut) {
        Write-Utf8NoBom (Join-Path $script:WorkDir ('fail_seed{0}.sol' -f $Seed)) $SolOut
    }
    if ($null -ne $BruteOut) {
        Write-Utf8NoBom (Join-Path $script:WorkDir ('fail_seed{0}.brute' -f $Seed)) $BruteOut
    }
    Write-Host ("STRESS FAIL  seed {0}  {1}" -f $Seed, $Reason) -ForegroundColor Red
    Write-Host ("  reproduce: cp.ps1 run -Solution {0} -InFile {1}" -f $Solution, $inPath) -ForegroundColor Red
    Write-Host '  --- input (head) ---' -ForegroundColor DarkGray
    $lines = (Get-NormalizedText $InputText).Split("`n")
    $show = [Math]::Min(30, $lines.Length)
    for ($j = 0; $j -lt $show; $j++) { Write-Host ('  ' + $lines[$j]) -ForegroundColor Gray }
    if ($lines.Length -gt $show) {
        Write-Host ("  ... ({0} lines total)" -f $lines.Length) -ForegroundColor DarkGray
    }
    return 1
}

function Invoke-Stress {
    if (-not $Solution -or -not $Brute -or -not $Generator) { Show-Usage; return 2 }

    $solExe = Build-CppFile -Source $Solution
    if (-not $solExe) { return 1 }
    $bruteExe = Build-CppFile -Source $Brute
    if (-not $bruteExe) { return 1 }
    $genExe = Build-CppFile -Source $Generator
    if (-not $genExe) { return 1 }

    $emptyIn = New-EmptyInput
    $stressIn = Join-Path $script:WorkDir '_stress.in'
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $seen = @{}
    $ok = 0
    $skipped = 0
    $maxSol = 0
    $maxBrute = 0
    $bruteLimit = [Math]::Max(3000, $TimeLimitMs * 5)

    for ($i = 0; $i -lt $Rounds; $i++) {
        $seed = $StartSeed + $i
        $g = Invoke-Program -Exe $genExe -InPath $emptyIn -ProgArgs @([string]$seed) -LimitMs 20000
        if ($g.Timeout) {
            Write-Host ("  seed {0}: GENERATOR TLE, skipped" -f $seed) -ForegroundColor Yellow
            $skipped++
            continue
        }
        if ($g.ExitCode -ne 0) {
            Write-Host ("  seed {0}: GENERATOR exit={1}, skipped" -f $seed, $g.ExitCode) -ForegroundColor Yellow
            $skipped++
            continue
        }
        if ([string]::IsNullOrWhiteSpace($g.StdOut)) {
            Write-Host ("  seed {0}: GENERATOR empty output, skipped" -f $seed) -ForegroundColor Yellow
            $skipped++
            continue
        }

        $hashBytes = $md5.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($g.StdOut))
        $seen[[System.BitConverter]::ToString($hashBytes)] = 1
        Write-Utf8NoBom $stressIn $g.StdOut

        $s = Invoke-Program -Exe $solExe -InPath $stressIn -LimitMs $TimeLimitMs
        if ($s.Timeout) {
            return (Save-StressFailure -InputText $g.StdOut -SolOut $null -BruteOut $null -Seed $seed -Reason ("SOLUTION TLE > {0} ms" -f $TimeLimitMs))
        }
        if ($s.ExitCode -ne 0) {
            return (Save-StressFailure -InputText $g.StdOut -SolOut $s.StdOut -BruteOut $null -Seed $seed -Reason ("SOLUTION RE exit={0} {1}" -f $s.ExitCode, $s.StdErr.Trim()))
        }

        $b = Invoke-Program -Exe $bruteExe -InPath $stressIn -LimitMs $bruteLimit
        if ($b.Timeout -or $b.ExitCode -ne 0) {
            $skipped++
            continue
        }

        if (-not (Test-SameOutput $b.StdOut $s.StdOut)) {
            Show-OutputDiff -Expected $b.StdOut -Actual $s.StdOut -ActualLabel 'SOL'
            return (Save-StressFailure -InputText $g.StdOut -SolOut $s.StdOut -BruteOut $b.StdOut -Seed $seed -Reason 'outputs differ (brute vs sol)')
        }

        $ok++
        if ($s.Ms -gt $maxSol) { $maxSol = $s.Ms }
        if ($b.Ms -gt $maxBrute) { $maxBrute = $b.Ms }
        if (($i + 1) % 50 -eq 0) {
            Write-Host ("  ... {0} rounds done" -f ($i + 1)) -ForegroundColor DarkGray
        }
    }

    if ($ok + $skipped -ge 20 -and $seen.Count -le 1) {
        Write-Host 'WARN  generator produced identical input every round; does it read argv[1] as seed?' -ForegroundColor Yellow
    }
    $color = 'Green'
    if ($ok -eq 0) { $color = 'Yellow' }
    Write-Host ("STRESS OK  {0} rounds  skipped {1}  max sol {2} ms  max brute {3} ms" -f $ok, $skipped, $maxSol, $maxBrute) -ForegroundColor $color
    if ($ok -eq 0) { return 1 }
    return 0
}

$code = 0
switch ($Action) {
    'build' { $code = Invoke-Build }
    'run' { $code = Invoke-Run }
    'samples' { $code = Invoke-Samples }
    'stress' { $code = Invoke-Stress }
}
exit $code
