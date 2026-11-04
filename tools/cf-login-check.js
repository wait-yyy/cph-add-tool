#!/usr/bin/env node
'use strict';

/*
 * tools/cf-login-check.js
 * Verify the locally stored Codeforces Cookie (training/cf-cookies.txt) by
 * requesting the settings page and extracting the handle.
 *
 * Exit codes: 0 = logged in, 1 = request failed / not logged in, 2 = no cookie.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const auth = require('./_cf_auth.js');

const UA = auth.getUserAgent();

function fetchPage(url) {
    const args = [
        '-sSL', '-f', '--max-time', '25', '--compressed',
        '-A', UA,
        '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        '-H', 'Accept-Language: en-US,en;q=0.9',
        '-H', 'Cookie: ' + auth.readCookie(),
        url
    ];
    return execFileSync('curl.exe', args, { maxBuffer: 30 * 1024 * 1024, timeout: 30000, windowsHide: true }).toString('utf8');
}

const cookie = auth.readCookie();
if (!cookie) {
    console.error('未配置 Codeforces Cookie：' + auth.COOKIE_FILE);
    console.error('先在浏览器登录 codeforces.com，复制 Cookie 请求头，再用面板「设置 CF 登录 Cookie」。');
    process.exit(2);
}

let handle = '';
try {
    const html = fetchPage('https://codeforces.com/settings/general');
    const m1 = /handle\s*=\s*"([^"]+)"/i.exec(html);
    const m2 = /href="\/profile\/([A-Za-z0-9_.\-]+)"/i.exec(html);
    const handle = (m1 && m1[1]) || (m2 && m2[1]) || '';
    if (!handle) {
        console.error('请求成功，但没有解析到登录 handle（Cookie 可能不完整）。');
        process.exit(1);
    }
    console.log('OK handle=' + handle);
} catch (e) {
    const detail = String((e && e.stderr) || (e && e.message) || e);
    if (/403|Just a moment|challenge/i.test(detail)) {
        console.error('Cloudflare 403：Codeforces 对脚本请求启用了 JS 挑战，这不是账号/Cookie 错误。浏览器能打开，但 curl 被拦截。');
    } else {
        console.error('登录检查失败：' + detail.split(/\r?\n/)[0]);
    }
    process.exit(1);
}
