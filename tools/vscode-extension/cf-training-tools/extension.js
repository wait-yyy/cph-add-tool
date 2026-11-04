'use strict';

// CF Training Tools -- thin VS Code wrapper around the PowerShell tools in <workspace>/tools.
// Adds: activity bar panel (current training plan + clickable buttons), status bar menu,
// command palette commands. All heavy lifting stays in the scripts.

const vscode = require('vscode');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let output = null;
let statusBar = null;
let aiStatusBar = null;
let sidebarProvider = null;
let samplesProvider = null;
let lastPreviewed = null;
let lastActiveCpp = null;
let layoutingCpp = null;

function workspaceRoot() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    return folders[0].uri.fsPath;
}

function toolsPath(name) {
    const root = workspaceRoot();
    if (!root) return null;
    return path.join(root, 'tools', name);
}

function readHandle() {
    const root = workspaceRoot();
    if (!root) return '';
    const file = path.join(root, 'training', 'cf-handle.txt');
    try {
        if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
    } catch (e) { /* ignore */ }
    return '';
}

const PLATFORM_LOGIN = {
    codeforces: { label: 'Codeforces', host: 'codeforces.com', loginUrl: 'https://codeforces.com/enter' },
    luogu: { label: '洛谷', host: 'www.luogu.com.cn', loginUrl: 'https://www.luogu.com.cn/auth/login' },
    nowcoder: { label: '牛客', host: 'ac.nowcoder.com', loginUrl: 'https://ac.nowcoder.com/login' },
    atcoder: { label: 'AtCoder', host: 'atcoder.jp', loginUrl: 'https://atcoder.jp/login' }
};

function platformCookiePath(platform) {
    const root = workspaceRoot();
    if (!root) return '';
    if (platform === 'codeforces') return path.join(root, 'training', 'cf-cookies.txt');
    return path.join(root, 'training', 'cookies.' + platform + '.txt');
}

function accountDataPath() {
    const root = workspaceRoot();
    return root ? path.join(root, 'training', 'accounts.json') : '';
}

function readAccounts() {
    const file = accountDataPath();
    if (!file) return {};
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch (e) { /* ignore */ }
    return {};
}

function writeAccount(platform, nickname) {
    const file = accountDataPath();
    if (!file) return;
    const data = readAccounts();
    data[platform] = { nickname: String(nickname || ''), at: new Date().toISOString() };
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
    } catch (e) { /* ignore */ }
}

function accountLineHtml() {
    const accounts = readAccounts();
    const handle = readHandle();
    const defs = [
        ['codeforces', 'CF', handle],
        ['luogu', '洛谷', ''],
        ['nowcoder', '牛客', ''],
        ['atcoder', 'AtCoder', '']
    ];
    return defs.map(function (d) {
        let nickname = accounts[d[0]] && accounts[d[0]].nickname ? String(accounts[d[0]].nickname) : '';
        if (!nickname && d[0] === 'codeforces') nickname = handle;
        return escapeHtml(d[1]) + '：' + (nickname ? '<code>' + escapeHtml(nickname) + '</code>' : '<span class="muted">未登录</span>');
    }).join('　') + '　' + gymStatusHtml();
}

function accountChipsHtml() {
    const accounts = readAccounts();
    const handle = readHandle();
    const defs = [
        ['codeforces', 'CF', '🟥', handle],
        ['luogu', '洛谷', '🟦', ''],
        ['nowcoder', '牛客', '🟨', ''],
        ['atcoder', 'AtCoder', '🟪', '']
    ];
    return defs.map(function (d) {
        let nickname = accounts[d[0]] && accounts[d[0]].nickname ? String(accounts[d[0]].nickname) : '';
        if (!nickname && d[0] === 'codeforces') nickname = handle;
        return '<span class="acc ' + (nickname ? 'on' : 'off') + '" title="' + escapeHtml(d[1] + (nickname ? '：' + nickname : '：未登录')) + '">' +
            '<span class="acc-ico">' + d[2] + '</span><span class="acc-name">' + escapeHtml(d[1]) + '</span>' +
            (nickname ? '<span class="acc-nick">' + escapeHtml(nickname) + '</span>' : '') + '</span>';
    }).join('');
}

function gymChipHtml() {
    const ok = hasCfCookie();
    return '<span class="chip ' + (ok ? 'ok' : 'warn') + '" title="Gym/私有比赛需要 Codeforces 登录 Cookie">' +
        '<span class="dot ' + (ok ? 'on' : 'off') + '"></span><span class="chip-key">Gym</span>' +
        '<span class="chip-val">' + (ok ? '可用' : '需要 CF Cookie') + '</span></span>';
}

function parseLastJson(text) {
    const lines = String(text || '').split(/\r?\n/).filter(function (l) { return l.trim(); });
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.charAt(0) === '{') {
            try { return JSON.parse(line); } catch (e) { /* ignore */ }
        }
    }
    return null;
}

function readPlan() {
    const root = workspaceRoot();
    if (!root) return null;
    const file = path.join(root, 'training', 'plan.json');
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) { /* ignore */ }
    return null;
}

function readAiConfig() {
    const root = workspaceRoot();
    if (!root) return {};
    const file = path.join(root, 'training', 'ai-config.json');
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch (e) { /* ignore */ }
    return {};
}

function aiConfigured() {
    if (process.env.AI_API_KEY && process.env.AI_BASE_URL) return true;
    const s = getAiSettings();
    if (s.apiKey && s.baseUrl) return true;
    const cfg = readAiConfig();
    return !!(cfg.apiKey && cfg.baseUrl);
}

function getAiSettings() {
    try {
        const conf = vscode.workspace.getConfiguration('cf-training-tools');
        const read = function (key) {
            try {
                if (conf.inspect) {
                    const ins = conf.inspect(key);
                    if (ins) {
                        if (ins.globalValue !== undefined && ins.globalValue !== null) return ins.globalValue;
                        if (ins.workspaceValue !== undefined && ins.workspaceValue !== null) return ins.workspaceValue;
                        return '';
                    }
                }
                return conf.get(key) || '';
            } catch (e) {
                return conf.get(key) || '';
            }
        };
        return {
            baseUrl: String(read('ai.baseUrl') || ''),
            model: String(read('ai.model') || ''),
            apiKey: String(read('ai.apiKey') || ''),
            temperature: read('ai.temperature')
        };
    } catch (e) {
        return {};
    }
}

function writeAiConfigFile(cfg) {
    const root = workspaceRoot();
    if (!root) return;
    const file = path.join(root, 'training', 'ai-config.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

// Keep training/ai-config.json in sync with the VS Code settings UI, so the CLI
// scripts (which read the JSON file) and the Settings page always agree.
function syncAiSettingsToFile() {
    const root = workspaceRoot();
    if (!root) return;
    const s = getAiSettings();
    if (!s.baseUrl && !s.apiKey && !s.model) return;
    const file = path.join(root, 'training', 'ai-config.json');
    let cfg = {};
    try {
        if (fs.existsSync(file)) cfg = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch (e) { cfg = {}; }
    if (!cfg.baseUrl) cfg.baseUrl = 'https://api.deepseek.com';
    if (!cfg.model) cfg.model = 'deepseek-flash';
    if (s.baseUrl) cfg.baseUrl = s.baseUrl;
    if (s.model) cfg.model = s.model;
    if (s.apiKey) cfg.apiKey = s.apiKey;
    if (typeof s.temperature === 'number') cfg.temperature = s.temperature;
    writeAiConfigFile(cfg);
}

function updateAiStatusBar() {
    if (!aiStatusBar) return;
    const on = aiConfigured();
    const s = getAiSettings();
    const cfg = readAiConfig();
    const model = String(s.model || cfg.model || 'AI');
    aiStatusBar.text = on ? ('$(sparkle) AI ' + model) : '$(sparkle) AI 未配置';
    aiStatusBar.tooltip = on ? 'AI 已配置（点击修改 API 设置）' : '点击设置 AI API（用于翻译 / 复盘 / 提示）';
    aiStatusBar.command = 'cfTraining.aiConfig';
    aiStatusBar.show();
}

function killProcessTree(pid) {
    if (!pid) return;
    try {
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
        } else {
            try { process.kill(pid, 'SIGTERM'); } catch (e) { /* ignore */ }
        }
    } catch (e) { /* ignore */ }
}

function runNode(scriptName, args, title, options) {
    options = options || {};
    const root = workspaceRoot();
    if (!root) return Promise.reject(new Error('请先打开算竞工作区文件夹'));
    const scriptPath = toolsPath(scriptName);
    if (!scriptPath || !fs.existsSync(scriptPath)) {
        return Promise.reject(new Error('脚本不存在: ' + String(scriptPath)));
    }
    if (output) {
        output.show(true);
        output.appendLine('> node ' + scriptName + ' ' + (args || []).join(' '));
    }
    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: title || 'CF 训练工具',
        cancellable: options.cancellable !== false
    }, function (progress, token) {
        return new Promise(function (resolve) {
            let stdout = '';
            let stderr = '';
            let child;
            let cancelled = false;
            let killTimer = null;
            try {
                child = spawn('node', [scriptPath].concat(args || []), { cwd: root, windowsHide: true });
            } catch (e) {
                return resolve({ code: -1, stdout: '', stderr: String(e), cancelled: false });
            }
            if (token && token.onCancellationRequested) {
                token.onCancellationRequested(function () {
                    cancelled = true;
                    if (progress) { try { progress.report({ message: '正在中断…' }); } catch (e) { /* ignore */ } }
                    killProcessTree(child.pid);
                    killTimer = setTimeout(function () { killProcessTree(child.pid); }, 1500);
                });
            }
            child.stdout.on('data', function (d) { const s = d.toString(); stdout += s; if (output) output.append(s); });
            child.stderr.on('data', function (d) { const s = d.toString(); stderr += s; if (output) output.append(s); });
            child.on('error', function (e) { resolve({ code: -1, stdout: stdout, stderr: stderr + ' ' + String(e), cancelled: cancelled }); });
            child.on('close', function (code) {
                if (killTimer) clearTimeout(killTimer);
                resolve({ code: code, stdout: stdout, stderr: stderr, cancelled: cancelled || !!(token && token.isCancellationRequested) });
            });
        });
    });
}

function runNodeQuiet(scriptName, args) {
    const root = workspaceRoot();
    const scriptPath = toolsPath(scriptName);
    if (!root || !scriptPath || !fs.existsSync(scriptPath)) {
        return Promise.resolve({ code: -1, stdout: '', stderr: '脚本不存在: ' + String(scriptPath) });
    }
    return new Promise(function (resolve) {
        let stdout = '';
        let stderr = '';
        let child;
        try { child = spawn('node', [scriptPath].concat(args || []), { cwd: root, windowsHide: true }); }
        catch (e) { return resolve({ code: -1, stdout: '', stderr: String(e) }); }
        child.stdout.on('data', function (d) { stdout += d.toString(); });
        child.stderr.on('data', function (d) { stderr += d.toString(); });
        child.on('error', function (e) { resolve({ code: -1, stdout: stdout, stderr: stderr + ' ' + String(e) }); });
        child.on('close', function (code) { resolve({ code: code, stdout: stdout, stderr: stderr }); });
    });
}

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function runPowerShell(scriptName, args, title, options) {
    options = options || {};
    const root = workspaceRoot();
    if (!root) return Promise.reject(new Error('请先打开算竞工作区文件夹'));
    const scriptPath = toolsPath(scriptName);
    if (!scriptPath || !fs.existsSync(scriptPath)) {
        return Promise.reject(new Error('脚本不存在: ' + String(scriptPath)));
    }
    const fullArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath].concat(args || []);
    if (output) {
        output.show(true);
        output.appendLine('> ' + scriptName + ' ' + (args || []).join(' '));
    }
    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: title || 'CF 训练工具',
        cancellable: options.cancellable !== false
    }, function (progress, token) {
        return new Promise(function (resolve) {
            let stdout = '';
            let stderr = '';
            let child;
            let cancelled = false;
            let killTimer = null;
            try {
                child = spawn('powershell.exe', fullArgs, { cwd: root, windowsHide: true });
            } catch (e) {
                return resolve({ code: -1, stdout: '', stderr: String(e), cancelled: false });
            }
            if (token && token.onCancellationRequested) {
                token.onCancellationRequested(function () {
                    cancelled = true;
                    if (progress) { try { progress.report({ message: '正在中断…' }); } catch (e) { /* ignore */ } }
                    killProcessTree(child.pid);
                    killTimer = setTimeout(function () { killProcessTree(child.pid); }, 1500);
                });
            }
            child.stdout.on('data', function (d) {
                const s = d.toString();
                stdout += s;
                if (output) output.append(s);
            });
            child.stderr.on('data', function (d) {
                const s = d.toString();
                stderr += s;
                if (output) output.append(s);
            });
            child.on('error', function (e) {
                resolve({ code: -1, stdout: stdout, stderr: stderr + ' ' + String(e), cancelled: cancelled });
            });
            child.on('close', function (code) {
                if (killTimer) clearTimeout(killTimer);
                resolve({ code: code, stdout: stdout, stderr: stderr, cancelled: cancelled || !!(token && token.isCancellationRequested) });
            });
        });
    });
}

function relFromRoot(fsPath) {
    const root = workspaceRoot();
    if (!root) return fsPath;
    return path.relative(root, fsPath);
}

function activeCppPath() {
    const ed = vscode.window.activeTextEditor;
    if (ed && ed.document) {
        const fsPath = ed.document.uri.fsPath;
        if (/\.(cpp|cc|cxx)$/i.test(fsPath)) {
            lastActiveCpp = fsPath;
            return fsPath;
        }
        return null;
    }
    return lastActiveCpp || null;
}

async function saveDocumentForPath(fsPath) {
    try {
        const docs = vscode.workspace.textDocuments || [];
        for (let i = 0; i < docs.length; i++) {
            const doc = docs[i];
            if (doc && doc.uri && doc.uri.fsPath === fsPath) {
                if (doc.isDirty && typeof doc.save === 'function') await doc.save();
                return;
            }
        }
    } catch (e) { /* ignore */ }
}

function siblingMarkdown(cppFsPath) {
    return cppFsPath.replace(/\.(cpp|cc|cxx)$/i, '.md');
}

function cfCookiePath() {
    return path.join(workspaceRoot(), 'training', 'cf-cookies.txt');
}

function hasCfCookie() {
    try {
        return !!String(fs.readFileSync(cfCookiePath(), 'utf8')).trim();
    } catch (e) {
        return false;
    }
}

function gymStatusHtml() {
    return hasCfCookie()
        ? '<span title="已保存 CF Cookie，可抓 Gym/私有比赛">Gym：<code>可用</code></span>'
        : '<span title="Gym/私有比赛需要 Codeforces 登录 Cookie">Gym：<span class="muted">需要 CF Cookie</span></span>';
}

function customTestsFile(cppPath) {
    return path.join(path.dirname(cppPath), path.basename(cppPath).replace(/\.(cpp|cc|cxx)$/i, '') + '.custom-tests.json');
}

function readCustomTests(cppPath) {
    try {
        const data = JSON.parse(fs.readFileSync(customTestsFile(cppPath), 'utf8'));
        if (Array.isArray(data.tests)) return { tests: data.tests };
        if (Array.isArray(data)) return { tests: data };
    } catch (e) { /* ignore */ }
    return { tests: [] };
}

function writeCustomTests(cppPath, tests) {
    const file = customTestsFile(cppPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ tests: tests }, null, 2) + '\n', 'utf8');
}

function sampleOverridesFile(cppPath) {
    return path.join(path.dirname(cppPath), path.basename(cppPath).replace(/\.(cpp|cc|cxx)$/i, '') + '.sample-overrides.json');
}

function readSampleOverrides(cppPath) {
    try {
        const data = JSON.parse(fs.readFileSync(sampleOverridesFile(cppPath), 'utf8'));
        if (data && data.overrides && typeof data.overrides === 'object') return { data: data.overrides };
        if (data && typeof data === 'object') return { data: data };
    } catch (e) { /* ignore */ }
    return { data: {} };
}

function writeSampleOverrides(cppPath, data) {
    const file = sampleOverridesFile(cppPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ overrides: data }, null, 2) + '\n', 'utf8');
}

// Snapshot the active editor buffer (so unsaved edits are included) into .build
// and return that temp path for the AI call.
function snapshotActiveCode(cppPath) {
    const ed = vscode.window.activeTextEditor;
    let text = '';
    try {
        if (ed && ed.document && typeof ed.document.getText === 'function') {
            text = ed.document.getText();
        }
    } catch (e) { /* ignore */ }
    if (!text) {
        try { text = fs.readFileSync(cppPath, 'utf8'); } catch (e) { text = ''; }
    }
    const dir = path.join(workspaceRoot(), '.build');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'ai-active-code.cpp');
    fs.writeFileSync(file, text, 'utf8');
    return file;
}

async function openPreview(fsPath) {
    if (!fs.existsSync(fsPath)) return false;
    await vscode.commands.executeCommand('markdown.showPreviewToSide', vscode.Uri.file(fsPath));
    return true;
}

function parseOkPaths(stdout) {
    const paths = [];
    String(stdout || '').split(/\r?\n/).forEach(function (line) {
        const m = /^OK\s+(.+)$/.exec(line.trim());
        if (m) paths.push(m[1].trim());
    });
    return paths;
}

function reportFailure(action, result) {
    if (result && result.cancelled) {
        vscode.window.showInformationMessage('已取消：' + action);
        return;
    }
    const msg = (result && result.stderr ? result.stderr : '').trim();
    vscode.window.showErrorMessage((action + '失败') + (msg ? ('：' + msg.split(/\r?\n/)[0]) : '，详见输出面板'));
    if (output) output.show(true);
}

/* ---------------- commands ---------------- */

async function previewStatement(mdPath) {
    if (!fs.existsSync(mdPath)) return false;
    try {
        await vscode.commands.executeCommand('markdown.showPreviewToSide', vscode.Uri.file(mdPath));
        lastPreviewed = { md: mdPath, ts: Date.now() };
        return true;
    } catch (e) {
        return false;
    }
}

async function layoutCppAndMd(cppPath) {
    if (layoutingCpp) return;
    layoutingCpp = cppPath;
    try {
        const conf = vscode.workspace.getConfiguration('cf-training-tools');
        if (conf.get('forceTwoColumnSplit') !== false) {
            try { await vscode.commands.executeCommand('workbench.action.editorLayoutTwoColumns'); } catch (e) { /* ignore */ }
        }
        if (fs.existsSync(cppPath)) {
            try {
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(cppPath));
                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
            } catch (e) { /* ignore */ }
        }
        await previewStatement(siblingMarkdown(cppPath));
        try { await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup'); } catch (e) { /* ignore */ }
    } finally {
        setTimeout(function () { layoutingCpp = null; }, 700);
    }
}

async function openProblemWithStatement(cppPath) {
    return layoutCppAndMd(cppPath);
}

async function pickPulledProblem(folder) {
    let problems = [];
    try {
        const data = JSON.parse(fs.readFileSync(path.join(folder, 'contest.json'), 'utf8'));
        problems = Array.isArray(data.problems) ? data.problems.slice() : [];
    } catch (e) {
        problems = [];
    }
    if (!problems.length) {
        try {
            problems = fs.readdirSync(folder).filter(function (f) { return /\.md$/i.test(f); }).map(function (f) {
                return { base: f.replace(/\.md$/i, ''), name: '' };
            });
        } catch (e) {
            problems = [];
        }
    }
    if (!problems.length) {
        return vscode.window.showWarningMessage('没有找到可打开的题目');
    }
    const pick = await vscode.window.showQuickPick(problems.map(function (p) {
        return { label: p.base, description: p.name || '', base: p.base };
    }), { placeHolder: '选择题目：打开 .cpp 并分屏题面 md' });
    if (!pick) return;
    await openProblemWithStatement(path.join(folder, pick.base + '.cpp'));
}

async function cmdPullContest() {
    const url = await vscode.window.showInputBox({
        prompt: '比赛链接（Codeforces / AtCoder / 洛谷 / 牛客），会抓题面 + 建 cpp + 样例缓存',
        placeHolder: 'https://codeforces.com/contest/2278 或 https://atcoder.jp/contests/abc402 或 https://www.luogu.com.cn/contest/251050 或 https://ac.nowcoder.com/acm/contest/85333',
        validateInput: function (s) { return /^https?:\/\//i.test(String(s || '').trim()) ? null : '请输入 http(s) 链接'; }
    });
    if (!url) return;
    if (/codeforces\.com\/gym\//i.test(url) && !hasCfCookie()) {
        const act = await vscode.window.showWarningMessage(
            '这是 Codeforces Gym 比赛，匿名 API 会被拒绝（You have to be authenticated）。需要先设置 CF 登录 Cookie。',
            '去登录', '继续尝试'
        );
        if (act === '去登录') {
            await cmdPlatformLogin('codeforces');
            return;
        }
    }
    const template = String(vscode.workspace.getConfiguration('cf-training-tools').get('pull.template') || 'new.cpp').trim();
    const pullArgs = [url.trim()];
    if (template) pullArgs.push('--template=' + template);
    const result = await runNode('pull-contest.js', pullArgs, '抓取整场比赛中…', { cancellable: true });
    const stdout = String(result.stdout || '');
    const stderr = String(result.stderr || '');
    const folderMatch = /FOLDER\s+(.+)/.exec(stdout);
    const doneMatch = /DONE created=(\d+) skipped=(\d+) failed=(\d+)/.exec(stdout);
    if (!doneMatch) {
        const first = (stderr || stdout).trim().split(/\r?\n/)[0] || '看输出面板';
        return vscode.window.showErrorMessage('抓取比赛失败：' + first);
    }
    const created = doneMatch[1];
    const skipped = doneMatch[2];
    const failed = doneMatch[3];
    const folder = folderMatch ? folderMatch[1].trim() : '';
    const msg = '抓取完成：新增 ' + created + ' 题，跳过 ' + skipped + ' 题' + (failed !== '0' ? ('，失败 ' + failed + ' 题') : '');
    const buttons = [];
    if (folder) { buttons.push('选择题目打开'); buttons.push('打开文件夹'); }
    const pick = await vscode.window.showInformationMessage(msg, ...buttons);
    if (pick === '选择题目打开' && folder) {
        return pickPulledProblem(folder);
    }
    if (pick === '打开文件夹' && folder) {
        try {
            await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(folder));
        } catch (e) {
            try { await vscode.env.openExternal(vscode.Uri.file(folder)); } catch (e2) { /* ignore */ }
        }
    }
}

async function cmdPullProblem() {
    const url = await vscode.window.showInputBox({
        prompt: '单个题目链接（Codeforces / AtCoder / 洛谷 / 牛客）',
        placeHolder: 'https://codeforces.com/contest/2278/problem/A 或 https://atcoder.jp/contests/abc402/tasks/abc402_a 或 https://www.luogu.com.cn/problem/P1000 或 https://ac.nowcoder.com/acm/problem/21302',
        validateInput: function (s) { return /^https?:\/\//i.test(String(s || '').trim()) ? null : '请输入 http(s) 链接'; }
    });
    if (!url) return;
    const template = String(vscode.workspace.getConfiguration('cf-training-tools').get('pull.template') || 'new.cpp').trim();
    const args = [url.trim(), '--single'];
    if (template) args.push('--template=' + template);
    const result = await runNode('pull-contest.js', args, '抓取题目中…', { cancellable: true });
    if (result.cancelled) {
        vscode.window.showInformationMessage('已取消抓取（已生成的文件保留）。');
        return;
    }
    const stdout = String(result.stdout || '');
    const hit = /SINGLE\s+([^|]+)\|([^|]+)\|(.+)/.exec(stdout);
    if (result.code !== 0 || !hit) {
        const first = (String(result.stderr || '') || stdout).trim().split(/\r?\n/)[0] || '看输出面板';
        return vscode.window.showErrorMessage('抓取题目失败：' + first);
    }
    const base = hit[1].trim();
    const cpp = hit[2].trim();
    await layoutCppAndMd(cpp);
    vscode.window.showInformationMessage('已拉取 ' + base + '，已打开 cpp + 题面 md');
}

async function cmdCfLogin() {
    const action = await vscode.window.showInformationMessage(
        'Gym/私有比赛需要 Codeforces 登录 Cookie：先在浏览器登录，再复制 Cookie 请求头。',
        '打开登录页', '粘贴 Cookie'
    );
    if (action === '打开登录页') {
        try { await vscode.env.openExternal(vscode.Uri.parse('https://codeforces.com/enter')); } catch (e) { /* ignore */ }
        return;
    }
    if (action !== '粘贴 Cookie') return;
    const cookie = await vscode.window.showInputBox({
        prompt: '粘贴 codeforces.com 的 Cookie 请求头（F12 → Network → 任意请求 → Request Headers → Cookie，整行复制）',
        password: true,
        ignoreFocusOut: true,
        validateInput: function (s) { return String(s || '').trim() ? null : '不能为空'; }
    });
    if (!cookie) return;
    try {
        const file = cfCookiePath();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, String(cookie).trim() + '\n', 'utf8');
    } catch (e) {
        return vscode.window.showErrorMessage('保存 Codeforces Cookie 失败：' + e.message);
    }
    const result = await runNode('cf-login-check.js', [], '检查 Codeforces 登录…');
    const out = String(result.stdout || '').trim();
    if (result.code === 0 && /OK handle=/.test(out)) {
        vscode.window.showInformationMessage('Codeforces 登录成功：' + out.split(/\r?\n/)[0].replace(/^OK handle=/, ''));
    } else {
        const first = (String(result.stderr || result.stdout || '').trim().split(/\r?\n/)[0]) || '看输出面板';
        vscode.window.showWarningMessage('Cookie 已保存，但验证失败：' + first);
    }
}

async function cmdCfLoginCheck() {
    const result = await runNode('cf-login-check.js', [], '检查 Codeforces 登录…');
    const out = String(result.stdout || '').trim();
    if (result.code === 0) {
        vscode.window.showInformationMessage('Codeforces 已登录：' + out.replace(/^OK handle=/, ''));
    } else {
        const first = (String(result.stderr || '').trim().split(/\r?\n/)[0]) || '未登录';
        vscode.window.showWarningMessage(first + '（面板「设置 CF 登录 Cookie」）');
    }
}

async function cmdCfLogout() {
    try { fs.unlinkSync(cfCookiePath()); } catch (e) { /* ignore */ }
    vscode.window.showInformationMessage('已清除 Codeforces 登录 Cookie');
}

async function cmdPlatformLogin(platform) {
    const info = PLATFORM_LOGIN[platform];
    if (!info) return;
    const extra = platform === 'codeforces'
        ? '（公开比赛/公开数据不需要登录；Gym/私有比赛需要 Cookie）'
        : '（仅私有/个人数据需要登录；公开题面不需要）';
    const action = await vscode.window.showInformationMessage(
        info.label + ' 登录：先在浏览器登录，然后复制该网站的 Cookie 请求头。' + extra,
        '打开登录页', '粘贴 Cookie'
    );
    if (action === '打开登录页') {
        try { await vscode.env.openExternal(vscode.Uri.parse(info.loginUrl)); } catch (e) { /* ignore */ }
        return;
    }
    if (action !== '粘贴 Cookie') return;
    const cookie = await vscode.window.showInputBox({
        prompt: '粘贴 ' + info.host + ' 的 Cookie 请求头（F12 → Network → 任意请求 → Request Headers → Cookie，整行复制）',
        password: true,
        ignoreFocusOut: true,
        validateInput: function (s) { return String(s || '').trim() ? null : '不能为空'; }
    });
    if (!cookie) return;
    const file = platformCookiePath(platform);
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, String(cookie).trim() + '\n', 'utf8');
    } catch (e) {
        return vscode.window.showErrorMessage('保存 ' + info.label + ' Cookie 失败：' + e.message);
    }
    const result = await runNode('account-login.js', [platform], '检查 ' + info.label + ' 登录…');
    const data = parseLastJson(String(result.stdout || ''));
    if (!data || !data.ok) {
        const detail = data && data.detail ? data.detail : (String(result.stderr || '').trim().split(/\r?\n/)[0] || 'Cookie 无效');
        return vscode.window.showWarningMessage(info.label + ' 登录校验失败：' + detail + '（Cookie 已保存，可稍后重试）');
    }
    let nickname = String(data.nickname || '').trim();
    if (!nickname) {
        const manual = await vscode.window.showInputBox({
            prompt: info.label + ' 未自动读取到昵称，可手动填写（留空则显示“已登录”）',
            ignoreFocusOut: true
        });
        nickname = manual ? manual.trim() : '';
    }
    writeAccount(platform, nickname || '已登录');
    if (platform === 'codeforces' && data.nickname) {
        try {
            const handleFile = path.join(workspaceRoot(), 'training', 'cf-handle.txt');
            fs.mkdirSync(path.dirname(handleFile), { recursive: true });
            fs.writeFileSync(handleFile, String(data.nickname).trim() + '\n', 'utf8');
        } catch (e) { /* ignore */ }
    }
    if (sidebarProvider) sidebarProvider.refresh();
    vscode.window.showInformationMessage(info.label + ' 登录成功：' + (nickname || '已登录'));
}

async function cmdAccountStatus() {
    const platforms = Object.keys(PLATFORM_LOGIN);
    const items = platforms.map(function (p) {
        const acc = readAccounts()[p];
        const nickname = acc && acc.nickname ? acc.nickname : '';
        return { label: PLATFORM_LOGIN[p].label, description: nickname || '未登录', platform: p };
    });
    items.push({ label: '检查全部平台', description: '依次校验已保存的 Cookie', platform: 'all' });
    const picked = await vscode.window.showQuickPick(items, { placeHolder: '选择要检查的账号' });
    if (!picked) return;
    const targets = picked.platform === 'all' ? platforms : [picked.platform];
    const results = [];
    for (let i = 0; i < targets.length; i++) {
        const p = targets[i];
        const file = platformCookiePath(p);
        let hasCookie = false;
        try { hasCookie = !!String(fs.readFileSync(file, 'utf8')).trim(); } catch (e) { hasCookie = false; }
        if (!hasCookie) {
            results.push(PLATFORM_LOGIN[p].label + '：未登录');
            continue;
        }
        const res = await runNodeQuiet('account-login.js', [p]);
        const data = parseLastJson(String(res.stdout || ''));
        if (data && data.ok) {
            writeAccount(p, data.nickname || '已登录');
            results.push(PLATFORM_LOGIN[p].label + '：' + (data.nickname || '已登录'));
        } else {
            results.push(PLATFORM_LOGIN[p].label + '：' + (data && data.detail ? data.detail : '登录失效'));
        }
    }
    if (sidebarProvider) sidebarProvider.refresh();
    vscode.window.showInformationMessage(results.join('　|　'));
}

async function cmdSubmit(cppArg) {
    const cpp = cppArg || activeCppPath();
    if (!cpp) return vscode.window.showWarningMessage('请先打开一道题的 .cpp 文件');
    await saveDocumentForPath(cpp);
    const confirm = await vscode.window.showWarningMessage(
        '提交 ' + path.basename(cpp) + ' 到对应 OJ？提交后会在评测机上产生一次记录。',
        { modal: true }, '提交'
    );
    if (confirm !== '提交') return;
    const res = await runNode('submit.js', [cpp], '提交代码到 OJ…', { cancellable: true });
    if (output) output.appendLine('[submit] code=' + res.code + ' err=' + String(res.stderr || '').slice(0, 200));
    const data = parseLastJson(String(res.stdout || ''));
    if (!data) return vscode.window.showErrorMessage('提交失败：没有返回结果（见输出面板）');
    if (!data.ok) {
        if (data.needLogin) {
            const loginCmd = {
                codeforces: 'cfTraining.loginCodeforces',
                luogu: 'cfTraining.loginLuogu',
                atcoder: 'cfTraining.loginAtcoder',
                nowcoder: 'cfTraining.loginNowcoder'
            }[data.platform];
            const pick = await vscode.window.showWarningMessage(data.message || '需要先登录对应平台', '去登录');
            if (pick === '去登录' && loginCmd) await vscode.commands.executeCommand(loginCmd);
        } else {
            vscode.window.showErrorMessage('提交失败：' + (data.message || '未知错误'));
        }
        return;
    }
    const pick = await vscode.window.showInformationMessage(data.message || ('已提交 ' + path.basename(cpp)), data.submissionUrl ? '打开提交记录' : '确定');
    if (pick === '打开提交记录' && data.submissionUrl) {
        try { await vscode.env.openExternal(vscode.Uri.parse(data.submissionUrl)); } catch (e) { /* ignore */ }
    }
}

async function cmdClearCookie() {
    const platforms = Object.keys(PLATFORM_LOGIN);
    const items = platforms.map(function (p) {
        const file = platformCookiePath(p);
        let exists = false;
        try { exists = fs.existsSync(file); } catch (e) { exists = false; }
        return { label: PLATFORM_LOGIN[p].label, description: exists ? '已保存 Cookie（点击清除）' : '未保存', platform: p };
    });
    items.push({ label: '全部平台', description: '清除所有 OJ Cookie', platform: 'all' });
    const picked = await vscode.window.showQuickPick(items, { placeHolder: '选择要清除 Cookie 的平台' });
    if (!picked) return;
    const targets = picked.platform === 'all' ? platforms : [picked.platform];
    const cleared = [];
    targets.forEach(function (p) {
        try {
            const file = platformCookiePath(p);
            if (fs.existsSync(file)) { fs.unlinkSync(file); cleared.push(PLATFORM_LOGIN[p].label); }
        } catch (e) { /* ignore */ }
    });
    const accountsFile = accountDataPath();
    try {
        const data = readAccounts();
        targets.forEach(function (p) { delete data[p]; });
        fs.mkdirSync(path.dirname(accountsFile), { recursive: true });
        fs.writeFileSync(accountsFile, JSON.stringify(data, null, 2) + '\n', 'utf8');
    } catch (e) { /* ignore */ }
    if (sidebarProvider) sidebarProvider.refresh();
    vscode.window.showInformationMessage(cleared.length ? ('已清除：' + cleared.join('、') + ' Cookie') : '所选平台没有保存 Cookie');
}

async function cmdOpenCookieFolder() {
    const dir = path.join(workspaceRoot(), 'training');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
    try {
        await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(dir));
    } catch (e) {
        try { await vscode.env.openExternal(vscode.Uri.file(dir)); } catch (e2) { /* ignore */ }
    }
}

async function cmdPullTemplate() {
    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: '用作初始模板',
        filters: { 'C++ 文件': ['cpp', 'cc', 'cxx'] }
    });
    if (!picked || !picked.length) return;
    const file = picked[0].fsPath;
    try {
        const conf = vscode.workspace.getConfiguration('cf-training-tools');
        await conf.update('pull.template', file, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('拉题初始模板已设置：' + file + '（之后「抓取整场比赛」会用它生成 .cpp）');
    } catch (e) {
        vscode.window.showErrorMessage('设置模板失败：' + e.message);
    }
}

async function cmdPlan() {
    const result = await runPowerShell('cf-plan.ps1', [], '分析弱项并生成周题单（CF + AtCoder + 洛谷）…');
    if (result.code !== 0) return reportFailure('生成题单', result);
    if (sidebarProvider) sidebarProvider.refresh();
    const plan = path.join(workspaceRoot(), 'training', 'plan.md');
    if (await openPreview(plan)) {
        vscode.window.showInformationMessage('周题单已更新：training/plan.md');
    } else {
        vscode.window.showInformationMessage('题单已生成，但没有找到 training/plan.md');
    }
}

async function cmdOpenPlan() {
    const plan = path.join(workspaceRoot(), 'training', 'plan.md');
    if (!(await openPreview(plan))) vscode.window.showWarningMessage('还没有题单，先点「生成/刷新周题单」');
}

async function cmdOpenRedo() {
    const redo = path.join(workspaceRoot(), 'training', 'redo.md');
    if (!(await openPreview(redo))) vscode.window.showWarningMessage('还没有重做队列，先点「生成/刷新周题单」');
}

async function cmdReview(contestId) {
    const args = [];
    if (contestId) args.push('-ContestId', String(contestId));
    const result = await runPowerShell('cf-review.ps1', args, '拉取提交记录并生成复盘…');
    if (result.code !== 0) return reportFailure('生成复盘', result);
    const okPaths = parseOkPaths(result.stdout).filter(function (p) { return /review\.md$/i.test(p); });
    let opened = false;
    for (let i = okPaths.length - 1; i >= 0 && !opened; i--) {
        opened = await openPreview(path.join(workspaceRoot(), okPaths[i].replace(/\//g, path.sep)));
    }
    if (!opened) vscode.window.showInformationMessage('复盘数据已生成（详见输出面板）');
}

async function cmdReviewLatest() {
    return cmdReview(0);
}

async function cmdReviewInput() {
    const value = await vscode.window.showInputBox({
        prompt: '输入 Codeforces contestId（如 2278；gym 是 6 位数字）',
        value: '',
        validateInput: function (s) { return /^\d+$/.test(s) ? null : '必须是数字'; }
    });
    if (!value) return;
    return cmdReview(parseInt(value, 10));
}

async function cmdStatementOpen() {
    const cpp = activeCppPath();
    if (!cpp) return vscode.window.showWarningMessage('请先打开一道题的 .cpp 文件');
    const md = siblingMarkdown(cpp);
    if (!fs.existsSync(md)) {
        const pick = await vscode.window.showInformationMessage('这道题还没有题面 md', '现在抓取');
        if (pick === '现在抓取') return cmdStatementNow();
        return;
    }
    await layoutCppAndMd(cpp);
}

async function cmdStatementNow() {
    const cpp = activeCppPath();
    if (!cpp) return vscode.window.showWarningMessage('请先打开一道题的 .cpp 文件');
    const result = await runPowerShell('cph-statements.ps1', ['-Solution', relFromRoot(cpp), '-Force'], '抓取题面并翻译…');
    const md = siblingMarkdown(cpp);
    if (await openPreview(md)) return;
    reportFailure('抓取题面', result);
}


async function cmdSampleTests() {
    try { await vscode.commands.executeCommand('workbench.view.extension.cfTrainingSidebar'); } catch (e) { /* ignore */ }
    if (samplesProvider) await samplesProvider.refresh();
}

async function cmdSamples() {
    const cpp = activeCppPath();
    if (!cpp) return vscode.window.showWarningMessage('请先打开一道题的 .cpp 文件');
    const result = await runPowerShell('cp.ps1', ['samples', '-Solution', relFromRoot(cpp)], '编译并跑样例…');
    if (result.cancelled) return vscode.window.showInformationMessage('已取消：跑样例');
    if (result.code === 0) vscode.window.showInformationMessage('样例全部通过');
    else if (result.code === 2) vscode.window.showWarningMessage('没有样例缓存（先拉一次题）');
    else vscode.window.showErrorMessage('样例失败，详见输出面板');
}

async function cmdBuild() {
    const cpp = activeCppPath();
    if (!cpp) return vscode.window.showWarningMessage('请先打开一道题的 .cpp 文件');
    const result = await runPowerShell('cp.ps1', ['build', '-Solution', relFromRoot(cpp)], '编译…');
    if (result.code === 0) vscode.window.showInformationMessage('编译通过');
    else reportFailure('编译', result);
}

async function cmdSetHandle() {
    const file = path.join(workspaceRoot(), 'training', 'cf-handle.txt');
    let current = '';
    if (fs.existsSync(file)) current = fs.readFileSync(file, 'utf8').trim();
    const value = await vscode.window.showInputBox({
        prompt: 'Codeforces handle（个人主页地址最后一段）',
        value: current,
        validateInput: function (s) { return s.trim().length > 0 ? null : '不能为空'; }
    });
    if (!value) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value.trim() + '\n', 'utf8');
    vscode.window.showInformationMessage('已保存 handle：' + value.trim());
    if (sidebarProvider) sidebarProvider.refresh();
}


async function cmdOpenDoc() {
    const file = path.join(workspaceRoot(), 'training', 'README.md');
    if (!(await openPreview(file))) {
        vscode.window.showWarningMessage('没找到 training/README.md');
    }
}

async function cmdAiConfig() {
    const file = path.join(workspaceRoot(), 'training', 'ai-config.json');
    const cfg = readAiConfig();
    const settings = getAiSettings();
    const currentBase = String(settings.baseUrl || cfg.baseUrl || 'https://api.deepseek.com');
    const currentModel = String(settings.model || cfg.model || 'deepseek-flash');
    const baseUrl = await vscode.window.showInputBox({
        prompt: 'AI API baseUrl（OpenAI 兼容，例如 https://api.deepseek.com）',
        value: currentBase,
        validateInput: function (s) { return s.trim() ? null : '不能为空'; }
    });
    if (!baseUrl) return;
    const modelPick = await vscode.window.showQuickPick([
        { label: 'deepseek-flash', description: 'DeepSeek 默认，快' },
        { label: 'deepseek-v4-pro', description: 'DeepSeek 更强模型' },
        { label: '（自定义模型名…）', description: '其他 OpenAI 兼容服务' }
    ], { placeHolder: '选择模型（当前：' + currentModel + '）' });
    if (!modelPick) return;
    let model = modelPick.label;
    if (model === '（自定义模型名…）') {
        model = await vscode.window.showInputBox({
            prompt: '模型名（填服务端支持的模型）',
            value: currentModel,
            validateInput: function (s) { return s.trim() ? null : '不能为空'; }
        });
        if (!model) return;
    }
    const apiKey = await vscode.window.showInputBox({
        prompt: 'API Key（保存在 VS Code 设置 + 本地 training/ai-config.json；已配置时留空表示不修改）',
        password: true,
        value: ''
    });
    const next = Object.assign({}, cfg, {
        baseUrl: baseUrl.trim(),
        model: String(model).trim(),
        temperature: (typeof cfg.temperature === 'number' ? cfg.temperature : 0.3),
        timeoutMs: cfg.timeoutMs || 180000
    });
    if (apiKey && apiKey.trim()) next.apiKey = apiKey.trim();
    writeAiConfigFile(next);
    try {
        const conf = vscode.workspace.getConfiguration('cf-training-tools');
        await conf.update('ai.baseUrl', next.baseUrl, vscode.ConfigurationTarget.Global);
        await conf.update('ai.model', next.model, vscode.ConfigurationTarget.Global);
        if (next.apiKey) await conf.update('ai.apiKey', next.apiKey, vscode.ConfigurationTarget.Global);
    } catch (e) { /* settings update is best-effort */ }
    updateAiStatusBar();
    if (sidebarProvider) sidebarProvider.refresh();
    const pick = await vscode.window.showInformationMessage('AI API 已保存：' + next.model + ' @ ' + next.baseUrl, '测试连接');
    if (pick === '测试连接') return cmdAiTest();
}

async function cmdAiOpenSettings() {
    try {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'cf-training-tools.ai');
    } catch (e) {
        return cmdAiConfig();
    }
}

async function cmdAiTest() {
    let result;
    try {
        result = await runNode('ai-client.js', ['ping'], '测试 AI 连接…');
    } catch (e) {
        return vscode.window.showErrorMessage('AI 测试失败：' + e.message);
    }
    if (result.code === 0) {
        const line = String(result.stdout || '').trim().split(/\r?\n/)[0] || 'AI 连接正常';
        vscode.window.showInformationMessage(line);
    } else {
        const msg = String(result.stderr || result.stdout || '').trim().split(/\r?\n/)[0] || '看输出面板';
        vscode.window.showErrorMessage('AI 连接失败：' + msg);
    }
}

async function writeAiResult(name, text) {
    const dir = path.join(workspaceRoot(), '.build');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, text, 'utf8');
    await openPreview(file);
}

async function cmdAiHint() {
    const cpp = activeCppPath();
    if (!cpp) return vscode.window.showWarningMessage('请先打开一道题的 .cpp 文件');
    const md = siblingMarkdown(cpp);
    if (!fs.existsSync(md)) return vscode.window.showWarningMessage('这道题还没有题面 md，先拉一次题或点「重新抓取当前题面」');
    const levelPick = await vscode.window.showQuickPick([
        { label: '1 · 只给方向（关键观察）', level: 1 },
        { label: '2 · 给具体思路（算法/状态/复杂度）', level: 2 },
        { label: '3 · 给伪代码 + 易错点', level: 3 }
    ], { placeHolder: '提示级别（会先读你当前代码做体检，再给提示）' });
    if (!levelPick) return;
    const codeSnap = snapshotActiveCode(cpp);
    const result = await runNode('ai-client.js', [
        'hint', '--md', md, '--cpp', codeSnap, '--cpp-label', relFromRoot(cpp), '--level', String(levelPick.level)
    ], 'AI 正在阅读你的代码并想提示…');
    if (result.code !== 0) return reportFailure('AI 提示', result);
    await writeAiResult('ai-hint.md', String(result.stdout || ''));
}

async function cmdAiAsk() {
    const cpp = activeCppPath();
    if (!cpp) return vscode.window.showWarningMessage('请先打开一道题的 .cpp 文件');
    const md = siblingMarkdown(cpp);
    const question = await vscode.window.showInputBox({
        prompt: '问 AI 关于这道题的问题（会带上你当前编辑器里的代码，包括未保存内容）'
    });
    if (!question) return;
    const codeSnap = snapshotActiveCode(cpp);
    const args = ['ask', '--question', question, '--cpp', codeSnap, '--cpp-label', relFromRoot(cpp)];
    if (fs.existsSync(md)) args.push('--md', md);
    const result = await runNode('ai-client.js', args, 'AI 思考中…');
    if (result.code !== 0) return reportFailure('AI 回答', result);
    await writeAiResult('ai-answer.md', String(result.stdout || ''));
}

async function cmdAiReview() {
    const root = workspaceRoot();
    const cfDir = path.join(root, 'codeforces');
    let dirs = [];
    try { dirs = fs.readdirSync(cfDir).filter(function (f) { return fs.statSync(path.join(cfDir, f)).isDirectory(); }); } catch (e) { dirs = []; }
    if (!dirs.length) return vscode.window.showWarningMessage('codeforces 下还没有比赛目录');
    const pick = await vscode.window.showQuickPick(dirs.map(function (d) {
        return { label: d, description: path.join(cfDir, d) };
    }), { placeHolder: '选择要 AI 复盘的比赛' });
    if (!pick) return;
    const dir = path.join(cfDir, pick.label);
    let contestId = 0;
    try {
        const cph = path.join(dir, '.cph');
        if (fs.existsSync(cph)) {
            const files = fs.readdirSync(cph);
            for (let i = 0; i < files.length; i++) {
                try {
                    const j = JSON.parse(fs.readFileSync(path.join(cph, files[i]), 'utf8'));
                    const m = /(?:contest|gym)\/(\d+)/.exec(String(j.url || ''));
                    if (m) { contestId = parseInt(m[1], 10); break; }
                } catch (e) { /* ignore */ }
            }
        }
        if (!contestId) {
            const files = fs.readdirSync(dir);
            for (let i = 0; i < files.length; i++) {
                const m = /^(\d+)[A-Za-z]/.exec(files[i]);
                if (m) { contestId = parseInt(m[1], 10); break; }
            }
        }
    } catch (e) { /* ignore */ }
    if (contestId) {
        try { await runPowerShell('cf-review.ps1', ['-ContestId', String(contestId)], '刷新复盘数据…'); } catch (e) { /* ignore */ }
    }
    const out = path.join(dir, 'review.ai.md');
    const result = await runNode('ai-client.js', ['review', dir, '--out', out], 'AI 正在复盘…');
    if (result.code !== 0) return reportFailure('AI 复盘', result);
    if (await openPreview(out)) vscode.window.showInformationMessage('AI 复盘已生成：review.ai.md');
}

async function cmdAiTranslate() {
    const cpp = activeCppPath();
    if (!cpp) return vscode.window.showWarningMessage('请先打开一道题的 .cpp 文件');
    if (!aiConfigured()) {
        const pick = await vscode.window.showWarningMessage('还没配置 AI API，会用 Bing 翻译；要配置 AI 吗？', '设置 AI API', '继续用 Bing');
        if (pick === '设置 AI API') return cmdAiConfig();
        if (pick !== '继续用 Bing') return;
    }
    const result = await runPowerShell('cph-statements.ps1', ['-Solution', relFromRoot(cpp), '-Force'], 'AI 翻译题面中…');
    const md = siblingMarkdown(cpp);
    if (await openPreview(md)) return;
    reportFailure('AI 翻译题面', result);
}

async function cmdMenu() {
    const items = [
        { label: '$(lightbulb) AI 提示（当前题）', description: '教练模式，分级提示', command: 'cfTraining.aiHint' },
        { label: '$(comment-discussion) 问 AI（当前题）', command: 'cfTraining.aiAsk' },
        { label: '$(brain) AI 复盘（选比赛）', command: 'cfTraining.aiReview' },
        { label: '$(globe) AI 翻译当前题面', command: 'cfTraining.aiTranslate' },
        { label: '$(settings-gear) 设置 AI API', command: 'cfTraining.aiConfig' },
        { label: '$(tools) 在 VS Code 设置中编辑 AI', command: 'cfTraining.aiSettings' },
        { label: '$(plug) 测试 AI 连接', command: 'cfTraining.aiTest' },
        { label: '$(calendar) 生成/刷新周题单（CF+AtCoder+洛谷）', description: 'training/plan.md', command: 'cfTraining.plan' },
        { label: '$(cloud-download) 抓取整场比赛（Codeforces/洛谷/牛客/AtCoder）', description: '题面 + cpp + 样例缓存', command: 'cfTraining.pullContest' },
        { label: '$(cloud-download) 抓取单个题目', description: '粘贴题目链接，自动建 md/cpp/缓存', command: 'cfTraining.pullProblem' },
        { label: '$(file) 设置拉题初始模板', description: '生成新 .cpp 用的模板文件', command: 'cfTraining.pullTemplate' },
        { label: '$(book) 打开完整周题单', command: 'cfTraining.openPlan' },
        { label: '$(checklist) 打开重做队列', command: 'cfTraining.openRedo' },
        { label: '$(history) 复盘最近一场', description: '生成 review.md 并打开', command: 'cfTraining.reviewLatest' },
        { label: '$(search) 复盘指定比赛', description: '输入 contestId', command: 'cfTraining.reviewInput' },
        { label: '$(book) 打开当前题面预览', command: 'cfTraining.statementOpen' },
        { label: '$(refresh) 重新抓取当前题面', command: 'cfTraining.statementNow' },
        { label: '$(beaker) 样例自测（计分面板）', command: 'cfTraining.sampleTests' },
        { label: '$(run-all) 编译并跑样例', command: 'cfTraining.samples' },
        { label: '$(tools) 只编译', command: 'cfTraining.build' },
        { label: '$(account) 设置 CF 登录 Cookie（Gym/私有比赛）', command: 'cfTraining.cfLogin' },
        { label: '$(search) 检查 CF 登录状态', command: 'cfTraining.cfLoginCheck' },
        { label: '$(trash) 清除 CF 登录 Cookie', command: 'cfTraining.cfLogout' },
        { label: '$(person) 设置 CF handle', command: 'cfTraining.setHandle' },
        { label: '$(question) 打开训练手册', command: 'cfTraining.openDoc' }
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: '选择操作' });
    if (pick && pick.command) {
        await vscode.commands.executeCommand(pick.command);
    }
}

/* ---------------- activity bar webview ---------------- */

function platformBadge(p) {
    if (p === 'Codeforces') return 'CF';
    if (p === 'AtCoder') return 'AT';
    return 'LG';
}

function planSectionHtml() {
    const plan = readPlan();
    if (!plan) {
        return '<div class="card">\n' +
            '<div class="card-head"><span class="card-icon">📅</span><div><div class="card-title">当前题单</div><div class="card-sub">按弱项 tag + 难度从 CF / AtCoder / 洛谷选题</div></div></div>\n' +
            '<div class="empty">还没有生成周题单。</div>\n' +
            '<div class="grid"><button class="btn primary wide" data-cmd="cfTraining.plan"><span class="ico">✨</span><span class="lbl">生成 / 刷新周题单</span></button></div>\n' +
            '</div>\n';
    }
    const problems = plan.problems || [];
    let html = '<div class="card">\n';
    html += '<div class="card-head"><span class="card-icon">📅</span><div><div class="card-title">当前题单</div><div class="card-sub">按弱项与难度生成</div></div><span class="count">' + escapeHtml(problems.length) + ' 题</span></div>\n';
    const meta = [];
    if (plan.rating) meta.push('rating ' + escapeHtml(plan.rating));
    if (plan.weakTags && plan.weakTags.length) meta.push('弱项 ' + escapeHtml(plan.weakTags.join(' / ')));
    if (plan.generated) meta.push(escapeHtml(plan.generated));
    if (meta.length) html += '<div class="plan-meta">' + meta.join(' · ') + '</div>\n';
    html += '<div class="problem-list">\n';
    problems.forEach(function (p) {
        const diffText = p.platform === 'Luogu' ? ('难度' + p.rating) : p.rating;
        html += '<button class="problem" data-url="' + escapeHtml(p.url) + '">' +
            '<span class="badge">' + escapeHtml(platformBadge(p.platform)) + '</span>' +
            '<span class="ptitle">' + escapeHtml(p.title) + '</span>' +
            '<span class="pdiff">' + escapeHtml(diffText) + '</span></button>\n';
    });
    html += '</div>\n';
    html += '<div class="grid">' +
        '<button class="btn small" data-cmd="cfTraining.plan"><span class="ico">🔄</span><span class="lbl">刷新题单</span></button>' +
        '<button class="btn small" data-cmd="cfTraining.openPlan"><span class="ico">📄</span><span class="lbl">完整题单</span></button>' +
        '</div>\n';
    const redoCount = plan.redoCount || 0;
    html += '<div class="divider"></div>\n';
    html += '<div class="mini-head"><span class="card-icon">🔁</span><span class="card-title">重做队列</span><span class="count">' + escapeHtml(redoCount) + ' 题</span></div>\n';
    html += '<button class="btn" data-cmd="cfTraining.openRedo"><span class="ico">📋</span><span class="lbl">打开重做队列</span></button>\n';
    html += '</div>\n';
    return html;
}
function sidebarHtml() {
    const handle = readHandle();
    const nonceSrc = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 24; i++) nonce += nonceSrc.charAt(Math.floor(Math.random() * nonceSrc.length));
    const aiCfg = readAiConfig();
    const aiOn = aiConfigured();
    const envModel = (process.env.AI_API_KEY && process.env.AI_BASE_URL) ? String(process.env.AI_MODEL || '') : '';
    const aiModel = envModel || String(aiCfg.model || 'AI');
    const aiText = aiOn ? ('已配置 · ' + aiModel) : '未配置';

    const groups = [
        {
            title: '快速开始', icon: '⚡', sub: '拉题 · 题面', open: true,
            items: [
                { cmd: 'cfTraining.pullContest', label: '抓取整场比赛', icon: '📥', primary: true },
                { cmd: 'cfTraining.pullProblem', label: '抓取单个题目', icon: '📄' },
                { cmd: 'cfTraining.statementOpen', label: '打开当前题面', icon: '📖' },
                { cmd: 'cfTraining.statementNow', label: '重新抓取题面', icon: '🔄' }
            ]
        },

        {
            title: '训练计划', icon: '📅', sub: '赛后复盘', open: true,
            items: [
                { cmd: 'cfTraining.reviewLatest', label: '复盘最近一场', icon: '🧾', primary: true },
                { cmd: 'cfTraining.reviewInput', label: '复盘指定比赛', icon: '🔍' }
            ]
        },
        {
            title: 'AI 助手', icon: '🤖', sub: aiText, open: false,
            items: [
                { cmd: 'cfTraining.aiHint', label: 'AI 提示', icon: '💡', primary: true },
                { cmd: 'cfTraining.aiAsk', label: '问 AI', icon: '❓' },
                { cmd: 'cfTraining.aiReview', label: 'AI 复盘', icon: '🧠' },
                { cmd: 'cfTraining.aiTranslate', label: '翻译题面', icon: '🌐' },
                { cmd: 'cfTraining.aiConfig', label: '设置 AI API', icon: '⚙️' },
                { cmd: 'cfTraining.aiTest', label: '测试 AI 连接', icon: '🔌' }
            ]
        },
        {
            title: '账号', icon: '👤', sub: '登录 · Cookie · handle', open: false,
            items: [
                { cmd: 'cfTraining.loginCodeforces', label: '登录 Codeforces', icon: '🟥' },
                { cmd: 'cfTraining.loginLuogu', label: '登录 洛谷', icon: '🟦' },
                { cmd: 'cfTraining.loginNowcoder', label: '登录 牛客', icon: '🟨' },
                { cmd: 'cfTraining.loginAtcoder', label: '登录 AtCoder', icon: '🟪' },
                { cmd: 'cfTraining.accountStatus', label: '检查账号状态', icon: '🔎' },
                { cmd: 'cfTraining.clearCookie', label: '清除平台 Cookie', icon: '🚪' },
                { cmd: 'cfTraining.openCookieFolder', label: '打开 Cookie 目录', icon: '📁' },
                { cmd: 'cfTraining.setHandle', label: '设置 CF handle', icon: '👤' }
            ]
        },
        {
            title: '设置', icon: '⚙️', sub: '模板 · AI 设置 · 帮助', open: false,
            items: [
                { cmd: 'cfTraining.pullTemplate', label: '拉题初始模板', icon: '🧩' },
                { cmd: 'cfTraining.aiSettings', label: 'AI 设置页', icon: '🧰' },
                { cmd: 'cfTraining.openDoc', label: '训练手册', icon: '❓' }
            ]
        }
    ];
    let body = '';
    groups.forEach(function (g) {
        body += '<details class="card group"' + (g.open ? ' open' : '') + '>' +
            '<summary><span class="card-icon">' + escapeHtml(g.icon) + '</span>' +
            '<span class="card-title">' + escapeHtml(g.title) + '</span>' +
            (g.sub ? '<span class="card-sub">' + escapeHtml(g.sub) + '</span>' : '') +
            '<span class="chev">›</span></summary><div class="grid">';
        g.items.forEach(function (it) {
            body += '<button class="btn' + (it.primary ? ' primary' : '') + (it.wide ? ' wide' : '') +
                '" data-cmd="' + escapeHtml(it.cmd) + '" title="' + escapeHtml(it.label) + '">' +
                '<span class="ico">' + escapeHtml(it.icon || '•') + '</span>' +
                '<span class="lbl">' + escapeHtml(it.label) + '</span></button>';
        });
        body += '</div></details>';
    });

    const hero = '<div class="hero">' +
        '<div class="brand"><div class="logo">🏆</div><div class="brand-text">' +
        '<div class="app-name">CF 训练工具</div>' +
        '<div class="app-sub">Codeforces · 洛谷 · 牛客 · AtCoder</div></div></div>' +
        '<div class="chips">' +
        '<span class="chip"><span class="chip-key">handle</span><span class="chip-val">' + escapeHtml(handle || '未设置') + '</span></span>' +
        '<span class="chip"><span class="dot ' + (aiOn ? 'on' : 'off') + '"></span><span class="chip-key">AI</span><span class="chip-val">' + escapeHtml(aiText) + '</span></span>' +
        gymChipHtml() +
        '</div>' +
        '<div class="accounts"><span class="accounts-label">账号：</span>' + accountChipsHtml() + '</div>' +
        '</div>\n';

    return '<!DOCTYPE html>\n' +
        '<html lang="zh-CN"><head><meta charset="utf-8">\n' +
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\';">\n' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
        '<style>\n' +
        '* { box-sizing: border-box; }\n' +
        'body { padding: 10px 10px 18px; margin: 0; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: 12.5px; }\n' +
        '.hero { padding: 12px 12px 10px; border-radius: 10px; border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.25)); background: linear-gradient(135deg, rgba(56,139,253,.14), rgba(163,113,247,.10)); margin-bottom: 10px; }\n' +
        '.brand { display: flex; align-items: center; gap: 9px; }\n' +
        '.logo { width: 34px; height: 34px; border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 20px; background: rgba(255,255,255,.10); }\n' +
        '.brand-text { min-width: 0; }\n' +
        '.app-name { font-size: 15px; font-weight: 700; letter-spacing: .01em; }\n' +
        '.app-sub { font-size: 10.5px; opacity: .6; margin-top: 1px; }\n' +
        '.chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 9px; }\n' +
        '.chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 10.5px; background: rgba(128,128,128,.12); border: 1px solid rgba(128,128,128,.18); max-width: 100%; }\n' +
        '.chip-key { opacity: .6; }\n' +
        '.chip-val { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px; }\n' +
        '.chip.warn { border-color: rgba(210,153,34,.45); }\n' +
        '.dot { width: 6px; height: 6px; border-radius: 50%; background: #888; flex: 0 0 auto; }\n' +
        '.dot.on { background: #3fb950; }\n' +
        '.dot.off { background: #d29922; }\n' +
        '.accounts { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 7px; }\n' +
        '.accounts-label { font-size: 10.5px; opacity: .55; margin-right: 1px; }\n' +
        '.acc { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; border-radius: 5px; font-size: 10.5px; background: rgba(128,128,128,.10); border: 1px solid transparent; max-width: 100%; }\n' +
        '.acc.on { border-color: rgba(63,185,80,.35); }\n' +
        '.acc.off { opacity: .55; }\n' +
        '.acc-ico { font-size: 8px; }\n' +
        '.acc-name { font-weight: 600; }\n' +
        '.acc-nick { opacity: .7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 78px; }\n' +
        '.card { border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.22)); border-radius: 8px; padding: 9px 9px 8px; margin: 7px 0; background: rgba(128,128,128,.045); }\n' +
        '.card-head, .mini-head { display: flex; align-items: center; gap: 7px; margin-bottom: 6px; }\n' +
        '.card-icon { font-size: 13px; flex: 0 0 auto; }\n' +
        '.card-title { font-size: 12px; font-weight: 650; }\n' +
        '.card-sub { font-size: 10.5px; opacity: .55; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n' +
        '.count { margin-left: auto; font-size: 10px; opacity: .65; background: rgba(128,128,128,.15); padding: 1px 6px; border-radius: 999px; flex: 0 0 auto; }\n' +
        '.plan-meta { font-size: 10.5px; opacity: .6; margin: 0 0 6px; line-height: 1.5; }\n' +
        '.empty { opacity: .6; font-size: 11px; margin: 2px 0 7px; }\n' +
        '.problem-list { display: flex; flex-direction: column; gap: 3px; margin-bottom: 7px; }\n' +
        'button.problem { display: flex; align-items: center; gap: 6px; width: 100%; margin: 0; padding: 5px 7px; text-align: left; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--vscode-foreground); cursor: pointer; font-family: inherit; font-size: 11.5px; }\n' +
        'button.problem:hover { background: var(--vscode-list-hoverBackground); }\n' +
        '.badge { flex: 0 0 auto; font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }\n' +
        '.ptitle { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n' +
        '.pdiff { flex: 0 0 auto; opacity: .55; font-size: 10.5px; }\n' +
        '.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }\n' +
        '.btn { display: flex; align-items: center; gap: 5px; width: 100%; min-height: 30px; padding: 5px 7px; margin: 0; border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.20)); border-radius: 6px; cursor: pointer; text-align: left; font-size: 11.5px; font-family: inherit; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }\n' +
        '.btn:hover { background: var(--vscode-button-secondaryHoverBackground); }\n' +
        '.btn:active { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }\n' +
        '.btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }\n' +
        '.btn.primary:hover { background: var(--vscode-button-hoverBackground); }\n' +
        '.btn.wide { grid-column: 1 / -1; }\n' +
        '.btn.small { min-height: 27px; font-size: 11px; }\n' +
        '.btn .ico { flex: 0 0 auto; font-size: 12px; line-height: 1; }\n' +
        '.btn .lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n' +
        '.divider { height: 1px; background: var(--vscode-panel-border, rgba(128,128,128,.22)); margin: 8px 0; }\n' +
        'details.group { padding: 0; }\n' +
        'details.group > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 7px; padding: 8px 9px; margin: 0; user-select: none; }\n' +
        'details.group > summary::-webkit-details-marker { display: none; }\n' +
        'details.group > summary:hover { background: rgba(128,128,128,.08); border-radius: 7px; }\n' +
        'details.group[open] > summary { border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.18)); border-radius: 7px 7px 0 0; margin-bottom: 8px; }\n' +
        'details.group > .grid { padding: 0 9px 9px; }\n' +
        '.chev { margin-left: auto; opacity: .45; font-size: 15px; transition: transform .12s ease; }\n' +
        'details.group[open] .chev { transform: rotate(90deg); }\n' +
        '.hint { opacity: .5; margin-top: 12px; font-size: 10.5px; line-height: 1.5; }\n' +
        '.muted { opacity: .7; }\n' +
        '</style></head><body>\n' +
        hero +
        planSectionHtml() +
        body + '\n' +
        '<div class="hint">题面 / 编译 / 提交按钮需要先在编辑器打开对应 .cpp 文件。题单里的题目点一下会在浏览器打开。</div>\n' +
        '<script nonce="' + nonce + '">\n' +
        'const vscode = acquireVsCodeApi();\n' +
        'document.querySelectorAll(\'button[data-cmd]\').forEach(function (b) {\n' +
        '  b.addEventListener(\'click\', function () { vscode.postMessage({ command: b.getAttribute(\'data-cmd\') }); });\n' +
        '});\n' +
        'document.querySelectorAll(\'button[data-url]\').forEach(function (b) {\n' +
        '  b.addEventListener(\'click\', function () { vscode.postMessage({ openUrl: b.getAttribute(\'data-url\') }); });\n' +
        '});\n' +
        '</script></body></html>';
}
function samplesHtml(state) {
    const nonceSrc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 24; i++) nonce += nonceSrc.charAt(Math.floor(Math.random() * nonceSrc.length));
    const esc = escapeHtml;
    const results = state.results && Array.isArray(state.results.tests) ? state.results.tests : [];
    const sampleTotal = state.results ? Number(state.results.sampleCount || 0) : state.tests.filter(function (t) { return t.kind !== 'custom'; }).length;
    const customTotal = state.results ? Number(state.results.customCount || 0) : state.tests.filter(function (t) { return t.kind === 'custom'; }).length;
    let samplePassed = 0;
    let customPassed = 0;
    results.forEach(function (r) {
        if (r.status !== 'PASS') return;
        if (r.kind === 'custom') customPassed++;
        else samplePassed++;
    });
    const total = state.results ? Number(state.results.total || results.length) : state.tests.length;
    const passed = state.results ? Number(state.results.passed || 0) : 0;
    const pct = total ? Math.round(passed * 100 / total) : 0;
    let sampleCases = '';
    let customCases = '';
    let fallbackCustom = 0;
    (state.tests || []).forEach(function (t, i) {
        const kind = t.kind === 'custom' ? 'custom' : 'sample';
        const idx = kind === 'custom'
            ? (t.customIndex != null ? t.customIndex : fallbackCustom++)
            : (t.sampleIndex != null ? t.sampleIndex : i);
        const r = results[i] || null;
        const status = r ? r.status : '待测';
        const cls = r ? (r.status === 'PASS' ? 'ok' : (r.status === 'FAIL' ? 'bad' : 'warn')) : 'idle';
        const del = kind === 'custom' ? '<button class="del" data-index="' + idx + '" title="删除这条自定义测试">✕</button>' : '';
        const card = '<div class="case"><div class="hd"><b>#' + (i + 1) + '</b>' +
            '<span class="kind ' + (kind === 'custom' ? 'kc' : 'ks') + '">' + (kind === 'custom' ? '自定义' : '样例') + '</span>' +
            (t.name ? '<span class="nm">' + esc(t.name) + '</span>' : '') +
            '<span class="badge ' + cls + '">' + esc(status) + '</span>' +
            (r ? '<span class="ms">' + r.ms + ' ms</span>' : '') + del + '</div>' +
            '<div class="lbl">输入</div><textarea class="tin" data-i="' + i + '" data-kind="' + kind + '" data-index="' + idx + '">' + esc(t.input || '') + '</textarea>' +
            '<div class="lbl">期望输出</div><textarea class="tout" data-i="' + i + '" data-kind="' + kind + '" data-index="' + idx + '">' + esc(t.output || '') + '</textarea>' +
            (r && r.status !== 'PASS' ? ('<div class="lbl">实际输出</div><pre>' + esc(r.got || '(空)') + '</pre>') : '') +
            '<div class="row"><button class="runone" data-i="' + i + '" data-kind="' + kind + '" data-index="' + idx + '">▶ 运行此测试</button></div></div>';
        if (kind === 'custom') customCases += card;
        else sampleCases += card;
    });
    const scoreLine = state.results
        ? ('样例 ' + samplePassed + '/' + sampleTotal + ' · 自定义 ' + customPassed + '/' + customTotal +
            ' · 总得分 ' + passed + '/' + total + '（' + pct + '%）')
        : ('共 ' + total + ' 个测试（样例 ' + sampleTotal + ' + 自定义 ' + customTotal + '）· 点击「运行全部测试」');
    const msg = state.message ? '<div class="msg">' + esc(state.message) + '</div>' : '';
    return '<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="utf-8">' +
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\';">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0"><style>' +
        'body{padding:8px 12px 16px;color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:13px;}' +
        'h3{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;opacity:.65;margin:10px 0 6px;}' +
        '.title{font-weight:600;margin:0 0 2px;}.muted{opacity:.7;font-size:12px;}.msg{color:var(--vscode-errorForeground);margin:6px 0;}' +
        '.score{font-size:13px;margin:6px 0 4px;}.bar{height:14px;background:rgba(128,128,128,.3);border-radius:7px;overflow:hidden;margin-bottom:10px;}' +
        '.bar i{display:block;height:100%;width:' + pct + '%;background:var(--vscode-testing-iconPassed,#3fb950);}' +
        'button{width:100%;margin:4px 0;padding:6px 10px;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-family:inherit;background:var(--vscode-button-background);color:var(--vscode-button-foreground);}' +
        'button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);}' +
        '.case{border:1px solid var(--vscode-panel-border,rgba(128,128,128,.35));border-radius:4px;margin:6px 0;padding:6px 8px;}' +
        '.hd{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}.hd b{flex:0 0 auto;}' +
        '.kind{font-size:10px;padding:1px 4px;border-radius:3px;}.kind.ks{background:rgba(56,139,253,.25);}.kind.kc{background:rgba(210,153,34,.3);}' +
        '.nm{font-size:11px;opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px;}' +
        '.badge{font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;}.badge.ok{background:#2ea043;color:#fff;}.badge.bad{background:#da3633;color:#fff;}.badge.warn{background:#d29922;color:#fff;}.badge.idle{opacity:.6;border:1px solid currentColor;}' +
        '.ms{margin-left:auto;opacity:.65;font-size:11px;}' +
        'button.del{width:auto;margin:0 0 0 4px;padding:0 5px;background:transparent;color:var(--vscode-errorForeground);font-size:12px;}' +
        '.lbl{font-size:11px;opacity:.65;margin-top:4px;}' +
        'textarea{width:100%;box-sizing:border-box;margin:2px 0;padding:4px 6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,rgba(128,128,128,.4));border-radius:3px;font-family:var(--vscode-editor-font-family,monospace);font-size:12px;min-height:44px;resize:vertical;}' +
        'pre{background:var(--vscode-textCodeBlock-background);padding:5px;border-radius:3px;overflow:auto;max-height:180px;white-space:pre;font-size:12px;}' +
        '.row{display:flex;gap:4px;}.row button{width:auto;flex:1;margin-top:4px;}' +
        '.form{margin:6px 0;}.form input{width:100%;box-sizing:border-box;margin:3px 0;padding:4px 6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,rgba(128,128,128,.4));border-radius:3px;font-family:inherit;font-size:12px;}' +
        '</style></head><body>' +
        '<h3>样例自测</h3><div class="title">' + esc(state.cpp ? path.basename(state.cpp) : '未打开题目') + '</div>' +
        '<div class="muted">' + (state.source ? ('样例：' + esc(path.basename(state.source))) : '') + (state.customSource ? (' · 自定义：' + esc(path.basename(state.customSource))) : '') + '</div>' +
        msg +
        '<div class="score">' + scoreLine + '</div><div class="bar"><i></i></div>' +
        '<button id="run">▶ 运行全部测试</button>' +
        '<button id="submit">🚀 提交到 OJ</button>' +
        '<h3>样例</h3>' +
        '<div id="cases-sample">' + sampleCases + '</div>' +
        '<h3>自定义测试</h3>' +
        '<div id="cases-custom">' + customCases + '</div>' +
        '<div class="form">' +
        '<input id="cname" placeholder="名称（可选）">' +
        '<textarea id="cin" placeholder="输入（stdin）"></textarea>' +
        '<textarea id="cout" placeholder="期望输出（用于计分，必填）"></textarea>' +
        '<button id="add">➕ 添加并运行</button>' +
        '</div>' +
        '<div class="muted">自定义测试保存在同目录 题号.custom-tests.json；样例修改保存在 题号.sample-overrides.json</div>' +
        '<script nonce="' + nonce + '">const vscode=acquireVsCodeApi();' +
        'function valById(i,c){var els=document.querySelectorAll("textarea."+c);for(var k=0;k<els.length;k++){if(els[k].getAttribute("data-i")==i)return els[k].value;}return "";}' +
        'function collectEdits(){var vals=[];var ins=document.querySelectorAll("textarea.tin");for(var k=0;k<ins.length;k++){var i=ins[k].getAttribute("data-i");vals.push({kind:ins[k].getAttribute("data-kind"),index:Number(ins[k].getAttribute("data-index")),input:ins[k].value,output:valById(i,"tout")});}return vals;}' +
        'document.getElementById("run").addEventListener("click",function(){vscode.postMessage({command:"run",values:collectEdits()});});' +
        'document.getElementById("submit").addEventListener("click",function(){vscode.postMessage({command:"submit"});});' +
        'document.getElementById("add").addEventListener("click",function(){vscode.postMessage({command:"addCustom",name:document.getElementById("cname").value,input:document.getElementById("cin").value,output:document.getElementById("cout").value});});' +
        'Array.prototype.forEach.call(document.querySelectorAll("button.runone"),function(b){b.addEventListener("click",function(){var i=b.getAttribute("data-i");vscode.postMessage({command:"runOne",kind:b.getAttribute("data-kind"),index:Number(b.getAttribute("data-index")),input:valById(i,"tin"),output:valById(i,"tout")});});});' +
        'Array.prototype.forEach.call(document.querySelectorAll("button.del"),function(b){b.addEventListener("click",function(){vscode.postMessage({command:"deleteCustom",index:Number(b.getAttribute("data-index"))});});});' +
        '</script></body></html>';
}

class SamplesViewProvider {
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
        this.view = null;
        this.cpp = '';
        this.source = '';
        this.customSource = '';
        this.tests = [];
        this.results = null;
        this.message = '';
    }
    state() {
        return {
            cpp: this.cpp,
            source: this.source,
            customSource: this.customSource,
            tests: this.tests,
            results: this.results,
            message: this.message
        };
    }
    render() {
        if (this.view) this.view.webview.html = samplesHtml(this.state());
    }
    resolveWebviewView(view) {
        this.view = view;
        view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
        this.render();
        const self = this;
        view.webview.onDidReceiveMessage(async function (msg) {
            if (!msg) return;
            try {
                if (output) output.appendLine('[samples] message: ' + JSON.stringify(msg).slice(0, 200));
                if (msg.command === 'run') return await self.runAll(msg);
                if (msg.command === 'addCustom') return await self.addCustom(msg);
                if (msg.command === 'deleteCustom') return await self.deleteCustom(msg);
                if (msg.command === 'saveTest') return await self.saveTest(msg);
                if (msg.command === 'runOne') return await self.runOne(msg);
                if (msg.command === 'submit') return await vscode.commands.executeCommand('cfTraining.submit', self.cpp);
            } catch (e) {
                if (output && output.appendLine) output.appendLine('[samples] ERROR ' + (e && e.stack ? e.stack : String(e)));
                vscode.window.showErrorMessage('样例自测失败：' + String(e && e.message ? e.message : e));
            }
        });
        this.refresh();
    }
    async refresh() {
        this.cpp = activeCppPath() || lastActiveCpp || '';
        this.source = '';
        this.customSource = '';
        this.tests = [];
        this.results = null;
        this.message = '';
        if (!this.cpp) {
            this.message = '请先打开一道题的 .cpp 文件';
            this.render();
            return;
        }
        this.render();
        const res = await runNodeQuiet('sample-tests.js', ['--list', this.cpp]);
        try {
            const data = JSON.parse(String(res.stdout || '{}'));
            this.tests = Array.isArray(data.tests) ? data.tests : [];
            this.source = data.source || '';
            this.customSource = data.customSource || '';
            if (data.error) this.message = data.error;
        } catch (e) {
            this.message = '读取样例失败';
        }
        this.render();
    }
    async saveEdits(values) {
        if (!this.cpp || !Array.isArray(values) || !values.length) return;
        const custom = readCustomTests(this.cpp).tests;
        const overrides = readSampleOverrides(this.cpp).data;
        let customChanged = false;
        let sampleChanged = false;
        values.forEach(function (v) {
            const kind = v.kind === 'custom' ? 'custom' : 'sample';
            const idx = Number(v.index);
            if (!isFinite(idx) || idx < 0) return;
            const input = String(v.input == null ? '' : v.input);
            const output = String(v.output == null ? '' : v.output);
            if (kind === 'custom') {
                if (custom[idx]) {
                    custom[idx].input = input;
                    custom[idx].output = output;
                    customChanged = true;
                }
            } else {
                overrides[idx] = { input: input, output: output };
                sampleChanged = true;
            }
        });
        if (customChanged) writeCustomTests(this.cpp, custom);
        if (sampleChanged) writeSampleOverrides(this.cpp, overrides);
        this.tests.forEach(function (t) {
            values.forEach(function (v) {
                const kind = v.kind === 'custom' ? 'custom' : 'sample';
                const idx = Number(v.index);
                const ti = t.kind === 'custom' ? t.customIndex : t.sampleIndex;
                if ((t.kind === 'custom' ? 'custom' : 'sample') === kind && ti === idx) {
                    t.input = String(v.input == null ? '' : v.input);
                    t.output = String(v.output == null ? '' : v.output);
                }
            });
        });
    }
    async runAll(msg) {
        if (msg && Array.isArray(msg.values)) await this.saveEdits(msg.values);
        return this.run();
    }
    async run() {
        if (!this.cpp) return this.refresh();
        await saveDocumentForPath(this.cpp);
        this.message = '正在编译并运行测试…';
        this.render();
        const res = await runNode('sample-tests.js', [this.cpp], '运行样例自测…', { cancellable: true });
        if (output) output.appendLine('[samples] run code=' + res.code + ' cancelled=' + !!res.cancelled + ' err=' + String(res.stderr || '').slice(0, 200));
        if (res.cancelled) {
            this.message = '已取消';
            this.render();
            return;
        }
        try {
            const data = JSON.parse(String(res.stdout || '{}'));
            this.results = data;
            this.source = data.source || this.source;
            this.customSource = data.customSource || this.customSource;
            if (!this.tests.length && Array.isArray(data.tests)) {
                this.tests = data.tests.map(function (t, i) {
                    return { index: t.index || (i + 1), kind: t.kind || 'sample', name: t.name || '', input: t.input || '', output: t.output || '' };
                });
            }
            const errLine = String(data.compileError || '').split(/\\r?\\n/).filter(function (l) { return l.trim(); })[0] || '';
            this.message = data.compiled === false ? ('编译失败：' + errLine.slice(0, 180)) : '';
        } catch (e) {
            const first = (String(res.stderr || '').trim().split(/\r?\n/)[0]) || '详见输出面板';
            this.message = '运行失败：' + first;
        }
        this.render();
    }
    async saveTest(msg) {
        if (!this.cpp) return;
        const kind = msg.kind === 'custom' ? 'custom' : 'sample';
        const idx = Number(msg.index);
        if (!isFinite(idx) || idx < 0) return;
        const input = String(msg.input == null ? '' : msg.input);
        const output = String(msg.output == null ? '' : msg.output);
        if (kind === 'custom') {
            const list = readCustomTests(this.cpp).tests;
            if (list[idx]) {
                list[idx].input = input;
                list[idx].output = output;
                writeCustomTests(this.cpp, list);
            }
        } else {
            const ov = readSampleOverrides(this.cpp);
            ov.data[idx] = { input: input, output: output };
            writeSampleOverrides(this.cpp, ov.data);
        }
        this.tests.forEach(function (t) {
            const ti = t.kind === 'custom' ? t.customIndex : t.sampleIndex;
            if ((t.kind === 'custom' ? 'custom' : 'sample') === kind && ti === idx) {
                t.input = input;
                t.output = output;
            }
        });
        this.message = '已保存';
        this.render();
    }
    async runOne(msg) {
        if (!this.tests.length) await this.refresh();
        if (!this.cpp) {
            this.cpp = activeCppPath() || lastActiveCpp || '';
            if (!this.cpp) {
                this.message = '请先打开一道题的 .cpp 文件';
                this.render();
                return;
            }
        }
        const kind = msg.kind === 'custom' ? 'custom' : 'sample';
        const idx = Number(msg.index);
        if (!isFinite(idx) || idx < 0) return;
        const input = String(msg.input == null ? '' : msg.input);
        const outputText = String(msg.output == null ? '' : msg.output);
        await this.saveTest({ kind: kind, index: idx, input: input, output: outputText });
        await saveDocumentForPath(this.cpp);
        this.message = '正在运行单个测试…';
        this.render();
        const args = [this.cpp, kind === 'custom' ? '--only-custom' : '--only-sample', String(idx)];
        const res = await runNode('sample-tests.js', args, '运行单个测试…', { cancellable: true });
        if (output) output.appendLine('[samples] runOne code=' + res.code + ' cancelled=' + !!res.cancelled + ' err=' + String(res.stderr || '').slice(0, 200));
        if (res.cancelled) {
            this.message = '已取消';
            this.render();
            return;
        }
        try {
            const data = JSON.parse(String(res.stdout || '{}'));
            const one = (data.tests || [])[0];
            if (!one) throw new Error('没有结果');
            const sampleTotal = this.tests.filter(function (t) { return t.kind !== 'custom'; }).length;
            const globalIdx = kind === 'custom' ? sampleTotal + idx : idx;
            if (!this.results || !Array.isArray(this.results.tests) || this.results.tests.length !== this.tests.length) {
                this.results = {
                    tests: this.tests.map(function (t, i) {
                        return { index: i + 1, kind: t.kind, name: t.name || '', status: '待测', ms: 0, input: t.input, output: t.output, got: '' };
                    }),
                    sampleCount: sampleTotal,
                    customCount: this.tests.length - sampleTotal
                };
            }
            if (globalIdx >= 0 && globalIdx < this.results.tests.length) {
                one.index = globalIdx + 1;
                this.results.tests[globalIdx] = one;
            }
            const total = this.results.tests.length;
            const passed = this.results.tests.filter(function (x) { return x.status === 'PASS'; }).length;
            this.results.total = total;
            this.results.passed = passed;
            this.results.score = passed;
            this.results.maxScore = total;
            this.results.sampleCount = sampleTotal;
            this.results.customCount = this.tests.length - sampleTotal;
            const errLine = String(data.compileError || '').split(/\\r?\\n/).filter(function (l) { return l.trim(); })[0] || '';
            this.message = data.compiled === false ? ('编译失败：' + errLine.slice(0, 180)) : '';
        } catch (e) {
            if (output && output.appendLine) output.appendLine('[samples] runOne ERROR ' + (e && e.stack ? e.stack : String(e)));
            const first = (String(res.stderr || '').trim().split(/\r?\n/)[0]) || (e && e.message) || '详见输出面板';
            this.message = '运行失败：' + first;
        }
        this.render();
    }
    async addCustom(msg) {
        if (!this.cpp) {
            this.cpp = activeCppPath() || lastActiveCpp || '';
            if (!this.cpp) {
                this.message = '请先打开一道题的 .cpp 文件';
                this.render();
                return;
            }
        }
        const input = String(msg.input == null ? '' : msg.input);
        const output = String(msg.output == null ? '' : msg.output);
        if (!input.trim() || !output.trim()) {
            this.message = '输入和期望输出都要填写（期望输出用于计分）';
            this.render();
            return;
        }
        const list = readCustomTests(this.cpp).tests;
        list.push({ name: String(msg.name || '').trim(), input: input, output: output });
        writeCustomTests(this.cpp, list);
        this.message = '已添加自定义测试';
        await this.refresh();
        await this.run();
    }
    async deleteCustom(msg) {
        if (!this.cpp) return;
        const list = readCustomTests(this.cpp).tests;
        const idx = Number(msg.index);
        if (!isFinite(idx) || idx < 0 || idx >= list.length) return;
        list.splice(idx, 1);
        writeCustomTests(this.cpp, list);
        this.results = null;
        await this.refresh();
    }
}

class SidebarViewProvider {
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
        this.view = null;
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        webviewView.webview.html = sidebarHtml();
        webviewView.webview.onDidReceiveMessage(async function (msg) {
            if (!msg) return;
            try {
                if (msg.openUrl) {
                    await vscode.env.openExternal(vscode.Uri.parse(String(msg.openUrl)));
                    return;
                }
                if (msg.command) {
                    await vscode.commands.executeCommand(msg.command);
                }
            } catch (e) {
                vscode.window.showErrorMessage('执行失败：' + String(e && e.message ? e.message : e));
            }
        });
    }
    refresh() {
        if (this.view) this.view.webview.html = sidebarHtml();
    }
}

/* ---------------- activation ---------------- */

function activate(context) {
    output = vscode.window.createOutputChannel('CF 训练工具');
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.text = '$(mortar-board) CF 训练';
    statusBar.tooltip = '打开 CF 训练工具菜单';
    statusBar.command = 'cfTraining.menu';
    statusBar.show();
    context.subscriptions.push(output, statusBar);

    aiStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    context.subscriptions.push(aiStatusBar);
    try { syncAiSettingsToFile(); } catch (e) { /* ignore */ }
    updateAiStatusBar();
    try {
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(function (e) {
            try {
                if (e && e.affectsConfiguration && e.affectsConfiguration('cf-training-tools.ai')) {
                    syncAiSettingsToFile();
                    updateAiStatusBar();
                    if (sidebarProvider) sidebarProvider.refresh();
                }
            } catch (err) { /* ignore */ }
        }));
    } catch (e) { /* ignore */ }

    try {
        if (vscode.window.onDidChangeActiveTextEditor) {
            context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(function (ed) {
                if (ed && ed.document && ed.document.languageId === 'cpp') {
                    lastActiveCpp = ed.document.uri.fsPath;
                    if (samplesProvider) {
                        try { samplesProvider.refresh(); } catch (e) { /* ignore */ }
                    }
                }
            }));
        }
    } catch (e) { /* ignore */ }
    try {
        if (vscode.window.onDidChangeActiveTextEditor) {
            context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(function (ed) {
                try {
                    if (!ed || !ed.document || ed.document.languageId !== 'cpp') return;
                    const conf = vscode.workspace.getConfiguration('cf-training-tools');
                    if (conf.get('autoStatementPreview') === false) return;
                    const mdPath = siblingMarkdown(ed.document.fileName);
                    if (!fs.existsSync(mdPath)) return;
                    if (lastPreviewed && lastPreviewed.md === mdPath && (Date.now() - lastPreviewed.ts) < 8000) return;
                    setTimeout(function () {
                        try {
                            const cur = vscode.window.activeTextEditor;
                            if (!cur || !cur.document || cur.document.fileName !== ed.document.fileName) return;
                            layoutCppAndMd(ed.document.fileName);
                        } catch (e) { /* ignore */ }
                    }, 350);
                } catch (e) { /* ignore */ }
            }));
        }
    } catch (e) { /* ignore */ }

    const map = {
        'cfTraining.menu': cmdMenu,
        'cfTraining.plan': cmdPlan,
        'cfTraining.pullContest': cmdPullContest,
        'cfTraining.pullProblem': cmdPullProblem,
        'cfTraining.cfLogin': cmdCfLogin,
        'cfTraining.loginCodeforces': function () { return cmdPlatformLogin('codeforces'); },
        'cfTraining.loginLuogu': function () { return cmdPlatformLogin('luogu'); },
        'cfTraining.loginNowcoder': function () { return cmdPlatformLogin('nowcoder'); },
        'cfTraining.loginAtcoder': function () { return cmdPlatformLogin('atcoder'); },
        'cfTraining.accountStatus': cmdAccountStatus,
        'cfTraining.clearCookie': cmdClearCookie,
        'cfTraining.openCookieFolder': cmdOpenCookieFolder,
        'cfTraining.cfLoginCheck': cmdCfLoginCheck,
        'cfTraining.cfLogout': cmdCfLogout,
        'cfTraining.pullTemplate': cmdPullTemplate,
        'cfTraining.openPlan': cmdOpenPlan,
        'cfTraining.openRedo': cmdOpenRedo,
        'cfTraining.aiHint': cmdAiHint,
        'cfTraining.aiAsk': cmdAiAsk,
        'cfTraining.aiReview': cmdAiReview,
        'cfTraining.aiTranslate': cmdAiTranslate,
        'cfTraining.aiConfig': cmdAiConfig,
        'cfTraining.aiSettings': cmdAiOpenSettings,
        'cfTraining.aiTest': cmdAiTest,
        'cfTraining.reviewLatest': cmdReviewLatest,
        'cfTraining.reviewInput': cmdReviewInput,
        'cfTraining.statementOpen': cmdStatementOpen,
        'cfTraining.statementNow': cmdStatementNow,
        'cfTraining.sampleTests': cmdSampleTests,
        'cfTraining.submit': cmdSubmit,
        'cfTraining.samples': cmdSamples,
        'cfTraining.build': cmdBuild,
        'cfTraining.setHandle': cmdSetHandle,
        'cfTraining.openDoc': cmdOpenDoc
    };
    Object.keys(map).forEach(function (id) {
        context.subscriptions.push(vscode.commands.registerCommand(id, map[id]));
    });

    sidebarProvider = new SidebarViewProvider(context.extensionUri || vscode.Uri.file(__dirname));
    samplesProvider = new SamplesViewProvider(context.extensionUri || vscode.Uri.file(__dirname));
    if (vscode.window.registerWebviewViewProvider) {
        context.subscriptions.push(vscode.window.registerWebviewViewProvider(
            'cfTraining.main',
            sidebarProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        ));
        context.subscriptions.push(vscode.window.registerWebviewViewProvider(
            'cfTraining.samples',
            samplesProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        ));
    }

    try {
        ['**/training/plan.json', '**/training/ai-config.json'].forEach(function (pattern) {
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            if (!watcher) return;
            watcher.onDidChange(function () { if (sidebarProvider) sidebarProvider.refresh(); });
            watcher.onDidCreate(function () { if (sidebarProvider) sidebarProvider.refresh(); });
            context.subscriptions.push(watcher);
        });
    } catch (e) { /* ignore */ }
}

function deactivate() {
    if (output) output.dispose();
    if (statusBar) statusBar.dispose();
}

module.exports = { activate: activate, deactivate: deactivate };
