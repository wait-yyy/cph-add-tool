#!/usr/bin/env node
'use strict';

/*
 * tools/account-login.js
 * 读取本地保存的 Cookie，检查各平台登录状态并尽量解析昵称。
 *
 *   node tools/account-login.js <codeforces|luogu|nowcoder|atcoder>
 *
 * 输出一行 JSON：
 *   { platform, ok, nickname, detail, cookieFile }
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const PLATFORMS = {
    codeforces: {
        label: 'Codeforces',
        cookie: path.join(ROOT, 'training', 'cf-cookies.txt'),
        loginUrl: 'https://codeforces.com/enter'
    },
    luogu: {
        label: '洛谷',
        cookie: path.join(ROOT, 'training', 'cookies.luogu.txt'),
        loginUrl: 'https://www.luogu.com.cn/auth/login'
    },
    nowcoder: {
        label: '牛客',
        cookie: path.join(ROOT, 'training', 'cookies.nowcoder.txt'),
        loginUrl: 'https://ac.nowcoder.com/login'
    },
    atcoder: {
        label: 'AtCoder',
        cookie: path.join(ROOT, 'training', 'cookies.atcoder.txt'),
        loginUrl: 'https://atcoder.jp/login'
    }
};

function out(obj) {
    console.log(JSON.stringify(obj));
}

function readCookie(cfg) {
    try {
        let text = String(fs.readFileSync(cfg.cookie, 'utf8')).trim();
        if (/\bcurl(\.exe)?\b/i.test(text) || /(?:^|\s)-H\s/.test(text) || /(?:^|\s)-b\s/.test(text)) {
            const m1 = /(?:-H|--header)\s+['"]cookie:\s*([^'"]+)['"]/i.exec(text);
            const m2 = /(?:^|\s)-b\s+['"]([^'"]+)['"]/i.exec(text);
            if (m1) text = m1[1];
            else if (m2) text = m2[1];
        }
        return text
            .replace(/\r?\n/g, ' ')
            .replace(/^\s*Cookie:\s*/i, '')
            .trim();
    } catch (e) {
        return '';
    }
}

function curl(url, cookie) {
    const args = [
        '-sL', '--max-time', '25', '-A', UA,
        '-H', 'Cookie: ' + cookie,
        url
    ];
    const r = spawnSync('curl.exe', args, {
        encoding: 'utf8',
        timeout: 30000,
        windowsHide: true,
        maxBuffer: 24 * 1024 * 1024
    });
    return {
        code: r.status,
        body: r.stdout == null ? '' : String(r.stdout),
        err: r.stderr == null ? '' : String(r.stderr)
    };
}

function pick(re, text) {
    const m = re.exec(text);
    return m ? String(m[1]).trim() : '';
}

function jwtNickname(cookie) {
    const parts = String(cookie || '').split(';');
    for (let i = 0; i < parts.length; i++) {
        const v = parts[i].split('=').slice(1).join('=').trim();
        const seg = v.split('.');
        if (seg.length < 2) continue;
        try {
            let payload = seg[1].replace(/-/g, '+').replace(/_/g, '/');
            while (payload.length % 4) payload += '=';
            const data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
            const n = data.nickname || data.userName || data.username || data.name || data.handle;
            if (n) return String(n);
        } catch (e) { /* ignore */ }
    }
    return '';
}

function checkCodeforces(cookie) {
    const r = spawnSync('node', [path.join(ROOT, 'tools', 'cf-login-check.js')], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 30000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024
    });
    const stdout = String(r.stdout || '');
    const stderr = String(r.stderr || '');
    const m = /OK handle=([^\r\n]+)/.exec(stdout);
    if (r.status === 0 && m) {
        return { ok: true, nickname: m[1].trim(), detail: 'Cookie 有效' };
    }
    return { ok: false, nickname: '', detail: (stderr.trim().split(/\r?\n/)[0] || 'Cookie 无效或已过期') };
}

function checkLuogu(cookie) {
    const uid = pick(/(?:^|;\s*)_uid=(\d+)/, cookie);
    if (!uid) return { ok: false, nickname: '', detail: 'Cookie 里没有 _uid' };
    const page = curl('https://www.luogu.com.cn/user/' + uid, cookie);
    if (!page.body) return { ok: false, nickname: '', detail: page.err || '请求失败' };
    if (/登录|login/i.test(page.body) && !/user-name|data-name="[^"]+"/i.test(page.body)) {
        return { ok: false, nickname: '', detail: 'Cookie 无效或已过期' };
    }
    let nickname = '';
    nickname = pick(/class="[^"]*user-name[^"]*"[^>]*>([^<]+)</i, page.body) ||
        pick(/data-name="([^"]+)"/i, page.body) ||
        pick(/<h1[^>]*class="[^"]*(?:name|username)[^"]*"[^>]*>([^<]+)</i, page.body) ||
        jwtNickname(cookie);
    return { ok: true, nickname: nickname, detail: '已登录洛谷' };
}

function checkNowcoder(cookie) {
    const page = curl('https://ac.nowcoder.com/acm/user/home', cookie);
    if (!page.body) return { ok: false, nickname: '', detail: page.err || '请求失败' };
    if (/class="nav-account-login"|请先登录|立即登录/.test(page.body)) {
        return { ok: false, nickname: '', detail: 'Cookie 无效或已过期' };
    }
    let nickname = pick(/nickname["']?\s*[:=]\s*["']([^"']+)/i, page.body) ||
        pick(/userName["']?\s*[:=]\s*["']([^"']+)/i, page.body) ||
        pick(/class="[^"]*user-name[^"]*"[^>]*>([^<]+)</i, page.body) ||
        jwtNickname(cookie);
    return { ok: true, nickname: nickname, detail: '已登录牛客' };
}

function checkAtcoder(cookie) {
    const page = curl('https://atcoder.jp/settings', cookie);
    if (!page.body) return { ok: false, nickname: '', detail: page.err || '请求失败' };
    if (/Sign In|name="csrf_token"|name="password"/.test(page.body) && !/name="username"[^>]*value="[^"]+"/.test(page.body)) {
        return { ok: false, nickname: '', detail: 'Cookie 无效或已过期' };
    }
    const nickname = pick(/name="username"[^>]*value="([^"]+)"/i, page.body) ||
        pick(/id="username"[^>]*value="([^"]+)"/i, page.body) ||
        pick(/Username<\/td>\s*<td[^>]*>\s*([^<]+)/i, page.body);
    return { ok: true, nickname: nickname, detail: '已登录 AtCoder' };
}

function main() {
    const platform = String(process.argv[2] || '').toLowerCase();
    const cfg = PLATFORMS[platform];
    if (!cfg) {
        out({ platform: platform, ok: false, nickname: '', detail: '不支持的平台', cookieFile: '' });
        return 0;
    }
    const cookie = readCookie(cfg);
    if (!cookie) {
        out({ platform: platform, ok: false, nickname: '', detail: '还没有保存 ' + cfg.label + ' Cookie', cookieFile: cfg.cookie });
        return 0;
    }
    let result;
    try {
        if (platform === 'codeforces') result = checkCodeforces(cookie);
        else if (platform === 'luogu') result = checkLuogu(cookie);
        else if (platform === 'nowcoder') result = checkNowcoder(cookie);
        else result = checkAtcoder(cookie);
    } catch (e) {
        result = { ok: false, nickname: '', detail: String(e && e.message ? e.message : e) };
    }
    out({
        platform: platform,
        ok: !!result.ok,
        nickname: result.nickname || '',
        detail: result.detail || '',
        cookieFile: cfg.cookie
    });
    return 0;
}

process.exit(main());
