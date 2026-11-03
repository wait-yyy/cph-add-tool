#!/usr/bin/env node
'use strict';

/*
 * tools/pull-contest.js
 * Pull a whole contest (all problems) from AtCoder / 洛谷 / 牛客 (Nowcoder):
 *   - fetch each statement -> <题号>.md (bilingual when English)
 *   - create <题号>.cpp from new.cpp (unless --no-cpp)
 *   - create CPH sample cache .cph/.<name>_<md5>.prob so CPH / cp.ps1 samples work
 *
 * Usage:
 *   node tools/pull-contest.js <contestUrl> [--out=<dir>] [--only=A,B] [--force]
 *                              [--template=<cpp>] [--single] [--no-cpp] [--no-translate] [--no-ai]
 *
 * Examples:
 *   node tools/pull-contest.js https://atcoder.jp/contests/abc402
 *   node tools/pull-contest.js https://www.luogu.com.cn/contest/251050
 *   node tools/pull-contest.js https://ac.nowcoder.com/acm/contest/85333
 *
 * Supported URL shapes:
 *   Codeforces /contest/<id>               or /gym/<id>（单题可加 /problem/<index>）
 *   AtCoder  /contests/<contest>            (tasks page) or .../tasks/<taskId>
 *   洛谷      /contest/<id>                  or /problem/<pid>
 *   牛客      /acm/contest/<id>              or /acm/problem/<id>
 *
 * Exit codes: 0 = at least one problem pulled, 1 = all failed / bad input.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const cfAuth = require('./_cf_auth.js');

const ROOT = path.resolve(__dirname, '..');
const STATEMENT = path.join(__dirname, 'cph-statement.js');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const IS_WIN = process.platform === 'win32';

function usage() {
    console.log('usage: node tools/pull-contest.js <contestUrl> [--out=<dir>] [--only=A,B] [--force] [--template=<cpp>] [--single] [--no-cpp] [--no-translate] [--no-ai]');
    console.log('  Codeforces: https://codeforces.com/contest/2278');
    console.log('  AtCoder : https://atcoder.jp/contests/abc402');
    console.log('  洛谷    : https://www.luogu.com.cn/contest/251050');
    console.log('  牛客    : https://ac.nowcoder.com/acm/contest/85333');
}

function parseArgs(argv) {
    const flags = { only: [] };
    const pos = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.indexOf('--out=') === 0) flags.out = a.slice(6);
        else if (a.indexOf('--only=') === 0) flags.only = a.slice(7).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        else if (a.indexOf('--template=') === 0) flags.template = a.slice(11);
        else if (a === '--force') flags.force = true;
        else if (a === '--single') flags.single = true;
        else if (a === '--no-cpp') flags.noCpp = true;
        else if (a === '--no-translate') flags.noTranslate = true;
        else if (a === '--no-ai') flags.noAi = true;
        else if (a.indexOf('--') === 0) { /* ignore unknown */ }
        else pos.push(a);
    }
    return { flags: flags, pos: pos };
}

function curlGet(url, opts) {
    opts = opts || {};
    const args = ['-sSL', '--max-time', String(opts.timeout || 30), '--compressed', '-A', UA,
        '-H', 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8'];
    if (opts.jar) args.push('-c', opts.jar, '-b', opts.jar);
    if (opts.referer) args.push('-H', 'Referer: ' + opts.referer);
    const cookie = cfAuth.readCookie();
    if (cookie && cfAuth.isCfUrl(url)) args.push('-H', 'Cookie: ' + cookie);
    if (!opts.allowError) args.push('-f');
    args.push(url);
    const out = execFileSync(IS_WIN ? 'curl.exe' : 'curl', args, {
        maxBuffer: 40 * 1024 * 1024,
        timeout: (opts.timeout || 30) * 1000 + 5000,
        windowsHide: true
    });
    const text = out.toString('utf8');
    if (!text || text.length < 100) throw new Error('empty response: ' + url);
    return text;
}

function decodeEntities(s) {
    return String(s || '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

function cleanInline(html) {
    return decodeEntities(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function readLentille(html) {
    const m = /<script id="lentille-context"[^>]*>([\s\S]*?)<\/script>/.exec(html);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (e) { return null; }
}

// Optional local settings: training/pull-config.json (gitignored), e.g.
//   { "template": "templates/new.cpp" }
function loadPullConfig() {
    try {
        const file = path.join(ROOT, 'training', 'pull-config.json');
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch (e) { /* ignore */ }
    return {};
}

function detect(url) {
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    const host = u.hostname.toLowerCase();
    const p = u.pathname;
    let m;
    if (/(^|\.)codeforces\.com$/.test(host)) {
        m = /\/problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/.exec(p);
        if (m) return { platform: 'codeforces', contestId: m[1], singleIndex: m[2], isGym: false, isSingle: true };
        m = /\/contest\/(\d+)/.exec(p) || /\/gym\/(\d+)/.exec(p);
        if (!m) return null;
        const isGym = /\/gym\//.test(p);
        const tm = /\/problem\/([A-Za-z0-9]+)/.exec(p);
        return { platform: 'codeforces', contestId: m[1], isGym: isGym, singleIndex: tm ? tm[1] : '', isSingle: !!tm };
    }
    if (/(^|\.)atcoder\.jp$/.test(host)) {
        m = /\/contests\/([^/?#]+)/.exec(p);
        if (!m) return null;
        const tm = /\/tasks\/([^/?#]+)/.exec(p);
        return { platform: 'atcoder', contest: m[1], singleTask: tm ? tm[1] : '', isSingle: !!tm };
    }
    if (/(^|\.)luogu\.com(\.cn)?$/.test(host)) {
        m = /\/contest\/(\d+)/.exec(p);
        if (m) return { platform: 'luogu', contestId: m[1] };
        m = /\/problem\/([A-Za-z0-9_]+)/.exec(p);
        if (m) return { platform: 'luogu', singlePid: m[1], isSingle: true };
        return null;
    }
    if (/(^|\.)nowcoder\.com$/.test(host)) {
        m = /\/acm\/contest\/(\d+)/.exec(p);
        if (m) return { platform: 'nowcoder', contestId: m[1] };
        m = /\/acm\/problem\/(\d+)/.exec(p);
        if (m) return { platform: 'nowcoder', singleProblem: m[1], isSingle: true };
        return null;
    }
    return null;
}

function filterOnly(problems, only) {
    if (!only || !only.length) return problems;
    return problems.filter(function (p) {
        return only.some(function (o) {
            const up = String(o).toUpperCase();
            const low = String(o).toLowerCase();
            if (String(p.base).toUpperCase() === up) return true;
            if (String(p.base).toLowerCase() === low) return true;
            if (String(p.base).toLowerCase().endsWith('_' + low)) return true;
            // Codeforces: base = <contestId><index>, allow --only=A / --only=A1
            const cm = /^\d+([A-Z]\d*)$/.exec(String(p.base).toUpperCase());
            return !!cm && cm[1] === up;
        });
    });
}

function enumerateAtCoder(info, flags) {
    const key = info.contest;
    const tasksUrl = 'https://atcoder.jp/contests/' + key + '/tasks';
    const html = curlGet(tasksUrl);
    const titleM = /<title>([\s\S]*?)<\/title>/i.exec(html);
    let group = titleM ? cleanInline(titleM[1]) : '';
    group = group.replace(/^Tasks\s*-\s*/i, '').replace(/\s*-\s*AtCoder\s*$/i, '').trim();
    const re = new RegExp('/contests/' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/tasks/([A-Za-z0-9_]+)', 'g');
    const ids = [];
    let m;
    while ((m = re.exec(html)) !== null) {
        if (ids.indexOf(m[1]) < 0) ids.push(m[1]);
    }
    let problems = ids.map(function (id) {
        return { base: id, url: 'https://atcoder.jp/contests/' + key + '/tasks/' + id, name: id };
    });
    if (info.singleTask) {
        problems = problems.filter(function (p) { return p.base === info.singleTask; });
        if (!problems.length) problems = [{ base: info.singleTask, url: 'https://atcoder.jp/contests/' + key + '/tasks/' + info.singleTask, name: info.singleTask }];
    }
    return { group: group, folder: 'atcoder/' + key, problems: problems };
}

function enumerateLuogu(info) {
    if (info.singlePid) {
        return {
            group: '洛谷',
            folder: 'luogu/' + info.singlePid,
            problems: [{ base: info.singlePid, url: 'https://www.luogu.com.cn/problem/' + info.singlePid, name: info.singlePid }]
        };
    }
    const jar = path.join(ROOT, '.build', 'pull-luogu-' + process.pid + '.txt');
    try { fs.mkdirSync(path.dirname(jar), { recursive: true }); } catch (e) { /* ignore */ }
    curlGet('https://www.luogu.com.cn/', { jar: jar });
    const html = curlGet('https://www.luogu.com.cn/contest/' + info.contestId, { jar: jar, referer: 'https://www.luogu.com.cn/' });
    const j = readLentille(html);
    const d = (j && j.data) || {};
    if (!Array.isArray(d.contestProblems) || !d.contestProblems.length) {
        throw new Error('洛谷比赛页面没有题目列表（比赛未开始、未公开或需要登录）');
    }
    const group = (d.contest && d.contest.name) ? String(d.contest.name) : ('洛谷比赛 ' + info.contestId);
    const problems = d.contestProblems.map(function (x) {
        const pid = String(x.problem.pid);
        // Contest problems (e.g. T* language-contest pids) need the contestId
        // query parameter; without it Luogu answers 401 to anonymous requests.
        return {
            base: pid,
            url: 'https://www.luogu.com.cn/problem/' + pid + '?contestId=' + info.contestId,
            name: x.problem.name || pid
        };
    });
    return { group: group, folder: 'luogu/contest' + info.contestId, problems: problems };
}

function enumerateNowcoder(info, flags) {
    if (info.singleProblem) {
        return {
            group: '牛客',
            folder: 'nowcoder/problem' + info.singleProblem,
            problems: [{ base: 'problem' + info.singleProblem, url: 'https://ac.nowcoder.com/acm/problem/' + info.singleProblem, name: 'problem' + info.singleProblem }]
        };
    }
    const letters = null;
    const out = [];
    let group = '';
    let invalidRun = 0;
    for (let i = 0; i < 26; i++) {
        const L = String.fromCharCode(65 + i);
        if (letters && letters.indexOf(L) < 0) continue;
        if (!letters && flags.only.length && !flags.only.some(function (o) { return o.toUpperCase() === L; })) continue;
        let html = '';
        try {
            html = curlGet('https://ac.nowcoder.com/acm/contest/' + info.contestId + '/' + L, { timeout: 25 });
        } catch (e) {
            invalidRun++;
            if (!letters && invalidRun >= 2) break;
            continue;
        }
        const titleM = /<title>([\s\S]*?)<\/title>/i.exec(html);
        const rawTitle = cleanInline(titleM ? titleM[1] : '');
        const ok = /subject-question/.test(html) && new RegExp('^' + L + '\\s*-').test(rawTitle);
        if (ok) {
            invalidRun = 0;
            out.push({ base: L, url: 'https://ac.nowcoder.com/acm/contest/' + info.contestId + '/' + L, name: rawTitle });
            if (!group) {
                const gm = /^[A-Z]\s*-\s*[^_]+_([\s\S]+)$/.exec(rawTitle);
                group = gm ? gm[1].trim() : '';
            }
        } else {
            invalidRun++;
            if (!letters && invalidRun >= 2) break;
        }
    }
    if (!out.length) throw new Error('牛客比赛中没有找到题目（编号不对、比赛未开始或已删除）');
    return { group: group || ('牛客比赛 ' + info.contestId), folder: 'nowcoder/contest' + info.contestId, problems: out };
}

/* ---------- Codeforces ---------- */

// Mirror the CPH patch's folder naming so pulled files land in the same folder
// that the patched CPH extension would use for the same contest.
function codeforcesFolder(contestName, contestId, isGym) {
    if (isGym) return 'codeforces/gym' + contestId;
    const g = String(contestName || '');
    let m = /Codeforces Round (\d+)/.exec(g) || /Round (\d+)/.exec(g);
    if (m) {
        let c = m[1];
        const ds = [];
        const re = /Div\. ?(\d+)/g;
        let x;
        while ((x = re.exec(g)) !== null) {
            if (ds.indexOf(x[1]) < 0) ds.push(x[1]);
        }
        if (/Educational/i.test(g)) c = 'edu' + c;
        else if (/Global Round/i.test(g)) c = 'global' + c;
        if (ds.length) c += ' div' + ds.join('+');
        return 'codeforces/' + c;
    }
    return 'codeforces/contest' + contestId;
}

function enumerateGymFromPage(id) {
    const html = curlGet('https://codeforces.com/gym/' + id, { timeout: 40 });
    const titleM = /<title>([\s\S]*?)<\/title>/i.exec(html);
    const title = titleM ? cleanInline(titleM[1]) : ('Gym ' + id);
    const re = new RegExp('/gym/' + id + '/problem/([A-Za-z0-9]+)', 'g');
    const idxs = [];
    let m;
    while ((m = re.exec(html)) !== null) {
        if (idxs.indexOf(m[1]) < 0) idxs.push(m[1]);
    }
    if (!idxs.length) {
        throw new Error('页面里没有解析到题目列表（Cookie 可能无效/未报名该 gym）');
    }
    return {
        group: 'Codeforces - ' + title,
        folder: 'codeforces/gym' + id,
        problems: idxs.map(function (idx) {
            return {
                base: id + idx,
                url: 'https://codeforces.com/gym/' + id + '/problem/' + idx,
                name: idx,
                index: idx
            };
        })
    };
}

function enumerateCodeforces(info, flags) {
    const id = String(info.contestId);
    // Single Gym problem: no API needed; statement fetch will use the saved Cookie.
    if (info.isGym && info.singleIndex) {
        const idx = String(info.singleIndex);
        return {
            group: 'Codeforces - Gym ' + id,
            folder: 'codeforces/gym' + id,
            problems: [{
                base: id + idx,
                url: 'https://codeforces.com/gym/' + id + '/problem/' + idx,
                name: idx,
                index: idx
            }]
        };
    }
    // Anonymous requests must not add from/count (CF rejects them with 400),
    // so this returns the full standings payload (a few MB, cached by curl).
    const api = 'https://codeforces.com/api/contest.standings?contestId=' + id;
    let data = null;
    try {
        data = JSON.parse(curlGet(api, { timeout: 60, allowError: true }));
    } catch (e) {
        throw new Error('Codeforces API 请求失败：' + e.message);
    }
    if (!data || data.status !== 'OK' || !data.result) {
        const msg = (data && data.comment) || 'unknown';
        if (info.isGym) {
            try {
                return enumerateGymFromPage(id);
            } catch (e2) {
                throw new Error('CF Gym/私有比赛无法访问：' + msg + ' / ' + e2.message +
                    '。请先在面板「设置 CF 登录 Cookie」，并确认已报名该 gym。');
            }
        }
        throw new Error('Codeforces API 返回错误：' + msg);
    }
    const contest = data.result.contest || {};
    const name = String(contest.name || ('Contest ' + id));
    const folder = codeforcesFolder(name, id, info.isGym);
    const baseDir = info.isGym
        ? ('https://codeforces.com/gym/' + id)
        : ('https://codeforces.com/contest/' + id);
    let problems = (data.result.problems || []).map(function (p) {
        const idx = String(p.index);
        return { base: id + idx, url: baseDir + '/problem/' + idx, name: p.name || idx, index: idx };
    });
    if (info.singleIndex) {
        const want = String(info.singleIndex).toUpperCase();
        problems = problems.filter(function (p) { return p.index.toUpperCase() === want; });
        if (!problems.length) {
            problems = [{
                base: id + info.singleIndex,
                url: baseDir + '/problem/' + info.singleIndex,
                name: String(info.singleIndex),
                index: String(info.singleIndex)
            }];
        }
    }
    return { group: 'Codeforces - ' + name, folder: folder, problems: problems };
}

function writeCphCache(outDir, cppPath, samplesFile, fallbackGroup, fallbackUrl) {
    let data = null;
    try { data = JSON.parse(fs.readFileSync(samplesFile, 'utf8')); } catch (e) { return false; }
    const name = path.basename(cppPath);
    const cphDir = path.join(outDir, '.cph');
    fs.mkdirSync(cphDir, { recursive: true });
    const tests = (data.tests || []).map(function (t, i) {
        return {
            id: Date.now() + i * 7 + Math.floor(Math.random() * 1000),
            input: String(t.input == null ? '' : t.input),
            output: String(t.output == null ? '' : t.output)
        };
    });
    const variants = [cppPath, cppPath.replace(/^([A-Za-z]):/, function (m) { return m.toLowerCase(); })];
    variants.forEach(function (srcPath) {
        const hash = crypto.createHash('md5').update(srcPath).digest('hex');
        const prob = {
            name: data.title || name.replace(/\.cpp$/i, ''),
            group: data.group || fallbackGroup || '',
            url: data.url || fallbackUrl || '',
            interactive: false,
            memoryLimit: Number(data.memoryLimitMb) || 256,
            timeLimit: Number(data.timeLimitMs) || 2000,
            tests: tests,
            testType: 'single',
            input: { type: 'stdin' },
            output: { type: 'stdout' },
            batch: { id: crypto.randomUUID ? crypto.randomUUID() : ('b' + Date.now()), size: 1 },
            srcPath: srcPath
        };
        fs.writeFileSync(path.join(cphDir, '.' + name + '_' + hash + '.prob'), JSON.stringify(prob), 'utf8');
    });
    return true;
}

function main() {
    const parsed = parseArgs(process.argv.slice(2));
    const url = parsed.pos[0];
    if (!url) { usage(); return 2; }
    const info = detect(url);
    if (!info) {
        console.error('无法识别比赛链接（支持 Codeforces / AtCoder / 洛谷 / 牛客）: ' + url);
        return 2;
    }
    if (parsed.flags.single && !info.isSingle) {
        console.error('这是整场比赛链接；抓取单个题目请用题目链接，或改用「抓取整场比赛」。');
        return 2;
    }

    let meta;
    try {
        if (info.platform === 'codeforces') meta = enumerateCodeforces(info, parsed.flags);
        else if (info.platform === 'atcoder') meta = enumerateAtCoder(info, parsed.flags);
        else if (info.platform === 'luogu') meta = enumerateLuogu(info, parsed.flags);
        else meta = enumerateNowcoder(info, parsed.flags);
    } catch (e) {
        console.error('enumerate failed: ' + e.message);
        return 1;
    }
    meta.problems = filterOnly(meta.problems, parsed.flags.only);
    if (!meta.problems.length) {
        console.error('没有匹配的题目（检查 --only / 比赛链接）');
        return 1;
    }

    const outDir = parsed.flags.out ? path.resolve(parsed.flags.out) : path.join(ROOT, meta.folder);
    fs.mkdirSync(outDir, { recursive: true });
    console.log('PLATFORM ' + info.platform);
    console.log('FOLDER   ' + outDir);
    console.log('GROUP    ' + (meta.group || ''));
    console.log('PROBLEMS ' + meta.problems.length);

    let created = 0;
    let skipped = 0;
    let failed = 0;
    const pullCfg = loadPullConfig();
    let template = parsed.flags.template || pullCfg.template || 'new.cpp';
    template = path.resolve(ROOT, template);
    if (!parsed.flags.noCpp && !fs.existsSync(template)) {
        console.error('模板不存在: ' + template + '（用 --template 或 training/pull-config.json 设置）');
        return 1;
    }
    console.log('TEMPLATE ' + (parsed.flags.noCpp ? '（不创建 cpp）' : template));
    const tpl = template;

    meta.problems.forEach(function (p) {
        const cppPath = path.join(outDir, p.base + '.cpp');
        const mdPath = path.join(outDir, p.base + '.md');
        if (fs.existsSync(mdPath) && !parsed.flags.force) {
            console.log('SKIP     ' + p.base + ' (md exists, use --force to refresh)');
            if (!parsed.flags.noCpp && !fs.existsSync(cppPath) && fs.existsSync(tpl)) {
                fs.copyFileSync(tpl, cppPath);
                console.log('  (created missing ' + p.base + '.cpp)');
            }
            skipped++;
            return;
        }
        if (!parsed.flags.noCpp && !fs.existsSync(cppPath)) {
            if (fs.existsSync(tpl)) {
                fs.copyFileSync(tpl, cppPath);
            } else {
                console.error('WARN     模板不存在，cpp 未创建: ' + p.base);
            }
        }
        const samplesTmp = path.join(ROOT, '.build', 'pull-samples-' + process.pid + '-' + p.base + '.json');
        const childArgs = [STATEMENT, p.url, mdPath, '', meta.group || '', '', '', cppPath, '--force'];
        if (parsed.flags.noTranslate) childArgs.push('--no-translate');
        if (parsed.flags.noAi) childArgs.push('--no-ai');
        childArgs.push('--samples-out=' + samplesTmp);
        console.log('PULL     ' + p.base + '  ' + p.url);
        const r = spawnSync(process.execPath, childArgs, {
            cwd: ROOT,
            encoding: 'utf8',
            timeout: 300000,
            windowsHide: true
        });
        const outText = (r.stdout || '').trim();
        if (outText) outText.split(/\r?\n/).forEach(function (l) { if (l.trim()) console.log('  ' + l.trim()); });
        if (r.status !== 0) {
            const errText = (r.stderr || '').trim();
            if (errText) errText.split(/\r?\n/).forEach(function (l) { if (l.trim()) console.error('  ' + l.trim()); });
            failed++;
            console.error('FAIL     ' + p.base);
            try { fs.unlinkSync(samplesTmp); } catch (e) { /* ignore */ }
            return;
        }
        try {
            if (fs.existsSync(samplesTmp)) {
                const data = JSON.parse(fs.readFileSync(samplesTmp, 'utf8'));
                data.platform = info.platform;
                data.statement = p.base + '.md';
                data.cpp = parsed.flags.noCpp ? '' : (p.base + '.cpp');
                data.data = p.base + '.json';
                if (!data.group) data.group = meta.group || '';
                fs.writeFileSync(path.join(outDir, p.base + '.json'), JSON.stringify(data, null, 2) + '\n', 'utf8');
                console.log('  DATA JSON written');
            }
        } catch (e) {
            console.error('  WARN data json failed: ' + e.message);
        }
        if (!parsed.flags.noCpp && fs.existsSync(cppPath)) {
            try {
                const ok = writeCphCache(outDir, cppPath, samplesTmp, meta.group, p.url);
                if (ok) console.log('  CPH CACHE written');
            } catch (e) {
                console.error('  WARN cph cache failed: ' + e.message);
            }
        }
        try { fs.unlinkSync(samplesTmp); } catch (e) { /* ignore */ }
        created++;
    });

    if (parsed.flags.single) {
        const p = meta.problems[0];
        const singleCpp = path.join(outDir, p.base + '.cpp');
        const singleMd = path.join(outDir, p.base + '.md');
        if (created > 0 && fs.existsSync(singleMd)) {
            console.log('SINGLE ' + p.base + '|' + singleCpp + '|' + singleMd);
        }
    } else {
        try {
            const summary = {
                platform: info.platform,
                source: url,
                name: meta.group || '',
                folder: outDir,
                template: parsed.flags.noCpp ? '' : template,
                generatedAt: new Date().toISOString(),
                problemCount: meta.problems.length,
                problems: meta.problems.map(function (p) {
                    return {
                        base: p.base,
                        name: p.name || '',
                        url: p.url,
                        md: p.base + '.md',
                        cpp: parsed.flags.noCpp ? '' : (p.base + '.cpp'),
                        data: p.base + '.json'
                    };
                })
            };
            fs.writeFileSync(path.join(outDir, 'contest.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
            console.log('CONTEST JSON ' + path.join(outDir, 'contest.json'));
        } catch (e) {
            console.error('WARN contest json failed: ' + e.message);
        }
    }

    console.log('DONE created=' + created + ' skipped=' + skipped + ' failed=' + failed);
    return (created === 0 && failed > 0) ? 1 : 0;
}

process.exit(main());
