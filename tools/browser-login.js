#!/usr/bin/env node
'use strict';

/*
 * tools/browser-login.js
 * 用本机 Edge/Chrome 的独立 profile 打开 OJ 登录页，登录态保存在
 * training/browser-profile/（gitignored），供后续浏览器自动提交复用。
 *
 *   node tools/browser-login.js <loginUrl>
 *   node tools/browser-login.js --check
 *
 * 输出 JSON。浏览器窗口会保持打开，用户自行登录。
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PROFILE = path.join(ROOT, 'training', 'browser-profile');
const BROWSERS = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

function findBrowser() {
    for (let i = 0; i < BROWSERS.length; i++) {
        if (fs.existsSync(BROWSERS[i])) return BROWSERS[i];
    }
    return '';
}

function out(obj) {
    console.log(JSON.stringify(obj));
}

const args = process.argv.slice(2);
if (args[0] === '--check') {
    out({ ok: !!findBrowser(), browser: findBrowser(), profile: PROFILE });
    process.exit(0);
}
const url = String(args[0] || '').trim();
if (!/^https?:\/\//i.test(url)) {
    out({ ok: false, message: 'usage: node tools/browser-login.js <loginUrl>' });
    process.exit(0);
}
const browser = findBrowser();
if (!browser) {
    out({ ok: false, message: '没有找到 Edge/Chrome' });
    process.exit(0);
}
try { fs.mkdirSync(PROFILE, { recursive: true }); } catch (e) { /* ignore */ }
try {
    const child = spawn(browser, [
        '--user-data-dir=' + PROFILE,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-blink-features=AutomationControlled',
        url
    ], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    out({ ok: true, browser: browser, profile: PROFILE, url: url, message: '浏览器已打开，请在里面登录' });
} catch (e) {
    out({ ok: false, message: '启动浏览器失败：' + String(e && e.message ? e.message : e) });
}
process.exit(0);
