# tools/cph-folder-patch.ps1
# Patch the CPH VS Code extension (divyanshuagrawal.competitive-programming-helper)
# so problems pulled from Competitive Companion are created inside a per-contest folder:
#
#   <workspace>\codeforces\1131 div3\2278A.cpp
#   <workspace>\codeforces\1131 div3\.cph\.2278A.cpp_<md5>.prob
#   <workspace>\codeforces\1131 div3\2278A.bin
#   <workspace>\codeforces\1131 div3\2278A.md      <- bilingual statement, preview auto-opens to the side
#
# Folder rule (see $Helper below): judge dir + contest dir, e.g.
#   Codeforces Round 1131 (Div. 3)          -> codeforces/1131 div3
#   DeepInfra Round 1 (CF Round 1126, Div. 1 + Div. 2) -> codeforces/1126 div1+2
#   Educational Codeforces Round 123 (Div. 2)          -> codeforces/edu123 div2
#   Codeforces Global Round 28                         -> codeforces/global28
#   Codeforces gym 729808                              -> codeforces/gym729808
#   AtCoder ABC400                                     -> atcoder/abc400
#   Luogu P1234                                        -> luogu/P1234
# Non-contest / unknown URLs fall back to the workspace root (old behaviour).
#
# Usage (Windows PowerShell 5.1):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\cph-folder-patch.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\cph-folder-patch.ps1 -Action status
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\cph-folder-patch.ps1 -Action revert
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\cph-folder-patch.ps1 -Action selftest
#
# CPH extension updates replace dist\extension.js -> just re-run -Action apply.
# Exit codes: 0 = OK, 1 = failure.

[CmdletBinding()]
param(
    [ValidateSet('apply', 'status', 'revert', 'selftest')]
    [string]$Action = 'apply',

    [string]$ExtensionsRoot = (Join-Path $env:USERPROFILE '.vscode\extensions')
)

$ErrorActionPreference = 'Stop'

$Marker = '/*cph-folder-patch*/'
$Anchor = ';const T=async e=>{'
$OldPathLine = 'const s=(0,t.getProblemFileName)(e,o),v=f.default.join(r,s);'
$NewPathLine = 'const s=(0,t.getProblemFileName)(e,o),__cf=(0,t.getProblemFolder)(e),v=(__cf?(d.mkdirSync(f.default.join(r,__cf),{recursive:!0}),f.default.join(r,__cf,s)):f.default.join(r,s));'
$OldSaveLine = '(0,c.saveProblem)(v,e);'
$NewSaveLine = '(0,c.saveProblem)(v,e);try{(0,t.maybeStatement)(e,v,r)}catch(x){}'

# Inserted just before the companion import handler. Returns "" to keep the old
# root-directory behaviour (local problems, unknown judges, empty URL).
$Helper = @'
/*cph-folder-patch*/t.getProblemFolder=e=>{try{const u=new URL(e.url),h=u.hostname.toLowerCase();let j="online";if(/(^|\.)codeforces\.com$/.test(h))j="codeforces";else if(/(^|\.)atcoder\.jp$/.test(h))j="atcoder";else if(/(^|\.)luogu\.com(\.cn)?$/.test(h))j="luogu";else if(/(^|\.)nowcoder\.com$/.test(h))j="nowcoder";else if(/(^|\.)codechef\.com$/.test(h))j="codechef";else if(/(^|\.)vjudge\.(net|com)$/.test(h))j="vjudge";const g=String(e.group||"").replace(/\s+/g," ").trim();let c="";if(j==="codeforces"){let m=g.match(/Codeforces Round (\d+)/)||g.match(/Round (\d+)/);if(m!==null){c=m[1];const ds=[];const re=/Div\. ?(\d+)/g;let x;while((x=re.exec(g))!==null){if(ds.indexOf(x[1])<0)ds.push(x[1])}if(/Educational/i.test(g))c="edu"+c;else if(/Global Round/i.test(g))c="global"+c;if(ds.length>0)c+=" div"+ds.join("+")}else{m=u.pathname.match(/\/gym\/(\d+)/);if(m!==null)c="gym"+m[1]}}else if(j==="atcoder"){const m=u.pathname.match(/contests\/([A-Za-z0-9_]+)/);if(m!==null)c=m[1]}else if(j==="luogu"){const m=u.pathname.match(/problem\/([A-Za-z0-9_]+)/);if(m!==null)c=m[1]}else{const p=u.pathname.split("/").filter(Boolean);c=p.length>0?p[p.length-1]:""}const z=s=>String(s).replace(/[\\\/:*?"<>|\u0000-\u001f]/g,"_").replace(/[\s.]+$/,"");const a=z(c);return a!==""?z(j)+"/"+a:z(j)}catch(x){return ""}};
t.maybeStatement=(e,src,r)=>{try{const u=String(e.url||"");if(!/^https?:/i.test(u))return;const p=f.default.join(r,"tools","cph-statement.js");const x=String(src||"");if(x==="")return;const ext=f.default.extname(x);const md=(ext?x.slice(0,x.length-ext.length):x)+".md";if(!d.existsSync(md)&&d.existsSync(p)){const a=[p,u,md,String(e.name||""),String(e.group||""),String(e.timeLimit||""),String(e.memoryLimit||""),x];const cp=(0,m.spawn)("node",a,{cwd:r,windowsHide:!0,detached:!0,stdio:"ignore"});if(cp&&cp.on)cp.on("error",function(){});if(cp&&cp.unref)cp.unref()}let auto=!0;try{const v=(0,l.workspace.getConfiguration)("cf-training-tools").get("autoPreview");if(v===!1)auto=!1}catch(z){}if(!auto)return;const same=function(p){if(p==="")return!0;try{return String(p).replace(/\\/g,"/").toLowerCase()===x.replace(/\\/g,"/").toLowerCase()}catch(z){return!1}};if(!globalThis.__cphPreviewTs)globalThis.__cphPreviewTs={};const ts=globalThis.__cphPreviewTs;let n=0;const iv=setInterval(function(){try{n++;if(d.existsSync(md)){clearInterval(iv);if(ts[md]&&Date.now()-ts[md]<30000)return;let a="";try{const ae=l.window.activeTextEditor;if(ae&&ae.document)a=String(ae.document.fileName||"")}catch(z){}if(!same(a))return;setTimeout(function(){try{let a2="";try{const ae2=l.window.activeTextEditor;if(ae2&&ae2.document)a2=String(ae2.document.fileName||"")}catch(z){}if(!same(a2))return;ts[md]=Date.now();(0,l.commands.executeCommand)("markdown.showPreviewToSide",l.Uri.file(md))}catch(z){}},300)}else if(n>120){clearInterval(iv)}}catch(z){}},500);if(iv&&iv.unref)iv.unref()}catch(z){}};
'@
$Helper = $Helper.Trim()

function Read-Utf8([string]$Path) {
    return [System.IO.File]::ReadAllText($Path)
}

function Write-Utf8([string]$Path, [string]$Text) {
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Find-Node {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($null -ne $cmd) { return $cmd.Source }
    $candidates = @((Join-Path $env:ProgramFiles 'nodejs\node.exe'))
    if (${env:ProgramFiles(x86)}) {
        $candidates += (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe')
    }
    foreach ($p in $candidates) {
        if ($p -and (Test-Path -LiteralPath $p)) { return $p }
    }
    return $null
}

function Get-CphExtensionDir {
    if (-not (Test-Path -LiteralPath $ExtensionsRoot)) {
        throw "extensions dir not found: $ExtensionsRoot"
    }
    $dirs = @(Get-ChildItem -LiteralPath $ExtensionsRoot -Directory |
        Where-Object { $_.Name -like 'divyanshuagrawal.competitive-programming-helper-*' } |
        Sort-Object LastWriteTime -Descending)
    if ($dirs.Count -eq 0) {
        throw "CPH extension not found under $ExtensionsRoot"
    }
    return $dirs[0].FullName
}

function Get-ExtVersion([string]$ExtDir) {
    try {
        $pkg = Read-Utf8 (Join-Path $ExtDir 'package.json') | ConvertFrom-Json
        return [string]$pkg.version
    } catch {
        return 'unknown'
    }
}

function Invoke-Merge([string]$Js) {
    if (-not $Js.Contains($OldPathLine)) {
        throw 'anchor (source path line) not found; CPH bundle changed, patch needs an update'
    }
    if (-not $Js.Contains($OldSaveLine)) {
        throw 'anchor (saveProblem line) not found; CPH bundle changed, patch needs an update'
    }
    if (([regex]::Matches($Js, [regex]::Escape($Anchor))).Count -ne 1) {
        throw 'anchor (const T) not unique; CPH bundle changed, patch needs an update'
    }
    $once = $Js.Replace($OldPathLine, $NewPathLine)
    $once = $once.Replace($OldSaveLine, $NewSaveLine)
    return $once.Replace($Anchor, (';' + $Helper + 'const T=async e=>{'))
}

function Invoke-Unmerge([string]$Js) {
    $out = $Js.Replace($NewSaveLine, $OldSaveLine)
    $out = $out.Replace($NewPathLine, $OldPathLine)
    return $out.Replace((';' + $Helper + 'const T=async e=>{'), $Anchor)
}

function Test-JsSyntax([string]$JsPath, [string]$Node) {
    if ($null -eq $Node) {
        Write-Host 'WARN    node not found, skipped JS syntax check'
        return $true
    }
    $out = & $Node --check $JsPath 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'SYNTAX ERROR in patched extension.js:' -ForegroundColor Red
        foreach ($line in $out) { Write-Host ('  ' + $line) -ForegroundColor Red }
        return $false
    }
    return $true
}

$extDir = Get-CphExtensionDir
$jsPath = Join-Path $extDir 'dist\extension.js'
$bakPath = Join-Path $extDir 'dist\extension.js.cph-folder-orig'
$version = Get-ExtVersion $extDir

if (-not (Test-Path -LiteralPath $jsPath)) {
    Write-Host ('ERROR   extension.js not found: {0}' -f $jsPath) -ForegroundColor Red
    exit 1
}

$js = Read-Utf8 $jsPath
$isPatched = $js.Contains($Marker)
$hasBackup = Test-Path -LiteralPath $bakPath

function Show-Status {
    Write-Host ('EXT     {0}' -f $extDir)
    Write-Host ('VERSION {0}' -f $version)
    $patchText = 'no'
    if ($isPatched) { $patchText = 'yes (contest folders enabled)' }
    Write-Host ('PATCHED {0}' -f $patchText)
    $bakText = 'no'
    if ($hasBackup) { $bakText = 'yes' }
    Write-Host ('BACKUP  {0}' -f $bakText)
}

switch ($Action) {
    'status' {
        Show-Status
        exit 0
    }

    'apply' {
        Write-Host ('EXT     {0}' -f $extDir)
        Write-Host ('VERSION {0}' -f $version)
        if ($isPatched) {
            Write-Host 'STATUS  already patched, nothing to do'
            exit 0
        }
        if (-not $hasBackup) {
            Copy-Item -LiteralPath $jsPath -Destination $bakPath -Force
            Write-Host ('BACKUP  {0}' -f $bakPath)
        } else {
            Write-Host ('BACKUP  keeping existing backup: {0}' -f $bakPath)
        }
        $patched = Invoke-Merge $js
        Write-Utf8 $jsPath $patched
        $node = Find-Node
        if (-not (Test-JsSyntax $jsPath $node)) {
            Copy-Item -LiteralPath $bakPath -Destination $jsPath -Force
            Write-Host 'RESTORED original extension.js after syntax failure' -ForegroundColor Red
            exit 1
        }
        Write-Host 'PATCH OK  contests folders are enabled after a VS Code window reload'
        Write-Host '          (Ctrl+Shift+P -> Developer: Reload Window)'
        exit 0
    }

    'revert' {
        Write-Host ('EXT     {0}' -f $extDir)
        if ($hasBackup) {
            Copy-Item -LiteralPath $bakPath -Destination $jsPath -Force
            Write-Host 'REVERT OK  restored dist\extension.js from backup'
            exit 0
        }
        if (-not $isPatched) {
            Write-Host 'STATUS  not patched, nothing to revert'
            exit 0
        }
        Write-Utf8 $jsPath (Invoke-Unmerge $js)
        $node = Find-Node
        if (-not (Test-JsSyntax $jsPath $node)) { exit 1 }
        Write-Host 'REVERT OK  patch removed'
        exit 0
    }

    'selftest' {
        if (-not $isPatched) {
            Write-Host 'ERROR   patch is not applied, run -Action apply first' -ForegroundColor Red
            exit 1
        }
        $start = $js.IndexOf($Marker)
        $end = $js.IndexOf('const T=async e=>{', $start)
        if ($start -lt 0 -or $end -lt 0) {
            Write-Host 'ERROR   cannot locate patch snippet in extension.js' -ForegroundColor Red
            exit 1
        }
        $helperJs = $js.Substring($start, $end - $start)

        $harness = @'
const t={};
'@ + $helperJs + @'

const cases=[
["https://codeforces.com/contest/2278/problem/A","Codeforces - Codeforces Round 1131 (Div. 3)","codeforces/1131 div3"],
["https://codeforces.com/contest/2271/problem/A","Codeforces - DeepInfra Round 1 (Codeforces Round 1126, Div. 1 + Div. 2)","codeforces/1126 div1+2"],
["https://codeforces.com/contest/1/problem/A","Codeforces - Educational Codeforces Round 123 (Rated for Div. 2)","codeforces/edu123 div2"],
["https://codeforces.com/contest/2/problem/A","Codeforces - Codeforces Global Round 28","codeforces/global28"],
["https://codeforces.com/gym/729808/problem/A","Codeforces - 1","codeforces/gym729808"],
["https://atcoder.jp/contests/abc400/tasks/abc400_a","AtCoder - AtCoder Beginner Contest 400","atcoder/abc400"],
["https://www.luogu.com.cn/problem/P1234","Luogu - P1234","luogu/P1234"],
["not-a-url","Local",""]
];
let bad=0;
for(const c of cases){
  const got=t.getProblemFolder({url:c[0],group:c[1]});
  const ok=got===c[2];
  if(!ok)bad++;
  console.log((ok?"PASS ":"FAIL ")+JSON.stringify(c[1])+" -> "+JSON.stringify(got)+(ok?"":" (want "+JSON.stringify(c[2])+")"));
  const parts=got.split("/");
  for(const p of parts){if(/[\\:*?"<>|]/.test(p)||/[\s.]$/.test(p)){console.log("FAIL illegal char in folder: "+JSON.stringify(got));bad++;break}}
}
if(bad>0){console.log("SELFTEST FAILED ("+bad+" problems)");process.exit(1)}
console.log("SELFTEST OK  "+cases.length+" naming cases");
'@

        $work = Join-Path ([System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))) '.build'
        if (-not (Test-Path -LiteralPath $work)) { New-Item -ItemType Directory -Force -Path $work | Out-Null }
        $tmpJs = Join-Path $work '_cph_folder_selftest.js'
        Write-Utf8 $tmpJs $harness
        $node = Find-Node
        if ($null -eq $node) {
            Write-Host 'ERROR   node not found, cannot run selftest' -ForegroundColor Red
            exit 1
        }
        & $node $tmpJs
        $code = $LASTEXITCODE
        Remove-Item -LiteralPath $tmpJs -Force -ErrorAction SilentlyContinue
        if ($code -ne 0) { exit 1 }

        $spawnHarness = @'
const fs=require("fs"),path=require("path");
const t={};
__HELPER__
const d=fs,f={default:path};
let spawned=null,lastCommand=null,autoPreview=true;
const m={spawn:function(cmd,args,opts){spawned={cmd:cmd,args:args,opts:opts};return {on:function(){},unref:function(){}}}};
const l={
  commands:{executeCommand:function(cmd,uri){lastCommand={cmd:cmd,uri:uri};}},
  Uri:{file:function(p){return "uri:"+p;}},
  window:{activeTextEditor:null},
  workspace:{getConfiguration:function(){return {get:function(){return autoPreview;}}}}
};
const r=process.argv[2];
let bad=0;
function check(name,ok,extra){console.log((ok?"PASS ":"FAIL ")+name+(extra?"  "+extra:""));if(!ok)bad++}
function sleep(ms){return new Promise(function(res){setTimeout(res,ms)})}
(async function(){
  fs.mkdirSync(path.join(r,"tools"),{recursive:true});
  const scriptPath=path.join(r,"tools","cph-statement.js");
  fs.writeFileSync(scriptPath,"// fake");
  const src=path.join(r,"codeforces","1131 div3","2278A.cpp");
  const md=path.join(r,"codeforces","1131 div3","2278A.md");
  fs.mkdirSync(path.dirname(src),{recursive:true});
  l.window.activeTextEditor={document:{fileName:src}};
  const prob={url:"https://codeforces.com/contest/2278/problem/A",name:"A. X",group:"G",timeLimit:1000,memoryLimit:256};
  spawned=null;lastCommand=null;
  t.maybeStatement(prob,src,r);
  check("statement: spawn called",spawned!==null);
  if(spawned){
    check("statement: runs node",spawned.cmd==="node",spawned.cmd);
    check("statement: script arg",spawned.args[0]===scriptPath);
    check("statement: url arg",spawned.args[1]===prob.url);
    check("statement: md arg",spawned.args[2]===md,spawned.args[2]);
    check("statement: src arg",spawned.args[7]===src);
    check("statement: cwd",!!spawned.opts&&spawned.opts.cwd===r);
  }
  fs.writeFileSync(md,"x");
  await sleep(900);
  check("preview: opened for active problem",lastCommand!==null&&lastCommand.cmd==="markdown.showPreviewToSide"&&lastCommand.uri==="uri:"+md,lastCommand?JSON.stringify(lastCommand):"none");

  spawned=null;lastCommand=null;
  t.maybeStatement(prob,src,r);
  await sleep(800);
  check("statement: no spawn when md exists",spawned===null);
  check("preview: no duplicate within 30s",lastCommand===null,lastCommand?JSON.stringify(lastCommand):"none");

  const src2=path.join(r,"codeforces","1131 div3","2278B.cpp");
  const md2=path.join(r,"codeforces","1131 div3","2278B.md");
  l.window.activeTextEditor={document:{fileName:src}};
  spawned=null;lastCommand=null;
  t.maybeStatement(prob,src2,r);
  fs.writeFileSync(md2,"x");
  await sleep(900);
  check("preview: skipped for inactive problem",lastCommand===null,lastCommand?JSON.stringify(lastCommand):"none");

  const src3=path.join(r,"codeforces","1131 div3","2278C.cpp");
  const md3=path.join(r,"codeforces","1131 div3","2278C.md");
  fs.writeFileSync(md3,"x");
  l.window.activeTextEditor={document:{fileName:src3}};
  autoPreview=false;
  spawned=null;lastCommand=null;
  t.maybeStatement(prob,src3,r);
  await sleep(800);
  check("preview: autoPreview=false disables it",lastCommand===null,lastCommand?JSON.stringify(lastCommand):"none");

  fs.unlinkSync(md);
  fs.unlinkSync(scriptPath);
  autoPreview=true;
  spawned=null;lastCommand=null;
  t.maybeStatement(prob,src,r);
  await sleep(400);
  check("statement: no spawn without helper",spawned===null);
  fs.rmSync(r,{recursive:true,force:true});
  if(bad>0){console.log("SELFTEST FAILED ("+bad+" problems)");process.exit(1)}
  console.log("SELFTEST OK  statement hook");
  process.exit(0);
})();
'@
        $spawnJs = $spawnHarness.Replace('__HELPER__', $helperJs)
        $tmpJs2 = Join-Path $work '_cph_statement_selftest.js'
        Write-Utf8 $tmpJs2 $spawnJs
        $sandboxDir = Join-Path $work ('_cph_hook_' + [guid]::NewGuid().ToString('N').Substring(0, 8))
        New-Item -ItemType Directory -Force -Path $sandboxDir | Out-Null
        & $node $tmpJs2 $sandboxDir
        $code2 = $LASTEXITCODE
        Remove-Item -LiteralPath $tmpJs2 -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $sandboxDir) { Remove-Item -LiteralPath $sandboxDir -Recurse -Force }
        if ($code2 -ne 0) { exit 1 }
        exit 0
    }
}
