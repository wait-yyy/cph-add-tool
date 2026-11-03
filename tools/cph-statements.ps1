# tools/cph-statements.ps1
# Generate Markdown statements for problems already pulled by CPH.
#
# The patched CPH extension runs this automatically for newly pulled problems
# (via tools/cph-statement.js). This script is for backfilling old problems or
# regenerating one file.
#
# Usage (Windows PowerShell 5.1):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\cph-statements.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\cph-statements.ps1 -Solution "codeforces\1131 div3\2278A.cpp"
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\cph-statements.ps1 -Force
#
# It reads CPH's .cph/*.prob cache (JSON with name/group/url/timeLimit/memoryLimit)
# and writes <problem>.md next to the source file.
# Exit codes: 0 = all OK/skipped, 1 = at least one failure, 2 = usage error.

[CmdletBinding()]
param(
    [string]$Solution,
    [switch]$Force
)

$ErrorActionPreference = 'Continue'

$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$StatementJs = Join-Path $PSScriptRoot 'cph-statement.js'

$NodeExe = $null
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($null -ne $cmd) { $NodeExe = $cmd.Source }
if (-not $NodeExe) {
    $candidates = @((Join-Path $env:ProgramFiles 'nodejs\node.exe'))
    if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe') }
    foreach ($p in $candidates) {
        if ($p -and (Test-Path -LiteralPath $p)) { $NodeExe = $p; break }
    }
}
if (-not $NodeExe) {
    Write-Host 'ERROR   node not found in PATH' -ForegroundColor Red
    exit 2
}
if (-not (Test-Path -LiteralPath $StatementJs)) {
    Write-Host ('ERROR   helper not found: {0}' -f $StatementJs) -ForegroundColor Red
    exit 2
}

$script:fail = 0
$script:ok = 0
$script:skip = 0
$script:seen = @{}

function Get-Relative([string]$FullPath) {
    $p = [System.IO.Path]::GetFullPath($FullPath)
    if ($p.StartsWith($Root + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        return $p.Substring($Root.Length + 1)
    }
    return $p
}

# Find the current local source file for a .prob entry.
# srcPath in the JSON may point to a path that no longer exists (file moved).
function Find-SourceFile($Prob) {
    $srcPath = [string]$Prob.srcPath
    if ($srcPath -and (Test-Path -LiteralPath $srcPath)) {
        return [System.IO.Path]::GetFullPath($srcPath)
    }
    if (-not $srcPath) { return $null }
    $base = [System.IO.Path]::GetFileName($srcPath)
    if (-not $base) { return $null }
    $found = @(Get-ChildItem -Path $Root -Recurse -File -Filter $base -ErrorAction SilentlyContinue |
        Where-Object {
            $_.FullName -notmatch '\\\.build\\' -and
            $_.FullName -notmatch '\\\.cph\\' -and
            $_.FullName -notmatch '\\problems\\'
        } | Select-Object -First 1)
    if ($found.Count -eq 0) { return $null }
    return $found[0].FullName
}

function Invoke-Statement($Prob, [string]$Src) {
    $key = $Src.ToLowerInvariant()
    if ($script:seen.ContainsKey($key)) {
        $script:seen[$key] = $script:seen[$key] + 1
        return
    }
    $script:seen[$key] = 1

    $url = [string]$Prob.url
    if (-not $url -or $url -notmatch '^https?://') {
        Write-Host ('SKIP   {0}  (no url)' -f (Get-Relative $Src)) -ForegroundColor DarkGray
        $script:skip++
        return
    }
    $md = [System.IO.Path]::ChangeExtension($Src, '.md')
    if ((Test-Path -LiteralPath $md) -and -not $Force) {
        Write-Host ('SKIP   {0}  (md exists)' -f (Get-Relative $md)) -ForegroundColor DarkGray
        $script:skip++
        return
    }
    $nodeArgs = @(
        $StatementJs, $url, $md, [string]$Prob.name, [string]$Prob.group,
        [string]$Prob.timeLimit, [string]$Prob.memoryLimit, $Src
    )
    if ($Force) { $nodeArgs += '--force' }
    $out = & $NodeExe @nodeArgs 2>&1
    $code = $LASTEXITCODE
    if ($code -eq 0) {
        Write-Host ('OK     {0}' -f (Get-Relative $md)) -ForegroundColor Green
        $script:ok++
    } else {
        $msg = ($out | ForEach-Object { "$_" }) -join ' | '
        Write-Host ('FAIL   {0}  {1}' -f (Get-Relative $Src), $msg) -ForegroundColor Red
        $script:fail++
    }
}

if ($Solution) {
    if (-not (Test-Path -LiteralPath $Solution)) {
        Write-Host ('ERROR   file not found: {0}' -f $Solution) -ForegroundColor Red
        exit 2
    }
    $src = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Solution).Path)
    $base = [System.IO.Path]::GetFileName($src)
    $candidates = @()
    $localCph = Join-Path (Split-Path -Parent $src) '.cph'
    if (Test-Path -LiteralPath $localCph) {
        $candidates += @(Get-ChildItem -LiteralPath $localCph -File -Filter ('.' + $base + '_*.prob') -ErrorAction SilentlyContinue)
    }
    $rootCph = Join-Path $Root '.cph'
    if (Test-Path -LiteralPath $rootCph) {
        $candidates += @(Get-ChildItem -LiteralPath $rootCph -File -Filter ('.' + $base + '_*.prob') -ErrorAction SilentlyContinue)
    }
    $candidates = @($candidates | Sort-Object LastWriteTime -Descending)
    if ($candidates.Count -eq 0) {
        Write-Host ('ERROR   no .cph cache for {0}' -f $base) -ForegroundColor Red
        exit 2
    }
    $prob = [System.IO.File]::ReadAllText($candidates[0].FullName) | ConvertFrom-Json
    Invoke-Statement $prob $src
} else {
    $cphDirs = @(Get-ChildItem -Path $Root -Recurse -Directory -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq '.cph' -and $_.FullName -notmatch '\\\.build\\' })
    $probs = @()
    foreach ($d in $cphDirs) {
        $probs += @(Get-ChildItem -LiteralPath $d.FullName -File -Filter '*.prob' -ErrorAction SilentlyContinue)
    }
    if ($probs.Count -eq 0) {
        Write-Host 'NO DATA  no .cph/*.prob caches found' -ForegroundColor Yellow
        exit 2
    }
    $probs = @($probs | Sort-Object LastWriteTime -Descending)
    Write-Host ('CACHE   {0} .prob file(s) in {1} .cph folder(s)' -f $probs.Count, $cphDirs.Count)
    foreach ($pf in $probs) {
        try {
            $prob = [System.IO.File]::ReadAllText($pf.FullName) | ConvertFrom-Json
        } catch {
            Write-Host ('SKIP   unreadable cache: {0}' -f $pf.Name) -ForegroundColor DarkGray
            $script:skip++
            continue
        }
        $src = Find-SourceFile $prob
        if (-not $src) {
            Write-Host ('SKIP   {0}  (source file not found)' -f $pf.Name) -ForegroundColor DarkGray
            $script:skip++
            continue
        }
        Invoke-Statement $prob $src
    }
}

Write-Host ('SUMMARY  ok={0}  skip={1}  fail={2}' -f $script:ok, $script:skip, $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0
