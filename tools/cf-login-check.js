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

function fetchApi() {
    const args = [
        '-sS', '--max-time', '25', '--compressed',
        '-A', UA,
        '-H', 'Accept: application/json,text/plain,*/*',
        '-H', 'Cookie: ' + auth.readCookie(),
        'https://codeforces.com/api/contest.standings?contestId=106648'
    ];
    return execFileSync('curl.exe', args, { maxBuffer: 30 * 1024 * 1024, timeout: 30000, windowsHide: true }).toString('utf8');
}

function readSavedHandle() {
    try {
        return String(fs.readFileSync(path.join(path.dirname(auth.COOKIE_FILE), 'cf-handle.txt'), 'utf8')).trim();
    } catch (e) {
        return '';
    }
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
    handle = (m1 && m1[1]) || (m2 && m2[1]) || '';
} catch (e) {
    // settings 页被 Cloudflare 拦截时，改用需要登录的 Gym API 验证
}

if (!handle) {
    try {
        const data = JSON.parse(fetchApi());
        if (data && data.status === 'OK') {
            handle = readSavedHandle();
            console.log('OK handle=' + handle);
            process.exit(0);
        }
    } catch (e) {
        // ignore, fall through
    }
    console.error('登录检查失败：Cookie 无效/已过期，或 Cloudflare 拦截（需包含 cf_clearance，并与浏览器 User-Agent 一致）。');
    process.exit(1);
}
console.log('OK handle=' + handle);
