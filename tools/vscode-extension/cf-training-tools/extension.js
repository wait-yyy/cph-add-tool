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
    if (!ed) return null;
    const fsPath = ed.document.uri.fsPath;
    if (!/\.(cpp|cc|cxx)$/i.test(fsPath)) return null;
    return fsPath;
}

function siblingMarkdown(cppFsPath) {
    return cppFsPath.replace(/\.(cpp|cc|cxx)$/i, '.md');
}

function cfCookiePath() {
    return path.join(workspaceRoot(), 'training', 'cf-cookies.txt');
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
        return '<h3>当前题单</h3>\n<div class="empty">还没有题单，点下面「生成/刷新周题单」。</div>\n';
    }
    let html = '<h3>当前题单 <span class="muted">' + escapeHtml(plan.problems ? plan.problems.length : 0) + ' 题</span></h3>\n';
    const meta = [];
    if (plan.rating) meta.push('rating ' + escapeHtml(plan.rating));
    if (plan.weakTags && plan.weakTags.length) meta.push('弱项 ' + escapeHtml(plan.weakTags.join(' / ')));
    if (plan.generated) meta.push(escapeHtml(plan.generated));
    if (meta.length) html += '<div class="plan-meta">' + meta.join(' · ') + '</div>\n';
    const problems = plan.problems || [];
    problems.forEach(function (p) {
        const diffText = p.platform === 'Luogu' ? ('难度' + p.rating) : p.rating;
        html += '<button class="problem" data-url="' + escapeHtml(p.url) + '">' +
            '<span class="badge">' + escapeHtml(platformBadge(p.platform)) + '</span>' +
            '<span class="ptitle">' + escapeHtml(p.title) + '</span>' +
            '<span class="pdiff">' + escapeHtml(diffText) + '</span></button>\n';
    });
    html += '<div class="row">' +
        '<button class="small" data-cmd="cfTraining.plan">🔄 刷新</button>' +
        '<button class="small" data-cmd="cfTraining.openPlan">📄 完整题单</button>' +
        '</div>\n';
    const redoCount = plan.redoCount || 0;
    html += '<h3>重做队列 <span class="muted">' + escapeHtml(redoCount) + ' 题</span></h3>\n';
    html += '<button data-cmd="cfTraining.openRedo">📋 打开重做队列</button>\n';
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
    const aiText = aiOn ? ('已配置 ' + escapeHtml(aiModel)) : '未配置（点下方「设置 AI API」）';
    const groups = [
        {
            title: 'AI 助手',
            items: [
                { cmd: 'cfTraining.aiHint', label: '💡 AI 提示（当前题）', primary: true },
                { cmd: 'cfTraining.aiAsk', label: '❓ 问 AI（当前题）' },
                { cmd: 'cfTraining.aiReview', label: '🧠 AI 复盘（选比赛）' },
                { cmd: 'cfTraining.aiTranslate', label: '🌐 AI 翻译当前题面' },
                { cmd: 'cfTraining.aiConfig', label: '⚙️ 设置 AI API' },
                { cmd: 'cfTraining.aiTest', label: '🔌 测试 AI 连接' },
                { cmd: 'cfTraining.aiSettings', label: '🧰 在 VS Code 设置中编辑' }
            ]
        },
        {
            title: '训练',
            items: [
                { cmd: 'cfTraining.pullContest', label: '📥 抓取整场比赛（CF/洛谷/牛客/AtCoder）', primary: true },
                { cmd: 'cfTraining.pullProblem', label: '📥 抓取单个题目' },
                { cmd: 'cfTraining.pullTemplate', label: '🧩 设置拉题初始模板' },
                { cmd: 'cfTraining.plan', label: '📅 生成 / 刷新周题单', primary: true },
                { cmd: 'cfTraining.reviewLatest', label: '🧾 复盘最近一场', primary: true },
                { cmd: 'cfTraining.reviewInput', label: '🔍 复盘指定比赛…' }
            ]
        },
        {
            title: '题面',
            items: [
                { cmd: 'cfTraining.statementOpen', label: '📖 打开当前题面预览' },
                { cmd: 'cfTraining.statementNow', label: '🔄 重新抓取当前题面' },
            ]
        },
        {
            title: '代码',
            items: [
                { cmd: 'cfTraining.sampleTests', label: '🧪 样例自测（计分）', primary: true },
                { cmd: 'cfTraining.samples', label: '▶️ 编译并跑样例' },
                { cmd: 'cfTraining.build', label: '🔨 只编译' }
            ]
        },
        {
            title: '设置 / 维护',
            items: [
                { cmd: 'cfTraining.cfLogin', label: '🍪 设置 CF 登录 Cookie（Gym/私有比赛）' },
                { cmd: 'cfTraining.cfLoginCheck', label: '🔎 检查 CF 登录状态' },
                { cmd: 'cfTraining.cfLogout', label: '🚪 清除 CF 登录 Cookie' },
                { cmd: 'cfTraining.setHandle', label: '👤 设置 CF handle' },
                { cmd: 'cfTraining.openDoc', label: '❓ 打开训练手册' }
            ]
        }
    ];
    let body = '';
    groups.forEach(function (g) {
        body += '<h3>' + escapeHtml(g.title) + '</h3>';
        g.items.forEach(function (it) {
            body += '<button' + (it.primary ? ' class="primary"' : '') + ' data-cmd="' + escapeHtml(it.cmd) + '">' + escapeHtml(it.label) + '</button>';
        });
    });
    return '<!DOCTYPE html>\n' +
        '<html lang="zh-CN"><head><meta charset="utf-8">\n' +
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\';">\n' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
        '<style>\n' +
        'body { padding: 4px 12px 16px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: 13px; }\n' +
        '.meta { opacity: .75; margin: 8px 0 4px; line-height: 1.6; }\n' +
        '.meta code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }\n' +
        'h3 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; opacity: .65; margin: 18px 0 6px; }\n' +
        'h3 .muted, .muted { text-transform: none; letter-spacing: 0; opacity: .7; font-weight: 400; }\n' +
        'button { display: block; width: 100%; margin: 4px 0; padding: 6px 10px; border: none; border-radius: 4px; cursor: pointer; text-align: left; font-size: 13px; font-family: inherit; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }\n' +
        'button:hover { background: var(--vscode-button-secondaryHoverBackground); }\n' +
        'button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }\n' +
        'button.primary:hover { background: var(--vscode-button-hoverBackground); }\n' +
        'button:active { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }\n' +
        'button.problem { display: flex; align-items: baseline; gap: 6px; background: transparent; border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35)); padding: 6px 8px; }\n' +
        'button.problem:hover { background: var(--vscode-list-hoverBackground); }\n' +
        '.badge { flex: 0 0 auto; font-size: 10px; font-weight: 700; padding: 1px 4px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }\n' +
        '.ptitle { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n' +
        '.pdiff { flex: 0 0 auto; opacity: .65; font-size: 12px; }\n' +
        '.plan-meta { opacity: .65; font-size: 12px; margin: 2px 0 8px; line-height: 1.5; }\n' +
        '.empty { opacity: .65; margin: 4px 0 8px; }\n' +
        '.row { display: flex; gap: 6px; }\n' +
        '.row button { flex: 1; text-align: center; }\n' +
        'button.small { padding: 5px 8px; font-size: 12px; }\n' +
        '.hint { opacity: .6; margin-top: 14px; font-size: 12px; line-height: 1.5; }\n' +
        '</style></head><body>\n' +
        '<div class="meta">handle：<code>' + escapeHtml(handle || '（未设置）') + '</code>　AI：<code>' + aiText + '</code></div>\n' +
        planSectionHtml() +
        body + '\n' +
        '<div class="hint">题面 / 编译按钮需要先在编辑器打开对应 .cpp 文件。题单里的题目点一下会在浏览器打开。</div>\n' +
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
    let cases = '';
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
        cases += '<div class="case"><div class="hd"><b>#' + (i + 1) + '</b>' +
            '<span class="kind ' + (kind === 'custom' ? 'kc' : 'ks') + '">' + (kind === 'custom' ? '自定义' : '样例') + '</span>' +
            (t.name ? '<span class="nm">' + esc(t.name) + '</span>' : '') +
            '<span class="badge ' + cls + '">' + esc(status) + '</span>' +
            (r ? '<span class="ms">' + r.ms + ' ms</span>' : '') + del + '</div>' +
            '<div class="lbl">输入</div><textarea class="tin" data-i="' + i + '">' + esc(t.input || '') + '</textarea>' +
            '<div class="lbl">期望输出</div><textarea class="tout" data-i="' + i + '">' + esc(t.output || '') + '</textarea>' +
            (r && r.status !== 'PASS' ? ('<div class="lbl">实际输出</div><pre>' + esc(r.got || '(空)') + '</pre>') : '') +
            '<div class="row"><button class="runone" data-i="' + i + '" data-kind="' + kind + '" data-index="' + idx + '">▶ 运行此测试</button>' +
            '<button class="save" data-i="' + i + '" data-kind="' + kind + '" data-index="' + idx + '">💾 保存</button></div></div>';
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
        '<h3>自定义测试</h3>' +
        '<div class="form">' +
        '<input id="cname" placeholder="名称（可选）">' +
        '<textarea id="cin" placeholder="输入（stdin）"></textarea>' +
        '<textarea id="cout" placeholder="期望输出（用于计分，必填）"></textarea>' +
        '<button id="add">➕ 添加并运行</button>' +
        '</div>' +
        '<div class="muted">自定义测试保存在同目录 题号.custom-tests.json；样例修改保存在 题号.sample-overrides.json</div>' +
        '<div id="cases">' + cases + '</div>' +
        '<script nonce="' + nonce + '">const vscode=acquireVsCodeApi();' +
        'function val(i,c){var el=document.querySelector("."+c+"[data-i=\""+i+"\"]");return el?el.value:"";}' +
        'document.getElementById("run").addEventListener("click",function(){vscode.postMessage({command:"run"});});' +
        'document.getElementById("add").addEventListener("click",function(){vscode.postMessage({command:"addCustom",name:document.getElementById("cname").value,input:document.getElementById("cin").value,output:document.getElementById("cout").value});});' +
        'Array.prototype.forEach.call(document.querySelectorAll("button.runone"),function(b){b.addEventListener("click",function(){var i=b.getAttribute("data-i");vscode.postMessage({command:"runOne",kind:b.getAttribute("data-kind"),index:Number(b.getAttribute("data-index")),input:val(i,"tin"),output:val(i,"tout")});});});' +
        'Array.prototype.forEach.call(document.querySelectorAll("button.save"),function(b){b.addEventListener("click",function(){var i=b.getAttribute("data-i");vscode.postMessage({command:"saveTest",kind:b.getAttribute("data-kind"),index:Number(b.getAttribute("data-index")),input:val(i,"tin"),output:val(i,"tout")});});});' +
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
                if (msg.command === 'run') return await self.run();
                if (msg.command === 'addCustom') return await self.addCustom(msg);
                if (msg.command === 'deleteCustom') return await self.deleteCustom(msg);
                if (msg.command === 'saveTest') return await self.saveTest(msg);
                if (msg.command === 'runOne') return await self.runOne(msg);
            } catch (e) {
                vscode.window.showErrorMessage('样例自测失败：' + String(e && e.message ? e.message : e));
            }
        });
        this.refresh();
    }
    async refresh() {
        this.cpp = activeCppPath() || '';
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
    async run() {
        if (!this.cpp) return this.refresh();
        this.message = '正在编译并运行测试…';
        this.render();
        const res = await runNode('sample-tests.js', [this.cpp], '运行样例自测…', { cancellable: true });
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
            this.message = data.compiled === false ? '编译失败（见下方或输出面板）' : '';
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
        if (!this.cpp) return;
        const kind = msg.kind === 'custom' ? 'custom' : 'sample';
        const idx = Number(msg.index);
        if (!isFinite(idx) || idx < 0) return;
        const input = String(msg.input == null ? '' : msg.input);
        const output = String(msg.output == null ? '' : msg.output);
        await this.saveTest({ kind: kind, index: idx, input: input, output: output });
        this.message = '正在运行单个测试…';
        this.render();
        const args = [this.cpp, kind === 'custom' ? '--only-custom' : '--only-sample', String(idx)];
        const res = await runNode('sample-tests.js', args, '运行单个测试…', { cancellable: true });
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
            if (!this.results || !Array.isArray(this.results.tests)) {
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
            this.message = data.compiled === false ? '编译失败' : '';
        } catch (e) {
            const first = (String(res.stderr || '').trim().split(/\r?\n/)[0]) || '详见输出面板';
            this.message = '运行失败：' + first;
        }
        this.render();
    }
    async addCustom(msg) {
        if (!this.cpp) return this.refresh();
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
                    if (samplesProvider) { try { samplesProvider.refresh(); } catch (e2) { /* ignore */ } }
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
