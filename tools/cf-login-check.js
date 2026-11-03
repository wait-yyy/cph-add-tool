#!/usr/bin/env node
'use strict';

/*
 * tools/cf-login-check.js
 * Verify the locally stored Codeforces Cookie (training/cf-cookies.txt) by
 * requesting the settings page and extracting the handle.
 *
 * Exit codes: 0 = logged in, 1 = request failed / not logged in, 2 = no cookie.
 */

const { execFileSync } = require('child_process');
const auth = require('./_cf_auth.js');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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

try {
    const html = fetchPage('https://codeforces.com/settings/general');
    const m1 = /handle\s*=\s*"([^"]+)"/i.exec(html);
    const m2 = /href="\/profile\/([A-Za-z0-9_.\-]+)"/i.exec(html);
    const handle = (m1 && m1[1]) || (m2 && m2[1]) || '';
    if (!handle) {
        console.error('请求成功，但没有解析到登录 handle（Cookie 可能不完整或已过期）。');
        process.exit(1);
    }
    console.log('OK handle=' + handle);
} catch (e) {
    const msg = String(e && e.message ? e.message : e).split(/\r?\n/)[0];
    console.error('登录检查失败：' + msg);
    console.error('常见原因：Cookie 不完整/已过期、Cloudflare 拦截（复制时请包含 cf_clearance 等全部 Cookie）。');
    process.exit(1);
}
