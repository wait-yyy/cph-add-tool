[CmdletBinding()]
param(
    [switch]$SkipPull,
    [switch]$NoExtension,
    [switch]$NoPatch
)

# tools/update.ps1
# One-command update for users who cloned the GitCode repo:
#   git pull -> reinstall the local VS Code extension -> re-apply the CPH patch
# Then reload the VS Code window.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\update.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\update.ps1 -SkipPull
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\update.ps1 -NoExtension -NoPatch

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot

Write-Host '=== CF 训练工具 · 更新 ===' -ForegroundColor Cyan
Write-Host ('仓库: ' + $root)

if (-not $SkipPull) {
    Push-Location $root
    try {
        Write-Host '--- git pull --ff-only ---'
        & git pull --ff-only
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'git pull 失败：可能有本地改动或冲突。先手动处理（git status / git stash）后再更新。' -ForegroundColor Yellow
            Pop-Location
            exit 1
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Host 'SKIP git pull'
}

if (-not $NoExtension) {
    Write-Host '--- 重装本地 VS Code 插件 ---'
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'install-vscode-extension.ps1')
} else {
    Write-Host 'SKIP 插件重装'
}

if (-not $NoPatch) {
    Write-Host '--- 检查/重新打 CPH 补丁 ---'
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'cph-folder-patch.ps1') -Action apply
} else {
    Write-Host 'SKIP CPH 补丁'
}

Write-Host ''
Write-Host '更新完成。请在 VS Code 里按 Ctrl+Shift+P -> Developer: Reload Window 让插件生效。' -ForegroundColor Green
Write-Host '（如果状态栏/活动栏版本没变化，完全退出 VS Code 再打开一次）'
