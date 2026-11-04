#!/usr/bin/env node
'use strict';

/*
 * tools/browser-submit.js
 * 用本机 Edge/Chrome 的独立 profile（training/browser-profile）自动提交。
 * 浏览器必须是可见窗口（Cloudflare 在 headless 下会拦），且 profile 里已登录对应 OJ。
 *
 *   node tools/browser-submit.js <problem.cpp> [--check]
 *
 * 输出 JSON：{ ok, platform, needLogin, submissionUrl, message }
 *
 * 当前支持：Codeforces（正赛/Gym）、AtCoder。
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PROFILE = path.join(ROOT, 'training', 'browser-profile');
const PORT = 9333;
const BROWSERS = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

function out(obj) {
    console.log(JSON.stringify(obj));
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function findBrowser() {
    for (let i = 0; i < BROWSERS.length; i++) if (fs.existsSync(BROWSERS[i])) return BROWSERS[i];
    return '';
}

function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function findMeta(cpp) {
    const dir = path.dirname(cpp);
    const stem = path.basename(cpp).replace(/\.(cpp|cc|cxx)$/i, '');
    const data = readJson(path.join(dir, stem + '.json'));
    if (data && data.url) return data;
    const cphDir = path.join(dir, '.cph');
    if (fs.existsSync(cphDir)) {
        const files = fs.readdirSync(cphDir).filter(function (f) {
            return f.indexOf('.' + path.basename(cpp) + '_') === 0 && /\.prob$/i.test(f);
        });
        for (let i = 0; i < files.length; i++) {
            const prob = readJson(path.join(cphDir, files[i]));
            if (prob && prob.url) return prob;
        }
    }
    return null;
}

function parseTarget(meta) {
    const url = String(meta.url || '');
    let m = /codeforces\.com\/(contest|gym)\/(\d+)\/problem\/([A-Za-z0-9]+)/i.exec(url);
    if (m) {
        return {
            platform: 'codeforces',
            submitUrl: 'https://codeforces.com/' + m[1] + '/' + m[2] + '/submit',
            kind: m[1],
            contestId: m[2],
            index: m[3]
        };
    }
    m = /atcoder\.jp\/contests\/([^/]+)\/tasks\/([^/?#]+)/i.exec(url);
    if (m) {
        return {
            platform: 'atcoder',
            submitUrl: 'https://atcoder.jp/contests/' + m[1] + '/tasks/' + m[2] + '/submit',
            contest: m[1],
            task: m[2]
        };
    }
    return null;
}

async function cdpConnect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    ws.onmessage = function (ev) {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            const p = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
            else p.resolve(msg.result);
        }
    };
    await new Promise(function (resolve, reject) {
        ws.onopen = resolve;
        ws.onerror = function () { reject(new Error('CDP WebSocket 连接失败')); };
    });
    return {
        send: function (method, params) {
            return new Promise(function (resolve, reject) {
                const id = nextId++;
                pending.set(id, { resolve: resolve, reject: reject });
                ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
            });
        },
        close: function () { try { ws.close(); } catch (e) { /* ignore */ } }
    };
}

async function evaluate(page, expression) {
    const r = await page.send('Runtime.evaluate', { expression: expression, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.text || '页面脚本执行失败');
    return r && r.result ? r.result.value : undefined;
}

async function ensureBrowser(startUrl) {
    // 尝试连接已打开的调试端口
    try {
        const version = await fetch('http://127.0.0.1:' + PORT + '/json/version', { signal: AbortSignal.timeout(1500) });
        if (version.ok) {
            const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list', { signal: AbortSignal.timeout(2000) })).json();
            const pages = list.filter(function (t) { return t.type === 'page'; });
            if (pages.length) return pages[0].webSocketDebuggerUrl;
        }
    } catch (e) { /* not running */ }
    const browser = findBrowser();
    if (!browser) throw new Error('没有找到 Edge/Chrome');
    try { fs.mkdirSync(PROFILE, { recursive: true }); } catch (e) { /* ignore */ }
    spawn(browser, [
        '--user-data-dir=' + PROFILE,
        '--remote-debugging-port=' + PORT,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-blink-features=AutomationControlled',
        startUrl || 'about:blank'
    ], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    for (let i = 0; i < 40; i++) {
        await sleep(500);
        try {
            const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list', { signal: AbortSignal.timeout(2000) })).json();
            const pages = list.filter(function (t) { return t.type === 'page'; });
            if (pages.length) return pages[0].webSocketDebuggerUrl;
        } catch (e) { /* wait */ }
    }
    throw new Error('浏览器启动超时');
}

async function main() {
    const args = process.argv.slice(2);
    const checkOnly = args.indexOf('--check') >= 0;
    const cpp = args.filter(function (a) { return a !== '--check'; })[0];
    if (checkOnly) {
        out({ ok: !!findBrowser(), platform: '', browser: findBrowser(), profile: PROFILE, message: findBrowser() ? '浏览器可用' : '没有找到 Edge/Chrome' });
        return 0;
    }
    if (!cpp) { out({ ok: false, message: 'usage: node tools/browser-submit.js <problem.cpp>' }); return 0; }
    const cppPath = path.resolve(ROOT, cpp);
    if (!fs.existsSync(cppPath)) { out({ ok: false, message: '找不到文件：' + cppPath }); return 0; }
    const meta = findMeta(cppPath);
    if (!meta) { out({ ok: false, message: '缺少题目元数据（同目录 .json 或 .cph）' }); return 0; }
    const target = parseTarget(meta);
    if (!target) { out({ ok: false, platform: '', message: '浏览器自动提交暂只支持 Codeforces / AtCoder' }); return 0; }
    const code = fs.readFileSync(cppPath, 'utf8');
    let page = null;
    try {
        const ws = await ensureBrowser(target.submitUrl);
        page = await cdpConnect(ws);
        await page.send('Page.enable');
        await page.send('Runtime.enable');
        try { await page.send('Page.bringToFront'); } catch (e) { /* ignore */ }
        // 等待页面（可能刚打开/Cloudflare）
        await sleep(2500);
        const href = await evaluate(page, 'location.href');
        if (!href || !/codeforces\.com|atcoder\.jp/i.test(String(href))) {
            try { await page.send('Page.navigate', { url: target.submitUrl }); } catch (e) { /* ignore */ }
            await sleep(2500);
        }
        let fill = null;
        if (target.platform === 'codeforces') {
            fill = await evaluate(page, '(function(){var ta=document.querySelector("textarea[name=source]")||document.querySelector("#source");if(!ta)return {ok:false,reason:"no source textarea"};var setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set;setter.call(ta,' + JSON.stringify(code) + ');ta.dispatchEvent(new Event("input",{bubbles:true}));var sel=document.querySelector("select[name=programTypeId]")||document.querySelector("#programTypeId");var lang="";if(sel){var opt=Array.prototype.slice.call(sel.options).filter(function(o){return /GNU G\\+\\+23|G\\+\\+23|G\\+\\+20|G\\+\\+17/.test(o.text);})[0];if(!opt)opt=Array.prototype.slice.call(sel.options).filter(function(o){return /GNU G\\+\\+/.test(o.text);})[0];if(opt){sel.value=opt.value;sel.dispatchEvent(new Event("change",{bubbles:true}));lang=opt.text;}}return {ok:true,lang:lang};})()');
        } else {
            fill = await evaluate(page, '(function(){var ta=document.querySelector("textarea[name=sourceCode]")||document.querySelector("#sourceCode")||document.querySelector("textarea");if(!ta)return {ok:false,reason:"no source textarea"};var setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set;setter.call(ta,' + JSON.stringify(code) + ');ta.dispatchEvent(new Event("input",{bubbles:true}));var sel=document.querySelector("select[name=\\"data.LanguageId\\"]")||document.querySelector("select");var lang="";if(sel){var opt=Array.prototype.slice.call(sel.options).filter(function(o){return /C\\+\\+23|C\\+\\+20|C\\+\\+17|GCC/.test(o.text);})[0];if(opt){sel.value=opt.value;sel.dispatchEvent(new Event("change",{bubbles:true}));lang=opt.text;}}return {ok:true,lang:lang};})()');
        }
        if (!fill || !fill.ok) {
            out({ ok: false, platform: target.platform, needLogin: true, message: '浏览器页面没有提交表单（可能未登录或 Cloudflare 未通过）：在打开的浏览器窗口登录后重试' });
            return 0;
        }
        let clicked = false;
        if (target.platform === 'codeforces') {
            clicked = await evaluate(page, '(function(){var b=Array.prototype.slice.call(document.querySelectorAll("input[type=submit],button[type=submit]")).filter(function(x){return /submit/i.test(x.value||x.textContent||"");})[0];if(!b)return false;b.click();return true;})()');
        } else {
            clicked = await evaluate(page, '(function(){var b=Array.prototype.slice.call(document.querySelectorAll("button[type=submit],input[type=submit]")).filter(function(x){return /submit|提出/i.test(x.value||x.textContent||"");})[0];if(!b)return false;b.click();return true;})()');
        }
        if (!clicked) {
            out({ ok: false, platform: target.platform, message: '代码已填入，但没有找到提交按钮；请手动点击提交' });
            return 0;
        }
        await sleep(4000);
        const after = await evaluate(page, 'location.href');
        const body = await evaluate(page, 'document.body ? document.body.innerText.slice(0,2000) : ""');
        const ok = /\/my|submissions\/me/i.test(String(after || '')) || /submitted|Submitted|提出/i.test(String(body || ''));
        out({
            ok: ok,
            platform: target.platform,
            submissionUrl: after || target.submitUrl,
            message: ok ? ('已提交（语言 ' + (fill.lang || '自动') + '）') : '已点击提交，但未确认成功；请在浏览器里查看结果'
        });
        return 0;
    } catch (e) {
        out({ ok: false, platform: target.platform, message: '浏览器提交失败：' + String(e && e.message ? e.message : e) });
        return 0;
    } finally {
        if (page) page.close();
    }
}

main().then(function (code) { process.exit(code || 0); }, function (e) {
    out({ ok: false, message: '浏览器提交异常：' + String(e && e.message ? e.message : e) });
    process.exit(1);
});
