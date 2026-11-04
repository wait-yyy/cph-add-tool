#!/usr/bin/env node
'use strict';

/*
 * tools/submit.js
 * 把当前题目的源码提交到对应 OJ（需要该平台已保存的登录 Cookie）。
 *
 *   node tools/submit.js <problem.cpp> [--dry-run] [--lang=<id>]
 *
 * 输出最后一行 JSON：
 *   { ok, platform, needLogin, url, submissionUrl, message, language, cookieFile }
 *
 * 支持：Codeforces（正赛/Gym）、洛谷、AtCoder。
 * 牛客暂不支持自动提交（接口不稳定），会返回 needLogin=false, ok=false 的说明。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const COOKIE_FILES = {
    codeforces: path.join(ROOT, 'training', 'cf-cookies.txt'),
    luogu: path.join(ROOT, 'training', 'cookies.luogu.txt'),
    atcoder: path.join(ROOT, 'training', 'cookies.atcoder.txt'),
    nowcoder: path.join(ROOT, 'training', 'cookies.nowcoder.txt')
};

function out(obj) {
    console.log(JSON.stringify(obj));
}

function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function readCookie(platform) {
    try { return String(fs.readFileSync(COOKIE_FILES[platform], 'utf8')).trim(); } catch (e) { return ''; }
}

function findMeta(cpp) {
    const dir = path.dirname(cpp);
    const stem = path.basename(cpp).replace(/\.(cpp|cc|cxx)$/i, '');
    const data = readJson(path.join(dir, stem + '.json'));
    if (data && data.url) {
        return { data: data, url: String(data.url), platform: String(data.platform || '') };
    }
    // fallback: legacy CPH cache (contains url)
    const cphDir = path.join(dir, '.cph');
    if (fs.existsSync(cphDir)) {
        const files = fs.readdirSync(cphDir).filter(function (f) {
            return f.indexOf('.' + path.basename(cpp) + '_') === 0 && /\.prob$/i.test(f);
        });
        for (let i = 0; i < files.length; i++) {
            const prob = readJson(path.join(cphDir, files[i]));
            if (prob && prob.url) return { data: prob, url: String(prob.url), platform: '' };
        }
    }
    return null;
}

function detectPlatform(meta, cpp) {
    const url = meta ? meta.url : '';
    if (/codeforces\.com/i.test(url)) return 'codeforces';
    if (/luogu\.com\.cn/i.test(url)) return 'luogu';
    if (/atcoder\.jp/i.test(url)) return 'atcoder';
    if (/nowcoder\.com/i.test(url)) return 'nowcoder';
    const p = cpp.replace(/\\/g, '/').toLowerCase();
    if (p.indexOf('/codeforces/') >= 0) return 'codeforces';
    if (p.indexOf('/luogu/') >= 0) return 'luogu';
    if (p.indexOf('/atcoder/') >= 0) return 'atcoder';
    if (p.indexOf('/nowcoder/') >= 0) return 'nowcoder';
    return '';
}

function curl(args) {
    const base = ['-sL', '--max-time', '35', '-A', UA];
    const r = spawnSync('curl.exe', base.concat(args), {
        encoding: 'utf8',
        timeout: 40000,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024
    });
    let body = r.stdout == null ? '' : String(r.stdout);
    let status = r.status;
    const m = /::HTTP::(\d+)\s*$/.exec(body);
    if (m) {
        status = Number(m[1]);
        body = body.slice(0, m.index);
    }
    return { code: status, body: body, stderr: r.stderr == null ? '' : String(r.stderr) };
}

function cookieArgs(cookie) {
    return ['-H', 'Cookie: ' + cookie];
}

function pick(re, text) {
    const m = re.exec(text);
    return m ? String(m[1]).trim() : '';
}

function extractCppLanguages(html) {
    const list = [];
    const re = /<option\s+value="(\d+)"[^>]*>([^<]+)<\/option>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        const text = String(m[2]).replace(/\s+/g, ' ').trim();
        if (/GNU G\+\+|C\+\+|c\+\+/i.test(text)) {
            list.push({ id: m[1], text: text });
        }
    }
    return list;
}

function chooseLanguage(list, preferred) {
    if (preferred) {
        const exact = list.filter(function (x) { return x.id === String(preferred); })[0];
        if (exact) return exact;
    }
    const order = ['G++23', 'G++20', 'G++17', 'C++23', 'C++20', 'C++17', 'C++14', 'C++'];
    for (let i = 0; i < order.length; i++) {
        const hit = list.filter(function (x) { return x.text.indexOf(order[i]) >= 0; })[0];
        if (hit) return hit;
    }
    return list[0] || null;
}

function submitLuogu(cpp, meta, code, cookie, opts) {
    const pid = pick(/\/problem\/([A-Za-z0-9_]+)/, meta.url);
    if (!pid) return { ok: false, message: '无法从 URL 解析洛谷题号：' + meta.url };
    const page = curl(cookieArgs(cookie).concat([meta.url, '-w', '\n::HTTP::%{http_code}']));
    let html = page.body;
    let csrf = pick(/<meta\s+name="csrf-token"\s+content="([^"]+)"/i, html);
    if (!csrf) {
        return { ok: false, needLogin: true, message: '洛谷 Cookie 无效或已过期（无法获取 csrf token）' };
    }
    const lang = opts.lang ? String(opts.lang) : '11'; // Luogu 常用 C++14 提交语言 id；可用 --lang 覆盖
    if (opts.dryRun) {
        return { ok: true, dryRun: true, message: 'dry-run：将提交到洛谷 ' + pid + '，lang=' + lang };
    }
    const payload = JSON.stringify({ code: code, lang: Number(lang), enableO2: 1 });
    const post = curl(cookieArgs(cookie).concat([
        '-H', 'Content-Type: application/json',
        '-H', 'x-csrf-token: ' + csrf,
        '-H', 'x-luogu-type: content-only',
        '-H', 'Origin: https://www.luogu.com.cn',
        '-H', 'Referer: ' + meta.url,
        '--data-binary', payload,
        'https://www.luogu.com.cn/fe/api/problem/submit/' + pid,
        '-w', '\n::HTTP::%{http_code}'
    ]));
    const bodyText = String(post.body || '').trim();
    let data = null;
    try { data = JSON.parse(bodyText); } catch (e) { data = null; }
    if (!data) {
        return { ok: false, needLogin: true, message: '洛谷提交失败：返回非 JSON（Cookie 可能失效）' };
    }
    if (data.code === 200 && data.data && data.data.rid) {
        const rid = data.data.rid;
        return {
            ok: true,
            submissionUrl: 'https://www.luogu.com.cn/record/' + rid,
            message: '已提交洛谷，评测记录 #' + rid
        };
    }
    return { ok: false, message: '洛谷提交失败：' + (data.errorMessage || data.message || JSON.stringify(data).slice(0, 200)) };
}

function submitCodeforces(cpp, meta, code, cookie, opts) {
    const m = /codeforces\.com\/(contest|gym)\/(\d+)\/problem\/([A-Za-z0-9]+)/.exec(meta.url);
    if (!m) return { ok: false, message: '无法解析 Codeforces 比赛/题号：' + meta.url };
    const kind = m[1];
    const contestId = m[2];
    const index = m[3];
    const base = 'https://codeforces.com/' + kind + '/' + contestId;
    const submitPage = curl(cookieArgs(cookie).concat([base + '/submit', '-w', '\n::HTTP::%{http_code}']));
    const csrf = pick(/name="csrf_token"\s+value="([^"]+)"/i, submitPage.body);
    if (!csrf) return { ok: false, needLogin: true, message: 'Codeforces Cookie 无效或已过期（无法获取 csrf_token）' };
    const languages = extractCppLanguages(submitPage.body);
    const lang = chooseLanguage(languages, opts.lang);
    if (!lang) return { ok: false, message: '没有在提交页找到 C++ 语言选项' };
    if (opts.dryRun) {
        return { ok: true, dryRun: true, message: 'dry-run：将提交到 Codeforces ' + contestId + index + '，语言 ' + lang.text + '（id=' + lang.id + '）' };
    }
    const post = curl(cookieArgs(cookie).concat([
        '-H', 'Origin: https://codeforces.com',
        '-H', 'Referer: ' + base + '/submit',
        '--data-urlencode', 'csrf_token=' + csrf,
        '--data-urlencode', 'action=submitSolutionFormSubmitted',
        '--data-urlencode', 'submittedProblemIndex=' + index,
        '--data-urlencode', 'programTypeId=' + lang.id,
        '--data-urlencode', 'tabSize=4',
        '--data-urlencode', 'source=' + code,
        base + '/submit?submittedProblemIndex=' + index,
        '-w', '\n::HTTP::%{http_code}'
    ]));
    const ok = /submitted successfully|Submitted|my submissions|status page/i.test(post.body) && post.code < 500;
    if (ok) {
        return {
            ok: true,
            submissionUrl: base + '/my',
            message: '已提交 Codeforces ' + contestId + index + '，语言 ' + lang.text
        };
    }
    const needLogin = /Please login|not logged|Sign In/i.test(post.body);
    return { ok: false, needLogin: needLogin, message: 'Codeforces 提交失败：' + (needLogin ? 'Cookie 失效' : '页面未返回成功信息（可能被 Cloudflare 拦截）') };
}

function submitAtcoder(cpp, meta, code, cookie, opts) {
    const m = /atcoder\.jp\/contests\/([^/]+)\/tasks\/([^/?#]+)/.exec(meta.url);
    if (!m) return { ok: false, message: '无法解析 AtCoder 比赛/任务：' + meta.url };
    const contest = m[1];
    const task = m[2];
    const base = 'https://atcoder.jp/contests/' + contest + '/tasks/' + task;
    const page = curl(cookieArgs(cookie).concat([base, '-w', '\n::HTTP::%{http_code}']));
    const csrf = pick(/var\s+csrfToken\s*=\s*"([^"]+)"/i, page.body) || pick(/name="csrf_token"\s+value="([^"]+)"/i, page.body);
    if (!csrf) return { ok: false, needLogin: true, message: 'AtCoder Cookie 无效或已过期（无法获取 csrf token）' };
    const languages = extractCppLanguages(page.body);
    const lang = chooseLanguage(languages, opts.lang);
    if (!lang) return { ok: false, message: '没有在 AtCoder 提交页找到 C++ 语言选项' };
    if (opts.dryRun) {
        return { ok: true, dryRun: true, message: 'dry-run：将提交到 AtCoder ' + contest + ' / ' + task + '，语言 ' + lang.text + '（id=' + lang.id + '）' };
    }
    const post = curl(cookieArgs(cookie).concat([
        '-H', 'Origin: https://atcoder.jp',
        '-H', 'Referer: ' + base,
        '--data-urlencode', 'csrf_token=' + csrf,
        '--data-urlencode', 'data.TaskScreenName=' + task,
        '--data-urlencode', 'data.LanguageId=' + lang.id,
        '--data-urlencode', 'sourceCode=' + code,
        'https://atcoder.jp/contests/' + contest + '/tasks/' + task + '/submit',
        '-w', '\n::HTTP::%{http_code}'
    ]));
    const ok = /Submitted|提出|submissions\/me|提出一覧/i.test(post.body) && post.code < 500;
    if (ok) {
        const sid = pick(/submissions\/(\d+)/, post.body);
        return {
            ok: true,
            submissionUrl: sid ? ('https://atcoder.jp/contests/' + contest + '/submissions/' + sid) : ('https://atcoder.jp/contests/' + contest + '/submissions/me'),
            message: '已提交 AtCoder ' + contest + ' / ' + task + '，语言 ' + lang.text
        };
    }
    return { ok: false, needLogin: /Sign In|Login/i.test(post.body), message: 'AtCoder 提交失败（Cookie 失效或页面结构变化）' };
}

function main() {
    const argv = process.argv.slice(2);
    const opts = { dryRun: argv.indexOf('--dry-run') >= 0, lang: '' };
    let cppArg = '';
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--dry-run') continue;
        if (argv[i].indexOf('--lang=') === 0) { opts.lang = argv[i].slice(7); continue; }
        if (!cppArg) cppArg = argv[i];
    }
    if (!cppArg) {
        out({ ok: false, message: 'usage: node tools/submit.js <problem.cpp> [--dry-run] [--lang=<id>]' });
        return 0;
    }
    const cpp = path.resolve(ROOT, cppArg);
    if (!fs.existsSync(cpp)) {
        out({ ok: false, message: '找不到文件：' + cpp });
        return 0;
    }
    const meta = findMeta(cpp);
    if (!meta) {
        out({ ok: false, message: '找不到题目元数据（同目录 <题号>.json 或 .cph 缓存），无法确定提交地址' });
        return 0;
    }
    const platform = detectPlatform(meta, cpp);
    const info = {
        ok: false,
        platform: platform,
        needLogin: false,
        url: meta.url,
        cookieFile: COOKIE_FILES[platform] || '',
        language: ''
    };
    if (!platform) {
        out(Object.assign(info, { message: '无法识别该题属于哪个 OJ：' + meta.url }));
        return 0;
    }
    if (platform === 'nowcoder') {
        out(Object.assign(info, { message: '牛客暂不支持自动提交（登录/提交接口不稳定），请到牛客网页手动提交' }));
        return 0;
    }
    const cookie = readCookie(platform);
    info.cookieFile = COOKIE_FILES[platform];
    if (!cookie) {
        out(Object.assign(info, { needLogin: true, message: '还没有保存 ' + platform + ' 的登录 Cookie，请先在面板「账号登录」登录' }));
        return 0;
    }
    const code = fs.readFileSync(cpp, 'utf8');
    try {
        let result;
        if (platform === 'luogu') result = submitLuogu(cpp, meta, code, cookie, opts);
        else if (platform === 'codeforces') result = submitCodeforces(cpp, meta, code, cookie, opts);
        else result = submitAtcoder(cpp, meta, code, cookie, opts);
        out(Object.assign(info, result));
    } catch (e) {
        out(Object.assign(info, { message: '提交异常：' + String(e && e.message ? e.message : e) }));
    }
    return 0;
}

process.exit(main());
