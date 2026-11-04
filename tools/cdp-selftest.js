#!/usr/bin/env node
'use strict';

/*
 * tools/cdp-selftest.js
 * 用 headless Edge/Chrome 验证浏览器自动提交所依赖的 CDP 能力：
 * 连接浏览器 → 打开本地表单 → 填 textarea/选语言 → 点击提交 → 检查结果。
 * 不访问 OJ、不登录、不会真的提交。
 *
 *   node tools/cdp-selftest.js
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PROFILE = path.join(ROOT, '.build', 'cdp-selftest-profile');
const PORT = 9335;
const BROWSERS = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

function findBrowser() {
    for (let i = 0; i < BROWSERS.length; i++) if (fs.existsSync(BROWSERS[i])) return BROWSERS[i];
    return '';
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function cdp(wsUrl) {
    const ws = new WebSocket(wsUrl);
    let id = 1;
    const pending = new Map();
    ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) {
            const p = pending.get(m.id);
            pending.delete(m.id);
            if (m.error) p.reject(new Error(JSON.stringify(m.error)));
            else p.resolve(m.result);
        }
    };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
    return {
        send: (method, params) => new Promise((res, rej) => {
            const n = id++;
            pending.set(n, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id: n, method, params: params || {} }));
        }),
        close: () => { try { ws.close(); } catch (e) {} }
    };
}

(async function () {
    const browser = findBrowser();
    if (!browser) {
        console.log(JSON.stringify({ ok: false, message: '没有找到 Edge/Chrome' }));
        process.exit(0);
    }
    let proc = null;
    let page = null;
    try {
        fs.rmSync(PROFILE, { recursive: true, force: true });
        proc = spawn(browser, [
            '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
            '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, 'about:blank'
        ], { stdio: 'ignore', windowsHide: true });
        let wsUrl = '';
        for (let i = 0; i < 30; i++) {
            await sleep(400);
            try {
                const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list', { signal: AbortSignal.timeout(1500) })).json();
                const pages = list.filter(t => t.type === 'page');
                if (pages.length) { wsUrl = pages[0].webSocketDebuggerUrl; break; }
            } catch (e) {}
        }
        if (!wsUrl) throw new Error('CDP 启动超时');
        page = await cdp(wsUrl);
        await page.send('Page.enable');
        await page.send('Runtime.enable');
        const html = '<html><body>' +
            '<textarea name="source"></textarea>' +
            '<select name="programTypeId"><option value="54">GNU G++17</option><option value="89">GNU G++23</option></select>' +
            '<button type="submit" id="go" onclick="window.__submitted=true;document.title=\'submitted\'">Submit</button>' +
            '</body></html>';
        await page.send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) });
        await sleep(800);
        const fill = await page.send('Runtime.evaluate', {
            expression: '(function(){var ta=document.querySelector("textarea[name=source]");if(!ta)return false;var s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set;s.call(ta,"#include <bits/stdc++.h>\\nint main(){}");ta.dispatchEvent(new Event("input",{bubbles:true}));var sel=document.querySelector("select[name=programTypeId]");if(sel){var o=Array.prototype.slice.call(sel.options).filter(function(x){return /G\\+\\+23/.test(x.text);})[0];if(o){sel.value=o.value;sel.dispatchEvent(new Event("change",{bubbles:true}));}}var b=document.querySelector("button[type=submit]");if(!b)return false;b.click();return true;})()',
            returnByValue: true
        });
        await sleep(500);
        const check = await page.send('Runtime.evaluate', {
            expression: '({submitted: !!window.__submitted, title: document.title, lang: (document.querySelector("select[name=programTypeId]")||{}).value || ""})',
            returnByValue: true
        });
        const value = check && check.result ? check.result.value : null;
        const ok = !!(fill && fill.result && fill.result.value && value && value.submitted);
        console.log(JSON.stringify({ ok: ok, submitted: value && value.submitted, title: value && value.title, lang: value && value.lang }));
        try { await page.send('Browser.close'); } catch (e) {}
        process.exit(0);
    } catch (e) {
        console.log(JSON.stringify({ ok: false, message: String(e && e.message ? e.message : e) }));
        try { if (proc) proc.kill(); } catch (e2) {}
        process.exit(0);
    }
})();
