'use strict';

/*
 * tools/companion-data.js
 * 把 Competitive Companion 发来的题目 JSON 写成工作区文件。
 * 不依赖 vscode，便于单独测试；由 VS Code 插件的本地 HTTP 接收器调用。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function safeName(value, fallback) {
    const text = String(value == null ? '' : value)
        .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
    return text || fallback || 'problem';
}

function parseTarget(data) {
    const url = String(data && data.url ? data.url : '');
    const group = safeName(data && data.group, 'Companion');
    let m;
    m = /codeforces\.com\/(gym|contest)\/(\d+)\/problem\/([A-Za-z0-9]+)/i.exec(url);
    if (m) {
        const kind = m[1].toLowerCase();
        const contestId = m[2];
        const index = m[3];
        return {
            platform: 'codeforces',
            folder: kind === 'gym' ? path.join('codeforces', 'gym' + contestId) : path.join('codeforces', safeName(group, 'contest' + contestId)),
            base: contestId + index
        };
    }
    m = /atcoder\.jp\/contests\/([^/?#]+)\/tasks\/([^/?#]+)/i.exec(url);
    if (m) {
        return {
            platform: 'atcoder',
            folder: path.join('atcoder', safeName(m[1], 'contest')),
            base: safeName(m[2], 'task')
        };
    }
    m = /luogu\.com\.cn\/problem\/([A-Za-z0-9_]+)/i.exec(url);
    if (m) {
        const cid = /[?&]contestId=(\d+)/i.exec(url);
        return {
            platform: 'luogu',
            folder: cid ? path.join('luogu', 'contest' + cid[1]) : path.join('luogu', 'companion'),
            base: safeName(m[1], 'problem')
        };
    }
    m = /nowcoder\.com\/acm\/contest\/(\d+)\/([A-Za-z0-9]+)/i.exec(url);
    if (m) {
        return {
            platform: 'nowcoder',
            folder: path.join('nowcoder', 'contest' + m[1]),
            base: m[1] + safeName(m[2], 'A')
        };
    }
    return {
        platform: 'other',
        folder: path.join('companion', group),
        base: safeName(data && data.name, 'problem')
    };
}

function normalizeTests(data) {
    const list = Array.isArray(data && data.tests) ? data.tests : [];
    return list.map(function (t) {
        return {
            input: String(t && t.input != null ? t.input : ''),
            output: String(t && t.output != null ? t.output : '')
        };
    });
}

function readTemplate(root) {
    try {
        const file = path.join(root, 'new.cpp');
        if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
    } catch (e) { /* ignore */ }
    return [
        '#include <bits/stdc++.h>',
        'using namespace std;',
        '',
        'int main() {',
        '    ios::sync_with_stdio(false);',
        '    cin.tie(nullptr);',
        '    return 0;',
        '}',
        ''
    ].join('\n');
}

function writeCompanionProblem(data, root) {
    if (!root) throw new Error('没有打开工作区');
    const target = parseTarget(data || {});
    const folder = path.join(root, target.folder);
    fs.mkdirSync(folder, { recursive: true });
    const base = target.base;
    const cppPath = path.join(folder, base + '.cpp');
    const jsonPath = path.join(folder, base + '.json');
    const mdPath = path.join(folder, base + '.md');
    const tests = normalizeTests(data);
    const title = String(data && data.name ? data.name : base);
    const url = String(data && data.url ? data.url : '');
    const group = String(data && data.group ? data.group : '');
    const timeLimitMs = Number(data && data.timeLimit ? data.timeLimit : 2000) || 2000;
    const memoryLimitMb = Number(data && data.memoryLimit ? data.memoryLimit : 256) || 256;

    let createdCpp = false;
    if (!fs.existsSync(cppPath)) {
        fs.writeFileSync(cppPath, readTemplate(root), 'utf8');
        createdCpp = true;
    }

    fs.writeFileSync(jsonPath, JSON.stringify({
        title: title,
        url: url,
        group: group,
        platform: target.platform,
        timeLimitMs: timeLimitMs,
        memoryLimitMb: memoryLimitMb,
        tests: tests
    }, null, 2) + '\n', 'utf8');

    if (!fs.existsSync(mdPath)) {
        let md = '# ' + title + '\n\n';
        md += '- **比赛**: ' + group + '\n';
        md += '- **链接**: ' + url + '\n';
        md += '- **限制**: ' + (timeLimitMs / 1000) + ' s / ' + memoryLimitMb + ' MB\n';
        md += '- **来源**: Competitive Companion（浏览器解析，无 Cookie）\n\n';
        if (tests.length) {
            md += '## 样例\n\n';
            tests.forEach(function (t, i) {
                md += '### 样例 #' + (i + 1) + '\n\n```\n' + t.input + '\n```\n\n';
                md += '### 输出\n\n```\n' + t.output + '\n```\n\n';
            });
        }
        fs.writeFileSync(mdPath, md, 'utf8');
    }

    try {
        const cphDir = path.join(folder, '.cph');
        fs.mkdirSync(cphDir, { recursive: true });
        const md5 = crypto.createHash('md5').update(cppPath).digest('hex');
        const cacheFile = path.join(cphDir, '.' + path.basename(cppPath) + '_' + md5 + '.prob');
        fs.writeFileSync(cacheFile, JSON.stringify({
            name: title,
            group: group,
            url: url,
            interactive: !!(data && data.interactive),
            memoryLimit: memoryLimitMb,
            timeLimit: timeLimitMs,
            tests: tests,
            testType: 'single',
            input: '',
            output: '',
            srcPath: cppPath
        }, null, 2) + '\n', 'utf8');
    } catch (e) { /* cache is optional */ }

    return {
        platform: target.platform,
        folder: folder,
        cppPath: cppPath,
        jsonPath: jsonPath,
        mdPath: mdPath,
        createdCpp: createdCpp,
        tests: tests.length,
        title: title
    };
}

module.exports = {
    writeCompanionProblem: writeCompanionProblem,
    parseTarget: parseTarget
};
