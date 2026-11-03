# tools/install-vscode-extension.ps1
# Install (or uninstall) the local "CF Training Tools" VS Code extension.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\install-vscode-extension.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\install-vscode-extension.ps1 -Uninstall
#
# After installing/reinstalling, reload the VS Code window:
#   Ctrl+Shift+P -> Developer: Reload Window
# (If the version does not change, fully close VS Code and reopen so it rescans
#  the extensions folder.)
#
# Exit codes: 0 = OK, 1 = failure.

[CmdletBinding()]
param(
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$src = Join-Path $PSScriptRoot 'vscode-extension\cf-training-tools'
$extRoot = Join-Path $env:USERPROFILE '.vscode\extensions'

if (-not (Test-Path -LiteralPath $extRoot)) {
    New-Item -ItemType Directory -Force -Path $extRoot | Out-Null
}

# Update VS Code's extension registry (extensions.json) so a window reload can pick
# up the new version without a full application restart. Best effort.
function Update-Registry {
    param(
        [string]$ExtRoot,
        [string]$DestName,
        [string]$Version,
        [string]$Dest,
        [switch]$Remove
    )
    $extJsonPath = Join-Path $ExtRoot 'extensions.json'
    if (-not (Test-Path -LiteralPath $extJsonPath)) { return }
    try {
        $parsed = [System.IO.File]::ReadAllText($extJsonPath) | ConvertFrom-Json
        # In Windows PowerShell 5.1 ConvertFrom-Json emits the whole array as one
        # pipeline object; flatten explicitly so the foreach sees each extension.
        $arr = @($parsed | ForEach-Object { $_ })
        $found = $false
        $out = @()
        foreach ($entry in $arr) {
            $id = ''
            if ($null -ne $entry.identifier) { $id = [string]$entry.identifier.id }
            if ($id -match '(^|\.)cf-training-tools$') {
                $found = $true
                if ($Remove) { continue }
                $entry.version = $Version
                $entry.relativeLocation = $DestName
                if ($null -ne $entry.location) {
                    $entry.location.path = ('/' + ($Dest -replace '\\', '/'))
                }
                $out += $entry
            } else {
                $out += $entry
            }
        }
        if (-not $found) { return }
        $json = ''
        if (@($out).Count -eq 1) {
            $json = '[' + (ConvertTo-Json -InputObject $out[0] -Depth 12) + ']'
        } else {
            $json = ConvertTo-Json -InputObject @($out) -Depth 12
        }
        [System.IO.File]::WriteAllText($extJsonPath, $json, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host 'REGISTRY  extensions.json updated'
    } catch {
        Write-Host ('WARN      extensions.json update failed: ' + $_.Exception.Message)
    }
}

# Remove every version of the local extension first (any publisher id).
$oldDirs = @(Get-ChildItem -LiteralPath $extRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like '*cf-training-tools-*' })
foreach ($d in $oldDirs) {
    Remove-Item -LiteralPath $d.FullName -Recurse -Force
    Write-Host ('REMOVED  ' + $d.FullName)
}

if ($Uninstall) {
    Update-Registry -ExtRoot $extRoot -Remove
    if ($oldDirs.Count -eq 0) { Write-Host 'NOT INSTALLED' }
    Write-Host 'Reload the VS Code window to apply (Developer: Reload Window).'
    exit 0
}

if (-not (Test-Path -LiteralPath $src)) {
    Write-Host ('ERROR  extension source not found: ' + $src) -ForegroundColor Red
    exit 1
}
foreach ($f in @('package.json', 'extension.js', 'media\icon.svg')) {
    if (-not (Test-Path -LiteralPath (Join-Path $src $f))) {
        Write-Host ('ERROR  missing file in extension source: ' + $f) -ForegroundColor Red
        exit 1
    }
}
$pkg = [System.IO.File]::ReadAllText((Join-Path $src 'package.json')) | ConvertFrom-Json
$destName = ([string]$pkg.publisher) + '.' + ([string]$pkg.name) + '-' + ([string]$pkg.version)
$dest = Join-Path $extRoot $destName
Copy-Item -LiteralPath $src -Destination $dest -Recurse -Force
Update-Registry -ExtRoot $extRoot -DestName $destName -Version ([string]$pkg.version) -Dest $dest

Write-Host ('INSTALLED  ' + $dest)
Write-Host ('VERSION    ' + [string]$pkg.version)
Write-Host 'Next: Ctrl+Shift+P -> Developer: Reload Window (or fully restart VS Code)'
Write-Host 'Then: activity bar icon "CF 训练" (left side), status bar "CF 训练", or command palette "CF 训练: 训练菜单"'
exit 0
