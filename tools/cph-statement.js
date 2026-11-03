#!/usr/bin/env node
'use strict';

/*
 * tools/cph-statement.js
 * Fetch a problem statement and save it as Markdown next to the local source file.
 * English statements are translated to Chinese and saved as bilingual Markdown
 * (English line followed by the Chinese line); code samples are kept as-is.
 *
 * Called by the patched CPH extension right after a problem is pulled from
 * Competitive Companion:
 *   node tools/cph-statement.js <url> <out.md> <name> <group> <timeLimitMs> <memoryLimitMb> <srcPath>
 *
 * Can also be run by hand (e.g. to refresh/backfill):
 *   node tools/cph-statement.js "https://codeforces.com/contest/2278/problem/A" "codeforces/1131 div3/2278A.md"
 *   node tools/cph-statement.js ... --force         # overwrite an existing .md
 *   node tools/cph-statement.js ... --no-translate  # English only (debugging)
 *
 * Supported:
 *   - codeforces.com  (regular contests; GYM pages need login and are skipped)
 *   - atcoder.jp      (English statement)
 *   - luogu.com.cn    (problem pages; Chinese statements are kept as-is)
 *   - nowcoder.com    (acm/contest/<id>/<letter> and acm/problem/<id>; Chinese)
 * Unsupported judges / login walls: no file is written, exit code 1.
 *
 * Extra flags:
 *   --samples-out=<file>  write {title,timeLimitMs,memoryLimitMb,tests:[{input,output}]}
 *                         (used by tools/pull-contest.js to build CPH sample caches)
 *
 * Translation backend: AI first (any OpenAI-compatible API, configured in
 * training/ai-config.json; see tools/_ai.js), Bing web translator as fallback.
 * If translation fails the English statement is still written; errors go to
 * .build/cph-statement.log.
 *
 * Exit codes: 0 = written (or skipped because file exists), 1 = failed/unsupported.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { execFileSync } = require('child_process');
const aiHelper = require('./_ai.js');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const LOG_FILE = path.join(WORKSPACE_ROOT, '.build', 'cph-statement.log');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT_MS = 20000;

let scriptNoAi = false;
let translationBackend = 'Bing';

function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
}

function appendLog(msg) {
    try {
        fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
        fs.appendFileSync(LOG_FILE, '[' + new Date().toISOString() + '] ' + msg + '\n', 'utf8');
    } catch (e) { /* ignore */ }
}

function fetchText(url, redirectsLeft) {
    if (redirectsLeft === undefined) redirectsLeft = 5;
    return new Promise(function (resolve, reject) {
        let u;
        try { u = new URL(url); } catch (e) { return reject(e); }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            return reject(new Error('unsupported protocol: ' + u.protocol));
        }
        const mod = u.protocol === 'http:' ? http : https;
        const req = mod.get(u, {
            headers: {
                'User-Agent': UA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'identity'
            },
            timeout: TIMEOUT_MS
        }, function (res) {
            const code = res.statusCode || 0;
            if (code >= 300 && code < 400 && res.headers.location && redirectsLeft > 0) {
                res.resume();
                let next;
                try { next = new URL(res.headers.location, u).toString(); } catch (e) { return reject(e); }
                return resolve(fetchText(next, redirectsLeft - 1));
            }
            if (code !== 200) {
                res.resume();
                return reject(new Error('HTTP ' + code));
            }
            const chunks = [];
            res.on('data', function (c) { chunks.push(c); });
            res.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
            res.on('error', reject);
        });
        req.on('timeout', function () { req.destroy(new Error('timeout')); });
        req.on('error', reject);
    });
}

function curlFetch(url) {
    const args = [
        '-sSL', '-f', '--max-time', '25', '--compressed',
        '-A', UA,
        '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        '-H', 'Accept-Language: en-US,en;q=0.9',
        url
    ];
    const out = execFileSync('curl.exe', args, { maxBuffer: 30 * 1024 * 1024, timeout: 30000, windowsHide: true });
    const text = out.toString('utf8');
    if (!text || text.length < 200) throw new Error('empty curl response');
    return text;
}

// Luogu needs a cookie (C3VK) from the home page and follows a 302 before it
// serves the real problem page; curl with a cookie jar is the reliable path.
function curlFetchLuogu(url) {
    const jar = path.join(WORKSPACE_ROOT, '.build', 'luogu-cookies-' + process.pid + '.txt');
    try { fs.mkdirSync(path.dirname(jar), { recursive: true }); } catch (e) { /* ignore */ }
    try {
        curlText([
            '-sSL', '--max-time', '25', '--compressed', '-A', UA,
            '-H', 'Accept-Language: zh-CN,zh;q=0.9',
            '-c', jar, '-b', jar,
            'https://www.luogu.com.cn/'
        ]);
    } catch (e) { /* home page cookie is best-effort */ }
    const html = curlText([
        '-sSL', '--max-time', '25', '--compressed', '-A', UA,
        '-H', 'Accept-Language: zh-CN,zh;q=0.9',
        '-H', 'Referer: https://www.luogu.com.cn/',
        '-c', jar, '-b', jar,
        url
    ]);
    if (!/lentille-context/.test(html)) throw new Error('luogu: lentille-context not found (anti-bot page?)');
    return html;
}

async function fetchLuoguPage(url) {
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            return curlFetchLuogu(url);
        } catch (e) {
            lastErr = e;
            await sleep(900 + Math.random() * 800);
        }
    }
    throw lastErr;
}

// Codeforces HTML pages are behind Cloudflare and sometimes answer 403 to
// non-browser clients. Luogu mirrors most public CF problems as CF<contestId><index>,
// so use it as a statement fallback.
function luoguMirrorUrl(url) {
    const m = /\/contest\/(\d+)\/problem\/([A-Za-z0-9]+)/.exec(url) ||
        /\/problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/.exec(url);
    if (!m) return '';
    return 'https://www.luogu.com.cn/problem/CF' + m[1] + m[2];
}

// Codeforces sits behind Cloudflare and returns 403 to Node's TLS fingerprint.
// curl.exe on Windows gets through, so prefer it there and fall back to node https.
async function fetchProblem(url) {
    let lastErr;
    const engines = [];
    if (process.platform === 'win32') engines.push('curl');
    engines.push('https');
    for (let attempt = 0; attempt < 2; attempt++) {
        for (let i = 0; i < engines.length; i++) {
            try {
                if (engines[i] === 'curl') return curlFetch(url);
                return await fetchText(url);
            } catch (e) {
                lastErr = e;
            }
        }
        if (attempt === 0) await sleep(900 + Math.random() * 900);
    }
    throw lastErr;
}

/* ---------- small HTML helpers ---------- */

function stripTags(s) {
    return String(s || '').replace(/<[^>]*>/g, ' ');
}

function stripTagsTight(s) {
    return String(s || '').replace(/<[^>]*>/g, '');
}

function decodeEntities(s) {
    return String(s || '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#x([0-9a-fA-F]+);/g, function (m, h) { return String.fromCodePoint(parseInt(h, 16)); })
        .replace(/&#(\d+);/g, function (m, d) { return String.fromCodePoint(parseInt(d, 10)); })
        .replace(/&amp;/g, '&');
}

function cleanInline(html) {
    return decodeEntities(stripTags(html)).replace(/[ \t\r\n]+/g, ' ').trim();
}

function getAttr(attrs, name) {
    const re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i');
    const m = re.exec(attrs || '');
    if (!m) return '';
    return m[2] !== undefined ? m[2] : m[3];
}

function getClass(attrs) {
    return getAttr(attrs, 'class') || '';
}

function hasClass(attrs, cls) {
    return getClass(attrs).split(/\s+/).indexOf(cls) >= 0;
}

function resolveUrl(u, base) {
    const s = String(u || '').trim();
    if (!s) return '';
    try {
        if (s.indexOf('//') === 0) return 'https:' + s;
        return new URL(s, base).toString();
    } catch (e) {
        return s;
    }
}

/*
 * Find top-level blocks of `<tag ...>inner</tag>` whose attribute list satisfies matcher(attrs).
 * Returns [{start, innerStart, innerEnd, end}] with absolute indices.
 */
function findBlocks(html, tag, matcher) {
    const out = [];
    const openRe = new RegExp('<' + tag + '\\b([^>]*)>', 'gi');
    const walkRe = new RegExp('<' + tag + '\\b[^>]*>|</' + tag + '>', 'gi');
    let m;
    while ((m = openRe.exec(html))) {
        if (!matcher(m[1])) continue;
        const start = m.index;
        const innerStart = openRe.lastIndex;
        let depth = 1;
        let end = -1;
        let innerEnd = -1;
        walkRe.lastIndex = innerStart;
        let mm;
        while ((mm = walkRe.exec(html))) {
            const closing = mm[0].charAt(1) === '/';
            if (closing) depth--; else depth++;
            if (depth === 0) {
                innerEnd = mm.index;
                end = mm.index + mm[0].length;
                break;
            }
        }
        if (end < 0) break;
        out.push({ start: start, innerStart: innerStart, innerEnd: innerEnd, end: end });
        openRe.lastIndex = end;
    }
    return out;
}

/* ---------- HTML -> Markdown ---------- */

function htmlToMd(html, base) {
    let s = String(html || '');
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

    const codes = [];
    s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, function (m, inner) {
        let txt = decodeEntities(stripTagsTight(inner)).replace(/\r\n/g, '\n');
        txt = txt.replace(/[ \t]+$/gm, '').replace(/\n+$/, '').replace(/^\n+/, '');
        const token = '\u0000CODE' + codes.length + '\u0000';
        codes.push('```\n' + txt + '\n```');
        return '\n\n' + token + '\n\n';
    });

    s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, function (m, lvl, inner) {
        return '\n\n' + '#'.repeat(Math.min(3, parseInt(lvl, 10))) + ' ' + cleanInline(inner) + '\n\n';
    });
    s = s.replace(/<div\b[^>]*class="[^"]*section-title[^"]*"[^>]*>([\s\S]*?)<\/div>/gi, function (m, inner) {
        return '\n\n## ' + cleanInline(inner) + '\n\n';
    });

    s = s.replace(/<img\b([^>]*)>/gi, function (m, attrs) {
        const src = getAttr(attrs, 'src');
        if (!src) return '';
        const alt = getAttr(attrs, 'alt') || 'image';
        return '\n\n![' + alt + '](' + resolveUrl(src, base) + ')\n\n';
    });
    s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, function (m, attrs, inner) {
        const href = getAttr(attrs, 'href');
        const text = cleanInline(inner);
        if (!href || !text) return text;
        return '[' + text + '](' + resolveUrl(href, base) + ')';
    });

    s = s.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, function (m, tag, inner) { return '**' + cleanInline(inner) + '**'; });
    s = s.replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, function (m, tag, inner) { return '*' + cleanInline(inner) + '*'; });
    s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, function (m, inner) { return '`' + cleanInline(inner) + '`'; });
    s = s.replace(/<var\b[^>]*>([\s\S]*?)<\/var>/gi, function (m, inner) { return '$' + cleanInline(inner) + '$'; });
    s = s.replace(/<span\b[^>]*class="[^"]*tex-font-style-bf[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, function (m, inner) { return '**' + cleanInline(inner) + '**'; });
    s = s.replace(/<span\b[^>]*class="[^"]*tex-font-style-tt[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, function (m, inner) { return '`' + cleanInline(inner) + '`'; });
    s = s.replace(/<span\b[^>]*class="[^"]*tex-font-style-it[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, function (m, inner) { return '*' + cleanInline(inner) + '*'; });

    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');
    s = s.replace(/<li\b[^>]*>\s*/gi, '\n- ');
    s = s.replace(/<(ul|ol)\b[^>]*>/gi, '\n\n');
    s = s.replace(/<\/(ul|ol)>/gi, '\n\n');
    s = s.replace(/<\/?(p|div|section|article|center|blockquote|table|thead|tbody|tr)\b[^>]*>/gi, '\n\n');
    s = s.replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, '^$1');
    s = s.replace(/<sub\b[^>]*>([\s\S]*?)<\/sub>/gi, '_$1');

    s = stripTags(s);
    s = decodeEntities(s);

    s = s.replace(/\$\$\$\$\$\$/g, '$$');
    s = s.replace(/\$\$\$/g, '$');

    s = s.replace(/\r\n?/g, '\n');
    s = s.replace(/[ \t]{2,}/g, ' ');
    s = s.replace(/(^|\n)-[ \t]+/g, '$1- ');
    let lines = s.split('\n').map(function (line) { return line.replace(/[ \t]+$/, ''); });
    s = lines.join('\n');
    s = s.replace(/\n{3,}/g, '\n\n');
    s = s.trim();

    s = s.replace(/\u0000CODE(\d+)\u0000/g, function (m, i) { return codes[parseInt(i, 10)] || ''; });
    return s.trim();
}

/* ---------- Codeforces ---------- */

function cfPreText(inner) {
    let s = String(inner || '');
    if (/test-example-line/.test(s)) {
        s = s.replace(/<div\b[^>]*class="[^"]*test-example-line[^"]*"[^>]*>([\s\S]*?)<\/div>/gi, function (m, t) {
            return decodeEntities(stripTags(t)) + '\n';
        });
        s = stripTags(s);
    } else {
        s = stripTags(s);
    }
    s = decodeEntities(s).replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n');
    return s.replace(/^\n+/, '').replace(/\n+$/, '');
}

function codeBlock(text) {
    return '```\n' + text + '\n```';
}

function convertCfSamples(html, base) {
    const out = [];
    const titleM = /<div\b[^>]*class="[^"]*section-title[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
    out.push('## ' + (titleM ? cleanInline(titleM[1]) : 'Example'));
    const blocks = findBlocks(html, 'div', function (a) { return hasClass(a, 'sample-test'); });
    const n = blocks.length;
    for (let i = 0; i < n; i++) {
        const b = blocks[i];
        const inner = html.slice(b.innerStart, b.innerEnd);
        const ins = findBlocks(inner, 'div', function (a) { return hasClass(a, 'input'); });
        const outs = findBlocks(inner, 'div', function (a) { return hasClass(a, 'output'); });
        if (ins.length) {
            const pi = /<pre\b[^>]*>([\s\S]*?)<\/pre>/i.exec(inner.slice(ins[0].innerStart, ins[0].innerEnd));
            if (pi) {
                if (n > 1) out.push('**Input ' + (i + 1) + '**');
                else out.push('**Input**');
                out.push(codeBlock(cfPreText(pi[1])));
            }
        }
        if (outs.length) {
            const po = /<pre\b[^>]*>([\s\S]*?)<\/pre>/i.exec(inner.slice(outs[0].innerStart, outs[0].innerEnd));
            if (po) {
                if (n > 1) out.push('**Output ' + (i + 1) + '**');
                else out.push('**Output**');
                out.push(codeBlock(cfPreText(po[1])));
            }
        }
    }
    return out.join('\n\n');
}

function normalizeLimit(s) {
    return String(s || '')
        .replace(/\s+/g, ' ')
        .replace(/(\d+)\s*second(s)?/i, '$1 s')
        .replace(/(\d+)\s*megabyte(s)?/i, '$1 MB')
        .replace(/(\d+)\s*millisecond(s)?/i, '$1 ms')
        .trim();
}

function limitMsFromText(text) {
    const m = /([\d.]+)\s*(ms|milliseconds?|s|sec|seconds?)\b/i.exec(String(text || ''));
    if (!m) return 0;
    const v = parseFloat(m[1]);
    return /^(ms|milli)/i.test(m[2]) ? Math.round(v) : Math.round(v * 1000);
}

function limitMbFromText(text) {
    const m = /([\d.]+)\s*(MB|MiB|megabytes?|GB|GiB|gigabytes?)\b/i.exec(String(text || ''));
    if (!m) return 0;
    const v = parseFloat(m[1]);
    return /^(GB|GiB|giga)/i.test(m[2]) ? Math.round(v * 1024) : Math.round(v);
}

function buildCodeforces(html, meta) {
    const blocks = findBlocks(html, 'div', function (a) { return hasClass(a, 'problem-statement'); });
    if (!blocks.length) return null;
    const st = blocks[0];
    let inner = html.slice(st.innerStart, st.innerEnd);

    let title = meta.name || '';
    let tl = '';
    let ml = '';
    const hb = findBlocks(inner, 'div', function (a) { return hasClass(a, 'header'); });
    if (hb.length) {
        const h = inner.slice(hb[0].innerStart, hb[0].innerEnd);
        const tm = /<div\b[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(h);
        if (tm) title = cleanInline(tm[1]) || title;
        const tlm = /<div\b[^>]*class="[^"]*time-limit[^"]*"[^>]*>[\s\S]*?<div\b[^>]*class="[^"]*property-title[^"]*"[^>]*>[\s\S]*?<\/div>([\s\S]*?)<\/div>/i.exec(h);
        if (tlm) tl = normalizeLimit(decodeEntities(stripTags(tlm[1])));
        const mlm = /<div\b[^>]*class="[^"]*memory-limit[^"]*"[^>]*>[\s\S]*?<div\b[^>]*class="[^"]*property-title[^"]*"[^>]*>[\s\S]*?<\/div>([\s\S]*?)<\/div>/i.exec(h);
        if (mlm) ml = normalizeLimit(decodeEntities(stripTags(mlm[1])));
        inner = inner.slice(0, hb[0].start) + inner.slice(hb[0].end);
    }
    if (!tl && meta.tl) tl = (Number(meta.tl) / 1000) + ' s';
    if (!ml && meta.ml) ml = meta.ml + ' MB';

    const sb = findBlocks(inner, 'div', function (a) { return hasClass(a, 'sample-tests'); });
    let body;
    const samples = [];
    if (sb.length) {
        const b = sb[0];
        const sampleInner = inner.slice(b.innerStart, b.innerEnd);
        body = [
            htmlToMd(inner.slice(0, b.start), meta.url),
            convertCfSamples(sampleInner, meta.url),
            htmlToMd(inner.slice(b.end), meta.url)
        ].filter(function (x) { return x && x.trim(); }).join('\n\n');
        const blocks = findBlocks(sampleInner, 'div', function (a) { return hasClass(a, 'sample-test'); });
        blocks.forEach(function (bb) {
            const bi = sampleInner.slice(bb.innerStart, bb.innerEnd);
            const ins = findBlocks(bi, 'div', function (a) { return hasClass(a, 'input'); });
            const outs = findBlocks(bi, 'div', function (a) { return hasClass(a, 'output'); });
            const inp = ins.length ? (/<pre\b[^>]*>([\s\S]*?)<\/pre>/i.exec(bi.slice(ins[0].innerStart, ins[0].innerEnd))) : null;
            const out = outs.length ? (/<pre\b[^>]*>([\s\S]*?)<\/pre>/i.exec(bi.slice(outs[0].innerStart, outs[0].innerEnd))) : null;
            samples.push({
                input: inp ? cfPreText(inp[1]) : '',
                output: out ? cfPreText(out[1]) : ''
            });
        });
    } else {
        body = htmlToMd(inner, meta.url);
    }
    return {
        title: title,
        limits: [tl, ml].filter(Boolean).join(' / '),
        body: body,
        samples: samples,
        tlMs: Number(meta.tl) || limitMsFromText(tl),
        mlMb: Number(meta.ml) || limitMbFromText(ml),
        group: meta.group || ''
    };
}

/* ---------- AtCoder ---------- */

function buildAtCoder(html, meta) {
    const blocks = findBlocks(html, 'div', function (a) { return getAttr(a, 'id') === 'task-statement'; });
    if (!blocks.length) return null;
    let inner = html.slice(blocks[0].innerStart, blocks[0].innerEnd);
    const en = findBlocks(inner, 'span', function (a) { return hasClass(a, 'lang-en'); });
    if (en.length) inner = inner.slice(en[0].innerStart, en[0].innerEnd);

    let title = meta.name || '';
    const titleM = /<title>([\s\S]*?)<\/title>/i.exec(html);
    if (!title && titleM) title = cleanInline(titleM[1]).replace(/\s*-\s*AtCoder\s*$/i, '');

    let tl = '';
    let ml = '';
    const limitM = /Time Limit:\s*([^/<]+?)\s*\/\s*Memory Limit:\s*([^/<]+?)\s*</i.exec(html);
    if (limitM) {
        tl = normalizeLimit(limitM[1]);
        ml = normalizeLimit(limitM[2]);
    }
    if (!tl && meta.tl) tl = (Number(meta.tl) / 1000) + ' s';
    if (!ml && meta.ml) ml = meta.ml + ' MB';

    let tlMs = Number(meta.tl) || 0;
    let mlMb = Number(meta.ml) || 0;
    if (limitM) {
        const sec = /([\d.]+)\s*(?:sec|second|s)\b/i.exec(limitM[1]);
        if (sec) tlMs = Math.round(parseFloat(sec[1]) * 1000);
        const mem = /([\d.]+)\s*(MB|MiB|GB|GiB)/i.exec(limitM[2]);
        if (mem) {
            const v = parseFloat(mem[1]);
            const unit = mem[2].toUpperCase();
            mlMb = Math.round(unit.indexOf('G') === 0 ? v * 1024 : v);
        }
    }

    const samples = [];
    try {
        const byIdx = {};
        const re = /<h3[^>]*>\s*Sample\s+(Input|Output)\s+(\d+)\s*<\/h3>\s*<pre[^>]*>([\s\S]*?)<\/pre>/gi;
        let sm;
        while ((sm = re.exec(inner)) !== null) {
            const kind = sm[1].toLowerCase();
            const idx = sm[2];
            if (!byIdx[idx]) byIdx[idx] = {};
            byIdx[idx][kind] = decodeEntities(stripTagsTight(sm[3]))
                .replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '');
        }
        Object.keys(byIdx).sort(function (a, b) { return Number(a) - Number(b); }).forEach(function (k) {
            samples.push({ input: byIdx[k].input || '', output: byIdx[k].output || '' });
        });
    } catch (e) { /* samples are best-effort */ }

    return {
        title: title,
        limits: [tl, ml].filter(Boolean).join(' / '),
        body: htmlToMd(inner, meta.url),
        samples: samples,
        tlMs: tlMs,
        mlMb: mlMb,
        group: meta.group || ''
    };
}

/* ---------- Luogu ---------- */

function luoguMarkdown(md, base) {
    let s = String(md || '');
    s = s.replace(/\]\((\/problem\/[^)]+)\)/g, function (m, p) { return '](' + resolveUrl(p, base) + ')'; });
    s = s.replace(/\]\((\/discuss\/[^)]+)\)/g, function (m, p) { return '](' + resolveUrl(p, base) + ')'; });
    s = s.replace(/\]\((\/contest\/[^)]+)\)/g, function (m, p) { return '](' + resolveUrl(p, base) + ')'; });
    return s.trim();
}

function buildLuogu(html, meta) {
    const m = /<script id="lentille-context"[^>]*>([\s\S]*?)<\/script>/.exec(html);
    if (!m) return null;
    let j = null;
    try { j = JSON.parse(m[1]); } catch (e) { return null; }
    const d = (j && j.data) || {};
    const p = d.problem;
    if (!p) return null;
    const contenu = (p.contenu && typeof p.contenu === 'object') ? p.contenu
        : ((p.content && typeof p.content === 'object') ? p.content : {});
    const title = cleanInline(contenu.name || p.name || meta.name || 'Luogu problem');
    const group = meta.group || (d.contest && d.contest.name) || '';
    const tlMs = (p.limits && p.limits.time && Number(p.limits.time[0])) || 0;
    const mlKb = (p.limits && p.limits.memory && Number(p.limits.memory[0])) || 0;
    const mlMb = mlKb ? Math.round(mlKb / 1024) : 0;

    const samples = [];
    if (Array.isArray(p.samples)) {
        p.samples.forEach(function (s) {
            if (Array.isArray(s)) {
                samples.push({ input: String(s[0] == null ? '' : s[0]), output: String(s[1] == null ? '' : s[1]) });
            } else if (s && typeof s === 'object') {
                const v = Array.isArray(s.value) ? s.value : [];
                samples.push({
                    input: String(v[0] != null ? v[0] : (s.input || '')),
                    output: String(v[1] != null ? v[1] : (s.output || ''))
                });
            }
        });
    }

    const parts = [];
    const bg = luoguMarkdown(contenu.background, meta.url);
    if (bg) parts.push('## 题目背景\n\n' + bg);
    const desc = luoguMarkdown(contenu.description, meta.url);
    if (desc) parts.push('## 题目描述\n\n' + desc);
    const fi = luoguMarkdown(contenu.formatI, meta.url);
    if (fi) parts.push('## 输入格式\n\n' + fi);
    const fo = luoguMarkdown(contenu.formatO, meta.url);
    if (fo) parts.push('## 输出格式\n\n' + fo);
    if (samples.length) {
        const lines = [];
        samples.forEach(function (s, i) {
            lines.push(samples.length > 1 ? ('## 样例 #' + (i + 1)) : '## 样例');
            lines.push('### 输入');
            lines.push(codeBlock(String(s.input).replace(/\s+$/, '')));
            lines.push('### 输出');
            lines.push(codeBlock(String(s.output).replace(/\s+$/, '')));
            lines.push('');
        });
        parts.push(lines.join('\n\n').trim());
    }
    const hint = luoguMarkdown(contenu.hint, meta.url);
    if (hint) parts.push('## 提示\n\n' + hint);

    return {
        title: title,
        limits: [tlMs ? (tlMs / 1000) + ' s' : '', mlMb ? mlMb + ' MB' : ''].filter(Boolean).join(' / '),
        body: parts.join('\n\n'),
        samples: samples,
        tlMs: tlMs,
        mlMb: mlMb,
        group: group
    };
}

/* ---------- Nowcoder (牛客) ---------- */

function nowcoderEquationImages(html) {
    return String(html || '').replace(/<img\b([^>]*)>/gi, function (m, attrs) {
        const src = getAttr(attrs, 'src') || '';
        if (!/equation\?tex=/.test(src)) return m;
        let tex = decodeEntities(getAttr(attrs, 'alt') || '');
        if (!tex) {
            try { tex = new URL(src).searchParams.get('tex') || ''; } catch (e) { tex = ''; }
        }
        return tex ? ('$' + tex + '$') : m;
    });
}

function nowcoderMd(html, base) {
    return htmlToMd(nowcoderEquationImages(html), base);
}

function nowcoderLimits(html) {
    const text = decodeEntities(stripTags(html));
    const tm = /时间限制[：:][^0-9]{0,40}?(\d+(?:\.\d+)?)\s*秒/.exec(text);
    const mm = /空间限制[：:][^0-9]{0,40}?(\d+(?:\.\d+)?)\s*([MGT])\s*B?/i.exec(text);
    let tlMs = 0;
    let mlMb = 0;
    if (tm) tlMs = Math.round(parseFloat(tm[1]) * 1000);
    if (mm) {
        const v = parseFloat(mm[1]);
        const unit = mm[2].toUpperCase();
        mlMb = Math.round(unit === 'G' ? v * 1024 : (unit === 'T' ? v * 1024 * 1024 : v));
    }
    return { tlMs: tlMs, mlMb: mlMb };
}

function buildNowcoder(html, meta) {
    const titleM = /<title>([\s\S]*?)<\/title>/i.exec(html);
    const rawTitle = cleanInline(titleM ? titleM[1] : '');
    let title = rawTitle || meta.name || 'Nowcoder problem';
    let group = meta.group || '';
    const tm = /^([A-Za-z]?\d*)\s*-\s*([^_]+)_([\s\S]+)$/.exec(rawTitle);
    if (tm) {
        title = (tm[1] ? tm[1] + '. ' : '') + tm[2].trim();
        group = group || tm[3].trim();
    } else {
        const us = rawTitle.split('_');
        if (us.length > 1) {
            group = group || us.slice(1).join('_').replace(/牛客网.*$/, '').trim();
            title = us[0].trim() || title;
        }
    }

    const limits = nowcoderLimits(html);
    const tlMs = limits.tlMs || Number(meta.tl) || 0;
    const mlMb = limits.mlMb || Number(meta.ml) || 0;

    const descStart = html.indexOf('class="subject-question"');
    let desc = '';
    if (descStart >= 0) {
        const openEnd = html.indexOf('>', descStart);
        let h2 = html.indexOf('<h2', openEnd);
        if (h2 < 0) h2 = html.length;
        desc = nowcoderMd(html.slice(openEnd + 1, h2), meta.url);
    }
    const inM = /<h2[^>]*>\s*输入描述[：:]?\s*<\/h2>\s*<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(html);
    const outM = /<h2[^>]*>\s*输出描述[：:]?\s*<\/h2>\s*<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(html);
    const inputDesc = inM ? nowcoderMd(inM[1], meta.url) : '';
    const outputDesc = outM ? nowcoderMd(outM[1], meta.url) : '';

    // Samples live in .question-oi blocks; visible input/output are <pre> pairs
    // (hidden <textarea> copies are ignored).
    const samples = [];
    const oi = html.search(/question-oi-hd/);
    if (oi >= 0) {
        const tail = html.slice(oi);
        const pres = [];
        const re = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
        let mm;
        while ((mm = re.exec(tail)) !== null) {
            pres.push(decodeEntities(stripTagsTight(mm[1])).replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\n+$/, ''));
        }
        for (let i = 0; i + 1 < pres.length; i += 2) samples.push({ input: pres[i], output: pres[i + 1] });
    }

    const parts = [];
    if (desc) parts.push('## 题目描述\n\n' + desc);
    if (inputDesc) parts.push('## 输入描述\n\n' + inputDesc);
    if (outputDesc) parts.push('## 输出描述\n\n' + outputDesc);
    if (samples.length) {
        const lines = [];
        samples.forEach(function (s, i) {
            lines.push('## 样例 ' + (i + 1));
            lines.push('### 输入');
            lines.push(codeBlock(s.input));
            lines.push('### 输出');
            lines.push(codeBlock(s.output));
            lines.push('');
        });
        parts.push(lines.join('\n\n').trim());
    }
    const body = parts.join('\n\n');
    if (!body || !/subject-question/.test(html)) return null;

    return {
        title: title,
        limits: [tlMs ? (tlMs / 1000) + ' s' : '', mlMb ? mlMb + ' MB' : ''].filter(Boolean).join(' / '),
        body: body,
        samples: samples,
        tlMs: tlMs,
        mlMb: mlMb,
        group: group
    };
}

/* ---------- Chinese translation (Bing web endpoint) ---------- */

const BING_HOME = 'https://cn.bing.com/translator';
const BING_POST = 'https://cn.bing.com/ttranslatev3?isVertical=1';
let bingSession = null;

function curlText(args, timeoutMs) {
    const out = execFileSync('curl.exe', args, {
        maxBuffer: 64 * 1024 * 1024,
        timeout: timeoutMs || 45000,
        windowsHide: true
    });
    return out.toString('utf8');
}

function getBingSession() {
    if (bingSession) return bingSession;
    const jar = path.join(WORKSPACE_ROOT, '.build', 'bing-cookies-' + process.pid + '.txt');
    const page = curlText([
        '-sS', '--max-time', '25', '--compressed', '-A', UA,
        '-H', 'Accept-Language: en-US,en;q=0.9',
        '-c', jar, '-b', jar, BING_HOME
    ]);
    const pm = /params_AbusePreventionHelper\s*=\s*\[(\d+),\s*"([^"]+)",\s*(\d+)\]/.exec(page);
    const ig = /IG:"([^"]+)"/.exec(page);
    const iid = /data-iid="([^"]+)"/.exec(page);
    if (!pm || !ig || !iid) throw new Error('bing: translator page token not found');
    bingSession = { key: pm[1], token: pm[2], ig: ig[1], iid: iid[1], jar: jar };
    return bingSession;
}

function bingTranslate(text) {
    if (!text || !text.trim()) return '';
    const s = getBingSession();
    const url = BING_POST + '&&IG=' + s.ig + '&IID=' + s.iid;
    const out = curlText([
        '-sS', '--max-time', '60', '--compressed', '-A', UA,
        '-H', 'Accept-Language: en-US,en;q=0.9',
        '-H', 'Referer: ' + BING_HOME,
        '-c', s.jar, '-b', s.jar,
        '--data-urlencode', 'fromLang=auto-detect',
        '--data-urlencode', 'text=' + text,
        '--data-urlencode', 'to=zh-Hans',
        '--data-urlencode', 'token=' + s.token,
        '--data-urlencode', 'key=' + s.key,
        url
    ]);
    let j;
    try {
        j = JSON.parse(out);
    } catch (e) {
        throw new Error('bing: bad json: ' + out.slice(0, 160));
    }
    if (!Array.isArray(j) || !j[0] || !j[0].translations || !j[0].translations[0] ||
        typeof j[0].translations[0].text !== 'string') {
        throw new Error('bing: translate failed: ' + out.slice(0, 200));
    }
    return j[0].translations[0].text;
}

function protectInline(text) {
    const store = [];
    const hold = function (m) {
        const token = 'PH' + store.length + 'PH';
        store.push(m);
        return token;
    };
    let s = String(text || '');
    s = s.replace(/\$\$[\s\S]+?\$\$/g, hold);
    s = s.replace(/\$[^$\n]+?\$/g, hold);
    s = s.replace(/`[^`\n]+`/g, hold);
    // images already appear on the English line; do not repeat them in Chinese
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    s = s.replace(/\[[^\]]*\]\([^)]*\)/g, hold);
    s = s.replace(/\*\*|__/g, '');
    s = s.replace(/<sup>([\s\S]*?)<\/sup>/g, '^$1');
    return { text: s, store: store };
}

function restoreInline(text, store) {
    return String(text == null ? '' : text).replace(/PH(\d+)PH/g, function (m, i) {
        const v = store[parseInt(i, 10)];
        return v === undefined ? m : v;
    });
}

function isMetaListBlock(block) {
    if (block.type !== 'list') return false;
    return block.lines.every(function (line) {
        return /^\s*[-*]\s+\*\*(比赛|链接|限制|本地文件)\*\*/.test(line);
    });
}

/*
 * Split a Markdown document into blank-line separated blocks, keeping fenced code
 * blocks and lists intact so that we can pair each block with its translation.
 */
function splitMdBlocks(md) {
    const lines = String(md).split('\n');
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (line.trim() === '') { i++; continue; }
        if (/^\s*```/.test(line)) {
            const buf = [line];
            i++;
            while (i < lines.length) {
                buf.push(lines[i]);
                if (/^\s*```/.test(lines[i])) { i++; break; }
                i++;
            }
            blocks.push({ type: 'code', lines: buf });
            continue;
        }
        if (/^\s*#{1,6}\s/.test(line)) {
            blocks.push({ type: 'heading', lines: [line] });
            i++;
            continue;
        }
        if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
            blocks.push({ type: 'rule', lines: [line] });
            i++;
            continue;
        }
        if (/^\s*[-*]\s+/.test(line)) {
            const buf = [];
            while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { buf.push(lines[i]); i++; }
            blocks.push({ type: 'list', lines: buf });
            continue;
        }
        const buf = [];
        while (i < lines.length && lines[i].trim() !== '') { buf.push(lines[i]); i++; }
        if (buf.length === 1 && /^\*\*[^*]+\*\*$/.test(buf[0].trim())) {
            blocks.push({ type: 'label', lines: buf });
        } else {
            blocks.push({ type: 'para', lines: buf });
        }
    }
    return blocks;
}

function needsTranslation(text) {
    const cjk = (String(text).match(/[\u4e00-\u9fff]/g) || []).length;
    const latin = (String(text).match(/[A-Za-z]/g) || []).length;
    return latin > 120 && cjk < latin / 8;
}

const AI_TRANSLATE_SYSTEM = '你是算法竞赛题面翻译器。把用户给的英文片段翻译成简体中文。硬性要求：' +
    '1) 保留所有形如 PH0PH、PH12PH 的占位符原样，不翻译、不移动、不增删；' +
    '2) 保留片段中用 @@@ 表示的分隔符，数量与位置完全不变；' +
    '3) Markdown 标记、LaTeX 公式、代码、数字、URL 原样保留；' +
    '4) 只输出译文，不要解释、不要加引号、不要输出原文。';

async function translateUnits(units) {
    const CHUNK = 2800;
    const chunks = [];
    let cur = [];
    let curLen = 0;
    for (let k = 0; k < units.length; k++) {
        const u = units[k];
        const add = (cur.length ? 10 : 0) + u.text.length;
        if (cur.length && curLen + add > CHUNK) {
            chunks.push(cur);
            cur = [];
            curLen = 0;
        }
        cur.push(u);
        curLen += add;
    }
    if (cur.length) chunks.push(cur);

    let aiCfg = null;
    try {
        const cfg = aiHelper.loadConfig();
        if (!scriptNoAi && aiHelper.isConfigured(cfg)) {
            aiCfg = cfg;
            console.log('using AI translation: ' + cfg.model + ' @ ' + cfg.baseUrl);
        }
    } catch (e) {
        aiCfg = null;
    }

    let done = 0;
    for (let c = 0; c < chunks.length; c++) {
        const chunk = chunks[c];
        const joined = chunk.map(function (u) { return u.text; }).join('\n\n@@@\n\n');
        let parts = null;

        if (aiCfg) {
            try {
                const out = await aiHelper.chat([
                    { role: 'system', content: AI_TRANSLATE_SYSTEM },
                    { role: 'user', content: joined }
                ], { temperature: 0.1 });
                const maybe = out.split(/@@@/);
                if (maybe.length === chunk.length) {
                    parts = maybe;
                    translationBackend = 'AI';
                }
            } catch (e) {
                appendLog('ai translate chunk failed, fallback to Bing :: ' + e.message);
            }
        }
        if (!parts) {
            try {
                parts = bingTranslate(joined).split(/@@@/);
                if (parts.length !== chunk.length) parts = null;
                else translationBackend = 'Bing';
            } catch (e) {
                parts = null;
            }
        }
        if (!parts) {
            parts = [];
            for (let k = 0; k < chunk.length; k++) {
                parts.push(bingTranslate(chunk[k].text));
            }
            translationBackend = 'Bing';
        }
        for (let k = 0; k < chunk.length; k++) {
            units[done + k].zh = restoreInline(parts[k], units[done + k].store).trim();
        }
        done += chunk.length;
    }
}

/*
 * Build the bilingual Markdown: English line followed by the Chinese line
 * (two trailing spaces = hard line break in Markdown preview). Code blocks,
 * sample data and the metadata header stay untouched.
 */
async function makeBilingual(md) {
    const blocks = splitMdBlocks(md);
    const units = [];
    const byBlock = {};

    for (let bi = 0; bi < blocks.length; bi++) {
        const b = blocks[bi];
        if (b.type === 'heading') {
            const m = /^(\s*#{1,6}\s+)([\s\S]*)$/.exec(b.lines[0]);
            if (!m || /^#\s/.test(b.lines[0])) continue; // keep title as-is
            const p = protectInline(m[2]);
            if (!p.text.trim()) continue;
            units.push({ bi: bi, ii: -1, prefix: m[1], en: m[2], text: p.text, store: p.store });
        } else if (b.type === 'para') {
            const p = protectInline(b.lines.join(' '));
            if (!p.text.trim()) continue;
            units.push({ bi: bi, ii: -1, prefix: '', en: b.lines.join(' '), text: p.text, store: p.store });
        } else if (b.type === 'label') {
            const inner = b.lines[0].trim().replace(/^\*\*|\*\*$/g, '');
            const p = protectInline(inner);
            if (!p.text.trim()) continue;
            units.push({ bi: bi, ii: -1, prefix: '', en: inner, text: p.text, store: p.store });
        } else if (b.type === 'list' && !isMetaListBlock(b)) {
            byBlock[bi] = {};
            for (let ii = 0; ii < b.lines.length; ii++) {
                const m = /^(\s*[-*]\s+)([\s\S]*)$/.exec(b.lines[ii]);
                if (!m) continue;
                const p = protectInline(m[2]);
                if (!p.text.trim()) continue;
                units.push({ bi: bi, ii: ii, prefix: m[1], en: m[2], text: p.text, store: p.store });
            }
        }
    }
    if (!units.length) return md;

    await translateUnits(units);

    const unitAt = function (bi, ii) {
        for (let k = 0; k < units.length; k++) {
            if (units[k].bi === bi && units[k].ii === ii) return units[k];
        }
        return null;
    };

    const out = [];
    let noteInserted = false;
    for (let bi = 0; bi < blocks.length; bi++) {
        const b = blocks[bi];
        if (b.type === 'code') { out.push(b.lines.join('\n')); continue; }
        if (b.type === 'rule') {
            out.push(b.lines.join('\n'));
            if (!noteInserted) {
                out.push('> 中文为 ' + translationBackend + ' 机器翻译，仅供理解题意；以英文原题为准。');
                noteInserted = true;
            }
            continue;
        }
        if (b.type === 'heading') {
            const u = unitAt(bi, -1);
            out.push(u && u.zh ? (u.prefix + u.en + ' / ' + u.zh) : b.lines[0]);
            continue;
        }
        if (b.type === 'para') {
            const u = unitAt(bi, -1);
            out.push(u && u.zh && u.zh !== u.en.trim() ? (u.en + '  \n' + u.zh) : b.lines.join('\n'));
            continue;
        }
        if (b.type === 'label') {
            const u = unitAt(bi, -1);
            out.push(u && u.zh && u.zh !== u.en.trim() ? ('**' + u.en + ' / ' + u.zh + '**') : b.lines.join('\n'));
            continue;
        }
        if (b.type === 'list') {
            if (isMetaListBlock(b)) { out.push(b.lines.join('\n')); continue; }
            const lines = [];
            for (let ii = 0; ii < b.lines.length; ii++) {
                const m = /^(\s*[-*]\s+)([\s\S]*)$/.exec(b.lines[ii]);
                const u = unitAt(bi, ii);
                if (!m || !u || !u.zh || u.zh === u.en.trim()) { lines.push(b.lines[ii]); continue; }
                lines.push(m[1] + m[2] + '  ');
                lines.push('  ' + u.zh);
            }
            out.push(lines.join('\n'));
            continue;
        }
    }
    return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* ---------- main ---------- */

function buildMd(result, meta) {
    const lines = [];
    lines.push('# ' + (result.title || meta.name || 'Problem'));
    lines.push('');
    const bullets = [];
    if (meta.group) bullets.push('- **比赛**: ' + meta.group);
    if (meta.url) bullets.push('- **链接**: ' + meta.url);
    if (result.limits) bullets.push('- **限制**: ' + result.limits);
    if (meta.file) bullets.push('- **本地文件**: ' + String(meta.file).split(path.sep).join('/'));
    if (bullets.length) {
        lines.push(bullets.join('\n'));
        lines.push('', '---', '');
    }
    lines.push(result.body || '');
    lines.push('');
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

async function main() {
    const rawArgs = process.argv.slice(2);
    const force = rawArgs.indexOf('--force') >= 0;
    const noTranslate = rawArgs.indexOf('--no-translate') >= 0;
    const noAi = rawArgs.indexOf('--no-ai') >= 0;
    scriptNoAi = noAi;
    const htmlArg = (rawArgs.filter(function (a) { return a.indexOf('--html=') === 0; })[0] || '').slice(7);
    const samplesOut = (rawArgs.filter(function (a) { return a.indexOf('--samples-out=') === 0; })[0] || '').slice(14);
    const args = rawArgs.filter(function (a) {
        return a !== '--force' && a !== '--no-translate' && a !== '--no-ai' &&
            a.indexOf('--html=') !== 0 && a.indexOf('--samples-out=') !== 0;
    });
    const url = args[0] || '';
    const outPath = args[1] || '';
    const meta = {
        url: url,
        name: args[2] || '',
        group: args[3] || '',
        tl: args[4] || '',
        ml: args[5] || '',
        file: ''
    };
    if (args[6]) {
        try { meta.file = path.relative(WORKSPACE_ROOT, path.resolve(args[6])); } catch (e) { meta.file = args[6]; }
    }
    if (!url || !outPath) {
        console.error('usage: node cph-statement.js <url> <out.md> [name] [group] [tlMs] [mlMb] [srcPath] [--force] [--no-translate] [--no-ai] [--html=page.html] [--samples-out=file.json]');
        return 2;
    }
    if (!/^https?:/i.test(url)) {
        console.error('not an http(s) url: ' + url);
        return 2;
    }
    if (!force && fs.existsSync(outPath)) {
        console.log('SKIP exists: ' + outPath);
        return 0;
    }

    await sleep(150 + Math.random() * 900);
    const host = (function () { try { return new URL(url).hostname.toLowerCase(); } catch (e) { return ''; } })();
    const isCf = /(^|\.)codeforces\.com$/.test(host);
    const isAtCoder = /(^|\.)atcoder\.jp$/.test(host);
    const isLuogu = /(^|\.)luogu\.com(\.cn)?$/.test(host);
    const isNowcoder = /(^|\.)nowcoder\.com$/.test(host);
    if (!isCf && !isAtCoder && !isLuogu && !isNowcoder) {
        console.error('unsupported judge: ' + host + '（支持 Codeforces / AtCoder / 洛谷 / 牛客）');
        return 1;
    }

    let finalUrl = url;
    if (isAtCoder && !/[?&]lang=/.test(finalUrl)) {
        finalUrl += (finalUrl.indexOf('?') >= 0 ? '&' : '?') + 'lang=en';
    }

    let html;
    let parsedAsLuogu = false;
    if (htmlArg) {
        try {
            html = fs.readFileSync(path.resolve(WORKSPACE_ROOT, htmlArg), 'utf8');
        } catch (e) {
            console.error('cannot read --html file: ' + e.message);
            return 1;
        }
    } else {
        try {
            if (isLuogu) html = await fetchLuoguPage(finalUrl);
            else html = await fetchProblem(finalUrl);
        } catch (e) {
            let mirror = '';
            if (isCf) mirror = luoguMirrorUrl(url);
            if (mirror) {
                try {
                    html = await fetchLuoguPage(mirror);
                    parsedAsLuogu = true;
                    console.log('note: Codeforces blocked, used Luogu mirror: ' + mirror);
                    appendLog('cf 403 fallback to ' + mirror + ' for ' + finalUrl);
                } catch (e2) {
                    console.error('fetch failed: ' + e.message + ' ' + finalUrl + ' / mirror also failed: ' + e2.message);
                    appendLog('fetch failed ' + finalUrl + ' :: ' + e.message + ' / mirror ' + mirror + ' :: ' + e2.message);
                    return 1;
                }
            } else {
                console.error('fetch failed: ' + e.message + ' ' + finalUrl);
                appendLog('fetch failed ' + finalUrl + ' :: ' + e.message);
                return 1;
            }
        }
        const headTitle = (/<title>([\s\S]*?)<\/title>/i.exec(html.slice(0, 6000)) || [])[1] || '';
        if (!parsedAsLuogu && isCf && /Just a moment|Enter - Codeforces|Codeforces - Enter/i.test(headTitle)) {
            const msg = 'codeforces anti-bot/login wall (gym/private problem?): ' + url;
            console.error(msg);
            appendLog(msg);
            return 1;
        }
    }

    let result = null;
    try {
        if (parsedAsLuogu) result = buildLuogu(html, meta);
        else if (isCf) result = buildCodeforces(html, meta);
        else if (isAtCoder) result = buildAtCoder(html, meta);
        else if (isLuogu) result = buildLuogu(html, meta);
        else result = buildNowcoder(html, meta);
    } catch (e) {
        appendLog('parse error ' + url + ' :: ' + e.stack);
        console.error('parse error: ' + e.message);
        return 1;
    }
    if (!result || !result.body) {
        appendLog('no statement found ' + url);
        console.error('no statement found (login wall? unsupported layout?)');
        return 1;
    }
    if (!meta.group && result.group) meta.group = String(result.group);

    let md = buildMd(result, meta);
    if (!noTranslate && needsTranslation(result.body || '')) {
        try {
            const bilingual = await makeBilingual(md);
            if (bilingual && bilingual !== md) {
                md = bilingual;
                console.log('translated to zh-CN (' + translationBackend + ')');
            }
        } catch (e) {
            console.error('translate failed: ' + e.message);
            appendLog('translate failed ' + url + ' :: ' + e.message);
        }
    }
    try {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, md, 'utf8');
        console.log('OK ' + outPath + ' (' + Buffer.byteLength(md, 'utf8') + ' bytes)');
        if (samplesOut) {
            try {
                const payload = {
                    title: result.title || meta.name || '',
                    url: meta.url,
                    group: result.group || meta.group || '',
                    timeLimitMs: result.tlMs || (Number(meta.tl) || 0),
                    memoryLimitMb: result.mlMb || (Number(meta.ml) || 0),
                    tests: (result.samples || []).map(function (s) {
                        return { input: String(s.input == null ? '' : s.input), output: String(s.output == null ? '' : s.output) };
                    })
                };
                fs.mkdirSync(path.dirname(path.resolve(samplesOut)), { recursive: true });
                fs.writeFileSync(samplesOut, JSON.stringify(payload, null, 2) + '\n', 'utf8');
                console.log('SAMPLES ' + samplesOut + ' (' + payload.tests.length + ' tests)');
            } catch (e) {
                console.error('samples write failed: ' + e.message);
                appendLog('samples write failed :: ' + e.message);
            }
        }
        return 0;
    } catch (e) {
        console.error('write failed: ' + e.message);
        appendLog('write failed ' + outPath + ' :: ' + e.message);
        return 1;
    }
}

main().then(function (code) {
    process.exit(typeof code === 'number' ? code : 0);
}, function (e) {
    appendLog('fatal ' + (e && e.stack ? e.stack : e));
    console.error('fatal: ' + (e && e.message ? e.message : e));
    process.exit(1);
});
