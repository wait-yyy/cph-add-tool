#!/usr/bin/env node
'use strict';

/*
 * tools/ai-client.js
 * AI helpers for training: contest review, hints, Q&A, statement translation.
 * Talks to any OpenAI-compatible chat API (config in training/ai-config.json
 * or AI_BASE_URL / AI_API_KEY / AI_MODEL env vars).
 *
 * Usage:
 *   node tools/ai-client.js ping
 *   node tools/ai-client.js translate <statement.md> [--out <file>]
 *   node tools/ai-client.js review <contest dir> [--out <file>]
 *   node tools/ai-client.js hint --md <题面.md> [--cpp <代码.cpp>] [--level 1|2|3] [--out <file>]
 *   node tools/ai-client.js ask --md <题面.md> [--cpp <代码.cpp>] --question "问题" [--out <file>]
 *
 * Exit codes: 0 = OK, 1 = failure, 2 = usage / API not configured.
 */

const fs = require('fs');
const path = require('path');
const ai = require('./_ai.js');

const ROOT = path.resolve(__dirname, '..');

function usage() {
    console.log('usage:');
    console.log('  node tools/ai-client.js ping');
    console.log('  node tools/ai-client.js translate <statement.md> [--out <file>]');
    console.log('  node tools/ai-client.js review <contest dir> [--out <file>]');
    console.log('  node tools/ai-client.js hint --md <题面.md> [--cpp <代码.cpp>] [--level 1|2|3] [--out <file>]');
    console.log('  node tools/ai-client.js ask --md <题面.md> [--cpp <代码.cpp>] --question "问题" [--out <file>]');
}

function parseArgs(argv) {
    const flags = {};
    const pos = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--out') { flags.out = argv[++i]; }
        else if (a === '--level') { flags.level = parseInt(argv[++i], 10) || 1; }
        else if (a === '--md') { flags.md = argv[++i]; }
        else if (a === '--cpp') { flags.cpp = argv[++i]; }
        else if (a === '--cpp-label') { flags.cppLabel = argv[++i]; }
        else if (a === '--question') { flags.question = argv[++i]; }
        else if (a === '--error') { flags.error = argv[++i]; }
        else if (a === '--pseudo') { flags.pseudo = argv[++i]; }
        else if (a === '--plan') { flags.plan = argv[++i]; }
        else if (a === '--request') { flags.request = argv[++i]; }
        else if (a.indexOf('--') === 0) { /* ignore unknown flag */ }
        else { pos.push(a); }
    }
    return { flags: flags, pos: pos };
}

function readText(file, maxChars) {
    try {
        const t = fs.readFileSync(file, 'utf8');
        if (maxChars && t.length > maxChars) {
            return t.slice(0, maxChars) + '\n\n…（内容过长已截断）';
        }
        return t;
    } catch (e) {
        return '';
    }
}

function writeOut(text, flags) {
    if (flags.out) {
        fs.mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true });
        fs.writeFileSync(flags.out, text, 'utf8');
        console.log('OK ' + flags.out);
    } else {
        process.stdout.write(text + '\n');
    }
}

function findReviewFile(dir) {
    const direct = path.join(dir, 'review.md');
    if (fs.existsSync(direct)) return direct;
    let best = null;
    try {
        const files = fs.readdirSync(dir).filter(function (f) { return /^review.*\.md$/i.test(f); });
        files.forEach(function (f) {
            const p = path.join(dir, f);
            const st = fs.statSync(p);
            if (!best || st.mtimeMs > best.mtime) best = { path: p, mtime: st.mtimeMs };
        });
    } catch (e) { /* ignore */ }
    return best ? best.path : null;
}

function collectCpp(dir, maxFiles, maxCharsEach) {
    const out = [];
    try {
        const files = fs.readdirSync(dir).filter(function (f) { return /\.cpp$/i.test(f); });
        files.sort();
        for (let i = 0; i < files.length && out.length < maxFiles; i++) {
            const p = path.join(dir, files[i]);
            let t = readText(p, maxCharsEach);
            if (t.trim()) out.push('### ' + files[i] + '\n```cpp\n' + t + '\n```');
        }
    } catch (e) { /* ignore */ }
    return out.join('\n\n');
}

function splitChunks(text, maxChars) {
    const paras = String(text).split(/\n{2,}/);
    const chunks = [];
    let cur = '';
    paras.forEach(function (p) {
        if (cur && cur.length + p.length + 2 > maxChars) {
            chunks.push(cur);
            cur = p;
        } else {
            cur = cur ? (cur + '\n\n' + p) : p;
        }
    });
    if (cur.trim()) chunks.push(cur);
    return chunks;
}

async function cmdPing() {
    const cfg = ai.loadConfig();
    if (!ai.isConfigured(cfg)) {
        console.error('AI API 未配置：在插件里点「设置 AI API」，或写 training/ai-config.json');
        return 2;
    }
    const reply = await ai.chat([
        { role: 'system', content: '你是连接测试助手，只回复 OK 两个大写字母。' },
        { role: 'user', content: 'ping' }
    ], { temperature: 0, maxTokens: 64 });
    console.log('AI OK  model=' + cfg.model + '  baseUrl=' + cfg.baseUrl + '  reply=' + reply.replace(/\s+/g, ' '));
    return 0;
}

async function cmdTranslate(file, flags) {
    const text = readText(file);
    if (!text) { console.error('读不到文件: ' + file); return 1; }
    const chunks = splitChunks(text, 3500);
    const parts = [];
    for (let i = 0; i < chunks.length; i++) {
        const out = await ai.chat([
            {
                role: 'system',
                content: '你是算法竞赛题面翻译器。把用户给的英文题面翻译成简体中文，并以双语 Markdown 输出：先保留原始英文段落，紧接一行中文翻译。要求：代码块、LaTeX 公式、Markdown 标记、数字、URL 原样保留；不要添加解释或标题；不要翻译已经是中文的内容。'
            },
            { role: 'user', content: chunks[i] }
        ], { temperature: 0.1 });
        parts.push(out);
    }
    writeOut(parts.join('\n\n'), flags);
    return 0;
}

async function cmdReview(dir, flags) {
    const reviewFile = findReviewFile(dir);
    if (!reviewFile) { console.error('目录里没有 review.md: ' + dir); return 1; }
    const reviewText = readText(reviewFile, 12000);
    const codeText = collectCpp(dir, 8, 2500);
    const out = await ai.chat([
        {
            role: 'system',
            content: '你是算法竞赛教练，帮用户做赛后复盘。根据给出的比赛数据、题目标签/难度和用户的代码，输出中文 Markdown：\n' +
                '1. 对没过的题：卡点（没思路/思路错/实现或边界错）、正确解法的关键观察（不写完整代码）、下次遇到类似题怎么想；\n' +
                '2. 对过了但 WA 多的题：最可能的错误类型和该养成的习惯；\n' +
                '3. 本场总结：最该补的 1~2 个专题 + 1 个具体习惯问题 + 下一场比赛的 1 个具体行动。\n' +
                '不要写可直接提交的完整题解代码，不要泛泛而谈。'
        },
        { role: 'user', content: '## 比赛复盘数据\n\n' + reviewText + '\n\n## 本地代码\n\n' + (codeText || '（无本地代码）') }
    ], { temperature: 0.3 });
    writeOut(out, flags);
    return 0;
}

async function cmdHint(flags) {
    const md = flags.md || '';
    if (!md) { console.error('hint 需要 --md <题面.md>'); return 2; }
    const level = flags.level || 1;
    const statement = readText(md, 9000);
    if (!statement) { console.error('读不到题面: ' + md); return 1; }
    const code = flags.cpp ? readText(flags.cpp, 7000) : '';
    const codeLabel = flags.cppLabel || (flags.cpp ? path.basename(flags.cpp) : '');
    const levelText = level <= 1
        ? '第一级：只给方向性提示（关键观察 / 该往哪个方向想 / 复杂度），**不要给具体算法步骤，不要给代码或伪代码**。'
        : (level === 2
            ? '第二级：给具体思路（算法、状态定义、要维护的数据结构、复杂度），但**不要给完整代码**；可以给一句伪代码。'
            : '第三级：给伪代码 + 关键实现细节和易错点，但**仍然不要给完整可提交代码**。');
    const hasCode = !!(code && code.trim());
    const out = await ai.chat([
        {
            role: 'system',
            content: '你是算法竞赛教练。用户正在做一道题，你要先认真读「用户当前代码」，再根据代码给出针对性提示。\n' +
                '要求：\n' +
                '1. 先做「代码体检」：判断用户当前思路/算法对不对；如果方向对，指出实现里最可能出问题的地方（bug、边界、复杂度、没写 part），只描述问题，不要贴正确代码；如果代码只是模板或明显没写完，直接点明「还没写代码」并跳过体检。\n' +
                '2. 依据代码进度和下面级别给提示，避免重复用户代码里已经做对的东西：\n' + levelText + '\n' +
                '3. 永远不要给完整可提交代码；不要复述题面；不要泛泛而谈。\n' +
                '输出格式：`## 代码体检\\n- …\\n\\n## 提示\\n- …\\n\\n## 易错点\\n- …`（没有代码时省略代码体检）。'
        },
        {
            role: 'user',
            content: '## 题面\n\n' + statement + '\n\n## 用户当前代码' +
                (codeLabel ? '（' + codeLabel + (flags.cpp ? '，可能是编辑器里未保存的最新版本' : '') + '）' : '') +
                '\n\n' + (code && code.trim() ? '```cpp\n' + code + '\n```' : '（还没写代码）')
        }
    ], { temperature: 0.4 });
    writeOut(out, flags);
    return 0;
}

async function cmdAsk(flags) {
    const question = flags.question || '';
    if (!question) { console.error('ask 需要 --question "问题"'); return 2; }
    const statement = flags.md ? readText(flags.md, 9000) : '';
    const code = flags.cpp ? readText(flags.cpp, 7000) : '';
    const codeLabel = flags.cppLabel || '';
    const out = await ai.chat([
        {
            role: 'system',
            content: '你是算法竞赛教练。用户正在做一道题，回答他的问题。先读「用户当前代码」，回答时尽量结合他的代码现状（指出他哪一步想错/写错、下一步该做什么）。默认只给思路和关键点，不要直接给出完整可提交代码；如果用户明确要代码，再给最小示例。用中文，简洁，Markdown。'
        },
        {
            role: 'user',
            content: '## 题面\n\n' + (statement || '（无）') + '\n\n## 用户当前代码' +
                (codeLabel ? '（' + codeLabel + '，可能是未保存的最新版本）' : '') + '\n\n' +
                (code && code.trim() ? '```cpp\n' + code + '\n```' : '（还没写代码）') +
                '\n\n## 问题\n\n' + question
        }
    ], { temperature: 0.4 });
    writeOut(out, flags);
    return 0;
}

async function cmdDebug(flags) {
    const md = flags.md || '';
    const statement = md ? readText(md, 9000) : '';
    const code = flags.cpp ? readText(flags.cpp, 8000) : '';
    if (!statement && !code) { console.error('debug 需要 --md 或 --cpp'); return 2; }
    const err = String(flags.error || '').trim();
    const out = await ai.chat([
        {
            role: 'system',
            content: '你是算法竞赛教练。用户做错了题，请根据题面、当前代码和用户描述的症状定位错误。\n' +
                '要求：只指出问题和最可能的修法，不要直接给完整可提交代码。\n' +
                '输出 Markdown：\n' +
                '## 错误判断\n（WA / RE / TLE / 编译错误 / 思路错，选最可能的）\n' +
                '## 最可能原因\n（结合具体代码位置说明）\n' +
                '## 定位\n（函数/变量/边界条件；不要贴整份正确代码）\n' +
                '## 验证方法\n（构造什么小数据或检查什么）\n' +
                '## 最小修改建议\n（伪代码或一两行方向，不要完整代码）'
        },
        {
            role: 'user',
            content: '## 题面\n\n' + (statement || '（无题面）') +
                '\n\n## 当前代码\n\n' + (code && code.trim() ? '```cpp\n' + code + '\n```' : '（还没写代码）') +
                '\n\n## 用户描述的错误/症状\n\n' + (err || '（未填写；请根据代码和题面推断最可能的错误）')
        }
    ], { temperature: 0.25 });
    writeOut(out, flags);
    return 0;
}

async function cmdPseudocode(flags) {
    const pseudo = flags.pseudo ? readText(flags.pseudo, 5000) : '';
    if (!pseudo.trim()) { console.error('pseudocode 需要 --pseudo <伪代码文件>'); return 2; }
    const statement = flags.md ? readText(flags.md, 9000) : '';
    const code = flags.cpp ? readText(flags.cpp, 5000) : '';
    const out = await ai.chat([
        {
            role: 'system',
            content: '你是算法竞赛教练。用户在做题前写了简要伪代码/口胡思路，请判断它是否可行。\n' +
                '要求：不要直接给完整代码；不要泛泛而谈。输出 Markdown：\n' +
                '## 思路判断\n（可行 / 方向对但有漏洞 / 不可行，说明理由）\n' +
                '## 反例与漏洞\n（尽量给具体反例；没有反例就写无）\n' +
                '## 复杂度\n（时间/空间，是否满足题目限制）\n' +
                '## 需要补的细节\n（状态定义、边界、实现顺序）\n' +
                '## 结论\n（现在能不能直接写；不能的话先补哪一步）'
        },
        {
            role: 'user',
            content: '## 题面\n\n' + (statement || '（无题面）') +
                '\n\n## 用户伪代码 / 口胡\n\n' + pseudo +
                (code && code.trim() ? '\n\n## 当前代码（供参考）\n\n```cpp\n' + code + '\n```' : '')
        }
    ], { temperature: 0.3 });
    writeOut(out, flags);
    return 0;
}

async function cmdEditorial(flags) {
    const md = flags.md || '';
    if (!md) { console.error('editorial 需要 --md <题面.md>'); return 2; }
    const statement = readText(md, 12000);
    if (!statement) { console.error('读不到题面: ' + md); return 1; }
    const out = await ai.chat([
        {
            role: 'system',
            content: '你是算法竞赛题解作者。根据题面写一篇中文题解，面向正在训练的用户。\n' +
                '输出 Markdown：\n' +
                '## 题意\n## 关键观察\n## 算法\n## 正确性说明\n## 复杂度\n## 实现细节与易错点\n## 类似题/延伸\n' +
                '不要直接给完整可提交代码；可以给伪代码。不要编造题面没有的限制。'
        },
        { role: 'user', content: '## 题面\n\n' + statement }
    ], { temperature: 0.35 });
    writeOut(out, flags);
    return 0;
}

async function cmdPlanAdjust(flags) {
    const planFile = flags.plan ? path.resolve(flags.plan) : path.join(ROOT, 'training', 'plan.json');
    const request = String(flags.request || '').trim();
    if (!request) { console.error('plan-adjust 需要 --request "修改要求"'); return 2; }
    const planText = readText(planFile, 12000);
    if (!planText) { console.error('读不到题单: ' + planFile); return 1; }
    let plan = null;
    try { plan = JSON.parse(planText); } catch (e) { console.error('题单 JSON 无效: ' + planFile); return 1; }
    const out = await ai.chat([
        {
            role: 'system',
            content: '你是算法竞赛训练计划助手。用户会给你当前周题单 JSON 和修改要求，你要返回修改后的题单 JSON（不要 Markdown 代码块、不要解释）。\n' +
                '格式必须为：{"rating":..., "weakTags":[...], "generated":"YYYY-MM-DD HH:mm", "redoCount":数字, "problems":[{"platform":"Codeforces|AtCoder|Luogu|Nowcoder","rating":"1800","title":"题号 — 标题","url":"https://...","tags":"tag1, tag2"}]}。\n' +
                '要求：\n' +
                '1. 只根据用户要求调整难度/分类/题目数量/顺序；保留原题单中合法的题目对象，尽量不要编造 URL。\n' +
                '2. 如果用户要求新增题目，只使用你确定真实存在的题目 URL（Codeforces 形如 https://codeforces.com/contest/<id>/problem/<index> 或 /gym/<id>/problem/<index>；AtCoder /contests/<contest>/tasks/<task>；洛谷 https://www.luogu.com.cn/problem/<pid>），不确定就不要加。\n' +
                '3. 用户没有要求改的字段保持不变。\n' +
                '4. 输出必须是合法 JSON。'
        },
        { role: 'user', content: '## 当前题单 JSON\n\n' + planText + '\n\n## 修改要求\n\n' + request }
    ], { temperature: 0.2 });
    let text = String(out || '').trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try {
        const parsed = JSON.parse(text);
        if (!parsed || !Array.isArray(parsed.problems)) throw new Error('缺少 problems 数组');
        console.log(JSON.stringify(parsed));
        return 0;
    } catch (e) {
        console.error('AI 返回的题单 JSON 无效：' + (e && e.message ? e.message : e));
        console.error(text.slice(0, 500));
        return 1;
    }
}

async function main() {
    const parsed = parseArgs(process.argv.slice(2));
    const flags = parsed.flags;
    const pos = parsed.pos;
    const cmd = pos[0];
    if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') { usage(); return 2; }
    if (cmd === 'ping') return cmdPing();
    if (cmd === 'translate') {
        if (!pos[1]) { usage(); return 2; }
        return cmdTranslate(pos[1], flags);
    }
    if (cmd === 'review') {
        if (!pos[1]) { usage(); return 2; }
        return cmdReview(pos[1], flags);
    }
    if (cmd === 'hint') return cmdHint(flags);
    if (cmd === 'ask') return cmdAsk(flags);
    if (cmd === 'debug') return cmdDebug(flags);
    if (cmd === 'pseudocode') return cmdPseudocode(flags);
    if (cmd === 'editorial') return cmdEditorial(flags);
    if (cmd === 'plan-adjust') return cmdPlanAdjust(flags);
    usage();
    return 2;
}

main().then(function (code) {
    process.exit(typeof code === 'number' ? code : 0);
}, function (e) {
    console.error('AI 失败: ' + (e && e.message ? e.message : e));
    process.exit(1);
});
