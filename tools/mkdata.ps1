# tools/mkdata.ps1 -- agent CLI for problem setting: generate data + validate with brute/checker + time the solution
#
# Expected layout of a problem folder (see templates/):
#   problems/<slug>/
#     statement.md      problem statement
#     gen.cpp           generator, argv[1] = seed, writes test input to stdout
#     sol.cpp           reference solution (usually copied from new.cpp template)
#     brute.cpp         brute force (optional, used for cross-validation)
#     checker.cpp       optional special judge: checker.exe <input> <answer> <output>, exit 0 = AC
#     data/             generated tXX.in / tXX.ans (created by this script)
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\mkdata.ps1 -ProblemDir problems\slug [-Count 20] [-StartSeed 1] [-TimeLimitMs 2000] [-NoValidate]

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ProblemDir,
    [int]$Count = 20,
    [int]$StartSeed = 1,
    [int]$TimeLimitMs = 2000,
    [switch]$NoValidate
)

. (Join-Path $PSScriptRoot '_common.ps1')

$dir = Resolve-Source $ProblemDir
if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
    Write-Host ("NOT A DIRECTORY: {0}" -f $dir) -ForegroundColor Red
    exit 2
}

$genCpp = Join-Path $dir 'gen.cpp'
$solCpp = Join-Path $dir 'sol.cpp'
$bruteCpp = Join-Path $dir 'brute.cpp'
$checkerCpp = Join-Path $dir 'checker.cpp'

foreach ($required in @($genCpp, $solCpp)) {
    if (-not (Test-Path -LiteralPath $required)) {
        Write-Host ("MISSING: {0}" -f $required) -ForegroundColor Red
        Write-Host '  copy from templates\, e.g.:' -ForegroundColor Yellow
        Write-Host '    Copy-Item templates\gen.cpp   problems\<slug>\gen.cpp'
        Write-Host '    Copy-Item templates\brute.cpp problems\<slug>\brute.cpp'
        Write-Host '    Copy-Item templates\statement.md problems\<slug>\statement.md'
        exit 2
    }
}

$genExe = Build-CppFile -Source $genCpp
if (-not $genExe) { exit 1 }
$solExe = Build-CppFile -Source $solCpp
if (-not $solExe) { exit 1 }

$bruteExe = $null
if (-not $NoValidate) {
    if (Test-Path -LiteralPath $bruteCpp) {
        $bruteExe = Build-CppFile -Source $bruteCpp
        if (-not $bruteExe) { exit 1 }
    } else {
        Write-Host 'NOTE  no brute.cpp, validation disabled' -ForegroundColor Yellow
        $NoValidate = $true
    }
}
$checkerExe = $null
if (Test-Path -LiteralPath $checkerCpp) {
    $checkerExe = Build-CppFile -Source $checkerCpp
    if (-not $checkerExe) { exit 1 }
}

$dataDir = Join-Path $dir 'data'
if (-not (Test-Path -LiteralPath $dataDir)) {
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
}

$emptyIn = New-EmptyInput
$tmpOut = Join-Path $script:WorkDir '_mkdata_brute.out'
$failures = 0
$maxMs = 0
$slow = 0

Write-Host ("GENERATE  {0}  ({1} tests, seeds {2}..{3})" -f $dir, $Count, $StartSeed, ($StartSeed + $Count - 1)) -ForegroundColor Cyan

for ($i = 1; $i -le $Count; $i++) {
    $seed = $StartSeed + $i - 1
    $name = 't{0:D2}' -f $i
    $inPath = Join-Path $dataDir ($name + '.in')
    $ansPath = Join-Path $dataDir ($name + '.ans')

    $g = Invoke-Program -Exe $genExe -InPath $emptyIn -ProgArgs @([string]$seed) -LimitMs 60000
    if ($g.Timeout -or $g.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($g.StdOut)) {
        Write-Host ("{0}  GENERATOR FAILED  seed={1} timeout={2} exit={3}" -f $name, $seed, $g.Timeout, $g.ExitCode) -ForegroundColor Red
        if ($g.StdErr) { Write-Host ('  ' + $g.StdErr.Trim()) -ForegroundColor Red }
        $failures++
        continue
    }
    Write-Utf8NoBom $inPath $g.StdOut

    $s = Invoke-Program -Exe $solExe -InPath $inPath -LimitMs ([Math]::Max(3000, $TimeLimitMs * 5))
    if ($s.Timeout) {
        Write-Host ("{0}  SOL TLE  > {1} ms  (seed={2})" -f $name, [Math]::Max(3000, $TimeLimitMs * 5), $seed) -ForegroundColor Red
        $failures++
        continue
    }
    if ($s.ExitCode -ne 0) {
        Write-Host ("{0}  SOL RE  exit={1}  (seed={2})" -f $name, $s.ExitCode, $seed) -ForegroundColor Red
        if ($s.StdErr) { Write-Host ('  ' + $s.StdErr.Trim()) -ForegroundColor Red }
        $failures++
        continue
    }
    Write-Utf8NoBom $ansPath $s.StdOut
    if ($s.Ms -gt $maxMs) { $maxMs = $s.Ms }
    if ($s.Ms -gt $TimeLimitMs) { $slow++ }

    $sizeKb = [Math]::Round((Get-Item -LiteralPath $inPath).Length / 1024.0, 1)
    $status = 'ok'
    $statusColor = 'Green'

    if (-not $NoValidate) {
        $b = Invoke-Program -Exe $bruteExe -InPath $inPath -LimitMs ([Math]::Max(3000, $TimeLimitMs * 20))
        if ($b.Timeout -or $b.ExitCode -ne 0) {
            $status = 'brute failed (skipped)'
            $statusColor = 'Yellow'
        } else {
            Write-Utf8NoBom $tmpOut $b.StdOut
            if ($checkerExe) {
                # Relative + ASCII-only argv: the checker opens argv paths itself (fopen is
                # ANSI-based on Mingw), so never hand it the non-ASCII absolute workspace path.
                $c = Invoke-Program -Exe $checkerExe -InPath $emptyIn -LimitMs 20000 -WorkingDirectory $script:RepoRoot -ProgArgs @(
                    (Get-WorkspaceRelative $inPath), (Get-WorkspaceRelative $ansPath), (Get-WorkspaceRelative $tmpOut)
                )
                if ($c.Timeout -or $c.ExitCode -ne 0) {
                    $status = 'CHECKER REJECTED'
                    $statusColor = 'Red'
                    $failures++
                    if ($c.StdErr) { Write-Host ('  ' + $c.StdErr.Trim()) -ForegroundColor Red }
                }
            } elseif (-not (Test-SameOutput $b.StdOut $s.StdOut)) {
                $status = 'BRUTE MISMATCH'
                $statusColor = 'Red'
                $failures++
                Show-OutputDiff -Expected $b.StdOut -Actual $s.StdOut -ActualLabel 'SOL'
            }
        }
    }

    Write-Host ("{0}  {1,7} KB  {2,5} ms  {3}" -f $name, $sizeKb, $s.Ms, $status) -ForegroundColor $statusColor
}

Write-Host ''
$color = 'Green'
if ($failures -gt 0) { $color = 'Red' }
Write-Host ("DONE  {0} tests  failures {1}  max sol {2} ms" -f $Count, $failures, $maxMs) -ForegroundColor $color
if ($slow -gt 0) {
    Write-Host ("WARN  {0} test(s) exceeded -TimeLimitMs {1} (judge time limit should be ~2-3x the slowest accepted run)" -f $slow, $TimeLimitMs) -ForegroundColor Yellow
}
if ($failures -gt 0) { exit 1 }
exit 0
