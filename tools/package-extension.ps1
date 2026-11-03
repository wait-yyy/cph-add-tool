[CmdletBinding()]
param(
    [string]$OutDir = '',
    [switch]$Publish,
    [string]$Publisher = '',
    [string]$Token = $env:VSCE_PAT,
    [string]$Version = ''
)

# tools/package-extension.ps1
# Build a .vsix of the local VS Code extension, or publish it to the VS Code Marketplace.
#
# Build:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\package-extension.ps1
#   -> dist\cf-training-tools-<version>.vsix
#   Install it with: VS Code -> Extensions -> ... -> Install from VSIX
#
# Publish (requires a Marketplace publisher + Azure DevOps PAT with Marketplace:Manage scope):
#   $env:VSCE_PAT = '<your-pat>'
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\package-extension.ps1 -Publish -Publisher <your-publisher-id>
#   optional: -Version 0.6.1
#
# Open VSX (VSCodium etc.):
#   npx --yes ovsx publish dist\cf-training-tools-<version>.vsix -p <openvsx-token>

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$extDir = Join-Path $PSScriptRoot 'vscode-extension\cf-training-tools'
if (-not (Test-Path -LiteralPath (Join-Path $extDir 'package.json'))) {
    throw ('extension source not found: ' + $extDir)
}
if (-not $OutDir) {
    $OutDir = Join-Path $repoRoot 'dist'
} elseif (-not [System.IO.Path]::IsPathRooted($OutDir)) {
    # resolve relative -OutDir against the repo root, not the extension dir
    $OutDir = Join-Path $repoRoot $OutDir
}
$OutDir = [System.IO.Path]::GetFullPath($OutDir)

$pkgPath = Join-Path $extDir 'package.json'
$original = [System.IO.File]::ReadAllText($pkgPath)
$pkg = $original | ConvertFrom-Json
$changed = $false

function Invoke-Checked {
    param([string]$WorkDir, [string[]]$Arguments, [string]$What)
    Push-Location $WorkDir
    try {
        & npx --yes @Arguments
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($code -ne 0) { throw ($What + ' failed (exit ' + $code + ')') }
}

try {
    if ($Publisher -and ([string]$pkg.publisher -ne $Publisher)) {
        $pkg.publisher = $Publisher
        $changed = $true
    }
    if ($Version) {
        $pkg.version = $Version
        $changed = $true
    }
    if ($changed) {
        [System.IO.File]::WriteAllText($pkgPath, ($pkg | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding($false)))
        Write-Host ('package.json 临时改为 publisher=' + $pkg.publisher + ' version=' + $pkg.version)
    }

    if ($Publish) {
        if (-not $Token) { throw '缺少 token：请设置 $env:VSCE_PAT 或传 -Token' }
        Write-Host '--- vsce publish ---'
        Invoke-Checked -WorkDir $extDir -Arguments @('@vscode/vsce', 'publish', '-p', $Token) -What 'vsce publish'
        Write-Host 'PUBLISHED  https://marketplace.visualstudio.com/manage' -ForegroundColor Green
    } else {
        New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
        $outFile = Join-Path $OutDir ($pkg.name + '-' + $pkg.version + '.vsix')
        Write-Host '--- vsce package ---'
        Invoke-Checked -WorkDir $extDir -Arguments @('@vscode/vsce', 'package', '--out', $outFile) -What 'vsce package'
        Write-Host ('DONE ' + $outFile) -ForegroundColor Green
    }
} finally {
    if ($changed) {
        [System.IO.File]::WriteAllText($pkgPath, $original, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host 'package.json 已还原'
    }
}
