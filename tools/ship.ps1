[CmdletBinding()]
param(
    [string]$Message = '',
    [switch]$DryRun,
    [switch]$NoPush
)

# tools/ship.ps1
# 一键提交并推送到 GitCode（带安全检查，防止误提交密钥/个人文件/构建产物）。
#
# 用法:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\ship.ps1 -Message "更新：xxx"
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\ship.ps1 -DryRun   # 只检查，不提交
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\ship.ps1 -NoPush   # 只提交，不推送
#
# 注意：如果工作区还有没纳入版本管理的个人文件，它们不会被提交（.gitignore 已排除）。

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    Write-Host '--- git status ---'
    & git status --short

    & git add -A
    $staged = @(& git diff --cached --name-only)
    if ($staged.Count -eq 0) {
        Write-Host '没有需要提交的改动。' -ForegroundColor Yellow
        exit 0
    }

    # 1) 拦截个人配置 / 构建产物
    $blocked = @($staged | Where-Object {
        $_ -match '(^|/)ai-config\.json$' -or
        $_ -match '(^|/)cf-handle\.txt$' -or
        $_ -match '(^|/)training/(plan\.(md|json)|redo\.md|log\.md)$' -or
        $_ -match '\.vsix$' -or
        $_ -match '^dist/' -or
        $_ -match '^\.build/'
    })
    if ($blocked.Count -gt 0) {
        Write-Host '拒绝提交：发现个人配置/构建产物，请先移出提交：' -ForegroundColor Red
        $blocked | ForEach-Object { Write-Host ('  ' + $_) }
        exit 1
    }

    # 2) 拦截疑似 API key
    $secretHits = & git grep --cached -I -n -E 'sk-[A-Za-z0-9]{16,}' 2>$null
    if ($secretHits) {
        Write-Host '拒绝提交：疑似发现 API key（sk-...）：' -ForegroundColor Red
        $secretHits | Select-Object -First 5 | ForEach-Object { Write-Host ('  ' + $_) }
        exit 1
    }

    if (-not $Message) {
        $Message = '更新：' + (Get-Date -Format 'yyyy-MM-dd HH:mm')
    }
    Write-Host ('提交信息: ' + $Message)

    if ($DryRun) {
        Write-Host 'DRY RUN：检查通过，未提交/未推送。' -ForegroundColor Yellow
        exit 0
    }

    & git commit -m $Message
    if ($LASTEXITCODE -ne 0) { throw 'git commit 失败' }

    if (-not $NoPush) {
        & git push
        if ($LASTEXITCODE -ne 0) { throw 'git push 失败' }
        Write-Host '已提交并推送到 GitCode。' -ForegroundColor Green
    } else {
        Write-Host '已提交（未推送，使用 -NoPush）。' -ForegroundColor Yellow
    }
} finally {
    Pop-Location
}
