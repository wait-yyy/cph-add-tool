# tools/_cf_api.ps1
# Shared Codeforces API helpers for the training tools.
# Target: Windows PowerShell 5.1. Network goes through curl.exe + a browser UA
# (Codeforces sits behind Cloudflare, plain PowerShell/Node requests get 403).
# Public API only -- no login, no cookies, no password.

$script:CfRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script:CfCacheDir = Join-Path $script:CfRoot '.build\cf-cache'
$script:CfUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

function Get-CfHandle {
    param([string]$Handle)
    if ($Handle -and $Handle.Trim() -ne '') { return $Handle.Trim() }
    $f = Join-Path $script:CfRoot 'training\cf-handle.txt'
    if (Test-Path -LiteralPath $f) {
        $t = ([System.IO.File]::ReadAllText($f)).Trim()
        if ($t -ne '') { return $t }
    }
    throw 'CF handle not configured: write it into training\cf-handle.txt or pass -Handle'
}

function Get-CfCachePath([string]$Name) {
    if (-not (Test-Path -LiteralPath $script:CfCacheDir)) {
        New-Item -ItemType Directory -Force -Path $script:CfCacheDir | Out-Null
    }
    return (Join-Path $script:CfCacheDir ($Name + '.json'))
}

function Invoke-CfApi {
    param(
        [Parameter(Mandatory = $true)][string]$PathAndQuery,
        [Parameter(Mandatory = $true)][string]$CacheName,
        [int]$TtlSeconds = 600,
        [switch]$NoCache
    )
    $cache = Get-CfCachePath $CacheName
    if (-not $NoCache -and (Test-Path -LiteralPath $cache)) {
        $age = ((Get-Date) - (Get-Item -LiteralPath $cache).LastWriteTime).TotalSeconds
        if ($age -lt $TtlSeconds) {
            return ([System.IO.File]::ReadAllText($cache) | ConvertFrom-Json)
        }
    }
    Start-Sleep -Milliseconds 1200
    $url = 'https://codeforces.com/api/' + $PathAndQuery
    $raw = ((& curl.exe -sS --max-time 90 -A $script:CfUa $url) | Out-String)
    if (-not $raw -or $raw.Trim() -eq '') { throw ('CF API empty response: ' + $PathAndQuery) }
    $j = $raw | ConvertFrom-Json
    if ($j.status -ne 'OK') {
        throw ('CF API failed: ' + $PathAndQuery + ' => ' + $raw.Substring(0, [Math]::Min(300, $raw.Length)))
    }
    [System.IO.File]::WriteAllText($cache, $raw, (New-Object System.Text.UTF8Encoding($false)))
    return $j
}

function Format-CfRelativePath([string]$FullPath) {
    $root = $script:CfRoot.TrimEnd('\')
    $p = [System.IO.Path]::GetFullPath($FullPath)
    if ($p.StartsWith($root + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        return ($p.Substring($root.Length + 1) -replace '\\', '/')
    }
    return $p
}

function Format-CfProblemLink([int]$ContestId, [string]$Index) {
    if ($ContestId -gt 10000) { return ('https://codeforces.com/gym/' + $ContestId + '/problem/' + $Index) }
    return ('https://codeforces.com/contest/' + $ContestId + '/problem/' + $Index)
}

# Download any URL through curl.exe with a browser UA and cache the response text.
# Used for AtCoder (kenkoooo public data) and Luogu (HTML with embedded JSON).
function Get-CachedText {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$CacheName,
        [int]$TtlSeconds = 86400
    )
    $cache = Get-CfCachePath $CacheName
    if ((Test-Path -LiteralPath $cache) -and (((Get-Date) - (Get-Item -LiteralPath $cache).LastWriteTime).TotalSeconds -lt $TtlSeconds)) {
        return [System.IO.File]::ReadAllText($cache)
    }
    Start-Sleep -Milliseconds 600
    $raw = ((& curl.exe -sSL --max-time 90 -A $script:CfUa $Url) | Out-String)
    if (-not $raw -or $raw.Trim() -eq '') { throw ('HTTP empty response: ' + $Url) }
    [System.IO.File]::WriteAllText($cache, $raw, (New-Object System.Text.UTF8Encoding($false)))
    return $raw
}

function Get-CachedJson {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$CacheName,
        [int]$TtlSeconds = 86400
    )
    $raw = Get-CachedText -Url $Url -CacheName $CacheName -TtlSeconds $TtlSeconds
    return ($raw | ConvertFrom-Json)
}
