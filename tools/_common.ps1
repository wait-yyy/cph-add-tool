# tools/_common.ps1
# Shared helpers for agent-facing CP tooling.
# Target: Windows PowerShell 5.1 (no pwsh 7 on this machine, no PS7-only syntax).
# Output is deliberately ASCII: PS 5.1 console encoding would mangle UTF-8 Chinese.

$ErrorActionPreference = 'Continue'

$script:RepoRoot    = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script:ToolsDir    = $PSScriptRoot
$script:WorkDir     = Join-Path $script:RepoRoot '.build'
$script:Cxx         = 'C:\msys64\ucrt64\bin\g++.exe'
$script:ReleaseFlags = @('-std=gnu++23', '-O2', '-Wall', '-Wl,--stack=268435456', '-D', 'DEBUG', '-D', 'CPH')
$script:DebugFlags   = @('-std=gnu++23', '-O0', '-g3', '-D_GLIBCXX_DEBUG', '-Wall', '-Wl,--stack=268435456', '-D', 'DEBUG', '-D', 'CPH')

if (-not (Test-Path -LiteralPath $script:Cxx)) { $script:Cxx = 'g++' }

function Ensure-WorkDir {
    if (-not (Test-Path -LiteralPath $script:WorkDir)) {
        New-Item -ItemType Directory -Force -Path $script:WorkDir | Out-Null
    }
    return $script:WorkDir
}

# Resolve an existing file or directory, relative to the caller's current directory.
function Resolve-Source {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "PATH NOT FOUND: $Path"
    }
    return [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path).Path)
}

# Every compiled binary lives under .build/<ascii-name>[_hash].exe
# g++ corrupts non-ASCII *output* filenames on this setup (训练.exe -> mojibake), so the
# binary name is ASCII only; a short content hash keeps non-ASCII sources collision-free.
function Get-ExePath {
    param([Parameter(Mandatory = $true)][string]$Source)
    Ensure-WorkDir | Out-Null
    $base = [System.IO.Path]::GetFileNameWithoutExtension($Source)
    $ascii = $base -replace '[^A-Za-z0-9_.-]', '_'
    if ($ascii -ne $base) {
        $md5 = [System.Security.Cryptography.MD5]::Create()
        $hash = [System.BitConverter]::ToString($md5.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($base)))
        $hash = $hash.Replace('-', '').Substring(0, 8)
        $ascii = $ascii + '_' + $hash
    }
    return (Join-Path $script:WorkDir ($ascii + '.exe'))
}

# g++/ld mangle non-ASCII *absolute* paths passed via -o (workspace path contains 算竞),
# so every compiler argument must be relative to the repo root, with cwd = repo root.
function Get-WorkspaceRelative {
    param([Parameter(Mandatory = $true)][string]$FullPath)
    $root = $script:RepoRoot.TrimEnd('\')
    $full = [System.IO.Path]::GetFullPath($FullPath)
    if ($full.Equals($root, [System.StringComparison]::OrdinalIgnoreCase)) { return '.' }
    if ($full.StartsWith($root + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        return $full.Substring($root.Length + 1)
    }
    throw "PATH OUTSIDE WORKSPACE (work inside $root): $FullPath"
}

function Build-CppFile {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [switch]$DebugBuild,
        [switch]$Quiet
    )
    Ensure-WorkDir | Out-Null
    $src = Resolve-Source $Source
    $exe = Get-ExePath $src
    $flags = $script:ReleaseFlags
    if ($DebugBuild) { $flags = $script:DebugFlags }
    # relative arguments only (see Get-WorkspaceRelative)
    $argv = @($flags) + @('-o', (Get-WorkspaceRelative $exe), (Get-WorkspaceRelative $src))

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Push-Location $script:RepoRoot
    try {
        $out = & $script:Cxx @argv 2>&1
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    $sw.Stop()
    $ms = [int]$sw.Elapsed.TotalMilliseconds

    if ($code -ne 0) {
        Write-Host ("BUILD FAILED  {0}  ({1} ms)" -f [System.IO.Path]::GetFileName($src), $ms) -ForegroundColor Red
        foreach ($line in $out) { Write-Host ("  " + $line) -ForegroundColor Red }
        return $null
    }
    if (-not $Quiet) {
        $warn = 0
        foreach ($line in $out) {
            $s = "$line"
            if ($s.Trim() -ne '') { Write-Host ("  warn: " + $s) -ForegroundColor DarkYellow; $warn++ }
        }
        $tag = 'BUILD OK'
        if ($warn -gt 0) { $tag = "BUILD OK ($warn warnings)" }
        Write-Host ("{0}  {1}  {2} ms" -f $tag, $exe, $ms) -ForegroundColor Green
    }
    return $exe
}

# Compile the native runner (tools/_runner.cpp -> .build/_runner.exe) when missing or stale.
function Ensure-Runner {
    Ensure-WorkDir | Out-Null
    $src = Join-Path $script:ToolsDir '_runner.cpp'
    $exe = Join-Path $script:WorkDir '_runner.exe'
    $stale = $true
    if ((Test-Path -LiteralPath $exe) -and (Test-Path -LiteralPath $src)) {
        if ((Get-Item -LiteralPath $exe).LastWriteTimeUtc -ge (Get-Item -LiteralPath $src).LastWriteTimeUtc) { $stale = $false }
    }
    if (-not $stale) { return $exe }
    $argv = @('-std=gnu++23', '-O2', '-o', (Get-WorkspaceRelative $exe), (Get-WorkspaceRelative $src), '-lshell32')
    Push-Location $script:RepoRoot
    try {
        $out = & $script:Cxx @argv 2>&1
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($code -ne 0) {
        throw ("failed to build tools/_runner.cpp: " + (($out | ForEach-Object { "$_" }) -join ' | '))
    }
    return $exe
}

# Run a binary through the native runner: reliable exit code, enforced time limit,
# file-based stdio (no pipe deadlocks). Returns @{ Timeout; ExitCode; Ms; StdOut; StdErr }
function Invoke-Program {
    param(
        [Parameter(Mandatory = $true)][string]$Exe,
        [string]$InPath,
        [string[]]$ProgArgs = @(),
        [int]$LimitMs = 10000,
        [string]$WorkingDirectory = ''
    )
    $work = Ensure-WorkDir
    $runner = Ensure-Runner
    $outFile = Join-Path $work '_run.out'
    $errFile = Join-Path $work '_run.err'
    $statusFile = Join-Path $work '_run.status'
    foreach ($f in @($outFile, $errFile, $statusFile)) {
        if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
    }
    $inFile = $InPath
    if (-not $inFile -or -not (Test-Path -LiteralPath $inFile)) { $inFile = New-EmptyInput }

    $argv = @($Exe, $inFile, $outFile, $errFile, [string]([Math]::Max(1, $LimitMs)), $statusFile)
    if ($ProgArgs.Count -gt 0) { $argv += $ProgArgs }

    $runDir = $script:RepoRoot
    if ($WorkingDirectory -and (Test-Path -LiteralPath $WorkingDirectory -PathType Container)) { $runDir = $WorkingDirectory }

    Push-Location $runDir
    try {
        & $runner @argv | Out-Null
        $runnerExit = $LASTEXITCODE
    } finally {
        Pop-Location
    }

    $status = @{}
    if (Test-Path -LiteralPath $statusFile) {
        foreach ($line in (Get-Content -LiteralPath $statusFile)) {
            if ("$line" -match '^\s*([A-Za-z]+)\s*=\s*(.*)$') { $status[$matches[1]] = $matches[2].Trim() }
        }
    }
    $stdout = ''
    $stderr = ''
    if (Test-Path -LiteralPath $outFile) { $stdout = [System.IO.File]::ReadAllText($outFile) }
    if (Test-Path -LiteralPath $errFile) { $stderr = [System.IO.File]::ReadAllText($errFile) }

    if ($runnerExit -ne 0) {
        $msg = "RUNNER FAILED exit=$runnerExit"
        if ($status.ContainsKey('error')) { $msg += " " + $status['error'] }
        return @{ Timeout = $false; ExitCode = -1; Ms = 0; StdOut = $stdout; StdErr = $msg }
    }

    $timedOut = ($status['timeout'] -eq '1')
    $exitCode = -1
    if ($status.ContainsKey('exit')) { $exitCode = [long]$status['exit'] }
    $ms = 0
    if ($status.ContainsKey('ms')) { $ms = [int]$status['ms'] }
    if ($status.ContainsKey('error')) { $stderr = $stderr + "`n" + $status['error'] }
    return @{ Timeout = $timedOut; ExitCode = $exitCode; Ms = $ms; StdOut = $stdout; StdErr = $stderr }
}

# Tolerant comparison: CRLF -> LF, trailing spaces per line removed, trailing blank lines removed.
function Get-NormalizedText {
    param([string]$Text)
    if ($null -eq $Text) { return '' }
    $t = $Text.Replace("`r`n", "`n").Replace("`r", "`n")
    $lines = $t.Split("`n")
    for ($i = 0; $i -lt $lines.Length; $i++) { $lines[$i] = $lines[$i].TrimEnd() }
    return ($lines -join "`n").TrimEnd("`n")
}

function Test-SameOutput {
    param([string]$Expected, [string]$Actual)
    return ((Get-NormalizedText $Expected) -ceq (Get-NormalizedText $Actual))
}

function Show-OutputDiff {
    param([string]$Expected, [string]$Actual, [string]$ActualLabel = 'GOT', [int]$MaxLines = 20)
    $e = (Get-NormalizedText $Expected).Split("`n")
    $a = (Get-NormalizedText $Actual).Split("`n")
    $n = [Math]::Min($MaxLines, [Math]::Max($e.Length, $a.Length))
    Write-Host '  EXPECTED | ' -NoNewline -ForegroundColor DarkGray
    Write-Host $ActualLabel -ForegroundColor DarkGray
    for ($i = 0; $i -lt $n; $i++) {
        $ev = ''
        $av = ''
        if ($i -lt $e.Length) { $ev = $e[$i] }
        if ($i -lt $a.Length) { $av = $a[$i] }
        $mark = ' '
        $color = 'Gray'
        if ($ev -cne $av) { $mark = '!'; $color = 'Red' }
        Write-Host ("  {0} {1,-30} | {2}" -f $mark, $ev, $av) -ForegroundColor $color
    }
    if ($n -lt [Math]::Max($e.Length, $a.Length)) {
        Write-Host ("  ... (truncated; expected {0} lines, got {1} lines)" -f $e.Length, $a.Length) -ForegroundColor DarkGray
    }
}

# Write text as UTF-8 without BOM.
function Write-Utf8NoBom {
    param([Parameter(Mandatory = $true)][string]$Path, [string]$Text)
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function New-EmptyInput {
    Ensure-WorkDir | Out-Null
    $f = Join-Path $script:WorkDir '_empty.in'
    if (-not (Test-Path -LiteralPath $f)) { Write-Utf8NoBom $f '' }
    return $f
}
