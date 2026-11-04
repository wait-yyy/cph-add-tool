#!/usr/bin/env node
'use strict';

/*
 * tools/cf-ac.js
 * 查询 Codeforces 同一道题其他人的 AC 提交（公开 API，无需登录）。
 *
 *   node tools/cf-ac.js <problem.cpp>
 *
 * 输出 JSON：{ ok, contestId, index, title, handles:[{handle,submissionId,time,language}] }
 *
 * 注意：CF 不公开提交源码，只能拿到提交记录页链接；源码需要登录后在浏览器打开。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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

function curl(url) {
    const r = spawnSync('curl.exe', ['-s', '--max-time', '40', '-A', UA, url], {
        encoding: 'utf8',
        timeout: 45000,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024
    });
    return r.stdout == null ? '' : String(r.stdout);
}

function main() {
    const cpp = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : '';
    if (!cpp || !fs.existsSync(cpp)) {
        console.log(JSON.stringify({ ok: false, message: 'usage: node tools/cf-ac.js <problem.cpp>' }));
        return 0;
    }
    const meta = findMeta(cpp);
    if (!meta || !/codeforces\.com/i.test(String(meta.url || ''))) {
        console.log(JSON.stringify({ ok: false, message: '不是 Codeforces 题目（或缺少 <题号>.json / .cph 元数据）' }));
        return 0;
    }
    const m = /codeforces\.com\/(?:contest|gym)\/(\d+)\/problem\/([A-Za-z0-9]+)/i.exec(String(meta.url));
    if (!m) {
        console.log(JSON.stringify({ ok: false, message: '无法从 URL 解析比赛/题号：' + meta.url }));
        return 0;
    }
    const contestId = m[1];
    const index = m[2];
    const gym = /codeforces\.com\/gym\//i.test(String(meta.url));
    const api = 'https://codeforces.com/api/contest.status?contestId=' + contestId + '&from=1&count=10000';
    let data = null;
    try {
        data = JSON.parse(curl(api));
    } catch (e) {
        console.log(JSON.stringify({ ok: false, message: 'CF API 请求失败：' + String(e && e.message ? e.message : e) }));
        return 0;
    }
    if (!data || data.status !== 'OK' || !Array.isArray(data.result)) {
        console.log(JSON.stringify({ ok: false, message: 'CF API 返回错误：' + ((data && data.comment) || 'unknown') }));
        return 0;
    }
    const seen = Object.create(null);
    const rows = [];
    data.result.forEach(function (s) {
        try {
            if (!s || !s.problem || String(s.problem.index) !== String(index)) return;
            if (s.verdict !== 'OK') return;
            const handle = s.author && s.author.members && s.author.members[0] ? s.author.members[0].handle : '';
            if (!handle || seen[handle]) return;
            seen[handle] = true;
            rows.push({
                handle: handle,
                submissionId: s.id,
                time: s.creationTimeSeconds,
                language: s.programmingLanguage || ''
            });
        } catch (e) { /* ignore */ }
    });
    rows.sort(function (a, b) { return a.time - b.time; });
    console.log(JSON.stringify({
        ok: true,
        contestId: contestId,
        gym: gym,
        index: String(index),
        title: String(meta.title || (meta.name || '')),
        count: rows.length,
        handles: rows.slice(0, 50)
    }));
    return 0;
}

process.exit(main());
